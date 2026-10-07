'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import { readLocal, writeLocal } from './hooks';
import type { FeedbackView } from './types';

/**
 * Offline tolerance for answers: a POST /attempts/:id/answers that fails for network reasons is queued in localStorage
 * and retried with exponential backoff (and immediately when the browser comes back online). The latest answer to a
 * question replaces an older queued one, and saves to the same question are serialised so they can never land out of order.
 */

const QUEUE_KEY = 'ctn_answer_queue_v1';
const MAX_BACKOFF_MS = 60_000;
/** Queued answers older than this are dropped (the attempt has long been closed). */
const MAX_AGE_MS = 7 * 86_400_000;

interface Queued { attemptId: string; questionId: string; answer: unknown; timeMs?: number; tries: number; nextAt: number; queuedAt: number }

function readQueue(): Queued[] {
  const now = Date.now();
  return readLocal<Queued[]>(QUEUE_KEY, []).filter((q) => q && typeof q.attemptId === 'string' && now - q.queuedAt < MAX_AGE_MS);
}
function writeQueue(list: Queued[]) {
  writeLocal(QUEUE_KEY, list.length ? list : null);
}
function upsert(item: Queued) {
  writeQueue([...readQueue().filter((q) => !(q.attemptId === item.attemptId && q.questionId === item.questionId)), item]);
}
function removeQueued(attemptId: string, questionId: string) {
  writeQueue(readQueue().filter((q) => !(q.attemptId === attemptId && q.questionId === questionId)));
}
function backoff(tries: number): number {
  return Math.min(MAX_BACKOFF_MS, 1000 * 2 ** Math.min(tries, 6)) + Math.round(Math.random() * 500);
}

/** Network trouble (retry later) vs an answer the server refused (never retried). */
function isTransient(e: unknown): boolean {
  if (e instanceof ApiError) return e.status >= 500 || e.status === 429 || e.status === 408;
  return true; // TypeError from fetch: offline, DNS, proxy…
}

export type SendResult =
  | { status: 'ok'; data: FeedbackView }
  | { status: 'queued' }
  | { status: 'error'; code: string; httpStatus: number };

export interface AnswerSyncHandlers {
  /** A queued answer finally reached the server. */
  onSynced?: (questionId: string, data: FeedbackView) => void;
  /** The server refused a queued answer (limit reached, attempt closed…). */
  onRejected?: (questionId: string, code: string, httpStatus: number) => void;
}

