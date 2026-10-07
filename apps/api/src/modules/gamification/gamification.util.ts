import { diffDaysIso } from './tunis-time';

/** XP needed per day to reach the daily goal shown in the app. */
export const DAILY_GOAL_XP = 30;
/** A 7-day milestone earns a streak freeze, up to this many in reserve. */
export const MAX_STREAK_FREEZES = 3;
export const STREAK_FREEZE_MILESTONE = 7;
export const LEADERBOARD_SIZE = 20;

/**
 * The streak a user sees today. `user_stats.streak_current` is only rewritten on activity, so a streak that was
 * broken days ago is still stored; it counts while it can be continued (yesterday, or two days ago with a freeze).
 */
export function displayedStreak(current: number, lastActiveDate: string | null, freezes: number, today: string): number {
  if (!lastActiveDate || current <= 0) return 0;
  const gap = diffDaysIso(lastActiveDate, today);
  if (gap <= 1) return current;
  if (gap === 2 && freezes > 0) return current;
  return 0;
}

/** Freezes after a streak update: +1 each time the streak reaches a new multiple of 7, capped (never reduced) at 3. */
export function freezesAfter(prevCurrent: number, nextCurrent: number, freezes: number): number {
  const milestone = nextCurrent > prevCurrent && nextCurrent % STREAK_FREEZE_MILESTONE === 0;
  return milestone && freezes < MAX_STREAK_FREEZES ? freezes + 1 : freezes;
}

/**
 * Public leaderboard name: first name + initial of the last name ("Amira B."). Never the email, never the full name.
 * Users without a name appear as a generic candidate label.
 */
export function leaderboardName(name: string | null | undefined, fallback = 'Candidat · مترشح'): string {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return fallback;
  const first = Array.from(parts[0]).slice(0, 20).join('');
  if (parts.length === 1) return first;
  const initial = Array.from(parts[parts.length - 1])[0];
  return `${first} ${initial}.`;
}

/** Standard competition ranking (1, 2, 2, 4) over rows already sorted by xp desc. */
export function rankRows<T extends { xp: number }>(rows: T[]): (T & { rank: number })[] {
  let prevXp: number | null = null;
  let prevRank = 0;
  return rows.map((r, i) => {
    const rank = prevXp !== null && r.xp === prevXp ? prevRank : i + 1;
    prevXp = r.xp;
    prevRank = rank;
    return { ...r, rank };
  });
}
