import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { z } from 'zod';
import {
  CONFIDENCES, CONTENT_STATUSES, DIPLOMA_LEVELS, DOMAINS, FIELDS, GENDERS, PAYMENT_PROVIDERS, PAYMENT_STATUSES,
  QUESTION_ORIGINS, SOURCE_TYPES, USER_ROLES, type ContentStatus,
} from '@ctn/shared';

// ───────────── Ids, paging, small helpers ─────────────

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === 'string' && UUID_RE.test(v);

/** Path ids that are not UUIDs can never match a row: answer 404 instead of a database cast error. */
export function assertUuid(v: string): string {
  if (!isUuid(v)) throw new NotFoundException('NOT_FOUND');
  return v;
}

export const notFound = () => new NotFoundException('NOT_FOUND');
export const badRequest = (message: string, extra: Record<string, unknown> = {}) => new BadRequestException({ message, ...extra });
export const conflict = (message: string, extra: Record<string, unknown> = {}) => new ConflictException({ message, ...extra });

export interface Paging { page: number; pageSize: number; offset: number }
export function paging(page: number | undefined, pageSize: number | undefined, defSize = 25, maxSize = 100): Paging {
  const p = Math.max(1, page ?? 1);
  const s = Math.min(Math.max(1, pageSize ?? defSize), maxSize);
  return { page: p, pageSize: s, offset: (p - 1) * s };
}

export const iso = (d: Date | null | undefined): string | null => (d ? d.toISOString() : null);

