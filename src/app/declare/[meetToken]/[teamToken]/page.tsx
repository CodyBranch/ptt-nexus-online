'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
import { byStartTime, closesAtOf, isClosed, meetTimeZone, meetTime, schoolRaceIds } from '@/lib/declare-deadline';
import Image from 'next/image';
import { useParams } from 'next/navigation';

/**
 * The coach's declaration form.
 *
 * One row per runner, and one question on it: which race are they in, or are
 * they out. A meet with a Gold and an Open race asks it as a choice between
 * them; a meet with one race asks it as in or out. Same control either way,
 * because a coach at one meet should not have to learn a second form at the
 * next.
 *
 * Dressed as the relay portal — same dark ground, same single narrow column,
 * same sticky header — because it is the same coach on the same phone, and a
 * second visual language would be a second thing to learn.
 *
 * Built for that phone held one-handed in a car park, which drives the rest:
 * full-width controls a thumb can hit without aiming, and the deadline and the
 * count of unanswered runners pinned to the top where scrolling a squad of
 * thirty cannot lose them.
 *
 * Saving happens per tap rather than behind a Submit. A form that loses twenty
 * answers because the signal went before the button was pressed is worse than
 * one that saves nineteen and says so about the twentieth.
 */

// ── Talking to the server ─────────────────────────────────────────────────────

/**
 * fetch, but patient.
 *
 * A request that stalls or meets a server hiccup is tried again, up to three
 * times, each attempt given ten seconds, before the coach is told anything.
 * Only failures that another try can fix are retried — a network error, a
 * timeout, a 5xx — never a 4xx, which is the server's considered answer.
 * Every write on this form is safe to repeat: an answer is set, not added.
 */
