/**
 * French-first labels, badge tones and formatting helpers of the admin back-office.
 * Values from @ctn/shared are imported from the per-file builds so zod never reaches the client bundle.
 */
import type { Confidence, ContentStatus, Difficulty, EditionStatus, PaymentStatus, QuestionType, SourceType, UserRole } from '@ctn/shared';
import { ApiError } from '@/lib/api';
import type { ApiIssue, FactKind } from './types';

export type Tone = 'neutral' | 'primary' | 'success' | 'warning' | 'danger' | 'info' | 'accent';

export const CONTENT_STATUS_LABEL: Record<ContentStatus, string> = {
  DRAFT: 'Brouillon',
  AI_REVIEWED: 'Validé par IA',
  HUMAN_REVIEWED: 'Relu (humain)',
  PUBLISHED: 'Publié',
  ARCHIVED: 'Archivé',
};
export const CONTENT_STATUS_TONE: Record<ContentStatus, Tone> = {
  DRAFT: 'neutral', AI_REVIEWED: 'warning', HUMAN_REVIEWED: 'info', PUBLISHED: 'success', ARCHIVED: 'neutral',
};

export const EDITION_STATUS_LABEL: Record<EditionStatus, string> = {
  EXPECTED: 'Attendue', ANNOUNCED: 'Annoncée', OPEN: 'Inscriptions ouvertes', CLOSED: 'Inscriptions closes', EXAM_DONE: 'Examen passé', RESULTS: 'Résultats publiés',
};
export const EDITION_STATUS_TONE: Record<EditionStatus, Tone> = {
  EXPECTED: 'neutral', ANNOUNCED: 'info', OPEN: 'success', CLOSED: 'warning', EXAM_DONE: 'neutral', RESULTS: 'primary',
};

export const QUESTION_TYPE_LABEL: Record<QuestionType, string> = {
  MCQ_SINGLE: 'QCM (une réponse)', MCQ_MULTI: 'QCM (plusieurs réponses)', TRUE_FALSE: 'Vrai / Faux', MATCHING: 'Appariement', ORDERING: 'Remise en ordre', NUMERIC: 'Numérique',
};
export const DIFFICULTY_LABEL: Record<Difficulty, string> = { EASY: 'Facile', MEDIUM: 'Moyen', HARD: 'Difficile', EXPERT: 'Expert' };
export const ORIGIN_LABEL: Record<string, string> = {
  PAST_EXAM_VERBATIM: 'Annale (verbatim)', PAST_EXAM_REWRITTEN: 'Annale (reformulée)', AUTHORED: 'Rédigée', AI_GENERATED: 'Générée par IA', ALGORITHMIC: 'Algorithmique',
};
export const LANGUAGE_LABEL: Record<string, string> = { ar: 'Arabe', fr: 'Français', en: 'Anglais' };

export const SOURCE_TYPE_LABEL: Record<SourceType, string> = { OFFICIAL: 'Officielle', SECONDARY: 'Secondaire', COMMUNITY: 'Communauté', SUGGESTED: 'Suggestion' };
export const SOURCE_TYPE_TONE: Record<SourceType, Tone> = { OFFICIAL: 'success', SECONDARY: 'info', COMMUNITY: 'neutral', SUGGESTED: 'warning' };
export const CONFIDENCE_LABEL: Record<Confidence, string> = { HIGH: 'Élevée', MEDIUM: 'Moyenne', LOW: 'Faible' };
export const CONFIDENCE_TONE: Record<Confidence, Tone> = { HIGH: 'success', MEDIUM: 'info', LOW: 'warning' };

export const FACT_KIND_LABEL: Record<FactKind, string> = {
  edition: 'Session', eligibility: 'Conditions', phase: 'Épreuve / phase', subject: 'Matière', fact: 'Fait (pièce, test…)',
};

export const PAYMENT_STATUS_LABEL: Record<PaymentStatus, string> = { PENDING: 'En attente', PAID: 'Payé', FAILED: 'Échoué / rejeté', REFUNDED: 'Remboursé' };
export const PAYMENT_STATUS_TONE: Record<PaymentStatus, Tone> = { PENDING: 'warning', PAID: 'success', FAILED: 'danger', REFUNDED: 'neutral' };

export const ROLE_LABEL: Record<UserRole, string> = { USER: 'Utilisateur', EDITOR: 'Éditeur', ADMIN: 'Administrateur' };

export const REPORT_REASON_LABEL: Record<string, string> = {
  WRONG_ANSWER: 'Mauvaise réponse', AMBIGUOUS: 'Ambiguë', TYPO: 'Coquille', OUTDATED: 'Obsolète', OTHER: 'Autre',
};
export const REPORT_STATUS_LABEL: Record<string, string> = { OPEN: 'Ouvert', RESOLVED: 'Résolu', REJECTED: 'Rejeté' };

export const FREQUENCY_LABEL: Record<string, string> = { ANNUAL: 'Annuelle', BIENNIAL: 'Tous les 2 ans', IRREGULAR: 'Irrégulière', UNKNOWN: 'Inconnue' };

