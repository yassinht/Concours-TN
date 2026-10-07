import { Injectable, Logger } from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { env } from '../../config/env';
import { AiOutputError, isRetryableStatus, jsonInstruction, parseJsonObject, retryDelayMs } from './ai.util';

export interface AiJsonOptions {
  model: 'tutor' | 'content';
  system: string;
  prompt: string;
  maxTokens?: number;
  /** Optional description of the expected JSON shape, appended to the prompt. */
  schemaHint?: string;
}

export interface AiJsonResult<T> {
  data: T;
  model: string;
  tokensIn: number;
  tokensOut: number;
}

/** Minimal surface of the SDK client we use (lets tests inject a fake). */
export type MessagesClient = Pick<Anthropic, 'messages'>;

const DEFAULT_MAX_TOKENS = 4096;
/** Non-streaming requests above ~21k max_tokens are refused by the SDK (10 min timeout heuristic). */
const MAX_NON_STREAMING_TOKENS = 16_000;
const REQUEST_TIMEOUT_MS = 120_000;

/**
 * CONTRACT (owned by the ai module) — thin wrapper over the Anthropic Messages API (@anthropic-ai/sdk).
 * - enabled → true when ANTHROPIC_API_KEY is set. All callers MUST have a deterministic fallback when disabled.
 * - json<T>({ model, system, prompt, maxTokens, schemaHint }) → asks for JSON output, parses & returns { data, model, tokensIn, tokensOut }.
 *   Throws on API/parse failure (callers catch and fall back).
 *
 * One retry on 429 / 5xx / connection errors (the SDK's own retries are disabled so the policy is explicit here).
 * Nothing is persisted by this service: callers record ai_jobs / caches themselves.
 */
@Injectable()
export class AiService {
  private readonly logger = new Logger('AiService');
  private client: MessagesClient | null = null;

  get enabled(): boolean {
    return !!env().ANTHROPIC_API_KEY;
  }

  /** Model id that `json()` will use for a given role (useful for callers that log it before the call). */
  modelId(role: 'tutor' | 'content'): string {
    return role === 'tutor' ? env().AI_MODEL_TUTOR : env().AI_MODEL_CONTENT;
  }

  async json<T>(opts: AiJsonOptions): Promise<AiJsonResult<T>> {
    if (!this.enabled) throw new Error('AI_DISABLED');
    const model = this.modelId(opts.model);
    const maxTokens = Math.max(256, Math.min(opts.maxTokens ?? DEFAULT_MAX_TOKENS, MAX_NON_STREAMING_TOKENS));
    const params: Anthropic.MessageCreateParamsNonStreaming = {
      model,
      max_tokens: maxTokens,
      system: opts.system,
      messages: [{ role: 'user', content: `${opts.prompt}\n\n${jsonInstruction(opts.schemaHint)}` }],
    };

    const message = await this.createWithRetry(params);
    if (message.stop_reason === 'refusal') throw new AiOutputError('AI_REFUSED');
    const text = message.content
      .filter((b): b is Anthropic.TextBlock => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    if (!text.trim()) throw new AiOutputError(message.stop_reason === 'max_tokens' ? 'AI_TRUNCATED' : 'AI_EMPTY');
    let data: T;
    try {
      data = parseJsonObject<T>(text);
    } catch (e) {
      // A cut-off answer is the usual cause of unparsable JSON: say so, callers may retry with a larger budget.
      if (message.stop_reason === 'max_tokens') throw new AiOutputError('AI_TRUNCATED', text.slice(0, 500));
      throw e;
    }
    return { data, model: message.model ?? model, tokensIn: message.usage?.input_tokens ?? 0, tokensOut: message.usage?.output_tokens ?? 0 };
  }

  /** Test seam: replace the SDK client (e.g. with a fake `messages.create`). */
  setClientForTesting(client: MessagesClient | null): void {
    this.client = client;
  }

  private sdk(): MessagesClient {
    if (!this.client) {
      this.client = new Anthropic({ apiKey: env().ANTHROPIC_API_KEY, maxRetries: 0, timeout: REQUEST_TIMEOUT_MS });
    }
    return this.client;
  }

  private async createWithRetry(params: Anthropic.MessageCreateParamsNonStreaming): Promise<Anthropic.Message> {
    try {
      return await this.sdk().messages.create(params);
    } catch (err) {
      const retry = this.retryPlan(err);
      if (!retry) throw err;
      this.logger.warn(`Anthropic call failed (${retry.reason}), retrying once in ${retry.delayMs} ms`);
      await new Promise((r) => setTimeout(r, retry.delayMs));
      return this.sdk().messages.create(params);
    }
  }

  private retryPlan(err: unknown): { reason: string; delayMs: number } | null {
    if (err instanceof Anthropic.APIConnectionError) return { reason: 'connection', delayMs: 1000 };
    if (err instanceof Anthropic.APIError && isRetryableStatus(err.status)) {
      const header = err.headers?.get?.('retry-after') ?? null;
      return { reason: `HTTP ${err.status}`, delayMs: retryDelayMs(header) };
    }
    return null;
  }
}