/** ILIKE pattern for free-text admin search (wildcards escaped), or null when the query is empty. */
export function likeAny(q: string | undefined | null): string | null {
  const s = (q ?? '').trim();
  if (!s) return null;
  return `%${s.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
}

/** Escapes LIKE wildcards so a key is matched literally as a prefix of descendants (`key.%`). */
export const likeChildren = (key: string) => `${key.replace(/[\\%_]/g, (c) => `\\${c}`)}.%`;

/** Field-by-field diff of two flat records (only keys present in `next`), for audit logs and "did anything change?". */
export function diffFields(prev: Record<string, unknown>, next: Record<string, unknown>): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const [k, v] of Object.entries(next)) {
    if (v === undefined) continue;
    if (!sameValue(prev[k], v)) out[k] = { from: prev[k] ?? null, to: v };
  }
  return out;
}

export function sameValue(a: unknown, b: unknown): boolean {
  return JSON.stringify(normalize(a)) === JSON.stringify(normalize(b));
}

function normalize(v: unknown): unknown {
  if (v === undefined) return null;
  if (v instanceof Date) return v.toISOString();
  if (Array.isArray(v)) return v.map(normalize);
  if (v && typeof v === 'object') {
    return Object.fromEntries(
      Object.entries(v as Record<string, unknown>)
        .filter(([, x]) => x !== undefined)
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, x]) => [k, normalize(x)]),
    );
  }
  return v;
}

/** Same-site path ("/concours/x") or absolute https URL; anything else (javascript:, //evil) is refused. */
export function isSafeLink(url: string): boolean {
  if (/[\u0000-\u001f\u007f\s]/.test(url)) return false;
  if (url.startsWith('/')) return !url.startsWith('//') && !url.includes('\\');
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}

/** DD/MM/YYYY — the format Tunisian announcements use, in both languages. */
export function formatDay(isoDate: string | null | undefined): string {
  if (!isoDate || !/^\d{4}-\d{2}-\d{2}/.test(isoDate)) return '—';
  const [y, m, d] = isoDate.slice(0, 10).split('-');
  return `${d}/${m}/${y}`;
}

// ───────────── Query-string parsing ─────────────

const blank = (v: unknown) => (v === '' || v === null ? undefined : v);
export const opt = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blank, schema.optional());
const toInt = (v: unknown) => (typeof v === 'string' && /^\d{1,7}$/.test(v) ? Number(v) : v);
export const optInt = (min: number, max: number) => z.preprocess((v) => toInt(blank(v)), z.number().int().min(min).max(max).optional());
const toBool = (v: unknown) => (v === 'true' || v === '1' ? true : v === 'false' || v === '0' ? false : v);
export const optBool = () => z.preprocess((v) => toBool(blank(v)), z.boolean().optional());
export const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD');
export const slugSchema = z.string().min(2).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'lowercase-slug');

export const REVIEW_ENTITIES = ['question', 'fact', 'lesson', 'edition'] as const;
export type ReviewEntity = (typeof REVIEW_ENTITIES)[number];

export const ReviewQueueQuery = z.object({
  entity: z.preprocess(blank, z.enum(REVIEW_ENTITIES).default('question')),
  status: opt(z.enum(CONTENT_STATUSES)),
  familySlug: opt(z.string().max(80)),
  domain: opt(z.enum(DOMAINS)),
  /** Questions/lessons of this syllabus node or any node below it (review a topic at a time). */
  topicKey: opt(z.string().max(200)),
  limit: optInt(1, 200),
});
export type ReviewQueueQuery = z.infer<typeof ReviewQueueQuery>;

export const QuestionsQuery = z.object({
  status: opt(z.enum(CONTENT_STATUSES)),
  domain: opt(z.enum(DOMAINS)),
  topicKey: opt(z.string().max(200)),
  familySlug: opt(z.string().max(80)),
  origin: opt(z.enum(QUESTION_ORIGINS)),
  q: opt(z.string().max(200)),
  reported: optBool(),
  sort: opt(z.enum(['recent', 'oldest', 'accuracy', 'attempts', 'reports'])),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 100),
});
export type QuestionsQuery = z.infer<typeof QuestionsQuery>;

export const LessonsQuery = z.object({
  status: opt(z.enum(CONTENT_STATUSES)),
  topicKey: opt(z.string().max(200)),
  q: opt(z.string().max(200)),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 100),
});
export type LessonsQuery = z.infer<typeof LessonsQuery>;

export const EditionsQuery = z.object({
  familySlug: opt(z.string().max(80)),
  status: opt(z.enum(['EXPECTED', 'ANNOUNCED', 'OPEN', 'CLOSED', 'EXAM_DONE', 'RESULTS'])),
  year: optInt(1990, 2100),
  needsVerification: optBool(),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 200),
});
export type EditionsQuery = z.infer<typeof EditionsQuery>;

export const FACT_KINDS = ['fact', 'phase', 'subject', 'eligibility', 'edition'] as const;
export type FactKind = (typeof FACT_KINDS)[number];

export const FactsQuery = z.object({
  needsVerification: z.preprocess(blank, z.enum(['true', 'false', 'all']).default('true')),
  familySlug: opt(z.string().max(80)),
  kind: opt(z.enum(FACT_KINDS)),
  limit: optInt(1, 1000),
});
export type FactsQuery = z.infer<typeof FactsQuery>;

export const SourcesQuery = z.object({
  q: opt(z.string().max(200)),
  sourceType: opt(z.enum(SOURCE_TYPES)),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 200),
});
export type SourcesQuery = z.infer<typeof SourcesQuery>;

export const BlueprintsQuery = z.object({ familySlug: opt(z.string().max(80)), positionSlug: opt(z.string().max(80)) });
export type BlueprintsQuery = z.infer<typeof BlueprintsQuery>;

export const REPORT_STATUSES = ['OPEN', 'RESOLVED', 'REJECTED'] as const;
export const ReportsQuery = z.object({
  status: z.preprocess(blank, z.enum([...REPORT_STATUSES, 'ALL']).default('OPEN')),
  questionId: opt(z.string().uuid()),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 100),
});
export type ReportsQuery = z.infer<typeof ReportsQuery>;

export const UsersQuery = z.object({
  q: opt(z.string().max(200)),
  role: opt(z.enum(USER_ROLES)),
  premium: optBool(),
  includeGuests: optBool(),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 100),
});
export type UsersQuery = z.infer<typeof UsersQuery>;

export const PaymentsQuery = z.object({
  status: opt(z.enum(PAYMENT_STATUSES)),
  provider: opt(z.enum(PAYMENT_PROVIDERS)),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 100),
});
export type PaymentsQuery = z.infer<typeof PaymentsQuery>;

export const WaitlistQuery = z.object({
  familySlug: opt(z.string().max(120)),
  page: optInt(1, 100_000),
  pageSize: optInt(1, 500),
  format: opt(z.enum(['json', 'csv'])),
});
export type WaitlistQuery = z.infer<typeof WaitlistQuery>;

export const AuditQuery = z.object({
  limit: optInt(1, 500),
  entityType: opt(z.string().max(40)),
  entityId: opt(z.string().max(80)),
  actorId: opt(z.string().uuid()),
  action: opt(z.string().max(80)),
  before: opt(z.string().datetime({ offset: true })),
});
export type AuditQuery = z.infer<typeof AuditQuery>;

// ───────────── Admin-only bodies (not in @ctn/shared; documented in the result "requests") ─────────────

export const BulkReviewInput = z.object({
  ids: z.array(z.string().uuid()).min(1).max(200),
  action: z.enum(['approve', 'reject', 'publish', 'archive', 'to_draft']),
  comment: z.string().max(2000).optional(),
});
export type BulkReviewInput = z.infer<typeof BulkReviewInput>;

const nullableText = (max: number) => z.string().max(max).nullable().optional();

export const OrganizationInput = z.object({
  slug: slugSchema,
  name_ar: z.string().min(2).max(200),
  name_fr: z.string().min(2).max(200),
  ministry_fr: nullableText(200),
  website: z.string().url().max(300).nullable().optional(),
});

const familyFields = {
  field: z.enum(FIELDS),
  /** Existing organization by slug, or a new one. */
  organizationSlug: slugSchema.optional(),
  organization: OrganizationInput.optional(),
  name_ar: z.string().min(2).max(200),
  name_fr: z.string().min(2).max(200),
  description_ar: z.string().max(5000).optional(),
  description_fr: z.string().max(5000).optional(),
  frequency: z.enum(['ANNUAL', 'BIENNIAL', 'IRREGULAR', 'UNKNOWN']).optional(),
  popularity: z.number().int().min(1).max(5).optional(),
  keywords: z.array(z.string().min(1).max(60)).max(40).optional(),
  tips_ar: z.array(z.string().min(1).max(500)).max(30).optional(),
  tips_fr: z.array(z.string().min(1).max(500)).max(30).optional(),
  researchNotes: nullableText(10_000),
  status: z.enum(CONTENT_STATUSES).optional(),
};
export const FamilyCreateInput = z.object(familyFields).refine((v) => v.organizationSlug || v.organization, {
  message: 'organizationSlug or organization required',
  path: ['organizationSlug'],
});
export type FamilyCreateInput = z.infer<typeof FamilyCreateInput>;
export const FamilyPatchInput = z.object(familyFields).partial();
export type FamilyPatchInput = z.infer<typeof FamilyPatchInput>;

export const EligibilityRulesInput = z.object({
  min_age: z.number().int().min(10).max(100).nullable().optional(),
  max_age: z.number().int().min(10).max(100).nullable().optional(),
  genders: z.array(z.enum(GENDERS)).max(2).nullable().optional(),
  nationality: z.string().max(10).nullable().optional(),
  min_diploma: z.enum(DIPLOMA_LEVELS).nullable().optional(),
  diplomas: z.array(z.enum(DIPLOMA_LEVELS)).nullable().optional(),
  specialties: z.array(z.string().min(1).max(120)).max(60).nullable().optional(),
  min_height_cm_male: z.number().int().min(100).max(230).nullable().optional(),
  min_height_cm_female: z.number().int().min(100).max(230).nullable().optional(),
  marital_status: z.literal('SINGLE').nullable().optional(),
  other_ar: z.array(z.string().min(1).max(500)).max(30).optional(),
  other_fr: z.array(z.string().min(1).max(500)).max(30).optional(),
}).strict().refine((r) => r.min_age == null || r.max_age == null || r.min_age <= r.max_age, { message: 'min_age > max_age', path: ['max_age'] });

const positionFields = {
  title_ar: z.string().min(2).max(200),
  title_fr: z.string().min(2).max(200),
  diplomaLevel: z.enum(DIPLOMA_LEVELS),
  eligibility: EligibilityRulesInput.optional(),
  eligibilitySourceId: z.string().uuid().nullable().optional(),
  eligibilityConfidence: z.enum(CONFIDENCES).optional(),
  eligibilityNeedsVerification: z.boolean().optional(),
  eligibilityQuote: nullableText(5000),
  orderIndex: z.number().int().min(0).max(1000).optional(),
  status: z.enum(CONTENT_STATUSES).optional(),
};
export const PositionCreateInput = z.object(positionFields);
export type PositionCreateInput = z.infer<typeof PositionCreateInput>;
export const PositionPatchInput = z.object(positionFields).partial();
export type PositionPatchInput = z.infer<typeof PositionPatchInput>;

export const BlueprintSection = z.object({
  domain: z.enum(DOMAINS),
  specialtyKey: z.string().max(200).nullable().optional(),
  count: z.number().int().min(1).max(200),
  minutes: z.number().int().min(0).max(600),
});
const blueprintFields = {
  title: z.string().min(2).max(200),
  totalMinutes: z.number().int().min(1).max(600),
  fidelity: z.enum(['OFFICIAL_FORMAT', 'APPROXIMATED']),
  sections: z.array(BlueprintSection).min(1).max(30),
  status: z.enum(CONTENT_STATUSES).optional(),
};
export const BlueprintCreateInput = z.object({
  positionId: z.string().uuid().optional(),
  familySlug: z.string().max(80).optional(),
  positionSlug: z.string().max(80).optional(),
  ...blueprintFields,
}).refine((v) => v.positionId || (v.familySlug && v.positionSlug), { message: 'positionId or familySlug+positionSlug required', path: ['positionId'] });
export type BlueprintCreateInput = z.infer<typeof BlueprintCreateInput>;
export const BlueprintPatchInput = z.object(blueprintFields).partial();
export type BlueprintPatchInput = z.infer<typeof BlueprintPatchInput>;

export const ReportPatchInput = z.object({
  status: z.enum(REPORT_STATUSES),
  /** Applies the same status to every OPEN report of the same question. */
  applyToQuestion: z.boolean().optional(),
  /** Thanks the reporter(s) with an in-app notification when RESOLVED (default true). */
  notifyReporter: z.boolean().optional(),
});
export type ReportPatchInput = z.infer<typeof ReportPatchInput>;

export const UserPatchInput = z.object({
  role: z.enum(USER_ROLES).optional(),
  grantDays: z.number().int().min(1).max(3650).optional(),
  planCode: z.string().max(40).optional(),
}).refine((v) => v.role !== undefined || v.grantDays !== undefined, { message: 'role or grantDays required' });
export type UserPatchInput = z.infer<typeof UserPatchInput>;

export const PaymentRejectInput = z.object({ reason: z.string().max(300).optional() }).default({});
export type PaymentRejectInput = z.infer<typeof PaymentRejectInput>;

export const EditionUpdateNoticeInput = z.object({
  summary_ar: z.string().min(3).max(400),
  summary_fr: z.string().min(3).max(400),
});
export type EditionUpdateNoticeInput = z.infer<typeof EditionUpdateNoticeInput>;

export const LessonPatchInput = z.object({
  title: z.string().min(2).max(300).optional(),
  bodyMd: z.string().min(10).max(100_000).optional(),
  estMinutes: z.number().int().min(1).max(240).optional(),
  language: z.enum(['ar', 'fr', 'en']).optional(),
});
export type LessonPatchInput = z.infer<typeof LessonPatchInput>;

export const PublishFlagQuery = z.object({ publish: optBool() });
export const NotifyFlagQuery = z.object({ notify: optBool() });
export const ReplaceFlagQuery = z.object({ replace: optBool() });
export const DryRunQuery = z.object({ dryRun: optBool() });

/** Statuses an admin may set directly on catalog rows (families, positions, blueprints) — still checked against transitions. */
export type CatalogStatus = ContentStatus;