export const PHASE_KIND_LABEL: Record<string, string> = {
  WRITTEN: 'Écrit', PHYSICAL: 'Sportif', ORAL: 'Oral', PSYCHOTECH: 'Psychotechnique', MEDICAL: 'Médical', FILE_REVIEW: 'Étude de dossier', INTERVIEW: 'Entretien', TRAINING: 'Formation',
};

/** Why an edition cannot trigger profile alerts (EditionAlertReach.blockedBy / EDITION_NOT_ANNOUNCEABLE reason). */
export const ANNOUNCE_BLOCK_LABEL: Record<string, string> = {
  NOT_PUBLISHED: 'la session n’est pas publiée (relecture humaine requise)',
  STATUS_NOT_OPEN_OR_ANNOUNCED: 'le statut n’est ni « Annoncée » ni « Inscriptions ouvertes »',
  DEADLINE_PASSED: 'la date limite d’inscription est dépassée',
};

export const JOB_STATUS_TONE: Record<string, Tone> = { QUEUED: 'neutral', RUNNING: 'info', DONE: 'success', FAILED: 'danger' };
export const JOB_STATUS_LABEL: Record<string, string> = { QUEUED: 'En file', RUNNING: 'En cours', DONE: 'Terminé', FAILED: 'Échec' };
export const JOB_KIND_LABEL: Record<string, string> = {
  EXTRACT_FACTS: 'Extraction de faits', GENERATE_QUESTIONS: 'Génération IA', GENERATE_ALGORITHMIC: 'Génération algorithmique',
};

// ───────── Errors ─────────

const ERRORS: Record<string, string> = {
  NETWORK: 'Pas de connexion au serveur.',
  SESSION_REQUIRED: 'Session expirée : reconnectez-vous.',
  FORBIDDEN: 'Action réservée à un autre rôle.',
  NOT_FOUND: 'Élément introuvable.',
  VALIDATION_FAILED: 'Certaines valeurs sont invalides.',
  RATE_LIMITED: 'Trop d’actions rapprochées : patientez avant de recommencer.',
  INVALID_TRANSITION: 'Cette transition de statut n’est pas autorisée.',
  COMMENT_REQUIRED: 'Un commentaire est obligatoire pour rejeter.',
  SOURCE_REQUIRED: 'Une source est obligatoire pour marquer comme vérifié.',
  STALE_STATUS: 'L’élément a été modifié entre-temps : rechargez.',
  STALE_VERSION: 'Une autre personne a modifié cette question : rechargez avant d’enregistrer.',
  QUESTION_INVALID: 'La question est incohérente (options / clé de réponse).',
  DUPLICATE_QUESTION: 'Une question identique existe déjà dans ce thème.',
  EXT_ID_TAKEN: 'Cet identifiant externe est déjà utilisé.',
  UNKNOWN_TOPIC: 'Thème inconnu ou archivé.',
  UNKNOWN_OBJECTIVE: 'Objectif(s) inconnu(s).',
  OBJECTIVE_TOPIC_MISMATCH: 'Objectif(s) hors de la branche du thème choisi.',
  UNKNOWN_FAMILY: 'Concours inconnu.',
  UNKNOWN_SOURCE: 'Source inconnue.',
  SOURCE_NOT_FOUND: 'Source inconnue.',
  SOURCE_EXISTS: 'Une source avec cette URL existe déjà.',
  EDITION_EXISTS: 'Une session existe déjà pour cette année et ce libellé.',
  EDITION_NOT_ANNOUNCEABLE: 'Cette session ne peut pas encore déclencher d’alertes.',
  DATES_ORDER: 'Les dates ne sont pas dans le bon ordre (ouverture ≤ clôture ≤ examen).',
  UNKNOWN_POSITION: 'Poste inconnu pour ce concours.',
  SLUG_TAKEN: 'Cet identifiant (slug) est déjà pris.',
  INVALID_SLUG: 'Identifiant invalide (minuscules, chiffres et tirets).',
  ORGANIZATION_REQUIRED: 'Organisation requise.',
  UNKNOWN_ORGANIZATION: 'Organisation inconnue : renseignez ses noms pour la créer.',
  BLUEPRINT_EXISTS: 'Ce poste a déjà un blueprint actif.',
  INVALID_BLUEPRINT: 'Blueprint invalide.',
  LAST_ADMIN: 'Impossible : ce serait le dernier administrateur.',
  CANNOT_CHANGE_OWN_ROLE: 'Vous ne pouvez pas changer votre propre rôle.',
  GUEST_ACCOUNT: 'Compte invité : action impossible.',
  NOT_MANUAL: 'Seuls les paiements manuels se valident à la main.',
  ALREADY_PAID: 'Paiement déjà validé.',
  NOT_PENDING: 'Ce paiement n’est plus en attente.',
  PAYMENT_REFUNDED: 'Paiement remboursé.',
  INVALID_URL: 'Lien invalide (chemin interne « /… » ou URL http(s)).',
  AI_DISABLED: 'L’IA n’est pas configurée sur ce serveur (ANTHROPIC_API_KEY absente).',
  JOBS_BUSY: 'Trop de générations en cours : réessayez dans un instant.',
  TOPIC_NOT_FOUND: 'Thème introuvable.',
  TOPIC_LEVEL_REQUIRED: 'Choisissez un thème de niveau TOPIC (pas une matière ni une unité).',
  FILE_REQUIRED: 'Choisissez un fichier.',
  FILE_TOO_LARGE: 'Fichier trop volumineux (20 Mo max.).',
  INVALID_PDF: 'PDF illisible.',
  UNSUPPORTED_FILE_TYPE: 'Type de fichier non pris en charge (PDF, TXT, HTML).',
  TEXT_MUST_BE_UTF8: 'Le texte doit être encodé en UTF-8.',
  EMPTY_FILE: 'Fichier vide.',
  DOCUMENT_NEEDS_OCR: 'Document scanné sans couche texte : collez le texte à la main.',
  DOCUMENT_HAS_NO_TEXT: 'Ce document ne contient pas de texte.',
  DOCUMENT_OR_TEXT_REQUIRED: 'Choisissez un document ou collez un texte.',
  DOCUMENT_NOT_FOUND: 'Document introuvable.',
  FAMILY_NOT_FOUND: 'Concours introuvable.',
  FAMILY_REQUIRED: 'Choisissez le concours concerné.',
  ALREADY_DRAFTED: 'Ce candidat a déjà été transformé en session.',
  NOTHING_TO_UPDATE: 'Rien à modifier.',
  FILE_REJECTED: 'Fichier refusé.',
};

