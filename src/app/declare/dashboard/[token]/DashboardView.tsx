'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { meetTime } from '@/lib/declare-deadline';
import type { DashboardData, DashRace, DashRunner, DashTeam, SchoolState } from '@/lib/declare-dashboard';

/**
 * The live declarations dashboard, drawn and kept current.
 *
 * Asks the server every few seconds whether anything changed (one small
 * query) and redraws only when it did, so it reads as live without a reload:
 * a coach finalizes and their school's card turns over on the screen. A tab
 * in the background stops asking and catches up the moment it is looked at.
 */

const POLL_MS = 4000;

/**
 * Scrollbars that belong on this page: thin, dark, a soft thumb that lifts
 * on hover - not the browser's grey slab beside a dark list. The standard
 * properties for Firefox and current Chrome; the -webkit ones for Safari.
 */
const SCROLL_CSS = `
  html, .dash-scroll { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.28) transparent; }
  html:hover, .dash-scroll:hover { scrollbar-color: rgba(148,163,184,.45) transparent; }
  html::-webkit-scrollbar, .dash-scroll::-webkit-scrollbar { width: 8px; height: 8px; }
  html::-webkit-scrollbar-track, .dash-scroll::-webkit-scrollbar-track { background: transparent; }
  html::-webkit-scrollbar-thumb, .dash-scroll::-webkit-scrollbar-thumb {
    background: rgba(148,163,184,.28); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box;
  }
  html::-webkit-scrollbar-thumb:hover, .dash-scroll::-webkit-scrollbar-thumb:hover { background-color: rgba(148,163,184,.5); }
`;

type Tab = 'schools' | 'races' | 'latest';
type SchoolFilter = 'all' | SchoolState;

const side = (g: string | null | undefined): 'F' | 'M' | '' => {
  const s = (g ?? '').trim().toUpperCase();
  if (s.startsWith('F') || s === 'W' || s === 'G' || s.startsWith('GIRL') || s.startsWith('WOM')) return 'F';
  if (s.startsWith('M') || s === 'B' || s.startsWith('BOY')) return 'M';
  return '';
};

function ago(iso: string | null, now: number): string {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000));
  if (s < 10) return 'just now';
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

/** A school's color, when it is one a browser understands; otherwise none. */
function color(c: string | null | undefined): string | null {
  if (!c) return null;
  const v = c.trim();
  return /^#?[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? (v.startsWith('#') ? v : `#${v}`) : null;
}

