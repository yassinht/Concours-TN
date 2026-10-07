/**
 * Calendar helpers for Africa/Tunis. Daily goals, streaks, weekly leaderboards and reminder schedules all follow the
 * candidate's local day, not UTC (midnight UTC is 01:00 in Tunis).
 */
export const TUNIS_TZ = 'Africa/Tunis';

const partsFormat = new Intl.DateTimeFormat('en-GB', {
  timeZone: TUNIS_TZ,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
  weekday: 'short',
});

const WEEKDAYS: Record<string, number> = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };

export interface TunisParts {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
  /** ISO weekday: 1 = Monday … 7 = Sunday. */
  weekday: number;
}

function rawParts(d: Date) {
  const p: Record<string, string> = {};
  for (const part of partsFormat.formatToParts(d)) p[part.type] = part.value;
  return {
    year: Number(p.year), month: Number(p.month), day: Number(p.day),
    hour: Number(p.hour) % 24, minute: Number(p.minute), second: Number(p.second), weekday: WEEKDAYS[p.weekday] ?? 1,
  };
}

export function tunisParts(d = new Date()): TunisParts {
  const p = rawParts(d);
  const date = `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  return { date, hour: p.hour, minute: p.minute, weekday: p.weekday };
}

/** Local-minus-UTC offset (ms) of Africa/Tunis at instant `d`. */
function offsetMs(d: Date): number {
  const p = rawParts(d);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - (d.getTime() - d.getUTCMilliseconds());
}

/** The UTC instant of 00:00 Africa/Tunis on `date` (YYYY-MM-DD). */
export function tunisMidnightUtc(date: string): Date {
  const guess = Date.parse(`${date}T00:00:00Z`);
  let t = guess - offsetMs(new Date(guess));
  // Second pass in case the first guess crossed an offset change.
  t = guess - offsetMs(new Date(t));
  return new Date(t);
}

/** Monday 00:00 Africa/Tunis of the week containing `now`, as a UTC instant. */
export function tunisWeekStartUtc(now = new Date()): Date {
  const { date, weekday } = tunisParts(now);
  return tunisMidnightUtc(addDaysIso(date, -(weekday - 1)));
}

/** `date` (YYYY-MM-DD) shifted by `days` calendar days. */
export function addDaysIso(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole calendar days from `from` to `to` (both YYYY-MM-DD). */
export function diffDaysIso(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}
