/** Pure helpers for AiService (kept separate so they are unit-testable without the SDK). */

/** Thrown when the model answered but no usable JSON object could be read from it. */
export class AiOutputError extends Error {
  constructor(code: string, readonly raw?: string) {
    super(code);
    this.name = 'AiOutputError';
  }
}

/** Removes Markdown code fences (```json … ```) wherever they are. */
export function stripCodeFences(text: string): string {
  return text.replace(/```[a-zA-Z0-9_-]*[ \t]*\r?\n?/g, '').replace(/```/g, '');
}

/**
 * Returns the first balanced top-level JSON object found in `text` (string-aware, so braces inside strings do not
 * count). Models sometimes add a sentence before/after the object or wrap it in a fence; both are tolerated.
 */
export function extractFirstJsonObject(text: string): string | null {
  const src = stripCodeFences(text);
  let start = src.indexOf('{');
  while (start !== -1) {
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let i = start; i < src.length; i++) {
      const ch = src[i];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === '\\') escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') inString = true;
      else if (ch === '{') depth++;
      else if (ch === '}') {
        depth--;
        if (depth === 0) {
          const candidate = src.slice(start, i + 1);
          try {
            JSON.parse(candidate);
            return candidate;
          } catch {
            break; // balanced but not JSON (e.g. "{placeholder}" in prose): try the next "{"
          }
        }
      }
    }
    start = src.indexOf('{', start + 1);
  }
  return null;
}

/** Parses the model's text into an object, or throws AiOutputError('AI_INVALID_JSON'). */
export function parseJsonObject<T>(text: string): T {
  const raw = extractFirstJsonObject(text);
  if (!raw) throw new AiOutputError('AI_INVALID_JSON', text.slice(0, 500));
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new AiOutputError('AI_INVALID_JSON', text.slice(0, 500));
  return parsed as T;
}

/** Instruction appended to every prompt: one JSON object, nothing else. */
export function jsonInstruction(schemaHint?: string): string {
  const lines = [
    'Respond with a single JSON object and nothing else: no prose before or after it, no Markdown code fence.',
  ];
  if (schemaHint) lines.push(`The object must follow this shape:\n${schemaHint}`);
  return lines.join('\n');
}

/** HTTP statuses worth one more try: rate limiting and server-side failures. */
export function isRetryableStatus(status: number | undefined): boolean {
  return status === 429 || (typeof status === 'number' && status >= 500);
}

/** Delay before the single retry: honours `retry-after` (seconds) when the API sends it, capped to keep requests snappy. */
export function retryDelayMs(retryAfterHeader: string | null | undefined, fallbackMs = 1500, capMs = 15_000): number {
  const s = retryAfterHeader ? Number(retryAfterHeader) : Number.NaN;
  if (Number.isFinite(s) && s >= 0) return Math.min(capMs, Math.round(s * 1000));
  return fallbackMs;
}
