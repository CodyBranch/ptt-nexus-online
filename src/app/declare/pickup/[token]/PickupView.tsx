'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PickupResult, PickupSchool, PickupView as View, Side } from '@/lib/declare-pickup';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';
import SchoolBadge from './SchoolBadge';
import { covers, sameName, type StaffMember } from '@/lib/declare-staff';

/**
 * The packet table.
 *
 * The box at the top takes a team label's code: a USB or Bluetooth scanner
 * types it and presses Enter, an Android scanner in keyboard mode does the
 * same, and the PTT Nexus Tablet app's Scan button hands its camera's read
 * over as a 'nexus-scan' event. A scan looks the school up and opens its
 * packet window: which packets go out, who took them, and which of the
 * school's staff get a coach pass, all confirmed at once. Tapping a school
 * in the list opens the same window. Each station chooses (kept on this
 * device) whether the name is required and where the signature is taken:
 * nowhere, on this screen, or on the sign-off tablet facing the coach.
 *
 * Practice run tries all of that on the real meet: everything recorded
 * meanwhile is test data, and ending the run deletes it.
 */

const POLL_MS = 3000;
const STATION_KEY = 'nexus-pickup-station';

type SignMode = 'none' | 'here' | 'tablet';
interface Station { askName: boolean; sign: SignMode; device: string }
const DEFAULT_STATION: Station = { askName: false, sign: 'none', device: '' };

type Terms = 'men_women' | 'boys_girls';

/** A school's packet window: the school, and the packets ticked when it opened. */
interface Open { teamAccessId: string; sides: Side[] }

/** What the window hands over when confirmed. */
interface HandOver {
  sides: Side[];
  by: string;
  signature: string | null;
  /** Coach passes: someone on the staff list by id, or a walk-up by name. */
  passes: Array<{ staffId?: string; name?: string }>;
}

const LABEL_CODE = /^NXPKT-([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})-([FMA])$/i;

const FLASH: Record<PickupResult['status'], string> = {
  picked_up: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  waiting: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  already: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  unknown: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
};

