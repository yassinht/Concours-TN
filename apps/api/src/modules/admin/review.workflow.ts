import { CONTENT_TRANSITIONS, type ContentStatus } from '@ctn/shared';
import { badRequest, conflict, type ReviewEntity } from './admin.util';

export type ReviewAction = 'approve' | 'reject' | 'publish' | 'archive' | 'to_draft';

export interface TransitionPlan {
  /** Statuses walked through, in order (excluding the current one). Empty = no status change. */
  path: ContentStatus[];
  /** Fact-like entities only: the new needs_verification value (undefined = unchanged). */
  needsVerification?: boolean;
  /** Whether the actor is recorded as the human reviewer (reviewed_by / reviewed_at). */
  setsReviewer: boolean;
}

export function canTransition(from: ContentStatus, to: ContentStatus): boolean {
  return CONTENT_TRANSITIONS[from]?.includes(to) ?? false;
}

function invalid(from: ContentStatus, action: ReviewAction): never {
  throw conflict('INVALID_TRANSITION', { from, action });
}

function step(from: ContentStatus, to: ContentStatus, action: ReviewAction): ContentStatus[] {
  if (!canTransition(from, to)) invalid(from, action);
  return [to];
}

/**
 * Review workflow of questions and lessons (CONTENT_TRANSITIONS from @ctn/shared):
 * - approve → HUMAN_REVIEWED (the actor becomes the reviewer)
 * - publish → PUBLISHED, only from HUMAN_REVIEWED, or from AI_REVIEWED when the actor approves and publishes in one step
 *   (both transitions are recorded and the actor is the reviewer). A DRAFT can never be published directly.
 * - reject → DRAFT (with a comment); an AI draft that no human has reviewed yet is ARCHIVED instead (regenerating is
 *   cheaper than fixing, and it must never resurface in the queue)
 * - archive → ARCHIVED, to_draft → DRAFT
 */
export function planContentTransition(from: ContentStatus, action: ReviewAction, opts: { aiGenerated: boolean }): TransitionPlan {
  switch (action) {
    case 'approve':
      return { path: step(from, 'HUMAN_REVIEWED', action), setsReviewer: true };
    case 'publish':
      if (from === 'HUMAN_REVIEWED') return { path: ['PUBLISHED'], setsReviewer: true };
      if (from === 'AI_REVIEWED') return { path: ['HUMAN_REVIEWED', 'PUBLISHED'], setsReviewer: true };
      return invalid(from, action);
    case 'reject': {
      const aiDraft = opts.aiGenerated && (from === 'DRAFT' || from === 'AI_REVIEWED');
      return { path: step(from, aiDraft ? 'ARCHIVED' : 'DRAFT', action), setsReviewer: false };
    }
    case 'archive':
      return { path: step(from, 'ARCHIVED', action), setsReviewer: false };
    case 'to_draft':
      return { path: step(from, 'DRAFT', action), setsReviewer: false };
  }
}

/**
 * Fact-like entities (competition facts, editions) are gated by needs_verification rather than by an AI pipeline:
 * - approve → verified (needs_verification=false, last verified now); a DRAFT/AI_REVIEWED row becomes HUMAN_REVIEWED
 * - publish → verified and PUBLISHED (through HUMAN_REVIEWED: the actor is the human reviewer)
 * - reject → flagged for verification again; PUBLISHED/HUMAN_REVIEWED rows go back to DRAFT, a DRAFT is ARCHIVED
 * - archive → ARCHIVED, to_draft → DRAFT
 */
export function planFactTransition(from: ContentStatus, action: ReviewAction): TransitionPlan {
  if (from === 'ARCHIVED' && action !== 'to_draft') invalid(from, action);
  switch (action) {
    case 'approve':
      return { path: from === 'DRAFT' || from === 'AI_REVIEWED' ? ['HUMAN_REVIEWED'] : [], needsVerification: false, setsReviewer: true };
    case 'publish': {
      const path: ContentStatus[] = from === 'PUBLISHED' ? [] : from === 'HUMAN_REVIEWED' ? ['PUBLISHED'] : ['HUMAN_REVIEWED', 'PUBLISHED'];
      return { path, needsVerification: false, setsReviewer: true };
    }
    case 'reject':
      return { path: step(from, from === 'DRAFT' ? 'ARCHIVED' : 'DRAFT', action), needsVerification: true, setsReviewer: false };
    case 'archive':
      return { path: step(from, 'ARCHIVED', action), setsReviewer: false };
    case 'to_draft':
      return { path: step(from, 'DRAFT', action), setsReviewer: false };
  }
}

export function planTransition(entity: ReviewEntity, from: ContentStatus, action: ReviewAction, opts: { aiGenerated?: boolean; comment?: string }): TransitionPlan {
  if (action === 'reject' && !opts.comment?.trim()) throw badRequest('COMMENT_REQUIRED');
  const plan = entity === 'fact' || entity === 'edition'
    ? planFactTransition(from, action)
    : planContentTransition(from, action, { aiGenerated: !!opts.aiGenerated });
  // Defence in depth: every hop must be an allowed transition.
  let cur = from;
  for (const next of plan.path) {
    if (!canTransition(cur, next)) invalid(from, action);
    cur = next;
  }
  return plan;
}

/** Statuses a status walk passes through, as [from, to] pairs (one content_reviews row each). */
export function hops(from: ContentStatus, path: ContentStatus[]): [ContentStatus, ContentStatus][] {
  const out: [ContentStatus, ContentStatus][] = [];
  let cur = from;
  for (const next of path) {
    out.push([cur, next]);
    cur = next;
  }
  return out;
}

/**
 * Status after an editor saves an edit: the editor is the human reviewer, so the content lands in HUMAN_REVIEWED
 * (a PUBLISHED item is taken back through DRAFT, as CONTENT_TRANSITIONS requires). ARCHIVED content stays archived.
 */
export function editPath(from: ContentStatus): ContentStatus[] {
  switch (from) {
    case 'DRAFT':
    case 'AI_REVIEWED':
      return ['HUMAN_REVIEWED'];
    case 'HUMAN_REVIEWED':
    case 'ARCHIVED':
      return [];
    case 'PUBLISHED':
      return ['DRAFT', 'HUMAN_REVIEWED'];
  }
}

/** Direct status edits on catalog rows (families, positions, blueprints) follow the same transitions. */
export function assertCatalogTransition(from: ContentStatus, to: ContentStatus): void {
  if (from === to) return;
  if (to === 'PUBLISHED' && from !== 'HUMAN_REVIEWED' && from !== 'AI_REVIEWED' && from !== 'DRAFT') invalid(from, 'publish');
  // A human editor setting PUBLISHED on catalog structure reviews it in the same act (DRAFT/AI_REVIEWED → HUMAN_REVIEWED → PUBLISHED).
  if (to === 'PUBLISHED' && (from === 'DRAFT' || from === 'AI_REVIEWED')) return;
  if (!canTransition(from, to)) throw conflict('INVALID_TRANSITION', { from, to });
}

/** The hops recorded for a direct catalog status edit (see assertCatalogTransition). */
export function catalogPath(from: ContentStatus, to: ContentStatus): ContentStatus[] {
  if (from === to) return [];
  if (to === 'PUBLISHED' && (from === 'DRAFT' || from === 'AI_REVIEWED')) return ['HUMAN_REVIEWED', 'PUBLISHED'];
  return [to];
}