async function request(url: string, init?: RequestInit): Promise<Response> {
  const waits = [0, 700, 2000];
  let last: unknown = null;
  for (const wait of waits) {
    if (wait) await new Promise((r) => setTimeout(r, wait));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 10_000);
    try {
      const res = await fetch(url, { ...init, signal: ctl.signal, cache: 'no-store' });
      if (res.status < 500) return res;
      last = new Error(`HTTP ${res.status}`);
    } catch (e) {
      last = e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw last ?? new Error('unreachable');
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface Race {
  id: string;
  name: string;
  gender: string;
  distanceLabel?: string;
  scheduledTime?: string;
  deadlineMinutes?: number;
  /** The closing moment the desk worked out; null: it never closes. */
  closesAt?: string | null;
  /** The meet's time zone. */
  timeZone?: string;
  /** The most runners this school may declare into it; absent: no limit. */
  maxPerSchool?: number;
}

interface RosterAthlete {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
  gender?: string;
  year?: string;
  eligibleRaceIds: string[];
  /**
   * What the meet has on file: 'entered' with the race they were entered in,
   * not yet confirmed by anybody. Marked on the form, never counted as an
   * answer — confirming is the coach's.
   */
  status?: 'declared' | 'scratched' | 'entered';
  raceId?: string | null;
  /**
   * Entered and alternates: one of the squad not in a race, with no bib to
   * wear. They come in only by a swap with a runner who is.
   */
  alternate?: boolean;
}

interface Declaration {
  athleteId: string;
  /** 'swapped' / 'unswapped': one side of a swap with an alternate (swapFor). */
  status: 'declared' | 'scratched' | 'swapped' | 'unswapped';
  raceId: string | null;
  swapFor?: string | null;
}

interface Finalization {
  raceId: string;
  finalizedAt: string | null;
}

interface FormData {
  meetName: string;
  meetDate: string | null;
  /** What this meet calls the two sides of its field. */
  genderTerms?: 'boys_girls' | 'men_women';
  races: Race[];
  teamName: string;
  /** The meet's sign-up for coach texts, with this school picked; null before it has one. */
  textsUrl?: string | null;
  roster: RosterAthlete[];
  declarations: Declaration[];
  finalized?: Finalization[];
  /** Bibs the meet office has had handed back, by runner. */
  bibsReturned?: Array<{ athleteId: string; returnedAt: string }>;
}

type Choice = { kind: 'race'; raceId: string } | { kind: 'scratched' } | { kind: 'none' };

/** 'M' or 'F', or null when the value says nothing. */
function genderSide(value: string | null | undefined): 'M' | 'F' | null {
  const v = (value ?? '').trim().toUpperCase();
  if (!v) return null;
  // Before the M check: "Mixed" begins with one.
  if (v === 'X' || v.startsWith('MIXED') || v.startsWith('OPEN')) return null;
  if (v.startsWith('M') || v === 'B' || v.startsWith('BOY')) return 'M';
  if (v.startsWith('F') || v === 'W' || v === 'G' || v.startsWith('GIRL') || v.startsWith('WOM')) return 'F';
  return null;
}

/**
 * A race's name without the side of the field in front — "Gold Invite 8k"
 * for "Men's Gold Invite 8k". On a runner's own card the side goes without
 * saying, and the full name wrapped two buttons to two lines on a phone.
 */
function shortRaceName(name: string): string {
  const short = name.replace(/^(men['’]?s?|women['’]?s?|boys['’]?|girls['’]?)\s+/i, '').trim();
  return short || name;
}

const GENDER_WORDS = {
  boys_girls: { M: 'Boys', F: 'Girls' },
  men_women: { M: 'Men', F: 'Women' },
} as const;

// ── The deadline ──────────────────────────────────────────────────────────────

/** When declarations close for a race. The same rule the server enforces. */
const deadlineOf = (race: Race): Date | null => closesAtOf(race);



/** "1h 12m", "4m 20s", "closed" — readable at a glance and at arm's length. */
function untilText(deadline: Date, now: Date): string {
  const ms = deadline.getTime() - now.getTime();
  if (ms <= 0) return 'closed';
  const total = Math.floor(ms / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ── Page ──────────────────────────────────────────────────────────────────────

export default function DeclarePage() {
  const params = useParams<{ meetToken: string; teamToken: string }>();
  const { meetToken, teamToken } = params;

  const [data, setData] = useState<FormData | null>(null);
  const [choices, setChoices] = useState<Record<string, Choice>>({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [failed, setFailed] = useState<Record<string, boolean>>({});
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(() => new Date());
  const [side, setSide] = useState<'all' | 'M' | 'F'>('all');
  /** Races this school has said it is done with. */
  const [finalized, setFinalized] = useState<Set<string>>(new Set());
  /**
   * Swaps, both ways round: inFor[alternate] = the runner they went in for;
   * outFor[runner] = the alternate who went in for them. Kept apart because a
   * runner swapped out is an alternate and can go in for somebody else, after
   * which the first swap still stands but can no longer be undone.
   */
  const [swapState, setSwapState] = useState<{ inFor: Record<string, string>; outFor: Record<string, string> }>({ inFor: {}, outFor: {} });
  /** The runner whose list of alternates is open. */
  const [picking, setPicking] = useState<string | null>(null);

  // The countdown has to move, or it is a timestamp wearing a countdown's
  // clothes and a coach will trust it after it has gone stale.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    let retry: ReturnType<typeof setTimeout> | null = null;
    const load = async (attempt: number): Promise<void> => {
      try {
        const res = await request(`/api/declare/${meetToken}/${teamToken}`);
        if (!res.ok) {
          setError(res.status === 404
            ? 'This link is not valid for any meet. Check with the meet office.'
            : 'Could not load the form.');
          setLoading(false);
          return;
        }
        const json = await res.json() as FormData;
        if (cancelled) return;

        const initial: Record<string, Choice> = {};
        for (const a of json.roster) initial[a.id] = { kind: 'none' };
        const inFor: Record<string, string> = {};
        const outFor: Record<string, string> = {};
        for (const d of json.declarations) {
          // The runner's side of a swap, or one taken back: nothing to answer.
          if (d.status === 'swapped' && d.swapFor) outFor[d.athleteId] = d.swapFor;
          if (d.status === 'swapped' || d.status === 'unswapped') continue;
          if (d.status === 'declared' && d.swapFor) inFor[d.athleteId] = d.swapFor;
          initial[d.athleteId] = d.status === 'declared' && d.raceId
            ? { kind: 'race', raceId: d.raceId }
            : { kind: 'scratched' };
        }
        setSwapState({ inFor, outFor });
        // Every list on the form follows the day's running order.
        setData({ ...json, races: byStartTime(json.races) });
        setChoices(initial);
        setFinalized(new Set((json.finalized ?? []).map((f) => f.raceId)));
        setError(null);
        setLoading(false);
      } catch {
        if (cancelled) return;
        // No signal in a car park is ordinary. Say so, and keep trying.
        setError('Having trouble reaching the meet — still trying…');
        retry = setTimeout(() => { void load(attempt + 1); }, Math.min(15_000, 3_000 * (attempt + 1)));
      }
    };
    void load(0);
    return () => { cancelled = true; if (retry) clearTimeout(retry); };
  }, [meetToken, teamToken]);

  /**
   * The bibs the meet office has, read again. Loaded once, the form kept
   * saying "Hand bib in" for a bib handed in while it was open - or handed in
   * before the coach marked the runner Not running - until the page was
   * reloaded. Only the bibs are taken from the answer: what the coach is in
   * the middle of choosing is theirs, not the server's.
   */
  const refreshBibs = useCallback(async () => {
    try {
      const res = await request(`/api/declare/${meetToken}/${teamToken}`);
      if (!res.ok) return;
      const json = await res.json() as FormData;
      setData((d) => (d ? { ...d, bibsReturned: json.bibsReturned } : d));
    } catch { /* no signal: the next try will do */ }
  }, [meetToken, teamToken]);

  // Every 20 s while the form is on screen, and when the phone comes back to it.
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refreshBibs(); }, 20_000);
    const back = () => { if (document.visibilityState === 'visible') void refreshBibs(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', back); };
  }, [refreshBibs]);

  const save = useCallback(async (athleteId: string, choice: Choice, before: Choice = { kind: 'none' }) => {
    if (choice.kind === 'none') return;
    setSaving((s) => ({ ...s, [athleteId]: true }));
    try {
      const res = await request(`/api/declare/${meetToken}/${teamToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          declarations: [{
            athleteId,
            status: choice.kind === 'race' ? 'declared' : 'scratched',
            raceId: choice.kind === 'race' ? choice.raceId : null,
          }],
        }),
      });
      const json = await res.json().catch(() => ({})) as { rejected?: string[]; reasons?: Record<string, string> };
      const why = json.reasons?.[athleteId];
      if (res.ok && why) {
        // Refused for a reason the coach can act on: back as they were, said.
        setChoices((c) => ({ ...c, [athleteId]: before }));
        setFailed((f) => ({ ...f, [athleteId]: false }));
        setError(why);
        return;
      }
      const bad = !res.ok || (json.rejected?.length ?? 0) > 0;
      setFailed((f) => ({ ...f, [athleteId]: bad }));
      setError(bad ? 'That change was not accepted. Reload and try again.' : null);
      // Marked Not running: the bib may already be at the meet office.
      if (!bad && choice.kind === 'scratched') void refreshBibs();
    } catch {
      // Marked on the row itself, not only in a banner at the top: on a phone
      // the banner is off screen by the time a coach has scrolled to the next
      // name, and one who walks away believing it saved is the whole problem.
      setFailed((f) => ({ ...f, [athleteId]: true }));
      setError('Some changes did not save — check your signal and tap them again. They are marked below.');
    } finally {
      setSaving((s) => ({ ...s, [athleteId]: false }));
    }
  }, [meetToken, teamToken, refreshBibs]);

  /**
   * Say this school is done with one race, or take that back.
   *
   * One race, never the form: a coach is done with the Gold long before they
   * have decided the Open, and a runner not in the Gold is untouched by
   * closing it.
   */
  const setFinal = async (raceId: string, next: boolean) => {
    setBusy(`final:${raceId}`);
    try {
      const res = await request(`/api/declare/${meetToken}/${teamToken}/finalize`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raceId, finalized: next }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({})) as { error?: string };
        setError(json.error ?? 'Could not change that.');
        return;
      }
      setError(null);
      setFinalized((f) => {
        const copy = new Set(f);
        if (next) copy.add(raceId); else copy.delete(raceId);
        return copy;
      });
    } catch {
      setError('That did not save — check your signal and try again.');
    } finally {
      setBusy(null);
    }
  };

  /**
   * An alternate in for a runner: on their bib, in their place. The runner
   * becomes an alternate. The desk makes it when it next pulls the answers.
   */
  const swap = async (outId: string, alternateId: string, raceId: string) => {
    setPicking(null);
    setBusy(`swap:${outId}`);
    try {
      const res = await request(`/api/declare/${meetToken}/${teamToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ swap: { alternateId, forAthleteId: outId } }),
      });
      const json = await res.json().catch(() => ({})) as { error?: string; raceId?: string };
      if (!res.ok) { setError(json.error ?? 'That swap was not made. Reload and try again.'); return; }
      setSwapState((m) => {
        const inFor = { ...m.inFor, [alternateId]: outId }; const outFor = { ...m.outFor, [outId]: alternateId };
        // Each now on one side only: the alternate in, the runner out.
        delete inFor[outId]; delete outFor[alternateId];
        return { inFor, outFor };
      });
      setChoices((c) => ({ ...c, [alternateId]: { kind: 'race', raceId: json.raceId ?? raceId }, [outId]: { kind: 'none' } }));
      setError(null);
    } catch {
      setError('That swap did not save — check your signal and try again.');
    } finally {
      setBusy(null);
    }
  };

  const unswap = async (outId: string, alternateId: string) => {
    setBusy(`swap:${outId}`);
    try {
      const res = await request(`/api/declare/${meetToken}/${teamToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unswap: { alternateId } }),
      });
      const json = await res.json().catch(() => ({})) as { error?: string };
      if (!res.ok) { setError(json.error ?? 'That swap was not undone. Reload and try again.'); return; }
      setSwapState((m) => {
        const inFor = { ...m.inFor }; const outFor = { ...m.outFor };
        delete inFor[alternateId]; delete outFor[outId];
        // Swapped out before going in for this runner: out again.
        const earlier = Object.keys(inFor).find((alt) => inFor[alt] === alternateId);
        if (earlier) outFor[alternateId] = earlier;
        return { inFor, outFor };
      });
      setChoices((c) => ({ ...c, [alternateId]: { kind: 'none' }, [outId]: { kind: 'none' } }));
      setError(null);
    } catch {
      setError('That did not save — check your signal and try again.');
    } finally {
      setBusy(null);
    }
  };

  const choose = (athleteId: string, choice: Choice) => {
    const before = choices[athleteId] ?? { kind: 'none' as const };
    setChoices((c) => ({ ...c, [athleteId]: choice }));
    void save(athleteId, choice, before);
  };

  /** How many this school has in a race, and its cap; full when at it. */
  const countIn = (raceId: string) => Object.values(choices).filter((c) => c.kind === 'race' && c.raceId === raceId).length;
  const capOf = (raceId: string) => data?.races.find((r) => r.id === raceId)?.maxPerSchool ?? null;
  const isFull = (raceId: string) => { const cap = capOf(raceId); return cap != null && cap > 0 && countIn(raceId) >= cap; };

  /**
   * Everybody still to answer for who the meet has entered in this race,
   * confirmed in it with one tap. A coach with no changes is done in one
   * tap a race; one with changes makes those first and confirms the rest.
   */
  const enteredIn = useCallback((raceId: string) => (data?.roster ?? []).filter((a) =>
    a.status === 'entered' && a.raceId === raceId && a.eligibleRaceIds.includes(raceId)
    && !a.alternate && !swapState.outFor[a.id]
    && (choices[a.id]?.kind ?? 'none') === 'none'), [data, choices, swapState]);

  /** The runner each swapped-in alternate went in for. */
  const swappedFor = useMemo(() => new Map(Object.entries(swapState.inFor)), [swapState]);
  /**
   * In the squad's list or in the alternates': an alternate swapped in is
   * running; a runner swapped out is an alternate now.
   */
  const isAlternate = useCallback((a: RosterAthlete) =>
    !!swapState.outFor[a.id] || (!!a.alternate && !swappedFor.has(a.id)), [swapState, swappedFor]);

  const confirmEntered = async (raceId: string) => {
    const who = enteredIn(raceId).map((a) => a.id);
    if (who.length === 0) return;
    setBusy(`confirm:${raceId}`);
    setChoices((c) => ({ ...c, ...Object.fromEntries(who.map((id) => [id, { kind: 'race', raceId } as Choice])) }));
    setSaving((s) => ({ ...s, ...Object.fromEntries(who.map((id) => [id, true])) }));
    try {
      const res = await request(`/api/declare/${meetToken}/${teamToken}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ declarations: who.map((athleteId) => ({ athleteId, status: 'declared', raceId })) }),
      });
      const json = await res.json().catch(() => ({})) as { rejected?: string[]; reasons?: Record<string, string> };
      const refused = new Set(res.ok ? (json.rejected ?? []) : who);
      // Past the race's cap: not confirmed, left for the coach to choose.
      const full = who.filter((id) => json.reasons?.[id]);
      if (full.length) setChoices((c) => ({ ...c, ...Object.fromEntries(full.map((id) => [id, { kind: 'none' } as Choice])) }));
      setFailed((f) => ({ ...f, ...Object.fromEntries(who.map((id) => [id, refused.has(id) && !json.reasons?.[id]])) }));
      setError(full.length
        ? `${json.reasons![full[0]]}. ${full.length} runner${full.length === 1 ? ' was' : 's were'} left for you to choose.`
        : refused.size ? `${refused.size} of those were not accepted. They are marked below.` : null);
    } catch {
      setFailed((f) => ({ ...f, ...Object.fromEntries(who.map((id) => [id, true])) }));
      setError('Those did not save — check your signal and try again. They are marked below.');
    } finally {
      setSaving((s) => ({ ...s, ...Object.fromEntries(who.map((id) => [id, false])) }));
      setBusy(null);
    }
  };

  const words = GENDER_WORDS[data?.genderTerms === 'men_women' ? 'men_women' : 'boys_girls'];

  /**
   * Only the sides this squad actually has.
   *
   * A school that brought boys only should not be shown a Girls tab that
   * filters to an empty list — the tab would read as "you have girls to
   * answer for" and send a coach looking for them.
   */
  const sidesPresent = useMemo(() => {
    if (!data) return [] as Array<'M' | 'F'>;
    const seen = new Set(data.roster.map((a) => genderSide(a.gender)).filter(Boolean));
    return (['M', 'F'] as const).filter((g) => seen.has(g));
  }, [data]);

  const visibleAll = useMemo(() => {
    if (!data) return [];
    if (side === 'all') return data.roster;
    return data.roster.filter((a) => genderSide(a.gender) === side);
  }, [data, side]);
  // The squad to answer for, and its alternates apart below it.
  const visible = useMemo(() => visibleAll.filter((a) => !isAlternate(a)), [visibleAll, isAlternate]);
  const alternatesShown = useMemo(() => visibleAll.filter(isAlternate), [visibleAll, isAlternate]);

  // The counts are for the side being looked at: filtered to the men, the
  // coach sees the men's numbers. The other side's unanswered runners are
  // still said (below) — a coach who filtered to the boys and read "0 to
  // answer" must not walk away with five girls undeclared.
  // A scratched runner's bib goes back to the meet office; this is what has.
  const bibBack = useMemo(
    () => new Map((data?.bibsReturned ?? []).map((b) => [b.athleteId, b.returnedAt])),
    [data],
  );

  const counts = useMemo(() => {
    const tally = (ids: string[]) => {
      const values = ids.map((id) => choices[id] ?? { kind: 'none' as const });
      return {
        declared: values.filter((c) => c.kind === 'race').length,
        scratched: values.filter((c) => c.kind === 'scratched').length,
        undecided: values.filter((c) => c.kind === 'none').length,
        bibsOut: ids.filter((id, i) => values[i].kind === 'scratched' && !bibBack.has(id)).length,
      };
    };
    const shown = new Set(visible.map((a) => a.id));
    return {
      ...tally(visible.map((a) => a.id)),
      otherUndecided: side === 'all' ? 0
        : tally((data?.roster ?? []).filter((a) => !shown.has(a.id) && !isAlternate(a)).map((a) => a.id)).undecided,
    };
  }, [choices, visible, data, side, bibBack, isAlternate]);

  // The next race to close, and the ones already closed. Each race closes on
  // its own — the girls' cutoff passing leaves the boys' races open.
  // Only the races this school was placed in. A meet has races a school is
  // not part of — the Elite race for a Blue school — and they are no business
  // of this form: not a card, not a choice, not a cutoff to count down to.
  const schoolRaces = useMemo(() => {
    if (!data) return [] as Race[];
    const open = schoolRaceIds(data.roster);
    return data.races.filter((r) => open.has(r.id));
  }, [data]);
  const tz = useMemo(() => meetTimeZone(data?.races ?? []), [data]);
  const whenText = useCallback((d: Date) => meetTime(d, tz), [tz]);

  // The races on the side being looked at (and any open to both sides).
  const sideRaces = useMemo(() => (side === 'all' ? schoolRaces
    : schoolRaces.filter((r) => { const g = genderSide(r.gender); return g === side || g == null; })),
  [schoolRaces, side]);

  const { soonest, closedCount } = useMemo(() => {
    if (!data) return { soonest: null as Date | null, closedCount: 0 };
    const all = sideRaces.map(deadlineOf).filter((d): d is Date => d != null);
    const ahead = all.filter((d) => d.getTime() > now.getTime());
    return {
      soonest: ahead.length ? ahead.reduce((a, b) => (a < b ? a : b)) : null,
      closedCount: all.length - ahead.length,
    };
  }, [data, sideRaces, now]);
  const raceClosed = useCallback((raceId: string | null | undefined) => {
    const race = data?.races.find((r) => r.id === raceId);
    return race ? isClosed(race, now) : false;
  }, [data, now]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <div className="text-center px-6">
          <p className="text-sm text-gray-500">Loading…</p>
          {/* Still retrying: a note, not an alarm. */}
          {error && <p className="mt-2 text-xs text-amber-300/80">{error}</p>}
        </div>
      </div>
    );
  }

  if (error && !data) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950 p-6">
        <div className="text-center max-w-sm">
          <p className="text-sm text-red-400">{error}</p>
        </div>
      </div>
    );
  }

  if (!data) return null;

  const allClosed = soonest == null && closedCount > 0 && closedCount === sideRaces.length;
  const urgent = soonest != null && soonest.getTime() - now.getTime() < 30 * 60_000;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* ── Sticky header ──
          On a squad of thirty the deadline and what is left to answer would
          otherwise scroll away and stay away. */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="max-w-lg mx-auto">
          <div className="flex items-center justify-between gap-3 mb-1.5">
            <p className="text-xs text-gray-500 truncate">
              {data.meetName}
            </p>
            <Image src="/PRIMETIME.png" alt="PrimeTime Timing" width={1586} height={250} priority
              className="h-4 w-auto shrink-0 opacity-90" />
          </div>
          {/* The help link sits with the school's name, so the meet's name and
              the logo keep the top line to themselves. A new tab, so the form —
              and where the coach was in it — stays put. */}
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="text-xl font-bold text-white truncate">{data.teamName}</h1>
            <span className="shrink-0 flex items-baseline gap-3">
              {data.textsUrl && (
                <a href={data.textsUrl} target="_blank" rel="noopener"
                  className="text-xs text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                  Get text updates
                </a>
              )}
              <a href="/declare/help" target="_blank" rel="noopener"
                className="text-xs text-blue-400 hover:text-blue-300 underline-offset-2 hover:underline">
                How this works
              </a>
            </span>
          </div>

          {(soonest || closedCount > 0) && (
            <div className={`mt-2.5 rounded-lg border px-3 py-2 text-sm ${
              allClosed
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : urgent
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
            }`}>
              {allClosed
                ? 'Declarations have closed — call the meet office'
                : soonest && <>Next race closes in <span className="font-bold tabular-nums">{untilText(soonest, now)}</span></>}
              {!allClosed && closedCount > 0 && (
                <span className="block text-xs opacity-80">
                  {closedCount} race{closedCount === 1 ? ' has' : 's have'} closed — call the meet office to change {closedCount === 1 ? 'it' : 'them'}
                </span>
              )}
            </div>
          )}

          {/* Counts for the side being looked at, with the other side's
              unanswered runners still named, so a coach filtered to the boys
              cannot walk away with five girls undeclared. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-gray-400">
            <span><span className="font-bold text-gray-100">{counts.declared}</span> running</span>
            <span><span className="font-bold text-gray-100">{counts.scratched}</span> out</span>
            {counts.bibsOut > 0 && (
              <span className="text-amber-400">
                <span className="font-bold">{counts.bibsOut}</span> bib{counts.bibsOut === 1 ? '' : 's'} to hand in
              </span>
            )}
            <span className={counts.undecided > 0 ? 'text-amber-400' : ''}>
              <span className="font-bold">{counts.undecided}</span> to answer
            </span>
            {side !== 'all' && counts.otherUndecided > 0 && (
              <span className="text-amber-400/80">
                · {counts.otherUndecided} {words[side === 'M' ? 'F' : 'M'].toLowerCase()} to answer
              </span>
            )}
          </div>

          {sidesPresent.length > 1 && (
            <div className="flex gap-1.5 mt-3">
              {([['all', 'Everyone'], ...sidesPresent.map((g) => [g, words[g]] as const)] as const)
                .map(([value, label]) => (
                  <button
                    key={value}
                    type="button"
                    onClick={() => setSide(value as 'all' | 'M' | 'F')}
                    className={`flex-1 min-h-[36px] rounded-lg border px-3 py-1.5 text-xs
                      touch-manipulation transition-colors ${
                      side === value
                        ? 'bg-gray-700 border-gray-500 text-white font-semibold'
                        : 'bg-gray-800 border-gray-700 text-gray-400 active:bg-gray-700'
                    }`}
                  >
                    {label}
                  </button>
                ))}
            </div>
          )}
        </div>
      </div>

      {/* ── The squad ── */}
      <div className="max-w-lg mx-auto px-4 py-5 pb-[calc(2.5rem+env(safe-area-inset-bottom))]">
        {error && (
          <div className="mb-4 rounded-lg border border-red-500/30 bg-red-500/10 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        )}

        {data.textsUrl && <TextsInvite url={data.textsUrl} />}

        {/* One card per race: how many are in it, and whether this school
            has closed it. Closing one leaves every other race alone. */}
        <div className="space-y-2 mb-4">
          {sideRaces.map((race) => {
            const inThis = Object.values(choices)
              .filter((c) => c.kind === 'race' && c.raceId === race.id).length;
            const isFinal = finalized.has(race.id);
            const deadline = deadlineOf(race);
            const past = deadline != null && deadline.getTime() <= now.getTime();

            return (
              <div
                key={race.id}
                className={`rounded-xl border px-4 py-3 ${
                  isFinal ? 'border-emerald-700/50 bg-emerald-950/20' : 'border-gray-800 bg-gray-900/60'
                }`}
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold truncate">{race.name}</p>
                    <p className="text-xs text-gray-500">
                      {race.maxPerSchool
                        ? <span className={inThis >= race.maxPerSchool ? 'text-amber-300' : ''}>{inThis} of {race.maxPerSchool} declared{inThis >= race.maxPerSchool ? ' (full)' : ''}</span>
                        : <>{inThis} runner{inThis === 1 ? '' : 's'} declared</>}
                      {isFinal && <span className="text-emerald-400"> · finalized</span>}
                      {deadline && (past
                        ? <span className="text-red-400"> · closed</span>
                        : <span> · closes {whenText(deadline)}</span>)}
                    </p>
                  </div>
                  <button
                    type="button"
                    // After the deadline only the meet office can reopen it:
                    // by then the start list has been printed.
                    disabled={busy === `final:${race.id}` || past}
                    onClick={() => setFinal(race.id, !isFinal)}
                    className={`shrink-0 min-h-[40px] rounded-lg border px-3 py-2 text-xs
                      touch-manipulation transition-colors disabled:opacity-40 ${
                      isFinal || past
                        ? 'bg-gray-800 border-gray-700 text-gray-300'
                        : 'bg-emerald-700 border-emerald-600 text-white font-semibold'
                    }`}
                  >
                    {past ? 'Closed' : isFinal ? 'Reopen' : 'Finalize'}
                  </button>
                </div>
                {(() => {
                  const waiting = enteredIn(race.id).length;
                  if (waiting === 0 || past || isFinal) return null;
                  return (
                    <button
                      type="button"
                      disabled={busy === `confirm:${race.id}`}
                      onClick={() => void confirmEntered(race.id)}
                      className="mt-2.5 w-full min-h-[40px] rounded-lg border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-xs
                        font-semibold text-blue-200 touch-manipulation active:bg-blue-500/20 disabled:opacity-40"
                    >
                      {busy === `confirm:${race.id}` ? 'Confirming…'
                        : `Confirm ${waiting} entered runner${waiting === 1 ? '' : 's'} as running`}
                    </button>
                  );
                })()}
              </div>
            );
          })}
        </div>

        <ul className="space-y-2.5">
          {visible.map((athlete) => {
            const choice = choices[athlete.id] ?? { kind: 'none' as const };
            const races = data.races.filter((r) => athlete.eligibleRaceIds.includes(r.id));
            // Short names on the buttons, unless two would read the same.
            const shortNames = races.map((r) => shortRaceName(r.name));
            const labelOf = new Set(shortNames).size === shortNames.length
              ? (r: Race) => shortRaceName(r.name) : (r: Race) => r.name;
            const rowBusy = saving[athlete.id];
            const didFail = failed[athlete.id];
            // Locked only if THIS runner is in a race that has been closed.
            // A runner left out of the closed race is untouched and can still
            // be put in a later one, which is the point of closing per race.
            // Or if their race has passed its cutoff: its start list is set.
            const lockedIn = choice.kind === 'race'
              && (finalized.has(choice.raceId) || raceClosed(choice.raceId));
            // Every race open to them has closed: nothing left to choose.
            const nothingOpen = races.length > 0 && races.every((r) => raceClosed(r.id));

            // An alternate swapped in: running on the runner's bib, until undone.
            const outId = swappedFor.get(athlete.id);
            if (outId) {
              const out = data.roster.find((a) => a.id === outId);
              const raceId = choice.kind === 'race' ? choice.raceId : null;
              const race = data.races.find((r) => r.id === raceId);
              const bib = athlete.bib ?? out?.bib;
              const fixed = !!raceId && (finalized.has(raceId) || raceClosed(raceId));
              // Only while the runner is still out for them: gone in for
              // somebody else since, there is no place to put them back in.
              const undoable = swapState.outFor[outId] === athlete.id;
              return (
                <li key={athlete.id} className="rounded-xl border border-violet-600/50 bg-gray-900 px-4 py-3.5">
                  <div className="flex items-baseline justify-between gap-3">
                    <span className="font-semibold truncate">{athlete.firstName} {athlete.lastName}</span>
                    <span className="text-xs text-gray-500 shrink-0 font-mono">
                      {[bib ? `#${bib}` : null, athlete.year].filter(Boolean).join(' · ')}
                      <span className="ml-1 text-violet-300">swapped in</span>
                    </span>
                  </div>
                  <p className="mt-2 text-sm text-gray-300">
                    {race ? shortRaceName(race.name) : 'Running'}, in for {out ? `${out.firstName} ${out.lastName}` : 'a runner'}
                  </p>
                  {bib && out && (
                    <p className="mt-1 text-xs text-amber-400">
                      {out.firstName} hands bib #{bib} to {athlete.firstName}
                    </p>
                  )}
                  {!fixed && !undoable && out && (
                    <p className="mt-1 text-xs text-gray-500">{out.firstName} has gone in for somebody else, so this swap stays.</p>
                  )}
                  {!fixed && undoable && (
                    <button
                      type="button"
                      disabled={busy === `swap:${outId}`}
                      onClick={() => void unswap(outId, athlete.id)}
                      className="mt-2.5 w-full min-h-[40px] rounded-lg border border-gray-600 bg-gray-800 px-3 py-2 text-xs
                        text-gray-200 touch-manipulation active:bg-gray-700 disabled:opacity-40"
                    >
                      {busy === `swap:${outId}` ? 'Undoing…' : `Undo swap: ${out?.firstName ?? 'the runner'} runs`}
                    </button>
                  )}
                </li>
              );
            }

            // The race an alternate would go into in their place: the one they
            // are in, or the one the meet entered them in if not yet answered
            // or marked not running (their place and bib are free).
            const nowIn = choice.kind === 'race' ? choice.raceId
              : (athlete.status === 'entered' || athlete.status === 'declared') ? athlete.raceId ?? null : null;
            const canSwapIn = nowIn && !lockedIn && !finalized.has(nowIn) && !raceClosed(nowIn) ? (data.roster.filter((a) =>
              isAlternate(a) && a.eligibleRaceIds.includes(nowIn))) : [];

            return (
              <li
                key={athlete.id}
                className={`rounded-xl border bg-gray-900 px-4 py-3.5 ${
                  didFail
                    ? 'border-red-700/50'
                    // A runner still to answer for is what the coach is
                    // scrolling to find.
                    : choice.kind === 'none'
                      ? 'border-amber-600/40'
                      : 'border-gray-700'
                }`}
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="font-semibold truncate">
                    {athlete.firstName} {athlete.lastName}
                  </span>
                  <span className="text-xs text-gray-500 shrink-0 font-mono">
                    {[athlete.bib ? `#${athlete.bib}` : null, athlete.year]
                      .filter(Boolean).join(' · ')}
                    {rowBusy && <span className="ml-1 text-blue-400">saving…</span>}
                    {didFail && !rowBusy && <span className="ml-1 text-red-400 font-bold">not saved</span>}
                    {lockedIn && !rowBusy && (choice.kind === 'race' && finalized.has(choice.raceId)
                      ? <span className="ml-1 text-emerald-400">finalized</span>
                      : <span className="ml-1 text-red-400">closed</span>)}
                  </span>
                </div>

                {races.length === 0 ? (
                  <p className="mt-2 text-xs text-amber-500/90">
                    No race here is open to this runner — the meet office can
                    put them in one.
                  </p>
                ) : (
                  <div className="flex flex-wrap gap-2 mt-3">
                    {races.map((race) => {
                      const on = choice.kind === 'race' && choice.raceId === race.id;
                      // The race the meet has them entered in, while nobody
                      // has confirmed it: marked, not chosen.
                      const entered = choice.kind === 'none' && athlete.status === 'entered' && athlete.raceId === race.id;
                      return (
                        <button
                          key={race.id}
                          type="button"
                          disabled={lockedIn || finalized.has(race.id) || raceClosed(race.id) || (!on && isFull(race.id))}
                          aria-pressed={on}
                          onClick={() => choose(athlete.id, { kind: 'race', raceId: race.id })}
                          // One weight and one layout in every state: a bold
                          // "Men's Black Open 8k" wrapped to two lines when
                          // chosen and the whole row jumped. Chosen shows by
                          // colour and ring; "entered" is a corner tag.
                          title={!on && isFull(race.id) ? `${race.name} is full: ${capOf(race.id)} of ${capOf(race.id)} declared` : race.name}
                          className={`relative flex-1 min-w-[8.5rem] min-h-[44px] rounded-lg border px-3 py-2.5 text-sm font-medium
                            whitespace-nowrap overflow-hidden text-ellipsis
                            touch-manipulation transition-colors disabled:opacity-40
                            ${on
                              ? 'bg-blue-600 border-blue-500 text-white ring-2 ring-blue-400/60'
                              : entered
                                ? 'bg-gray-800 border-dashed border-blue-400/70 text-gray-100'
                                : 'bg-gray-800 border-gray-700 text-gray-300 active:bg-gray-700 hover:border-gray-500'}`}
                        >
                          {labelOf(race)}
                          {entered && (
                            <span className="absolute top-0.5 right-1.5 text-[9px] font-medium uppercase tracking-wide text-blue-300">
                              entered
                            </span>
                          )}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={lockedIn || (choice.kind === 'none' && nothingOpen)}
                      aria-pressed={choice.kind === 'scratched'}
                      onClick={() => choose(athlete.id, { kind: 'scratched' })}
                      className={`flex-1 min-w-[8.5rem] min-h-[44px] rounded-lg border px-3 py-2.5 text-sm font-medium
                        touch-manipulation transition-colors disabled:opacity-40
                        ${choice.kind === 'scratched'
                          ? 'bg-red-900/70 border-red-600 text-red-100 ring-2 ring-red-500/50'
                          : 'bg-gray-800 border-gray-700 text-gray-300 active:bg-gray-700 hover:border-gray-500'}`}
                    >
                      Not running
                    </button>
                  </div>
                )}

                {/* Entered and alternates: one of the school's alternates in
                    for this runner, picked from the ones who can run the race. */}
                {canSwapIn.length > 0 && (picking === athlete.id ? (
                  <div className="mt-2.5 rounded-lg border border-violet-600/50 p-2">
                    <p className="px-1 pb-1.5 text-xs text-gray-400">Swap in for {athlete.firstName}:</p>
                    <div className="flex flex-col gap-1.5">
                      {canSwapIn.map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => void swap(athlete.id, a.id, nowIn!)}
                          className="min-h-[40px] rounded-lg border border-gray-700 bg-gray-800 px-3 py-2 text-left text-sm
                            text-gray-100 touch-manipulation active:bg-gray-700"
                        >
                          {a.firstName} {a.lastName}
                          {a.year && <span className="ml-1.5 text-xs text-gray-500">{a.year}</span>}
                        </button>
                      ))}
                      <button type="button" onClick={() => setPicking(null)}
                        className="min-h-[36px] text-xs text-gray-400 touch-manipulation">
                        Cancel
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    type="button"
                    disabled={busy === `swap:${athlete.id}`}
                    onClick={() => setPicking(athlete.id)}
                    className="mt-2.5 w-full min-h-[40px] rounded-lg border border-violet-600/50 bg-violet-500/10 px-3 py-2 text-xs
                      font-medium text-violet-200 touch-manipulation active:bg-violet-500/20 disabled:opacity-40"
                  >
                    {busy === `swap:${athlete.id}` ? 'Swapping…' : 'Swap in an alternate'}
                  </button>
                ))}

                {/* A runner scratched hands their bib in at the meet office,
                    so nobody else runs on it; this says whether it is back. */}
                {choice.kind === 'scratched' && (bibBack.has(athlete.id) ? (
                  <p className="mt-2.5 text-xs text-emerald-400">
                    Bib received by the meet office
                    {' '}<span className="text-emerald-400/70">{new Date(bibBack.get(athlete.id)!).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}</span>
                  </p>
                ) : (
                  <p className="mt-2.5 text-xs text-amber-400">
                    Hand {athlete.bib ? `bib #${athlete.bib}` : 'this bib'} in at the meet office
                  </p>
                ))}
                {choice.kind === 'race' && bibBack.has(athlete.id) && (
                  <p className="mt-2.5 text-xs text-amber-400">
                    This bib was handed in - collect it from the meet office before the race
                  </p>
                )}
              </li>
            );
          })}
        </ul>

        {/* Entered and alternates: the rest of the squad, with no bib. They
            come in only by a swap, from a runner's card above. */}
        {alternatesShown.length > 0 && (
          <div className="mt-6">
            <div className="flex items-baseline justify-between gap-3 border-b border-gray-800 pb-1.5 mb-2">
              <h2 className="text-sm font-semibold text-gray-200">Alternates</h2>
              <span className="text-xs text-gray-500">no bib · in only by a swap</span>
            </div>
            <ul className="space-y-1.5">
              {alternatesShown.map((a) => {
                const inFor = swapState.outFor[a.id] ? data.roster.find((x) => x.id === swapState.outFor[a.id]) : undefined;
                return (
                  <li key={a.id} className="flex items-baseline justify-between gap-3 px-1 text-sm">
                    <span className="truncate text-gray-200">{a.firstName} {a.lastName}</span>
                    <span className="shrink-0 text-xs text-gray-500">
                      {inFor ? `swapped out · ${inFor.firstName} ${inFor.lastName} runs` : a.year ?? ''}
                    </span>
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {side !== 'all' && data.roster.length > visibleAll.length && (
          <p className="text-xs text-gray-500 text-center mt-4">
            Showing {visibleAll.length} of {data.roster.length}.{' '}
            <button
              type="button"
              onClick={() => setSide('all')}
              className="underline text-gray-400"
            >
              Show everyone
            </button>
          </p>
        )}

        <p className="text-xs text-gray-600 text-center mt-6">
          Every tap saves on its own — there is nothing to submit at the end.
          The meet office sees your answers as you make them.
        </p>
      </div>
    </div>
  );
}

/**
 * The meet's texts, offered at the top of the form when the desk asks for
 * it: weather, schedule changes and declaration reminders on the coach's
 * phone. Gone once this phone has signed up (the sign-up page says so), or
 * once the coach has hidden it.
 */
function TextsInvite({ url }: { url: string }) {
  const key = `coachTexts:${url}`;
  const [hidden, setHidden] = useState(true);
  useEffect(() => {
    try { setHidden(!!localStorage.getItem(key)); } catch { setHidden(false); }
  }, [key]);
  if (hidden) return null;
  const hide = () => {
    setHidden(true);
    try { localStorage.setItem(key, 'hidden'); } catch { /* shown again next time */ }
  };
  return (
    <div className="mb-4 rounded-xl border border-blue-500/30 bg-blue-500/10 px-4 py-3">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-blue-100">Get the meet&rsquo;s texts</p>
          <p className="text-xs text-blue-200/70 mt-0.5">Weather, schedule changes and declaration reminders, sent to your phone.</p>
        </div>
        <button type="button" onClick={hide} aria-label="Hide"
          className="shrink-0 -mr-1 -mt-1 h-8 w-8 rounded-lg text-blue-200/60 hover:text-blue-100 hover:bg-white/5 text-lg leading-none">&times;</button>
      </div>
      <a href={url} target="_blank" rel="noopener"
        className="mt-2.5 flex min-h-[40px] items-center justify-center rounded-lg bg-blue-600 hover:bg-blue-500 px-4 text-sm font-semibold text-white touch-manipulation">
        Sign up for texts
      </a>
    </div>
  );
}
