'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ClerkView as View, ClerkStatus, ClerkTeam } from '@/lib/declare-clerk';

/**
 * The clerks' page, for a phone or a tablet at the line: pick a race, see
 * each school in box order (or A to Z) with who is declared, checked in,
 * still to declare or scratched, and search any runner by name, bib or
 * school. Read-only; it refreshes itself every half minute.
 */

type Athlete = View['athletes'][number];
type Sort = 'box' | 'name';
type Show = 'all' | 'todo' | 'scratched';

const REFRESH_MS = 30_000;

const STATUS: Record<ClerkStatus, { words: string; cls: string }> = {
  declared: { words: 'Declared', cls: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30' },
  checked_in: { words: 'Checked in', cls: 'bg-sky-500/15 text-sky-300 border-sky-500/30' },
  entered: { words: 'Not declared', cls: 'bg-amber-500/15 text-amber-300 border-amber-500/30' },
  scratched: { words: 'Scratched', cls: 'bg-rose-500/15 text-rose-300 border-rose-500/30' },
  dns: { words: 'DNS', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  dnf: { words: 'DNF', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  dq: { words: 'DQ', cls: 'bg-gray-500/15 text-gray-300 border-gray-500/30' },
  unentered: { words: 'In no race', cls: 'bg-gray-500/15 text-gray-400 border-gray-500/30' },
};
/** Running or about to: declared and checked in. */
const IN = (s: ClerkStatus) => s === 'declared' || s === 'checked_in';

function ago(iso: string | null, now: number): string {
  if (!iso) return 'not sent yet';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min ago` : new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
}

function Pill({ status }: { status: ClerkStatus }) {
  const s = STATUS[status] ?? STATUS.entered;
  return <span className={`shrink-0 whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.words}</span>;
}

function Logo({ team, size = 36 }: { team: ClerkTeam | null; size?: number }) {
  const [failed, setFailed] = useState(false);
  const box = { width: size, height: size };
  const src = team ? team.logoDarkUrl || team.logoUrl : null;
  if (!team || !src || failed) {
    const name = team?.name ?? 'Unattached';
    const initials = name.replace(/^(The|University of)\s+/i, '').split(/\s+/).map((w) => w[0]).join('').slice(0, 2).toUpperCase();
    const bg = team?.primaryColor && /^#?[0-9a-f]{6}$/i.test(team.primaryColor) ? (team.primaryColor.startsWith('#') ? team.primaryColor : `#${team.primaryColor}`) : null;
    return (
      <span style={{ ...box, background: bg ?? undefined }}
        className={`inline-flex shrink-0 items-center justify-center rounded-md text-xs font-bold ${bg ? 'text-white' : 'bg-white/10 text-gray-300'}`}>
        {initials}
      </span>
    );
  }
  return (
    <span style={box} className={`inline-flex shrink-0 items-center justify-center rounded-md overflow-hidden p-1 ${team.logoDarkUrl ? 'bg-white/10' : 'bg-white'}`}>
      {/* eslint-disable-next-line @next/next/no-img-element -- logos come from storage and school sites */}
      <img src={src} alt="" loading="lazy" className="max-w-full max-h-full object-contain" onError={() => setFailed(true)} />
    </span>
  );
}

const nameOf = (a: Athlete) => `${a.firstName} ${a.lastName}`.trim();

export default function ClerkView({ token, initial }: { token: string; initial: View }) {
  const [data, setData] = useState<View>(initial);
  const [now, setNow] = useState(() => Date.now());
  const [offline, setOffline] = useState(false);
  const firstRace = initial.races.find((r) => !['official', 'complete', 'final'].includes(r.status)) ?? initial.races[0];
  const [raceId, setRaceId] = useState<string | null>(firstRace?.id ?? null);
  const [sort, setSort] = useState<Sort>('box');
  const [show, setShow] = useState<Show>('all');
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState<Set<string>>(new Set());
  const [flash, setFlash] = useState<string | null>(null);
  const cards = useRef(new Map<string, HTMLElement>());

  // Remembered on this device: the race and the order a clerk works in.
  useEffect(() => {
    try {
      const saved = JSON.parse(localStorage.getItem(`clerk:${token}`) || '{}') as { raceId?: string; sort?: Sort };
      if (saved.raceId && initial.races.some((r) => r.id === saved.raceId)) setRaceId(saved.raceId);
      if (saved.sort === 'box' || saved.sort === 'name') setSort(saved.sort);
    } catch { /* first visit */ }
  }, [token, initial.races]);
  useEffect(() => {
    try { localStorage.setItem(`clerk:${token}`, JSON.stringify({ raceId, sort })); } catch { /* not kept */ }
  }, [token, raceId, sort]);

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`/api/declare/clerk/${token}`, { cache: 'no-store' });
      if (!res.ok) throw new Error(String(res.status));
      setData(await res.json() as View);
      setOffline(false);
    } catch { setOffline(true); }
    setNow(Date.now());
  }, [token]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === 'visible') void refresh(); }, REFRESH_MS);
    const tick = setInterval(() => setNow(Date.now()), 15_000);
    const back = () => { if (document.visibilityState === 'visible') void refresh(); };
    document.addEventListener('visibilitychange', back);
    return () => { clearInterval(t); clearInterval(tick); document.removeEventListener('visibilitychange', back); };
  }, [refresh]);

  const teamOf = useMemo(() => new Map(data.teams.map((t) => [t.id, t])), [data.teams]);
  const raceOf = useMemo(() => new Map(data.races.map((r) => [r.id, r])), [data.races]);
  const race = raceId ? raceOf.get(raceId) ?? null : null;

  // Each race's runners, schools and boxes.
  const inRace = useMemo(() => data.athletes.filter((a) => a.raceId === raceId), [data.athletes, raceId]);
  const raceCounts = useMemo(() => {
    const m = new Map<string, { in: number; todo: number; all: number }>();
    for (const a of data.athletes) {
      if (!a.raceId) continue;
      const c = m.get(a.raceId) ?? { in: 0, todo: 0, all: 0 };
      c.all++;
      if (IN(a.status)) c.in++;
      if (a.status === 'entered') c.todo++;
      m.set(a.raceId, c);
    }
    return m;
  }, [data.athletes]);

  interface Group { key: string; team: ClerkTeam | null; boxes: number[]; runners: Athlete[] }
  const groups = useMemo<Group[]>(() => {
    const m = new Map<string, Group>();
    const get = (key: string, team: ClerkTeam | null) => {
      if (!m.has(key)) m.set(key, { key, team, boxes: [], runners: [] });
      return m.get(key)!;
    };
    for (const b of data.boxes) {
      if (b.raceId !== raceId) continue;
      const g = b.teamId ? get(b.teamId, teamOf.get(b.teamId) ?? null) : get('unattached', null);
      if (!g.boxes.includes(b.box)) g.boxes.push(b.box);
    }
    for (const a of inRace) {
      const g = a.teamId ? get(a.teamId, teamOf.get(a.teamId) ?? null) : get('unattached', null);
      g.runners.push(a);
    }
    const list = [...m.values()].filter((g) => g.runners.length > 0 || g.boxes.length > 0);
    for (const g of list) {
      g.boxes.sort((a, b) => a - b);
      g.runners.sort((a, b) => (a.bib ?? 1e9) - (b.bib ?? 1e9));
    }
    const name = (g: Group) => g.team?.name ?? 'Unattached';
    return list.sort(sort === 'box'
      ? (a, b) => (a.boxes[0] ?? 1e9) - (b.boxes[0] ?? 1e9) || name(a).localeCompare(name(b))
      : (a, b) => (a.team ? 0 : 1) - (b.team ? 0 : 1) || name(a).localeCompare(name(b)));
  }, [data.boxes, inRace, raceId, sort, teamOf]);

  const visible = groups.filter((g) => show === 'all'
    || (show === 'todo' ? g.runners.some((a) => a.status === 'entered') : g.runners.some((a) => a.status === 'scratched')));
  const totals = {
    schools: groups.filter((g) => g.team).length,
    declared: inRace.filter((a) => a.status === 'declared').length,
    checkedIn: inRace.filter((a) => a.status === 'checked_in').length,
    todo: inRace.filter((a) => a.status === 'entered').length,
    scratched: inRace.filter((a) => a.status === 'scratched').length,
    dns: inRace.filter((a) => a.status === 'dns').length,
  };

  // Search: any runner, by name, bib or school.
  const q = query.trim().toLowerCase();
  const results = useMemo(() => {
    if (!q) return [];
    const digits = /^\d+$/.test(q);
    return data.athletes.filter((a) => {
      if (digits) return a.bib != null && String(a.bib).startsWith(q);
      const school = a.teamId ? teamOf.get(a.teamId) : null;
      return nameOf(a).toLowerCase().includes(q) || `${a.lastName} ${a.firstName}`.toLowerCase().includes(q)
        || (!!school && (school.name.toLowerCase().includes(q) || school.abbreviation.toLowerCase() === q));
    })
      // A bib typed in full comes first, then the ones it starts.
      .sort((a, b) => (digits ? Number(String(b.bib) === q) - Number(String(a.bib) === q) : 0))
      .slice(0, 200);
  }, [q, data.athletes, teamOf]);

  const toggle = (key: string) => setOpen((s) => { const n = new Set(s); if (n.has(key)) n.delete(key); else n.add(key); return n; });
  const goTo = (a: Athlete) => {
    if (!a.raceId) return;
    setQuery('');
    setShow('all');
    setRaceId(a.raceId);
    const key = a.teamId ?? 'unattached';
    setOpen((s) => new Set(s).add(key));
    setFlash(a.id);
    setTimeout(() => cards.current.get(key)?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    setTimeout(() => setFlash(null), 2500);
  };

  const stale = !data.updatedAt || now - new Date(data.updatedAt).getTime() > 5 * 60_000;
  const timeOf = (r: View['races'][number]) => (r.time ? (() => {
    const [h, m] = r.time.split(':').map(Number);
    return Number.isFinite(h) ? `${h % 12 === 0 ? 12 : h % 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'AM' : 'PM'}` : r.time;
  })() : null);

  return (
    <div className="min-h-screen bg-[#0a0f24] text-gray-100">
      {/* ── Masthead and search: stay put while the schools scroll ── */}
      <header className="sticky top-0 z-20 border-b border-white/10 bg-[#0c1537]/95 backdrop-blur pt-[env(safe-area-inset-top)]">
        <div className="px-4 lg:px-6 pt-3 pb-2 flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static brand image */}
          <img src="/live/primetime-on-dark.png" alt="PrimeTime Timing" className="h-5 w-auto hidden sm:block" />
          <div className="min-w-0 flex-1">
            <h1 className="text-base sm:text-lg font-bold truncate">{data.meetName}</h1>
            <p className="text-[11px] text-gray-400">Clerks</p>
          </div>
          <span className={`shrink-0 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ${offline || stale ? 'bg-amber-500/15 text-amber-300' : 'bg-emerald-500/15 text-emerald-300'}`}
            title="When the meet desk last sent it">
            <span className={`h-2 w-2 rounded-full ${offline || stale ? 'bg-amber-400' : 'bg-emerald-400'}`} />
            {offline ? 'Reconnecting' : `Updated ${ago(data.updatedAt, now)}`}
          </span>
        </div>
        <div className="px-4 lg:px-6 pb-3">
          <input value={query} onChange={(e) => setQuery(e.target.value)} type="search" inputMode="search"
            placeholder="Search a runner: name, bib or school" aria-label="Search a runner"
            className="w-full rounded-lg border border-white/10 bg-white/[0.05] px-3 py-2.5 text-base placeholder:text-gray-500 focus:border-white/30 outline-none" />
        </div>
        {!q && data.races.length > 0 && (
          // The races, side by side; a phone scrolls them sideways.
          <nav className="px-4 lg:px-6 pb-3 flex gap-2 overflow-x-auto [scrollbar-width:none]" aria-label="Races">
            {data.races.map((r) => {
              const c = raceCounts.get(r.id);
              const on = r.id === raceId;
              return (
                <button key={r.id} onClick={() => setRaceId(r.id)} aria-pressed={on}
                  className={`shrink-0 rounded-lg border px-3 py-2 text-left min-w-[8.5rem] ${on ? 'border-white/40 bg-white/15' : 'border-white/10 bg-white/[0.03] hover:bg-white/[0.06]'}`}>
                  <div className="text-sm font-semibold whitespace-nowrap">{r.name}</div>
                  <div className="text-[11px] text-gray-400 whitespace-nowrap tabular-nums">
                    {timeOf(r) ? `${timeOf(r)} · ` : ''}{c ? `${c.in}/${c.all} in` : 'no runners'}{c?.todo ? ` · ${c.todo} to declare` : ''}
                  </div>
                </button>
              );
            })}
          </nav>
        )}
      </header>

      <main className="px-4 lg:px-6 py-4 pb-[calc(2rem+env(safe-area-inset-bottom))]">
        {!data.updatedAt && (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
            The meet desk has not sent the clerks&rsquo; page yet. It appears here once the desk pulls the declarations.
          </p>
        )}

        {q ? (
          // ── Search ──
          <section>
            <p className="text-xs text-gray-400 mb-2">{results.length === 200 ? 'First 200 runners' : `${results.length} runner${results.length === 1 ? '' : 's'}`} matching &ldquo;{query.trim()}&rdquo;</p>
            <ul className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))' }}>
              {results.map((a) => {
                const school = a.teamId ? teamOf.get(a.teamId) ?? null : null;
                const r = a.raceId ? raceOf.get(a.raceId) : null;
                return (
                  <li key={`${a.id}-${a.raceId ?? 'none'}`}>
                    <button onClick={() => goTo(a)} disabled={!a.raceId}
                      className="w-full text-left rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2.5 flex items-center gap-3 hover:bg-white/[0.06] disabled:hover:bg-white/[0.03]">
                      <span className="w-12 shrink-0 text-center font-mono text-lg font-bold tabular-nums">{a.bib ?? '–'}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold truncate">{nameOf(a)}{a.year ? <span className="font-normal text-gray-400"> · {a.year}</span> : null}</span>
                        <span className="block text-xs text-gray-400 truncate">{school?.name ?? 'Unattached'}</span>
                        <span className="block text-xs text-gray-500 truncate">{r ? r.name : 'In no race'}{a.box != null ? ` · Box ${a.box}` : ''}</span>
                      </span>
                      <Pill status={a.status} />
                    </button>
                  </li>
                );
              })}
            </ul>
            {results.length === 0 && <p className="text-sm text-gray-500">Nobody by that name, bib or school.</p>}
          </section>
        ) : race ? (
          <>
            {/* ── The race in numbers ── */}
            <section className="mb-3 grid grid-cols-3 sm:grid-cols-6 gap-2">
              {[
                { label: 'Schools', value: totals.schools },
                { label: 'Declared', value: totals.declared, tone: 'text-emerald-300' },
                { label: 'Checked in', value: totals.checkedIn, tone: 'text-sky-300' },
                { label: 'To declare', value: totals.todo, tone: totals.todo ? 'text-amber-300' : '' },
                { label: 'Scratched', value: totals.scratched, tone: 'text-rose-300' },
                { label: 'DNS', value: totals.dns },
              ].map((s) => (
                <div key={s.label} className="rounded-lg border border-white/10 bg-white/[0.03] px-2.5 py-2">
                  <div className="text-[10px] uppercase tracking-wider text-gray-400">{s.label}</div>
                  <div className={`text-xl font-bold tabular-nums ${s.tone ?? ''}`}>{s.value}</div>
                </div>
              ))}
            </section>

            {/* ── Order and filter ── */}
            <div className="mb-3 flex flex-wrap items-center gap-2">
              <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Order">
                {([['box', 'By box'], ['name', 'A–Z']] as const).map(([k, w]) => (
                  <button key={k} onClick={() => setSort(k)} aria-pressed={sort === k}
                    className={`px-3 py-1.5 text-sm rounded-md ${sort === k ? 'bg-white/15 text-white' : 'text-gray-400'}`}>{w}</button>
                ))}
              </div>
              <div className="flex rounded-lg border border-white/10 p-0.5" role="group" aria-label="Show">
                {([['all', 'Everyone'], ['todo', 'To declare'], ['scratched', 'Scratched']] as const).map(([k, w]) => (
                  <button key={k} onClick={() => setShow(k)} aria-pressed={show === k}
                    className={`px-3 py-1.5 text-sm rounded-md whitespace-nowrap ${show === k ? 'bg-white/15 text-white' : 'text-gray-400'}`}>{w}</button>
                ))}
              </div>
              <button onClick={() => setOpen(open.size ? new Set() : new Set(visible.map((g) => g.key)))}
                className="ml-auto px-3 py-1.5 text-sm rounded-lg border border-white/10 text-gray-300">
                {open.size ? 'Close all' : 'Open all'}
              </button>
            </div>

            {/* ── The schools ── */}
            <div className="grid gap-2.5 items-start" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 22rem), 1fr))' }}>
              {visible.map((g) => {
                const isOpen = open.has(g.key);
                const runners = show === 'all' ? g.runners
                  : g.runners.filter((a) => (show === 'todo' ? a.status === 'entered' : a.status === 'scratched'));
                const n = (s: (a: Athlete) => boolean) => g.runners.filter(s).length;
                return (
                  <article key={g.key} ref={(el) => { if (el) cards.current.set(g.key, el); }}
                    className="scroll-mt-48 rounded-lg border border-white/10 bg-white/[0.03]">
                    <button onClick={() => toggle(g.key)} aria-expanded={isOpen} className="w-full text-left px-3 py-2.5 flex items-center gap-3">
                      {/* The box, big: it is what a line clerk reads first. */}
                      <span className="shrink-0 min-w-[3rem] rounded-md bg-white/10 px-2 py-1 text-center">
                        <span className="block text-[9px] uppercase tracking-wider text-gray-400">Box</span>
                        <span className="block text-xl font-bold tabular-nums leading-tight">{g.boxes.length ? g.boxes.join(', ') : '–'}</span>
                      </span>
                      <Logo team={g.team} />
                      <span className="min-w-0 flex-1">
                        <span className="block font-semibold truncate">{g.team?.name ?? 'Unattached'}</span>
                        <span className="mt-0.5 flex flex-wrap gap-x-2.5 text-xs tabular-nums">
                          <span className="text-emerald-300/90">{n((a) => IN(a.status))} in</span>
                          {n((a) => a.status === 'entered') > 0 && <span className="text-amber-300/90">{n((a) => a.status === 'entered')} to declare</span>}
                          {n((a) => a.status === 'scratched') > 0 && <span className="text-rose-300/90">{n((a) => a.status === 'scratched')} scratched</span>}
                          {n((a) => a.status === 'dns') > 0 && <span className="text-gray-400">{n((a) => a.status === 'dns')} DNS</span>}
                        </span>
                      </span>
                      <span className={`shrink-0 text-gray-500 transition-transform ${isOpen ? 'rotate-90' : ''}`}>&#9656;</span>
                    </button>
                    {isOpen && (
                      <ul className="border-t border-white/10 divide-y divide-white/5">
                        {runners.map((a) => (
                          <li key={a.id} className={`px-3 py-2 flex items-center gap-3 transition-colors duration-700 ${flash === a.id ? 'bg-amber-400/15' : ''}`}>
                            <span className="w-11 shrink-0 text-center font-mono font-bold tabular-nums">{a.bib ?? '–'}</span>
                            <span className="min-w-0 flex-1">
                              <span className="block truncate">{nameOf(a)}</span>
                              <span className="block text-[11px] text-gray-500">{[a.year, !g.team && a.box != null ? `Box ${a.box}` : null].filter(Boolean).join(' · ')}</span>
                            </span>
                            <Pill status={a.status} />
                          </li>
                        ))}
                        {runners.length === 0 && <li className="px-3 py-2 text-xs text-gray-500">No runners.</li>}
                      </ul>
                    )}
                  </article>
                );
              })}
            </div>
            {visible.length === 0 && (
              <p className="text-sm text-gray-500">{show === 'all' ? 'No schools in this race.' : show === 'todo' ? 'Every school has declared everyone.' : 'Nobody scratched from this race.'}</p>
            )}
          </>
        ) : (
          <p className="text-sm text-gray-500">No races yet.</p>
        )}
      </main>
    </div>
  );
}
