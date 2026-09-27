/**
 * When declarations close for a race.
 *
 * One rule, used by the coach's form (to grey a race out and count down to
 * it) and by the server (to refuse a change after it). Two copies would drift,
 * and the day they disagree is the day a runner is added to a start list that
 * has already been printed.
 *
 * The desk works out each race's closing moment itself — a cutoff can be set
 * for the whole meet, per gender, or per race, as minutes before the start or
 * as a fixed time — and sends it as `closesAt`: an ISO instant, or null for a
 * race that never closes. A session published by an older desk has no
 * `closesAt` at all, and falls back to what that desk meant: `deadlineMinutes`
 * (default 30) before `scheduledTime`.
 */

export interface DeadlineRace {
  id: string;
  /** ISO instant the race goes off. */
  scheduledTime?: string;
  /** Older desks: minutes before the start. */
  deadlineMinutes?: number;
  /** The closing moment the desk worked out; null means it never closes. */
  closesAt?: string | null;
}

export function closesAtOf(race: DeadlineRace): Date | null {
  if ('closesAt' in race) {
    if (!race.closesAt) return null;
    const d = new Date(race.closesAt);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  if (!race.scheduledTime) return null;
  const start = new Date(race.scheduledTime);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() - (race.deadlineMinutes ?? 30) * 60_000);
}

export function isClosed(race: DeadlineRace | undefined, now: Date = new Date()): boolean {
  if (!race) return false;
  const at = closesAtOf(race);
  return at != null && at.getTime() <= now.getTime();
}