export function useAnswerSync(attemptId: string, handlers: AnswerSyncHandlers) {
  const [pending, setPending] = useState(0);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;
  const chains = useRef(new Map<string, Promise<unknown>>());
  const timer = useRef<number | null>(null);
  const flushing = useRef(false);
  const flushRef = useRef<(force: boolean) => Promise<number>>(async () => 0);

  const refreshCount = useCallback(() => {
    setPending(readQueue().filter((q) => q.attemptId === attemptId).length);
  }, [attemptId]);

  /** Runs `task` after any in-flight save of the same question. */
  const serial = useCallback(<T,>(questionId: string, task: () => Promise<T>): Promise<T> => {
    const prev = chains.current.get(questionId) ?? Promise.resolve();
    const next = prev.catch(() => undefined).then(task);
    chains.current.set(questionId, next);
    void next.finally(() => {
      if (chains.current.get(questionId) === next) chains.current.delete(questionId);
    }).catch(() => undefined);
    return next;
  }, []);

  const post = useCallback((questionId: string, answer: unknown, timeMs?: number) => api<FeedbackView>(
    `/attempts/${attemptId}/answers`,
    { body: { questionId, answer, ...(timeMs !== undefined ? { timeMs: Math.max(0, Math.min(3_600_000, Math.round(timeMs))) } : {}) } },
  ), [attemptId]);

  const schedule = useCallback(() => {
    if (timer.current) window.clearTimeout(timer.current);
    const mine = readQueue().filter((q) => q.attemptId === attemptId);
    if (!mine.length) return;
    const wait = Math.max(250, Math.min(...mine.map((q) => q.nextAt)) - Date.now());
    timer.current = window.setTimeout(() => void flushRef.current(false), wait);
  }, [attemptId]);

  /** Retries the queued answers of this attempt (`force` ignores the backoff, e.g. when back online or before submit). */
  const flush = useCallback(async (force: boolean): Promise<number> => {
    if (flushing.current) return readQueue().filter((q) => q.attemptId === attemptId).length;
    flushing.current = true;
    try {
      const due = readQueue().filter((q) => q.attemptId === attemptId && (force || q.nextAt <= Date.now()));
      for (const item of due) {
        try {
          const data = await serial(item.questionId, () => post(item.questionId, item.answer, item.timeMs));
          // A newer answer may have been queued for the same question meanwhile: only drop the one we sent.
          const still = readQueue().find((q) => q.attemptId === attemptId && q.questionId === item.questionId);
          if (still && still.queuedAt === item.queuedAt) removeQueued(attemptId, item.questionId);
          handlersRef.current.onSynced?.(item.questionId, data);
        } catch (e) {
          if (isTransient(e)) {
            const cur = readQueue().find((q) => q.attemptId === attemptId && q.questionId === item.questionId);
            if (cur && cur.queuedAt === item.queuedAt) upsert({ ...cur, tries: cur.tries + 1, nextAt: Date.now() + backoff(cur.tries + 1) });
            // Still offline: no point hammering the rest of the queue now.
            if (!(e instanceof ApiError)) break;
          } else {
            removeQueued(attemptId, item.questionId);
            const err = e as ApiError;
            handlersRef.current.onRejected?.(item.questionId, err.code, err.status);
          }
        }
      }
    } finally {
      flushing.current = false;
      refreshCount();
      schedule();
    }
    return readQueue().filter((q) => q.attemptId === attemptId).length;
  }, [attemptId, post, serial, refreshCount, schedule]);

  flushRef.current = flush;

  /** Sends one answer now; on network failure it is queued and the caller gets `queued`. */
  const send = useCallback(async (questionId: string, answer: unknown, timeMs?: number): Promise<SendResult> => {
    try {
      const data = await serial(questionId, () => post(questionId, answer, timeMs));
      // A fresh save supersedes an older queued value for this question.
      const stale = readQueue().find((q) => q.attemptId === attemptId && q.questionId === questionId);
      if (stale) {
        removeQueued(attemptId, questionId);
        refreshCount();
      }
      return { status: 'ok', data };
    } catch (e) {
      if (isTransient(e)) {
        upsert({ attemptId, questionId, answer, timeMs, tries: 0, nextAt: Date.now() + backoff(0), queuedAt: Date.now() });
        refreshCount();
        schedule();
        return { status: 'queued' };
      }
      const err = e as ApiError;
      return { status: 'error', code: err.code, httpStatus: err.status };
    }
  }, [attemptId, post, serial, refreshCount, schedule]);

  /** Waits for in-flight saves, then force-flushes the queue. Resolves with what is still pending. */
  const settle = useCallback(async (): Promise<number> => {
    await Promise.allSettled([...chains.current.values()]);
    return flush(true);
  }, [flush]);

  /** Forget everything queued for this attempt (after submit). */
  const clear = useCallback(() => {
    writeQueue(readQueue().filter((q) => q.attemptId !== attemptId));
    refreshCount();
  }, [attemptId, refreshCount]);

  useEffect(() => {
    refreshCount();
    void flushRef.current(true);
    const onOnline = () => void flushRef.current(true);
    window.addEventListener('online', onOnline);
    return () => {
      window.removeEventListener('online', onOnline);
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [refreshCount]);

  return useMemo(() => ({ send, flush, settle, clear, pending }), [send, flush, settle, clear, pending]);
}
