/**
 * Swaps on the coach's declaration form (entered runners and alternates).
 *
 * At a meet declaring this way each school's runners in a race hold real bibs
 * and the rest of the squad are alternates, with no bib to wear. An alternate
 * comes in only by a swap: they take an entered runner's place and bib, and
 * the runner becomes an alternate. The desk makes the swap when it next pulls
 * the answers, the way its own Swap button does.
 *
 * Stored as two answers (declaration_submissions):
 *   the alternate's: 'declared' in the race, swapFor = the runner
 *   the runner's:    'swapped', swapFor = the alternate
 * Undone, the alternate's becomes 'unswapped' (the desk puts both back when
 * it sees it) and the runner's is cleared, back to what the meet entered.
 *
 * The rules are here, apart from the route, so the check can try them without
 * a database.
 */

export interface SwapRosterRow {
  id: string;
  firstName: string;
  lastName: string;
  eligibleRaceIds?: string[];
  status?: 'declared' | 'scratched' | 'entered';
  raceId?: string | null;
  alternate?: boolean;
}

export interface SwapAnswer {
  athleteId: string;
  status: string;
  raceId: string | null;
  swapFor?: string | null;
}

export interface SwapRules {
  roster: SwapRosterRow[];
  answers: SwapAnswer[];
  finalized: Set<string>;
  closed: (raceId: string) => boolean;
}

type Checked<T> = ({ ok: true } & T) | { ok: false; error: string };

const nameOf = (a: SwapRosterRow | undefined) => (a ? `${a.firstName} ${a.lastName}` : 'That runner');

/** In a swap, either way round: the alternate in, or the runner out. */
export function inSwap(ans: SwapAnswer | undefined): boolean {
  return !!ans && !!ans.swapFor && (ans.status === 'declared' || ans.status === 'swapped');
}

/** Swapped in: running on somebody's bib. */
const swappedIn = (ans: SwapAnswer | undefined) => !!ans && ans.status === 'declared' && !!ans.swapFor;

/**
 * An alternate now: one the meet listed as an alternate and not swapped in,
 * or a runner swapped out (who can go in for somebody else in turn).
 */
export function alternateNow(a: SwapRosterRow, ans: SwapAnswer | undefined): boolean {
  return ans?.status === 'swapped' || (!!a.alternate && !swappedIn(ans));
}

/**
 * The race a runner is in now: their answer's, or with no answer the race the
 * meet entered them in.
 */
export function currentRace(a: SwapRosterRow, ans: SwapAnswer | undefined): string | null {
  if (ans && ans.status !== 'unswapped') return ans.status === 'declared' ? ans.raceId : null;
  return a.status === 'entered' || a.status === 'declared' ? a.raceId ?? null : null;
}

/**
 * The race an alternate would go into in this runner's place: the one they
 * are in, or for a runner marked not running, the one the meet entered them
 * in (their place and bib are free for an alternate).
 */
export function swapRace(a: SwapRosterRow, ans: SwapAnswer | undefined): string | null {
  if (ans?.status === 'scratched') return a.status === 'entered' || a.status === 'declared' ? a.raceId ?? null : null;
  return currentRace(a, ans);
}

/** Whether this alternate may go in for this runner, and into which race. */
export function checkSwap(rules: SwapRules, alternateId: string, forAthleteId: string): Checked<{ raceId: string }> {
  const byId = new Map(rules.roster.map((a) => [a.id, a]));
  const answerOf = new Map(rules.answers.map((x) => [x.athleteId, x]));
  const alt = byId.get(alternateId);
  const out = byId.get(forAthleteId);
  if (!alt || !out) return { ok: false, error: 'Those runners are not on this squad' };
  if (swappedIn(answerOf.get(alternateId))) return { ok: false, error: `${nameOf(alt)} is already in for somebody` };
  if (!alternateNow(alt, answerOf.get(alternateId))) return { ok: false, error: `${nameOf(alt)} is not an alternate` };
  if (answerOf.get(forAthleteId)?.status === 'swapped') return { ok: false, error: `${nameOf(out)} is already swapped out` };
  if (alternateNow(out, answerOf.get(forAthleteId))) return { ok: false, error: `${nameOf(out)} is an alternate, not in a race` };
  const raceId = swapRace(out, answerOf.get(forAthleteId));
  if (!raceId) return { ok: false, error: `${nameOf(out)} is not in a race` };
  if (rules.finalized.has(raceId)) return { ok: false, error: 'That race is finalized. Reopen it to swap.' };
  if (rules.closed(raceId)) return { ok: false, error: 'That race has closed. Call the meet office.' };
  if (Array.isArray(alt.eligibleRaceIds) && !alt.eligibleRaceIds.includes(raceId)) {
    return { ok: false, error: `${nameOf(alt)} cannot run that race` };
  }
  return { ok: true, raceId };
}

/**
 * Whether this alternate's swap can be taken back: only while the runner they
 * went in for is still out for them. Gone in for somebody else since, the
 * runner has nowhere to come back to.
 */
export function checkUnswap(rules: SwapRules, alternateId: string): Checked<{ raceId: string; forAthleteId: string }> {
  const ans = rules.answers.find((x) => x.athleteId === alternateId);
  if (!ans || ans.status !== 'declared' || !ans.swapFor || !ans.raceId) return { ok: false, error: 'There is no swap to undo' };
  const out = rules.answers.find((x) => x.athleteId === ans.swapFor);
  if (!out || out.status !== 'swapped' || out.swapFor !== alternateId) {
    return { ok: false, error: `${nameOf(rules.roster.find((a) => a.id === ans.swapFor))} has gone in for somebody else since, so this swap cannot be undone` };
  }
  if (rules.finalized.has(ans.raceId)) return { ok: false, error: 'That race is finalized. Reopen it to undo the swap.' };
  if (rules.closed(ans.raceId)) return { ok: false, error: 'That race has closed. Call the meet office.' };
  return { ok: true, raceId: ans.raceId, forAthleteId: ans.swapFor };
}
