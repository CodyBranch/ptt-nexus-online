'use client';

import { useState, useEffect, useCallback, useMemo } from 'react';
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

// ── Types ─────────────────────────────────────────────────────────────────────

interface Race {
  id: string;
  name: string;
  gender: string;
  distanceLabel?: string;
  scheduledTime?: string;
  deadlineMinutes?: number;
}

interface RosterAthlete {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
  gender?: string;
  year?: string;
  eligibleRaceIds: string[];
}

interface Declaration {
  athleteId: string;
  status: 'declared' | 'scratched';
  raceId: string | null;
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
  roster: RosterAthlete[];
  declarations: Declaration[];
  finalized?: Finalization[];
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

const GENDER_WORDS = {
  boys_girls: { M: 'Boys', F: 'Girls' },
  men_women: { M: 'Men', F: 'Women' },
} as const;

// ── The deadline ──────────────────────────────────────────────────────────────

/** When declarations close for a race: its start, less the notice required. */
function deadlineOf(race: Race): Date | null {
  if (!race.scheduledTime) return null;
  const start = new Date(race.scheduledTime);
  if (Number.isNaN(start.getTime())) return null;
  const minutes = race.deadlineMinutes ?? 30;
  return new Date(start.getTime() - minutes * 60_000);
}

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