function loadStation(): Station {
  try { return { ...DEFAULT_STATION, ...JSON.parse(localStorage.getItem(STATION_KEY) ?? '{}') }; } catch { return DEFAULT_STATION; }
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function sideWord(side: Side | 'A', terms: Terms): string {
  if (side === 'A') return 'All packets';
  if (side === 'X') return 'Packet';
  return side === 'F' ? (terms === 'men_women' ? 'Women' : 'Girls') : (terms === 'men_women' ? 'Men' : 'Boys');
}

/** The packets still to hand over. */
const remaining = (s: PickupSchool): Side[] => s.sides.filter((x) => !x.pickup).map((x) => x.side);

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export default function PickupView({ token, initial, terms }: { token: string; initial: View; terms: Terms }) {
  const [view, setView] = useState<View>(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ status: PickupResult['status']; message: string; teamAccessId?: string | null } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [station, setStation] = useState<Station>(DEFAULT_STATION);
  const [setup, setSetup] = useState(false);
  const [open, setOpen] = useState<Open | null>(null);
  /** A label scanned while a window is open: said in the window. */
  const [notice, setNotice] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [onlyLeft, setOnlyLeft] = useState(true);
  const [origin, setOrigin] = useState('');
  /** Starting or ending a practice run, waiting on a second tap. */
  const [practiceAsk, setPracticeAsk] = useState<'start' | 'end' | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const api = `/api/declare/pickup/${token}`;

  useEffect(() => { setStation(loadStation()); setOrigin(window.location.origin); }, []);
  const saveStation = (s: Station) => {
    setStation(s);
    try { localStorage.setItem(STATION_KEY, JSON.stringify(s)); } catch { /* kept for this visit only */ }
  };

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(api, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setView(await r.json());
      setError(null);
    } catch {
      setError('Lost touch with the server - retrying');
    }
  }, [api]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    return () => clearInterval(t);
  }, [refresh]);

  const post = useCallback(async (body: Record<string, unknown>) => {
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const res = await r.json().catch(() => ({})) as Record<string, unknown> & { held?: boolean; error?: string };
    if (!r.ok && !res.held) throw new Error(res.error ?? 'Not recorded');
    return res;
  }, [api]);

  const closeWindow = useCallback(() => {
    setOpen(null);
    setNotice(null);
    setTimeout(() => input.current?.focus(), 0);
  }, []);

  /** A label read by the scanner box, the tablet's camera, or while a window is open. */
  const scanned = useCallback((raw: string) => {
    const c = raw.trim();
    if (!c) return;
    const m = LABEL_CODE.exec(c);
    const school = m ? view.schools.find((s) => s.teamId === m[1].toLowerCase()) : undefined;
    if (!m || !school) {
      setFlash({ status: 'unknown', message: m ? 'That label is not for a school in this meet.' : `${c} is not a team label's code.` });
      return;
    }
    const label = m[2].toUpperCase() as Side | 'A';
    const sides = label === 'A' ? remaining(school) : remaining(school).filter((x) => x === label);
    if (open) {
      if (open.teamAccessId === school.teamAccessId) {
        // The same school's other label: tick its packet too.
        setOpen({ ...open, sides: [...new Set([...open.sides, ...sides])] });
      } else {
        setNotice(`That was ${school.name}'s label. Finish this school first, or cancel and scan it again.`);
      }
      return;
    }
    setFlash(null);
    setNotice(null);
    setOpen({ teamAccessId: school.teamAccessId, sides });
  }, [view.schools, open]);

  // The tablet app's camera.
  useEffect(() => {
    const onScan = (e: Event) => scanned(String((e as CustomEvent).detail ?? ''));
    window.addEventListener('nexus-scan', onScan);
    return () => window.removeEventListener('nexus-scan', onScan);
  }, [scanned]);

  // A scanner gun typing while a window is open: nothing has the focus to
  // take it, so catch the burst here (a person does not type 30 keys a second).
  useEffect(() => {
    if (!open) return;
    let buf = '';
    let last = 0;
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
      const now = Date.now();
      if (now - last > 80) buf = '';
      last = now;
      if (e.key === 'Enter') {
        if (LABEL_CODE.test(buf.trim())) { e.preventDefault(); scanned(buf); }
        buf = '';
      } else if (e.key.length === 1) {
        buf += e.key;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, scanned]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    scanned(code);
    setCode('');
  };

  /** The window's confirm: each packet ticked, then each pass, then one line saying what happened. */
  const handOver = async (school: PickupSchool, h: HandOver) => {
    setBusy(true);
    const wait = station.sign === 'tablet';
    const device = station.device || undefined;
    let held = false;
    const said: string[] = [];
    try {
      let first: string | null = null;
      for (const side of h.sides) {
        const res = await post({ action: 'manual', teamAccessId: school.teamAccessId, side, by: h.by || undefined, signature: h.signature, wait, device });
        held ||= !!res.held;
        first ??= typeof res.message === 'string' ? res.message : null;
      }
      if (h.sides.length) {
        const what = h.sides.map((s) => sideWord(s, terms).toLowerCase()).join(' and ');
        said.push(wait ? `${what} waiting to sign on the tablet` : `${what} picked up${h.by ? ` by ${h.by}` : ''}`);
      }
      let given = 0;
      for (const p of h.passes) {
        const res = await post({ action: 'checkin', teamAccessId: school.teamAccessId, ...p, device });
        held ||= !!res.held;
        if (res.status === 'checked_in' || res.held) given++;
      }
      if (given) said.push(plural(given, 'coach pass', 'coach passes'));
      setFlash({
        status: held || wait ? 'waiting' : 'picked_up',
        message: held ? 'No connection: held on this tablet, and sent as soon as it is back online.'
          : `${school.name}: ${said.join(' · ') || first || 'nothing to hand over'}.`,
        teamAccessId: school.teamAccessId,
      });
      closeWindow();
    } catch (e) {
      setNotice(`${e instanceof Error ? e.message : 'Not recorded'} - check the connection and try again.`);
    } finally {
      setBusy(false);
      await refresh();
    }
  };

  const takeBack = async (id: string) => {
    try { await post({ action: 'uncheckin', id }); await refresh(); } catch { setError('That change was not saved - try again'); }
  };

  const undo = async (id: string) => {
    try { await post({ action: 'undo', id }); await refresh(); } catch { setError('That change was not saved - try again'); }
  };

  const practice = async (on: boolean) => {
    setPracticeAsk(null);
    try {
      const res = await post({ action: 'practice', on }) as unknown as { removed: { pickups: number; passes: number } };
      setFlash(on
        ? { status: 'waiting', message: 'Practice run started. Scan, sign and hand out passes as on the day: none of it counts.' }
        : { status: 'picked_up', message: `Practice run ended. Removed ${plural(res.removed.pickups, 'practice pickup', 'practice pickups')} and ${plural(res.removed.passes, 'coach pass', 'coach passes')}.` });
      await refresh();
    } catch { setError('That change was not saved - try again'); }
  };

  const schools = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return view.schools.filter((s) => {
      if (words.length && !words.every((w) => s.name.toLowerCase().includes(w))) return false;
      if (onlyLeft && !words.length) return s.sides.some((x) => x.pickup?.status !== 'picked_up');
      return true;
    });
  }, [view.schools, query, onlyLeft]);

  const left = view.packets - view.pickedUp;
  const schoolOf = useMemo(() => new Map(view.schools.map((s) => [s.teamAccessId, s])), [view.schools]);
  const flashSchool = flash?.teamAccessId ? schoolOf.get(flash.teamAccessId) : undefined;
  const openSchool = open ? schoolOf.get(open.teamAccessId) : undefined;
  const scannerUrl = origin ? `${origin}${api}?code=` : '';

  return (
    <div className="min-h-screen bg-[#0a0f24] pb-16 text-gray-100">
      <header className="border-b border-white/10 bg-[#0c1537]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static brand image, as on the dashboard */}
          <img src="/live/primetime-on-dark.png" alt="PrimeTime Timing" className="h-5 w-auto sm:h-7" />
          <div className="order-last w-full min-w-0 sm:order-none sm:w-auto sm:flex-1">
            <h1 className="text-lg font-bold tracking-tight sm:truncate sm:text-xl">{view.meet.name}</h1>
            <p className="text-xs text-gray-400">Packet pickup{station.device ? ` · ${station.device}` : ''}</p>
          </div>
          {!view.practice && (
            <button onClick={() => setPracticeAsk(practiceAsk === 'start' ? null : 'start')} className="ml-auto rounded-md px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800 sm:ml-0">
              Practice run
            </button>
          )}
          <button onClick={() => setSetup((v) => !v)} className={`${view.practice ? 'ml-auto sm:ml-0 ' : ''}rounded-md px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800`}>
            This station
          </button>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${error ? 'bg-amber-500/15 text-amber-300' : view.practice ? 'bg-amber-400/20 text-amber-200' : 'bg-[#e70518]/15 text-red-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-amber-400' : view.practice ? 'bg-amber-300' : 'bg-red-500'}`} />
            {error ? 'Reconnecting' : view.practice ? 'Practice' : 'Live'}
          </span>
        </div>
      </header>

      {view.practice && (
        <div role="status" className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-amber-400/30 bg-amber-400/15 px-4 py-2.5 text-sm text-amber-100 sm:px-6">
          <p className="min-w-0 flex-1">
            <span className="font-semibold text-amber-200">Practice run since {clock(view.practice.since)}.</span>{' '}
            Nothing recorded now counts: pickups, signatures and coach passes are test data, kept apart from the real ones and deleted when the run ends.
          </p>
          <button onClick={() => setPracticeAsk('end')} className="rounded-md bg-amber-300 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
            End practice run
          </button>
        </div>
      )}

      {practiceAsk && (
        <section className="mx-4 mt-4 space-y-3 rounded-xl bg-gray-900/70 p-4 ring-1 ring-amber-400/40 sm:mx-6">
          {practiceAsk === 'start' ? (
            <>
              <h2 className="text-sm font-semibold">Start a practice run?</h2>
              <p className="text-sm text-gray-300">
                Every station on this page, the sign-off tablet and scanners calling the scanner URL switch to practice. Scan labels, sign and hand out
                passes as on the day; it is all test data. Real pickups already recorded are kept and hidden until the run ends.
              </p>
              <div className="flex gap-2">
                <button onClick={() => void practice(true)} className="rounded-md bg-amber-300 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-amber-200">Start practice run</button>
                <button onClick={() => setPracticeAsk(null)} className="rounded-md px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800">Cancel</button>
              </div>
            </>
          ) : (
            <>
              <h2 className="text-sm font-semibold">End the practice run?</h2>
              <p className="text-sm text-gray-300">
                Deletes the {view.log.length === 1 ? 'practice pickup' : `${view.log.length} practice pickups`} and {view.passes.given === 1 ? 'coach pass' : `${view.passes.given} coach passes`} recorded
                in it, and puts every station back on the real pickups.
              </p>
              <div className="flex gap-2">
                <button onClick={() => void practice(false)} className="rounded-md bg-amber-300 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-amber-200">End and delete the test data</button>
                <button onClick={() => setPracticeAsk(null)} className="rounded-md px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800">Keep practicing</button>
              </div>
            </>
          )}
        </section>
      )}

      {setup && (
        <section className="mx-4 mt-4 space-y-3 rounded-xl bg-gray-900/70 p-4 ring-1 ring-gray-800 sm:mx-6">
          <h2 className="text-sm font-semibold">What a pickup needs at this station</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={station.askName} onChange={(e) => saveStation({ ...station, askName: e.target.checked })} />
            Require the name of who picked it up
          </label>
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 text-gray-400">Signature</legend>
            {([
              ['none', 'None'],
              ['here', 'Signed on this screen'],
              ['tablet', 'Signed on the sign-off tablet facing the coach'],
            ] as Array<[SignMode, string]>).map(([v, l]) => (
              <label key={v} className="flex items-center gap-2">
                <input type="radio" name="sign" checked={station.sign === v} onChange={() => saveStation({ ...station, sign: v })} /> {l}
              </label>
            ))}
          </fieldset>
          {station.sign === 'tablet' && (
            <p className="text-xs text-gray-400">
              Open <a className="text-blue-400 underline" href={`/declare/pickup/${token}/sign`} target="_blank" rel="noreferrer">the sign-off page</a> on
              the tablet facing the coach. Each packet handed over here waits there until it is signed.
            </p>
          )}
          <label className="block text-sm">
            <span className="text-gray-400">This station&apos;s name (shown in the log)</span>
            <input value={station.device} onChange={(e) => saveStation({ ...station, device: e.target.value.slice(0, 40) })}
              placeholder="Packet table 1" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2" />
          </label>
        </section>
      )}

      <dl className="grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4 sm:gap-3 sm:px-6">
        {[
          { k: 'Packets', v: view.packets, sub: `${view.schools.length} schools`, cls: 'text-gray-100' },
          { k: 'Picked up', v: view.pickedUp, sub: view.waiting.length ? `${view.waiting.length} waiting to sign` : 'handed over', cls: 'text-emerald-300' },
          { k: 'Still here', v: left, sub: left ? 'to hand over' : 'every packet is out', cls: left ? 'text-amber-300' : 'text-gray-500' },
          { k: 'Coach passes', v: view.passes.given, sub: view.passes.staff ? `of ${view.passes.staff} on staff lists` : 'handed out', cls: 'text-sky-300' },
        ].map((s) => (
          <div key={s.k} className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 sm:py-2.5">
            <dt className="text-[10px] uppercase tracking-wider text-gray-400 sm:text-[11px]">{s.k}</dt>
            <dd className={`mt-0.5 text-xl font-bold tabular-nums sm:text-2xl ${s.cls}`}>{s.v}</dd>
            <dd className="text-[11px] text-gray-500">{s.sub}</dd>
          </div>
        ))}
      </dl>

      <div className="px-4 py-4 sm:px-6">
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="pk-code" className="sr-only">Team label code</label>
          <input id="pk-code" ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)}
            autoComplete="off" spellCheck={false} placeholder="Scan a team label"
            className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-lg placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          <button type="submit" disabled={busy || !code.trim()}
            className="rounded-lg bg-blue-600 px-5 font-semibold hover:bg-blue-500 disabled:opacity-40">Look up</button>
        </form>
        {flash && (
          <div role="status" className={`mt-3 flex items-center gap-3 rounded-lg border px-4 py-2.5 text-sm ${FLASH[flash.status]}`}>
            {flashSchool && <SchoolBadge key={flashSchool.teamAccessId} name={flashSchool.name} badge={flashSchool.badge} size={44} />}
            <p className={flashSchool ? 'text-base font-medium' : ''}>{flash.message}</p>
          </div>
        )}
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
      </div>

      <main className="grid gap-4 px-4 sm:px-6 lg:grid-cols-[3fr_2fr]">
        <section className="rounded-xl bg-gray-900/60 ring-1 ring-gray-800">
          <div className="flex flex-wrap items-center gap-2 border-b border-gray-800 px-4 py-3">
            <h2 className="mr-auto text-sm font-semibold">Schools</h2>
            <label className="flex items-center gap-1.5 text-xs text-gray-400">
              <input type="checkbox" checked={onlyLeft} onChange={(e) => setOnlyLeft(e.target.checked)} /> Still to collect
            </label>
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a school"
              className="w-40 rounded-md border border-gray-700 bg-gray-900 px-2 py-1 text-sm" />
          </div>
          <ul className="divide-y divide-gray-800/70">
            {schools.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">{left ? 'No school matches.' : 'Every packet has been picked up.'}</li>}
            {schools.map((s) => (
              <li key={s.teamAccessId} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <button onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: remaining(s) })}
                  className="flex min-w-0 flex-1 items-center gap-2 text-left hover:text-white" title="Open this school's packets and coach passes">
                  <SchoolBadge name={s.name} badge={s.badge} />
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                </button>
                {(s.staff.length > 0 || s.checkins.length > 0) && (
                  <button onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: [] })}
                    title="Coach passes handed to this school's staff"
                    className="rounded-md bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 ring-1 ring-gray-700 hover:bg-gray-700">
                    Passes {s.checkins.length}{s.staff.length ? `/${s.staff.length}` : ''}
                  </button>
                )}
                {s.sides.map((x) => {
                  const p = x.pickup;
                  const cls = p?.status === 'picked_up' ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
                    : p?.status === 'waiting' ? 'bg-sky-500/15 text-sky-200 ring-sky-500/30'
                      : 'bg-gray-800 text-gray-200 ring-gray-700 hover:bg-gray-700';
                  return (
                    <button key={x.side} disabled={!!p}
                      onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: [x.side] })}
                      title={p ? `${p.status === 'waiting' ? 'Waiting to sign' : 'Picked up'}${p.by ? ` by ${p.by}` : ''} at ${clock(p.at)}` : `Hand over (${x.bibs || 'no bibs'})`}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${cls}`}>
                      {sideWord(x.side, terms)} · {x.athletes}{p?.status === 'picked_up' ? ' ✓' : p?.status === 'waiting' ? ' …' : ''}
                    </button>
                  );
                })}
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-xl bg-gray-900/60 ring-1 ring-gray-800">
          <h2 className="border-b border-gray-800 px-4 py-3 text-sm font-semibold">Pickups</h2>
          <ul className="divide-y divide-gray-800/70">
            {view.log.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">{view.practice ? 'No practice pickups yet.' : 'No packets picked up yet.'}</li>}
            {view.log.slice(0, 60).map((r) => (
              <li key={r.id} className={`flex items-start gap-3 px-4 py-2.5 ${r.undone ? 'opacity-40' : ''}`}>
                <SchoolBadge name={r.teamName} badge={schoolOf.get(r.teamAccessId)?.badge} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.teamName} · {sideWord(r.side, terms)}</div>
                  <div className="text-[11px] text-gray-400">
                    {r.undone ? 'Undone: ' : ''}{r.status === 'waiting' ? 'Waiting to sign' : r.undone ? 'picked up' : 'Picked up'}
                    {r.by ? ` by ${r.by}` : ''}{r.byRole ? ` (${r.byRole})` : ''}
                    {r.byRole === null && <span className="text-amber-300"> · not on the staff list</span>}
                    {' · '}{clock(r.at)}{r.via === 'manual' ? '' : ' · scanned'}{r.device ? ` · ${r.device}` : ''}
                    {r.signed && <> · <a className="text-blue-400 underline" href={`${api}?signature=${r.id}`} target="_blank" rel="noreferrer">signature</a></>}
                  </div>
                </div>
                {!r.undone && (
                  <button onClick={() => undo(r.id)} className="shrink-0 rounded-md px-2.5 py-1 text-xs text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800">Undo</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>

      <footer className="mt-6 border-t border-gray-800 px-4 py-3 text-xs text-gray-500 sm:px-6">
        <span className="mr-2">Scanner URL (marks a packet picked up straight away, no window):</span>
        <code className="break-all text-gray-300">{scannerUrl}<span className="text-gray-500">{'{label code}'}</span></code>
      </footer>

      {open && openSchool && (
        <PacketWindow key={openSchool.teamAccessId} school={openSchool} initialSides={open.sides} extraSides={open.sides}
          terms={terms} station={station} busy={busy} notice={notice}
          onCancel={closeWindow} onConfirm={(h) => void handOver(openSchool, h)} onTakeBack={(id) => void takeBack(id)} />
      )}
    </div>
  );
}

/** Role names said short: "Head Coach (Girls), Assistant Coach (Boys)". */
export function rolesText(m: StaffMember, terms: Terms): string {
  const side = (x: string) => (x === 'F' ? sideWord('F', terms) : x === 'M' ? sideWord('M', terms) : '');
  return m.roles.map((r) => (r.scope === 'all' ? r.role : `${r.role} (${side(r.scope)})`)).join(', ');
}

const isHead = (m: StaffMember, sides: Array<Side | 'A'>) =>
  m.roles.some((r) => /head/i.test(r.role) && (r.scope === 'all' || sides.includes(r.scope as Side) || sides.includes('A')));

/**
 * A school's packet window, opened by a scan or a tap: the packets to hand
 * over (the scanned label's ticked, the others there to tick), who took them
 * (the school's staff who cover those packets, head coaches first, or anyone
 * typed), and coach passes for its staff, with the person taking the packets
 * ticked for one. One confirm records it all.
 */
function PacketWindow({ school, initialSides, extraSides, terms, station, busy, notice, onCancel, onConfirm, onTakeBack }: {
  school: PickupSchool; initialSides: Side[]; extraSides: Side[]; terms: Terms; station: Station; busy: boolean; notice: string | null;
  onCancel: () => void; onConfirm: (h: HandOver) => void; onTakeBack: (id: string) => void;
}) {
  const [sides, setSides] = useState<Side[]>(initialSides);
  const [by, setBy] = useState('');
  const [passes, setPasses] = useState<string[]>([]);
  /** Passes the table unticked by hand: picking that person again does not tick it back. */
  const [untouched, setUntouched] = useState(true);
  const [walkUps, setWalkUps] = useState<string[]>([]);
  const [walkUp, setWalkUp] = useState('');
  const [signed, setSigned] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  // Another label of the same school scanned while open adds its packet.
  useEffect(() => { setSides((s) => [...new Set([...s, ...extraSides])]); }, [extraSides]);

  const toHand = school.sides.filter((x) => !x.pickup);
  const passOf = (m: StaffMember) => school.checkins.find((c) => c.staffId === m.id || (!c.staffId && sameName(c.name, m.name)));
  const looking: Array<Side | 'A'> = sides.length ? sides : ['A'];
  const staff = [...school.staff].sort((a, b) =>
    Number(isHead(b, looking)) - Number(isHead(a, looking))
    || Number(looking.some((s) => covers(b, s))) - Number(looking.some((s) => covers(a, s))));
  /** Covers the packets ticked: offered first, the rest of the staff after. */
  const coversTicked = (m: StaffMember) => looking.some((s) => covers(m, s));
  const onFile = staff.length + school.coaches.filter((c) => !school.staff.some((m) => sameName(m.name, c))).length;
  const others = school.coaches.filter((c) => !school.staff.some((m) => sameName(m.name, c)));
  const extra = school.checkins.filter((c) => !school.staff.some((m) => c.staffId === m.id || sameName(c.name, m.name)));
  const typed = by.trim();
  const offList = school.staff.length > 0 && typed.length > 2 && !school.staff.some((m) => sameName(m.name, typed));

  const pick = (name: string) => {
    setBy(name);
    const m = school.staff.find((x) => sameName(x.name, name));
    // Whoever takes the packets usually takes a pass with them.
    if (m && untouched && !passOf(m)) setPasses((p) => (p.includes(m.id) ? p : [...p, m.id]));
  };
  const togglePass = (id: string) => { setUntouched(false); setPasses((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const toggleSide = (s: Side) => setSides((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  const passCount = passes.length + walkUps.length;
  const needName = station.askName && sides.length > 0 && !typed;
  const needSig = station.sign === 'here' && sides.length > 0 && !signed;
  const nothing = sides.length === 0 && passCount === 0;
  const verb = sides.length === 0 ? '' : station.sign === 'tablet' ? 'Send to sign-off tablet' : 'Hand over';
  const label = [verb, passCount ? `${verb ? '+ ' : 'Give '}${plural(passCount, 'pass', 'passes')}` : ''].filter(Boolean).join(' ');

  const confirm = () => onConfirm({
    sides, by: typed,
    signature: station.sign === 'here' && sides.length ? pad.current?.value() ?? null : null,
    passes: [...passes.map((staffId) => ({ staffId })), ...walkUps.map((name) => ({ name }))],
  });

  const section = 'space-y-2';
  const heading = 'text-xs font-semibold uppercase tracking-wider text-gray-400';

  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-0 sm:items-center sm:p-4" role="dialog" aria-modal="true" aria-label={school.name}>
      <div className="flex max-h-[100dvh] w-full max-w-2xl flex-col rounded-t-2xl bg-gray-900 ring-1 ring-gray-700 sm:max-h-[92vh] sm:rounded-2xl">
        <div className="flex items-center gap-4 border-b border-gray-800 px-5 py-4">
          <SchoolBadge name={school.name} badge={school.badge} size={56} />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-xl font-bold">{school.name}</h2>
            <p className="text-sm text-gray-400">
              {toHand.length ? `${plural(toHand.length, 'packet', 'packets')} to hand over` : 'Every packet is out'}
              {school.staff.length ? ` · ${school.checkins.length} of ${school.staff.length} staff have a pass` : ''}
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="rounded-md px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-800">×</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {notice && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{notice}</p>}

          <section className={section}>
            <h3 className={heading}>Packets</h3>
            <div className="grid gap-2 sm:grid-cols-2">
              {school.sides.map((x) => {
                const p = x.pickup;
                const on = sides.includes(x.side);
                return (
                  <button key={x.side} type="button" disabled={!!p} onClick={() => toggleSide(x.side)}
                    className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left ring-1 ${p ? 'bg-gray-950/40 text-gray-500 ring-gray-800'
                      : on ? 'bg-emerald-600/20 ring-emerald-500/60' : 'bg-gray-800/60 ring-gray-700 hover:bg-gray-800'}`}>
                    <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${p || on ? 'border-emerald-400 bg-emerald-500/30 text-emerald-100' : 'border-gray-500'}`}>
                      {p || on ? '✓' : ''}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="block font-medium">{sideWord(x.side, terms)} · {plural(x.athletes, 'runner', 'runners')}</span>
                      <span className="block truncate text-xs text-gray-400">
                        {p ? `${p.status === 'waiting' ? 'Waiting to sign' : 'Picked up'}${p.by ? ` by ${p.by}` : ''} at ${clock(p.at)}` : `Bibs ${x.bibs || '-'}`}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          </section>

          {sides.length > 0 && (
            <section className={section}>
              <h3 className={heading}>Picked up by{station.askName ? '' : ' (optional)'}</h3>
              {onFile > 0 ? (
                // Every coach on file, one tap each: those who cover the ticked
                // packets first (head coaches leading), then the rest of the
                // staff, then coaches who signed up for texts.
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {staff.map((m) => {
                    const on = sameName(m.name, by);
                    return (
                      <button key={m.id} type="button" onClick={() => pick(m.name)}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ${on ? 'bg-emerald-600/25 ring-emerald-500/60'
                          : coversTicked(m) ? 'bg-gray-800 ring-gray-700 hover:bg-gray-700' : 'bg-gray-900 ring-gray-800 hover:bg-gray-800'}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${on ? 'border-emerald-400 bg-emerald-500/40 text-white' : 'border-gray-500'}`}>{on ? '✓' : ''}</span>
                        <span className="min-w-0 flex-1">
                          <span className={`block truncate text-sm ${coversTicked(m) ? '' : 'text-gray-300'}`}>{m.name}</span>
                          <span className="block truncate text-[11px] text-gray-400">{rolesText(m, terms) || 'Staff'}{m.approved ? '' : ' · not approved'}</span>
                        </span>
                      </button>
                    );
                  })}
                  {others.map((c) => {
                    const on = sameName(c, by);
                    return (
                      <button key={c} type="button" onClick={() => pick(c)}
                        className={`flex items-center gap-3 rounded-lg px-3 py-2 text-left ring-1 ${on ? 'bg-emerald-600/25 ring-emerald-500/60' : 'bg-gray-800 ring-gray-700 hover:bg-gray-700'}`}>
                        <span className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-xs ${on ? 'border-emerald-400 bg-emerald-500/40 text-white' : 'border-gray-500'}`}>{on ? '✓' : ''}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm">{c}</span>
                          <span className="block text-[11px] text-gray-400">Signed up for texts</span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : (
                <p className="text-sm text-gray-400">No coaches on file for {school.name}. Type who took it.</p>
              )}
              <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={onFile ? 'Someone else: name' : 'Name'}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-base" />
              {offList && <p className="text-xs text-amber-300">Not on {school.name}&apos;s staff list. They can still take it; the log will say so.</p>}
            </section>
          )}

          {(school.staff.length > 0 || school.checkins.length > 0) && (
            <section className={section}>
              <h3 className={heading}>Coach passes</h3>
              <ul className="divide-y divide-gray-800 rounded-lg ring-1 ring-gray-800">
                {staff.map((m) => {
                  const given = passOf(m);
                  const on = passes.includes(m.id);
                  return (
                    <li key={m.id} className="flex items-center gap-3 px-3 py-2">
                      {given ? (
                        <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-sky-400 bg-sky-500/30 text-xs text-sky-100">✓</span>
                      ) : (
                        <input type="checkbox" checked={on} onChange={() => togglePass(m.id)} aria-label={`Coach pass for ${m.name}`} className="h-5 w-5 shrink-0 accent-sky-500" />
                      )}
                      <button type="button" disabled={!!given} onClick={() => togglePass(m.id)} className="min-w-0 flex-1 text-left">
                        <span className="block truncate text-sm">{m.name}{!m.approved && <span className="ml-1.5 text-[11px] text-amber-300">not approved</span>}</span>
                        <span className="block truncate text-[11px] text-gray-500">{rolesText(m, terms) || 'Staff'}</span>
                      </button>
                      {given && (
                        <>
                          <span className="text-xs text-sky-300">Pass given {clock(given.at)}</span>
                          <button type="button" onClick={() => onTakeBack(given.id)} className="rounded px-1.5 text-[11px] text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800">Undo</button>
                        </>
                      )}
                    </li>
                  );
                })}
                {extra.map((c) => (
                  <li key={c.id} className="flex items-center gap-3 px-3 py-2">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded border border-sky-400 bg-sky-500/30 text-xs text-sky-100">✓</span>
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{c.name}</span><span className="text-[11px] text-amber-300">not on the staff list</span></span>
                    <span className="text-xs text-sky-300">Pass given {clock(c.at)}</span>
                    <button type="button" onClick={() => onTakeBack(c.id)} className="rounded px-1.5 text-[11px] text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800">Undo</button>
                  </li>
                ))}
                {walkUps.map((n) => (
                  <li key={n} className="flex items-center gap-3 px-3 py-2">
                    <input type="checkbox" checked onChange={() => setWalkUps((w) => w.filter((x) => x !== n))} className="h-5 w-5 shrink-0 accent-sky-500" />
                    <span className="min-w-0 flex-1"><span className="block truncate text-sm">{n}</span><span className="text-[11px] text-amber-300">not on the staff list</span></span>
                  </li>
                ))}
              </ul>
              <form className="flex gap-2" onSubmit={(e) => {
                e.preventDefault();
                const n = walkUp.trim();
                if (n && !walkUps.some((x) => sameName(x, n))) setWalkUps((w) => [...w, n]);
                setWalkUp('');
              }}>
                <input value={walkUp} onChange={(e) => setWalkUp(e.target.value)} placeholder="A pass for someone not listed: name"
                  className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-950 px-3 py-1.5 text-sm" />
                <button type="submit" disabled={!walkUp.trim()} className="rounded-lg px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800 disabled:opacity-40">Add</button>
              </form>
            </section>
          )}

          {station.sign === 'here' && sides.length > 0 && (
            <section className={section}>
              <h3 className={heading}>Signature</h3>
              <SignaturePad ref={pad} onChange={setSigned} />
            </section>
          )}
          {station.sign === 'tablet' && sides.length > 0 && (
            <p className="text-sm text-sky-200">The packets wait on the sign-off tablet until the coach signs there.</p>
          )}
        </div>

        <div className="flex gap-2 border-t border-gray-800 px-5 py-4">
          <button onClick={onCancel} className="h-12 flex-1 rounded-xl text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800">Cancel</button>
          <button onClick={confirm} disabled={busy || nothing || needName || needSig}
            className="h-12 flex-[2] rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
            {busy ? 'Saving…' : nothing ? 'Tick a packet or a pass' : needName ? 'Who picked it up?' : needSig ? 'Sign above' : label}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * Who may take this packet, one tap each: the school's staff who cover its
 * side (head coaches first), then the coaches who signed up for texts and are
 * not on the list. A name typed that is on neither is taken, and marked in
 * the log as not on the staff list. (The sign-off tablet's picker.)
 */
export function StaffPicks({ school, side, terms, who, onPick }: {
  school: { name: string; staff: StaffMember[]; coaches: string[] };
  side: Side | 'A'; terms: Terms; who: string; onPick: (name: string) => void;
}) {
  const head = (m: StaffMember) => (isHead(m, [side]) ? 0 : 1);
  const staff = school.staff.filter((m) => covers(m, side)).sort((a, b) => head(a) - head(b));
  const others = school.coaches.filter((c) => !school.staff.some((m) => sameName(m.name, c)));
  const typed = who.trim();
  const offList = school.staff.length > 0 && typed.length > 2 && !school.staff.some((m) => sameName(m.name, typed));
  if (!staff.length && !others.length) return null;
  return (
    <div className="mt-2 space-y-2">
      {staff.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {staff.map((m) => (
            <button key={m.id} type="button" onClick={() => onPick(m.name)}
              className={`rounded-md px-2.5 py-1 text-left text-sm ring-1 hover:bg-gray-700 ${sameName(m.name, who) ? 'bg-emerald-600/25 ring-emerald-500/50' : 'bg-gray-800 ring-gray-700'}`}>
              <span className="block">{m.name}</span>
              <span className="block text-[11px] text-gray-400">{rolesText(m, terms) || 'Staff'}{m.approved ? '' : ' · not approved'}</span>
            </button>
          ))}
        </div>
      )}
      {others.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {others.map((c) => (
            <button key={c} type="button" onClick={() => onPick(c)} className="rounded-md bg-gray-800 px-2.5 py-1 text-sm ring-1 ring-gray-700 hover:bg-gray-700">{c}</button>
          ))}
        </div>
      )}
      {offList && <p className="text-xs text-amber-300">Not on {school.name}&apos;s staff list. They can still take it; the log will say so.</p>}
    </div>
  );
}