function Logo({ team, size = 40 }: { team: DashTeam; size?: number }) {
  const src = team.org?.logoDarkUrl || team.org?.logoUrl || null;
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  if (!src || failed) {
    const initials = team.name.replace(/^(The|University of)\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const bg = color(team.org?.primaryColor);
    return (
      <span style={{ ...box, background: bg ?? undefined }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-xs font-bold ${bg ? 'text-white' : 'bg-gray-800 text-gray-400'}`}>
        {initials}
      </span>
    );
  }
  return (
    <span style={box} className={`inline-flex shrink-0 items-center justify-center rounded-md overflow-hidden p-1 ${team.org?.logoDarkUrl ? 'bg-gray-800' : 'bg-white'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logos come from storage and school sites */}
      <img src={src} alt="" loading="lazy" className="max-w-full max-h-full object-contain" onError={() => setFailed(true)} />
    </span>
  );
}

function Face({ runner, size = 36 }: { runner: DashRunner; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: Math.round(size * 1.25) };
  if (!runner.photoUrl || failed) {
    return (
      <span style={box} className="inline-flex shrink-0 items-center justify-center rounded bg-gray-800 text-[10px] font-semibold text-gray-500">
        {`${runner.firstName[0] ?? ''}${runner.lastName[0] ?? ''}`.toUpperCase()}
      </span>
    );
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element -- served and sized by /headshots
    <img src={runner.photoUrl} alt="" style={box} loading="lazy" onError={() => setFailed(true)}
      className="shrink-0 rounded bg-gray-800 object-cover object-top" />
  );
}

function Bar({ value, total, tone = 'bg-emerald-500' }: { value: number; total: number; tone?: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((value / total) * 100)) : 0;
  return (
    <div className="h-1.5 w-full rounded-full bg-gray-800 overflow-hidden" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className={`h-full rounded-full ${tone} transition-all duration-700`} style={{ width: `${pct}%` }} />
    </div>
  );
}

const schoolState = (t: DashTeam): SchoolState => t.state;

const STATE_LABEL: Record<SchoolFilter, string> = {
  all: 'All', unopened: 'Not opened', opened: 'Opened', started: 'Started', done: 'All answered',
};
const STATE_TONE: Record<SchoolState, string> = {
  unopened: 'bg-gray-700/60 text-gray-300',
  opened: 'bg-sky-500/15 text-sky-300',
  started: 'bg-amber-500/15 text-amber-300',
  done: 'bg-emerald-500/15 text-emerald-300',
};

export default function DashboardView({ token, initial }: { token: string; initial: DashboardData }) {
  const [data, setData] = useState<DashboardData>(initial);
  // The server's moment to start with, so "12s ago" reads the same in the
  // first draw on both sides; the clock takes over a second later.
  const [now, setNow] = useState(() => Date.parse(initial.generatedAt));
  const [checkedAt, setCheckedAt] = useState(() => Date.parse(initial.generatedAt));
  const [offline, setOffline] = useState(false);
  const [tab, setTab] = useState<Tab>('schools');
  const [filter, setFilter] = useState<SchoolFilter>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [fresh, setFresh] = useState<Set<string>>(new Set());
  const version = useRef(initial.version);
  const busy = useRef(false);

  const poll = useCallback(async () => {
    if (busy.current || document.hidden) return;
    busy.current = true;
    try {
      const r = await fetch(`/api/declare/dashboard/${token}?v=${encodeURIComponent(version.current)}`, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      const body = await r.json() as DashboardData | { unchanged: true; version: string };
      setOffline(false);
      setCheckedAt(Date.now());
      if ('unchanged' in body) return;
      version.current = body.version;
      setData((prev) => {
        // Schools whose answers moved light up for a moment.
        const before = new Map(prev.teams.map((t) => [t.id, `${t.answered}|${t.declared}|${t.finalizedRaceIds.length}|${t.lastActivity}`]));
        const moved = body.teams.filter((t) => before.get(t.id) !== `${t.answered}|${t.declared}|${t.finalizedRaceIds.length}|${t.lastActivity}`).map((t) => t.id);
        if (moved.length) {
          setFresh(new Set(moved));
          setTimeout(() => setFresh(new Set()), 4000);
        }
        return body;
      });
    } catch {
      setOffline(true);
    } finally {
      busy.current = false;
    }
  }, [token]);

  useEffect(() => {
    const t = setInterval(() => void poll(), POLL_MS);
    const tick = setInterval(() => setNow(Date.now()), 1000);
    const onShow = () => { if (!document.hidden) void poll(); };
    document.addEventListener('visibilitychange', onShow);
    window.addEventListener('online', onShow);
    return () => { clearInterval(t); clearInterval(tick); document.removeEventListener('visibilitychange', onShow); window.removeEventListener('online', onShow); };
  }, [poll]);

  const tz = data.meet.timeZone ?? undefined;
  const words = data.meet.genderTerms === 'men_women' ? { F: 'Women', M: 'Men', '': '' } : { F: 'Girls', M: 'Boys', '': '' };
  const raceName = useMemo(() => new Map(data.races.map((r) => [r.id, r.name])), [data.races]);

  const teams = useMemo(() => {
    const q = query.trim().toLowerCase();
    return data.teams.filter((t) => (filter === 'all' || schoolState(t) === filter)
      && (!q || t.name.toLowerCase().includes(q) || (t.org?.abbreviation ?? '').toLowerCase().includes(q)
        || t.runners.some((r) => `${r.firstName} ${r.lastName}`.toLowerCase().includes(q) || r.bib === q)));
  }, [data.teams, filter, query]);

  const counts = useMemo(() => ({
    all: data.teams.length,
    unopened: data.teams.filter((t) => t.state === 'unopened').length,
    opened: data.teams.filter((t) => t.state === 'opened').length,
    started: data.teams.filter((t) => t.state === 'started').length,
    done: data.teams.filter((t) => t.state === 'done').length,
  }), [data.teams]);

  const toggle = (id: string) => setOpen((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const T = data.totals;
  const stale = now - checkedAt > POLL_MS * 4;

  return (
    // From a laptop up the page holds to the screen - masthead and totals
    // stay put - and the schools and the latest answers scroll on their own.
    // A phone scrolls the page, as a phone should.
    <div className="min-h-screen lg:h-screen lg:flex lg:flex-col lg:overflow-hidden bg-[#0a0f24] text-gray-100">
      <style>{SCROLL_CSS}</style>
      {/* ── Masthead ── */}
      <header className="shrink-0 border-b border-white/10 bg-[#0c1537]">
        <div className="mx-auto max-w-7xl px-4 py-3 sm:py-4 flex flex-wrap items-center gap-x-6 gap-y-2">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static brand image */}
          <img src="/live/primetime-on-dark.png" alt="PrimeTime Timing" className="h-5 sm:h-7 w-auto" />
          {/* Under the logo on a phone, beside it from there up. */}
          <div className="min-w-0 w-full sm:w-auto sm:flex-1 order-last sm:order-none">
            <h1 className="text-lg sm:text-xl font-bold tracking-tight sm:truncate">{data.meet.name}</h1>
            <p className="text-xs text-gray-400">
              Declarations{data.meet.date ? ` · ${new Date(`${data.meet.date}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}` : ''}
            </p>
          </div>
          <div className="ml-auto sm:ml-0 flex items-center gap-2 text-xs" aria-live="polite">
            <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold ${offline || stale ? 'bg-amber-500/15 text-amber-300' : 'bg-[#e70518]/15 text-red-300'}`}>
              <span className={`h-2 w-2 rounded-full ${offline || stale ? 'bg-amber-400' : 'bg-[#e70518] animate-pulse'}`} />
              {offline ? 'Reconnecting' : stale ? 'Paused' : 'Live'}
            </span>
            <span className="text-gray-500">Updated {ago(new Date(checkedAt).toISOString(), now)}</span>
          </div>
        </div>
      </header>

      <main className="mx-auto w-full max-w-7xl px-4 py-5 space-y-5 lg:space-y-0 lg:flex-1 lg:min-h-0 lg:flex lg:flex-col lg:gap-5">
        {/* ── The numbers ── */}
        <section className="shrink-0 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 sm:gap-3">
          {[
            { label: 'Schools answered', value: `${T.schoolsDone}/${T.schools}`, sub: `${T.schoolsOpened} opened \u00b7 ${T.schoolsStarted} started`, bar: [T.schoolsDone, T.schools] as const },
            { label: 'Runners', value: T.runners, sub: `${T.runners - T.undecided} answered` },
            { label: 'Declared', value: T.declared, sub: 'running', tone: 'text-emerald-300' },
            { label: 'Scratched', value: T.scratched, sub: 'out', tone: 'text-rose-300' },
            { label: 'No answer yet', value: T.undecided, sub: 'runners', tone: T.undecided ? 'text-amber-300' : '' },
            { label: 'Races', value: data.races.length, sub: `${data.races.filter((r) => r.closed).length} closed` },
          ].map((s) => (
            <div key={s.label} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 sm:py-2.5">
              <div className="text-[10px] sm:text-[11px] uppercase tracking-wider text-gray-400">{s.label}</div>
              <div className={`mt-0.5 text-xl sm:text-2xl font-bold tabular-nums ${s.tone ?? ''}`}>{s.value}</div>
              <div className="text-[11px] text-gray-500">{s.sub}</div>
              {s.bar && <div className="mt-1.5"><Bar value={s.bar[0]} total={s.bar[1]} /></div>}
            </div>
          ))}
        </section>

        <div className="grid gap-5 lg:grid-cols-[1fr_20rem] lg:flex-1 lg:min-h-0">
          <div className="min-w-0 space-y-3 lg:space-y-0 lg:min-h-0 lg:flex lg:flex-col lg:gap-3">
            {/* ── Which view ── */}
            <div className="flex flex-wrap items-center gap-2">
              {/* The full width on a phone, each tab an equal share; their own width from there up. */}
              <div className="flex w-full sm:w-auto rounded-lg border border-white/10 p-0.5">
                {(['schools', 'races', 'latest'] as const).map((t) => (
                  <button key={t} onClick={() => setTab(t)} aria-pressed={tab === t}
                    className={`flex-1 sm:flex-none px-3 py-2 sm:py-1.5 text-sm rounded-md ${t === 'latest' ? 'lg:hidden' : ''} ${tab === t ? 'bg-white/10 text-white' : 'text-gray-400 hover:text-gray-200'}`}>
                    {t === 'schools' ? `Schools (${data.teams.length})` : t === 'races' ? `Races (${data.races.length})` : 'Latest'}
                  </button>
                ))}
              </div>
              {tab === 'schools' && (
                <>
                  <div className="grid w-full grid-cols-2 gap-1.5 sm:flex sm:w-auto sm:flex-wrap sm:gap-1 [&>button:first-child]:col-span-2 sm:[&>button:first-child]:col-span-1">
                    {(['all', 'unopened', 'opened', 'started', 'done'] as const).map((f) => (
                      <button key={f} onClick={() => setFilter(f)} aria-pressed={filter === f}
                        className={`whitespace-nowrap px-2.5 py-2 sm:py-1 text-xs rounded-lg sm:rounded-full border text-center ${filter === f ? 'border-white/30 bg-white/10 text-white' : 'border-white/10 text-gray-400 hover:text-gray-200'}`}>
                        {STATE_LABEL[f]} <span className="tabular-nums text-gray-500">{counts[f]}</span>
                      </button>
                    ))}
                  </div>
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="School, runner or bib"
                    className="sm:ml-auto w-full sm:w-56 rounded-md border border-white/10 bg-white/[0.03] px-3 py-2 sm:py-1.5 text-sm placeholder:text-gray-600 focus:border-white/30 outline-none" />
                </>
              )}
            </div>

            <div className="dash-scroll lg:flex-1 lg:min-h-0 lg:overflow-y-auto lg:pr-1.5">
            {tab === 'schools' ? (
              // Dense, so a school opened across both columns leaves no hole beside the one before it.
              <div className="grid gap-3 md:grid-cols-2 grid-flow-row-dense">
                {teams.length === 0 && <p className="text-sm text-gray-500">No schools match.</p>}
                {teams.map((t) => {
                  const state = schoolState(t);
                  const accent = color(t.org?.primaryColor) ?? '#334155';
                  const isOpen = open.has(t.id);
                  return (
                    <article key={t.id}
                      className={`rounded-lg border bg-white/[0.03] transition-colors duration-700 ${fresh.has(t.id) ? 'border-emerald-400/60 bg-emerald-400/[0.06]' : 'border-white/10'} ${isOpen ? 'md:col-span-2' : ''}`}
                      style={{ boxShadow: `inset 4px 0 0 ${accent}` }}>
                      <button onClick={() => toggle(t.id)} aria-expanded={isOpen} className="w-full text-left px-3 sm:px-4 py-3 flex items-center gap-3">
                        <Logo team={t} />
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <h3 className="font-semibold truncate">{t.name}</h3>
                            <span className={`shrink-0 text-[10px] px-1.5 py-0.5 rounded ${STATE_TONE[state]}`}>{STATE_LABEL[state]}</span>
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-xs text-gray-400 [&>span]:whitespace-nowrap">
                            <span className="tabular-nums">{t.answered}/{t.total} answered</span>
                            <span className="text-emerald-300/90 tabular-nums">{t.declared} running</span>
                            {t.scratched > 0 && <span className="text-rose-300/90 tabular-nums">{t.scratched} out</span>}
                            <span className="ml-auto text-gray-500">{t.lastActivity ? ago(t.lastActivity, now) : t.openedAt ? `opened ${ago(t.lastOpenedAt ?? t.openedAt, now)}` : 'not opened'}</span>
                          </div>
                          <div className="mt-1.5"><Bar value={t.answered} total={t.total} tone={state === 'done' ? 'bg-emerald-500' : state === 'unopened' ? 'bg-gray-500' : 'bg-amber-400'} /></div>
                        </div>
                      </button>
                      {t.raceIds.length > 0 && (
                        <div className="px-4 pb-3 -mt-1 flex flex-wrap gap-1">
                          {t.raceIds.map((id) => {
                            const done = t.finalizedRaceIds.includes(id);
                            return (
                              <span key={id} className={`text-[10px] px-1.5 py-0.5 rounded border ${done ? 'border-emerald-500/40 text-emerald-300' : 'border-white/10 text-gray-500'}`}>
                                {done ? '✓ ' : ''}{raceName.get(id) ?? 'Race'}
                              </span>
                            );
                          })}
                        </div>
                      )}
                      {isOpen && <Roster team={t} raceName={raceName} words={words} now={now} />}
                    </article>
                  );
                })}
              </div>
            ) : tab === 'races' ? (
              <div className="space-y-3">
                {data.races.map((r) => <RaceCard key={r.id} race={r} teams={data.teams} tz={tz} words={words} open={open.has(r.id)} onToggle={() => toggle(r.id)} />)}
              </div>
            ) : (
              <Latest activity={data.activity} now={now} />
            )}
            </div>
          </div>

          {/* ── What just happened ── */}
          {/* Beside the schools from a laptop up; a tab of its own on a phone. */}
          <aside className="hidden lg:flex lg:flex-col lg:min-h-0 gap-2">
            <h2 className="shrink-0 text-xs font-semibold uppercase tracking-wider text-gray-400">Latest answers</h2>
            <Latest activity={data.activity} now={now} fill />
          </aside>
        </div>
      </main>
    </div>
  );
}

function Latest({ activity, now, fill = false }: { activity: DashboardData['activity']; now: number; fill?: boolean }) {
  return (
    <ol className={`rounded-lg border border-white/10 bg-white/[0.03] divide-y divide-white/5 ${fill ? 'dash-scroll flex-1 min-h-0 overflow-y-auto' : ''}`}>
      {activity.length === 0 && <li className="px-3 py-3 text-sm text-gray-500">Nothing yet.</li>}
      {activity.map((a, i) => (
        <li key={`${a.at}-${i}`} className="px-3 py-2 text-sm">
          <div className="flex items-baseline gap-2">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full translate-y-[-1px] ${a.status === 'declared' ? 'bg-emerald-400' : a.status === 'opened' ? 'bg-sky-400' : 'bg-rose-400'}`} />
            <span className="font-medium truncate">{a.status === 'opened' ? a.teamName : a.runnerName}</span>
            <span className="ml-auto shrink-0 text-[11px] text-gray-500">{ago(a.at, now)}</span>
          </div>
          <div className="pl-3.5 text-xs text-gray-400 truncate">
            {a.status === 'opened' ? 'opened their form'
              : <>{a.teamName} &middot; {a.status === 'declared' ? (a.raceName ?? 'declared') : 'scratched'}</>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Roster({ team, raceName, words, now }: {
  team: DashTeam; raceName: Map<string, string>; words: Record<string, string>; now: number;
}) {
  const bySide = (['F', 'M', ''] as const)
    .map((s) => ({ s, runners: team.runners.filter((r) => side(r.gender) === s) }))
    .filter((g) => g.runners.length);
  return (
    <div className="border-t border-white/10 px-3 sm:px-4 py-3 grid gap-4 md:grid-cols-2">
      {bySide.map((g) => (
        <div key={g.s || 'x'}>
          {g.s && <h4 className="text-[11px] uppercase tracking-wider text-gray-400 mb-1.5">{words[g.s]} &middot; {g.runners.length}</h4>}
          <ul className="space-y-1.5">
            {g.runners.map((r) => (
              <li key={r.id} className="flex items-center gap-2.5">
                <Face runner={r} />
                <div className="min-w-0 flex-1">
                  <div className="text-sm truncate">{r.firstName} {r.lastName}</div>
                  <div className="text-[11px] text-gray-500">{[r.bib && `#${r.bib}`, r.year].filter(Boolean).join(' · ')}</div>
                </div>
                <div className="text-right">
                  <span className={`text-[11px] px-1.5 py-0.5 rounded ${r.status === 'declared' ? 'bg-emerald-500/15 text-emerald-300' : r.status === 'scratched' ? 'bg-rose-500/15 text-rose-300' : 'bg-gray-700/60 text-gray-400'}`}>
                    {r.status === 'declared' ? (r.raceId ? raceName.get(r.raceId) ?? 'Declared' : 'Declared') : r.status === 'scratched' ? 'Scratched' : 'No answer'}
                  </span>
                  {r.answeredAt && <div className="text-[10px] text-gray-600 mt-0.5">{ago(r.answeredAt, now)}</div>}
                </div>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}

function RaceCard({ race, teams, tz, words, open, onToggle }: {
  race: DashRace; teams: DashTeam[]; tz: string | undefined; words: Record<string, string>; open: boolean; onToggle: () => void;
}) {
  const entered = teams
    .map((t) => ({ team: t, runners: t.runners.filter((r) => r.status === 'declared' && r.raceId === race.id) }))
    .filter((g) => g.runners.length);
  const pending = teams.filter((t) => t.raceIds.includes(race.id) && !t.finalizedRaceIds.includes(race.id));
  return (
    <article className="rounded-lg border border-white/10 bg-white/[0.03]">
      <button onClick={onToggle} aria-expanded={open} className="w-full text-left px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="font-semibold">{race.name}</h3>
          {words[side(race.gender)] && <span className="text-xs text-gray-500">{words[side(race.gender)]}</span>}
          {race.distanceLabel && <span className="text-xs text-gray-500">{race.distanceLabel}</span>}
          <span className={`ml-auto text-[11px] px-2 py-0.5 rounded-full ${race.closed ? 'bg-gray-700/60 text-gray-300' : 'bg-emerald-500/15 text-emerald-300'}`}>
            {race.closed ? 'Closed' : race.closesAt ? `Open until ${meetTime(new Date(race.closesAt), tz)}` : 'Open'}
          </span>
        </div>
        <div className="mt-2 grid grid-cols-2 sm:grid-cols-3 gap-3 text-xs">
          <div><div className="text-gray-500">Declared</div><div className="text-lg font-bold tabular-nums">{race.declared}<span className="text-xs font-normal text-gray-500"> / {race.eligible}</span></div></div>
          <div><div className="text-gray-500">Schools done</div><div className="text-lg font-bold tabular-nums">{race.finalized}<span className="text-xs font-normal text-gray-500"> / {race.schools}</span></div></div>
          <div><div className="text-gray-500">Starts</div><div className="text-sm font-medium">{race.scheduledTime ? meetTime(new Date(race.scheduledTime), tz) : '—'}</div></div>
        </div>
        <div className="mt-2"><Bar value={race.finalized} total={race.schools} /></div>
      </button>
      {open && (
        <div className="border-t border-white/10 px-4 py-3 space-y-3">
          {pending.length > 0 && (
            <p className="text-xs text-amber-300/90">
              Not done yet: {pending.map((t) => t.name).join(', ')}
            </p>
          )}
          {entered.length === 0 ? <p className="text-sm text-gray-500">Nobody declared yet.</p> : (
            <div className="grid gap-3 md:grid-cols-2">
              {entered.map(({ team, runners }) => (
                <div key={team.id} className="rounded-md border border-white/5 p-2.5">
                  <div className="flex items-center gap-2 mb-2">
                    <Logo team={team} size={24} />
                    <span className="text-sm font-medium truncate">{team.name}</span>
                    <span className="ml-auto text-xs text-gray-500 tabular-nums">{runners.length}</span>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {runners.map((r) => (
                      <div key={r.id} className="flex items-center gap-1.5 text-xs">
                        <Face runner={r} size={24} />
                        <span>{r.firstName} {r.lastName}</span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