  // The countdown has to move, or it is a timestamp wearing a countdown's
  // clothes and a coach will trust it after it has gone stale.
  useEffect(() => {
    const t = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/declare/${meetToken}/${teamToken}`);
        if (!res.ok) {
          setError(res.status === 404
            ? 'This link is not valid for any meet. Check with the meet office.'
            : 'Could not load the form.');
          return;
        }
        const json = await res.json() as FormData;
        if (cancelled) return;

        const initial: Record<string, Choice> = {};
        for (const a of json.roster) initial[a.id] = { kind: 'none' };
        for (const d of json.declarations) {
          initial[d.athleteId] = d.status === 'declared' && d.raceId
            ? { kind: 'race', raceId: d.raceId }
            : { kind: 'scratched' };
        }
        setData(json);
        setChoices(initial);
        setFinalized(new Set((json.finalized ?? []).map((f) => f.raceId)));
      } catch {
        if (!cancelled) setError('Could not reach the server.');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [meetToken, teamToken]);

  const save = useCallback(async (athleteId: string, choice: Choice) => {
    if (choice.kind === 'none') return;
    setSaving((s) => ({ ...s, [athleteId]: true }));
    try {
      const res = await fetch(`/api/declare/${meetToken}/${teamToken}`, {
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
      const json = await res.json() as { rejected?: string[] };
      const bad = !res.ok || (json.rejected?.length ?? 0) > 0;
      setFailed((f) => ({ ...f, [athleteId]: bad }));
      setError(bad ? 'That change was not accepted. Reload and try again.' : null);
    } catch {
      // Marked on the row itself, not only in a banner at the top: on a phone
      // the banner is off screen by the time a coach has scrolled to the next
      // name, and one who walks away believing it saved is the whole problem.
      setFailed((f) => ({ ...f, [athleteId]: true }));
      setError('Some changes did not save — you are offline. They are marked below.');
    } finally {
      setSaving((s) => ({ ...s, [athleteId]: false }));
    }
  }, [meetToken, teamToken]);

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
      const res = await fetch(`/api/declare/${meetToken}/${teamToken}/finalize`, {
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
      setError('That did not save — you are offline.');
    } finally {
      setBusy(null);
    }
  };

  const choose = (athleteId: string, choice: Choice) => {
    setChoices((c) => ({ ...c, [athleteId]: choice }));
    void save(athleteId, choice);
  };

  const counts = useMemo(() => {
    const values = Object.values(choices);
    return {
      declared: values.filter((c) => c.kind === 'race').length,
      scratched: values.filter((c) => c.kind === 'scratched').length,
      undecided: values.filter((c) => c.kind === 'none').length,
    };
  }, [choices]);

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

  const visible = useMemo(() => {
    if (!data) return [];
    if (side === 'all') return data.roster;
    return data.roster.filter((a) => genderSide(a.gender) === side);
  }, [data, side]);

  const soonest = useMemo(() => {
    if (!data) return null;
    const all = data.races.map(deadlineOf).filter((d): d is Date => d != null);
    if (all.length === 0) return null;
    return all.reduce((a, b) => (a < b ? a : b));
  }, [data]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-gray-950">
        <p className="text-sm text-gray-500">Loading…</p>
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

  const closed = soonest != null && soonest.getTime() <= now.getTime();
  const urgent = soonest != null && !closed
    && soonest.getTime() - now.getTime() < 30 * 60_000;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100">

      {/* ── Sticky header ──
          On a squad of thirty the deadline and what is left to answer would
          otherwise scroll away and stay away. */}
      <div className="bg-gray-900 border-b border-gray-800 px-4 py-4 sticky top-0 z-10 pt-[max(1rem,env(safe-area-inset-top))]">
        <div className="max-w-lg mx-auto">
          <p className="text-xs text-gray-500 truncate">
            {data.meetName}{data.meetDate ? ` · ${data.meetDate}` : ''}
          </p>
          <h1 className="text-xl font-bold text-white truncate">{data.teamName}</h1>

          {soonest && (
            <div className={`mt-2.5 rounded-lg border px-3 py-2 text-sm ${
              closed
                ? 'bg-red-500/10 border-red-500/30 text-red-300'
                : urgent
                  ? 'bg-amber-500/10 border-amber-500/30 text-amber-300'
                  : 'bg-blue-500/10 border-blue-500/30 text-blue-300'
            }`}>
              {closed
                ? 'Declarations have closed — call the meet office'
                : <>Closes in <span className="font-bold tabular-nums">{untilText(soonest, now)}</span></>}
            </div>
          )}

          {/* Counts are always the WHOLE squad, never the filtered view. A
              coach who has filtered to the boys and reads "0 to answer" would
              otherwise walk away with five girls undeclared. */}
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-2.5 text-xs text-gray-400">
            <span><span className="font-bold text-gray-100">{counts.declared}</span> running</span>
            <span><span className="font-bold text-gray-100">{counts.scratched}</span> out</span>
            <span className={counts.undecided > 0 ? 'text-amber-400' : ''}>
              <span className="font-bold">{counts.undecided}</span> to answer
            </span>
            {side !== 'all' && <span className="text-gray-600">(whole squad)</span>}
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

        {/* One card per race: how many are in it, and whether this school
            has closed it. Closing one leaves every other race alone. */}
        <div className="space-y-2 mb-4">
          {data.races.map((race) => {
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
                      {inThis} runner{inThis === 1 ? '' : 's'} declared
                      {isFinal && <span className="text-emerald-400"> · finalised</span>}
                    </p>
                  </div>
                  <button
                    type="button"
                    // After the deadline only the meet office can reopen it:
                    // by then the start list has been printed.
                    disabled={busy === `final:${race.id}` || (isFinal && past)}
                    onClick={() => setFinal(race.id, !isFinal)}
                    className={`shrink-0 min-h-[40px] rounded-lg border px-3 py-2 text-xs
                      touch-manipulation transition-colors disabled:opacity-40 ${
                      isFinal
                        ? 'bg-gray-800 border-gray-700 text-gray-300'
                        : 'bg-emerald-700 border-emerald-600 text-white font-semibold'
                    }`}
                  >
                    {isFinal ? (past ? 'Closed' : 'Reopen') : 'Finalise'}
                  </button>
                </div>
              </div>
            );
          })}
        </div>

        <ul className="space-y-2.5">
          {visible.map((athlete) => {
            const choice = choices[athlete.id] ?? { kind: 'none' as const };
            const races = data.races.filter((r) => athlete.eligibleRaceIds.includes(r.id));
            const rowBusy = saving[athlete.id];
            const didFail = failed[athlete.id];
            // Locked only if THIS runner is in a race that has been closed.
            // A runner left out of the closed race is untouched and can still
            // be put in a later one, which is the point of closing per race.
            const lockedIn = choice.kind === 'race' && finalized.has(choice.raceId);

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
                    {lockedIn && !rowBusy && <span className="ml-1 text-emerald-400">finalised</span>}
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
                      return (
                        <button
                          key={race.id}
                          type="button"
                          disabled={closed || lockedIn || finalized.has(race.id)}
                          aria-pressed={on}
                          onClick={() => choose(athlete.id, { kind: 'race', raceId: race.id })}
                          className={`flex-1 min-w-[8.5rem] min-h-[44px] rounded-lg border px-3 py-2.5 text-sm
                            touch-manipulation transition-colors disabled:opacity-40
                            ${on
                              ? 'bg-blue-600 border-blue-500 text-white font-semibold'
                              : 'bg-gray-800 border-gray-700 text-gray-300 active:bg-gray-700 hover:border-gray-500'}`}
                        >
                          {race.name}
                        </button>
                      );
                    })}
                    <button
                      type="button"
                      disabled={closed || lockedIn}
                      aria-pressed={choice.kind === 'scratched'}
                      onClick={() => choose(athlete.id, { kind: 'scratched' })}
                      className={`flex-1 min-w-[8.5rem] min-h-[44px] rounded-lg border px-3 py-2.5 text-sm
                        touch-manipulation transition-colors disabled:opacity-40
                        ${choice.kind === 'scratched'
                          ? 'bg-red-900/70 border-red-600 text-red-100 font-semibold'
                          : 'bg-gray-800 border-gray-700 text-gray-300 active:bg-gray-700 hover:border-gray-500'}`}
                    >
                      Not running
                    </button>
                  </div>
                )}
              </li>
            );
          })}
        </ul>

        {side !== 'all' && data.roster.length > visible.length && (
          <p className="text-xs text-gray-500 text-center mt-4">
            Showing {visible.length} of {data.roster.length}.{' '}
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