export interface DescribedError { message: string; code: string; details: string[] }

/** French message + details (zod issues, offending keys…) for any failed API call. */
export function describeError(e: unknown): DescribedError {
  if (!(e instanceof ApiError)) {
    const code = e instanceof TypeError ? 'NETWORK' : 'ERROR';
    return { code, message: ERRORS[code] ?? 'Erreur inattendue.', details: [] };
  }
  const body = (e.body && typeof e.body === 'object' ? e.body : {}) as Record<string, unknown>;
  const details: string[] = [];
  const issues = Array.isArray(body.issues) ? (body.issues as ApiIssue[]) : [];
  for (const i of issues.slice(0, 8)) {
    const path = Array.isArray(i.path) ? i.path.join('.') : i.path;
    details.push(path ? `${path} : ${i.message}` : i.message);
  }
  for (const k of ['objectiveKeys', 'familySlugs', 'positionSlugs', 'topicKey', 'reason', 'field', 'from', 'to', 'action', 'status']) {
    const v = body[k];
    if (v === undefined || v === null) continue;
    const text = Array.isArray(v) ? v.join(', ') : String(v);
    details.push(k === 'reason' && ANNOUNCE_BLOCK_LABEL[text] ? `Raison : ${ANNOUNCE_BLOCK_LABEL[text]}` : `${k} : ${text}`);
  }
  if (e.status === 403 && e.code === 'FORBIDDEN') return { code: e.code, message: 'Action réservée aux administrateurs.', details };
  if (e.status === 429) return { code: e.code, message: ERRORS.RATE_LIMITED, details };
  return { code: e.code, message: ERRORS[e.code] ?? `Erreur (${e.code || e.status}).`, details };
}

// ───────── Formatting ─────────

const dateFmt = new Intl.DateTimeFormat('fr-TN', { day: '2-digit', month: '2-digit', year: 'numeric' });
const dateTimeFmt = new Intl.DateTimeFormat('fr-TN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });

/** DD/MM/YYYY for a date or ISO timestamp ("—" when empty). */
export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso.length === 10 ? `${iso}T00:00:00` : iso);
  return Number.isNaN(d.getTime()) ? iso : dateFmt.format(d);
}

export function fmtDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : dateTimeFmt.format(d);
}

export function fmtNumber(n: number | null | undefined): string {
  return n == null ? '—' : n.toLocaleString('fr-FR');
}

export function fmtPct(ratio: number | null | undefined, digits = 0): string {
  return ratio == null ? '—' : `${(ratio * 100).toFixed(digits)} %`;
}

/** Today in Africa/Tunis as YYYY-MM-DD (the API's reference day). */
export function tunisToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Africa/Tunis', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

export function daysFromToday(iso: string | null | undefined): number | null {
  if (!iso) return null;
  const t = tunisToday();
  const a = Date.UTC(+t.slice(0, 4), +t.slice(5, 7) - 1, +t.slice(8, 10));
  const d = iso.slice(0, 10);
  const b = Date.UTC(+d.slice(0, 4), +d.slice(5, 7) - 1, +d.slice(8, 10));
  return Math.round((b - a) / 86_400_000);
}

/** Query string from a record, skipping empty values. */
export function qs(params: Record<string, string | number | boolean | null | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

/** Only http(s) links are rendered as clickable (sources come from scraped pages and editors). */
export function safeHref(url: string | null | undefined): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

export function truncate(s: string | null | undefined, n: number): string {
  if (!s) return '';
  return s.length > n ? `${s.slice(0, n - 1)}…` : s;
}

/** "Name" of a bilingual row for the French-first back-office (falls back to Arabic). */
export function frName(fr: string | null | undefined, ar: string | null | undefined): string {
  return fr || ar || '';
}
