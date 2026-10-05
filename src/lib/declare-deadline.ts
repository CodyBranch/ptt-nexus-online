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
  /** The meet's time zone (IANA). Every time is shown on the meet's clock. */
  timeZone?: string;
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

/** The meet's time zone, from any race that carries it. */
export function meetTimeZone(races: DeadlineRace[]): string | undefined {
  const tz = races.find((r) => r.timeZone)?.timeZone;
  if (!tz) return undefined;
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return tz; } catch { return undefined; }
}

/**
 * A moment as the meet's clock shows it, with the zone named: "Fri 8:00 PM
 * CDT". A coach whose phone is set to another zone still reads the meet's
 * time, and the zone name says whose it is.
 */
export function meetTime(d: Date, tz: string | undefined, opts: Intl.DateTimeFormatOptions = {}): string {
  return d.toLocaleString('en-US', {
    weekday: 'short', hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
    ...(tz ? { timeZone: tz } : {}), ...opts,
  });
}

/** Races this school may put runners in: every race open to someone on its roster. */
export function schoolRaceIds(roster: Array<{ eligibleRaceIds?: string[] }>): Set<string> {
  return new Set(roster.flatMap((a) => a.eligibleRaceIds ?? []));
}

/**
 * Races in the order they go off, as a coach thinks about the day - not by
 * event number, which is only the order they were typed in. A race with no
 * start time keeps its place after the timed ones; ties keep the desk's order.
 */
export function byStartTime<T extends { scheduledTime?: string | null }>(races: T[]): T[] {
  const at = (r: T) => {
    const t = r.scheduledTime ? Date.parse(r.scheduledTime) : NaN;
    return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY;
  };
  return races.map((r, i) => ({ r, i })).sort((a, b) => (at(a.r) - at(b.r)) || (a.i - b.i)).map((x) => x.r);
}

export function isClosed(race: DeadlineRace | undefined, now: Date = new Date()): boolean {
  if (!race) return false;
  const at = closesAtOf(race);
  return at != null && at.getTime() <= now.getTime();
}
