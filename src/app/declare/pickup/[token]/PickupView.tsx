'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ItemLine, ItemPer, ItemSide, PickupItem, PickupResult, PickupSchool, PickupView as View, Side } from '@/lib/declare-pickup';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';
import SchoolBadge from './SchoolBadge';
import { covers, sameName, type StaffMember } from '@/lib/declare-staff';

/**
 * The packet table.
 *
 * The box at the top takes a team label's code: a USB or Bluetooth scanner
 * types it and presses Enter, an Android scanner in keyboard mode does the
 * same, and the Nexus XC Tablet app's Scan button hands its camera's read
 * over as a 'nexus-scan' event. A scan looks the school up and opens its
 * packet window: which packets go out, who took them, and which of the
 * school's staff get a coach pass, all confirmed at once. Tapping a school
 * in the list opens the same window. Each station chooses (kept on this
 * device) whether the name is required and where the signature is taken:
 * nowhere, on this screen, or on the sign-off tablet facing the coach.
 *
 * Pickup items (hats, water bottles) are set for the meet on the desk and
 * sent with the portal, so many per team, per runner or per school. Each station chooses what it
 * hands out - everything at one grouped table, or one item at a station of
 * its own - and the same label opens the school's window at each. Whoever
 * took something at an earlier station is offered first by name at the next.
 *
 * Practice run tries all of that on the real meet: everything recorded
 * meanwhile is test data, and ending the run deletes it.
 */

const POLL_MS = 3000;
const STATION_KEY = 'nexus-pickup-station';

type SignMode = 'none' | 'here' | 'tablet';
interface Station {
  askName: boolean;
  sign: SignMode;
  device: string;
  /**
   * What this station hands out: 'packets', 'passes' and 'i:<item id>' for
   * each pickup item. Null is everything, items added later included.
   */
  hands: string[] | null;
}
const DEFAULT_STATION: Station = { askName: false, sign: 'none', device: '', hands: null };

/** Whether a station hands this out. */
const handsOut = (station: Station, key: string) => !station.hands || station.hands.includes(key);
const itemKey = (id: string) => `i:${id}`;
const lineKey = (l: { itemId: string; side: ItemSide }) => `${l.itemId}|${l.side}`;

type Terms = 'men_women' | 'boys_girls';

/**
 * A school's packet window: the school, the packets ticked when it opened,
 * and the labels read (a side, or 'A' for all) that tick its item lines.
 */
interface Open { teamAccessId: string; sides: Side[]; labels: Array<Side | 'A'> }

/** What the window hands over when confirmed. */
interface HandOver {
  sides: Side[];
  by: string;
  signature: string | null;
  /** Coach passes: someone on the staff list by id, or a walk-up by name. */
  passes: Array<{ staffId?: string; name?: string }>;
  /** Pickup items: how many of each item for each side (or the school). */
  items: Array<{ itemId: string; side: ItemSide; count: number }>;
}

const LABEL_CODE = /^NXPKT-([0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12})-([FMA])$/i;

const FLASH: Record<PickupResult['status'], string> = {
  picked_up: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  waiting: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  already: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  unknown: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
};

/**
 * Whether the label box can take focus by itself. A desk with a USB or
 * Bluetooth scanner needs it there, since the scanner types into whatever has
 * focus. On a touch screen focus brings up the keyboard, which covered the
 * page after every hand-over on a phone (2026-11-08): there the box is focused
 * only when tapped, and the tablet app's Scan button needs no focus at all.
 */
function quietFocus(): boolean {
  return typeof window !== 'undefined' && !window.matchMedia('(pointer: coarse)').matches;
}

function loadStation(): Station {
  try { return { ...DEFAULT_STATION, ...JSON.parse(localStorage.getItem(STATION_KEY) ?? '{}') }; } catch { return DEFAULT_STATION; }
}

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function sideWord(side: ItemSide | 'A', terms: Terms): string {
  if (side === 'A') return 'All packets';
  if (side === 'S') return 'School';
  if (side === 'X') return 'Packet';
  return side === 'F' ? (terms === 'men_women' ? 'Women' : 'Girls') : (terms === 'men_women' ? 'Men' : 'Boys');
}

/** The packets still to hand over. */
const remaining = (s: PickupSchool): Side[] => s.sides.filter((x) => !x.pickup).map((x) => x.side);

/** An item's lines a label ticks: its side's, the school's, or with 'A' every one. */
const labelTicks = (l: ItemLine, labels: Array<Side | 'A'>) => labels.includes('A') || l.side === 'S' || labels.includes(l.side as Side);

const PER_WORD: Record<ItemPer, string> = { team: 'per team', runner: 'per runner', school: 'per school' };

/**
 * Who took something for this school at an earlier station, newest first:
 * the names the next station offers before anyone else, with what they took.
 */
export function earlierNames(school: PickupSchool, items: PickupItem[]): Array<{ name: string; what: string; at: string }> {
  const seen: Array<{ name: string; what: string; at: string }> = [];
  for (const x of school.sides) if (x.pickup?.by) seen.push({ name: x.pickup.by, what: 'Packets', at: x.pickup.at });
  for (const l of school.items) {
    const name = items.find((i) => i.id === l.itemId)?.name ?? 'Item';
    for (const h of l.handOvers) if (h.by) seen.push({ name: h.by, what: name, at: h.at });
  }
  for (const c of school.checkins) seen.push({ name: c.name, what: c.item, at: c.at });
  seen.sort((a, b) => b.at.localeCompare(a.at));
  const out: Array<{ name: string; what: string; at: string }> = [];
  for (const n of seen) {
    const had = out.find((o) => sameName(o.name, n.name));
    if (!had) out.push({ ...n });
    else if (!had.what.split(', ').includes(n.what)) had.what += `, ${n.what}`;
  }
  return out.slice(0, 8);
}

/** Anything still to hand over at this station. */
function leftHere(s: PickupSchool, station: Station): boolean {
  if (handsOut(station, 'packets') && s.sides.some((x) => x.pickup?.status !== 'picked_up')) return true;
  return s.items.some((l) => handsOut(station, itemKey(l.itemId)) && l.given < l.due);
}

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

  useEffect(() => {
    setStation(loadStation());
    setOrigin(window.location.origin);
    if (quietFocus()) input.current?.focus();
  }, []);
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
    if (quietFocus()) setTimeout(() => input.current?.focus(), 0);
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
    const sides = !handsOut(station, 'packets') ? []
      : label === 'A' ? remaining(school) : remaining(school).filter((x) => x === label);
    if (open) {
      if (open.teamAccessId === school.teamAccessId) {
        // The same school's other label: tick its packet and items too.
        setOpen({ ...open, sides: [...new Set([...open.sides, ...sides])], labels: [...new Set([...open.labels, label])] });
      } else {
        setNotice(`That was ${school.name}'s label. Finish this school first, or cancel and scan it again.`);
      }
      return;
    }
    setFlash(null);
    setNotice(null);
    setOpen({ teamAccessId: school.teamAccessId, sides, labels: [label] });
  }, [view.schools, open, station]);

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
      if (h.items.length) {
        const res = await post({ action: 'items', teamAccessId: school.teamAccessId, lines: h.items, by: h.by || undefined, device });
        held ||= !!res.held;
        if (res.status === 'already' && typeof res.message === 'string') first ??= res.message;
        else {
          const counts = new Map<string, number>();
          for (const l of h.items) counts.set(l.itemId, (counts.get(l.itemId) ?? 0) + l.count);
          const what = [...counts].map(([id, n]) => `${n} ${(view.items.find((i) => i.id === id)?.name ?? 'items').toLowerCase()}`);
          said.push(`${what.join(', ')}${!h.sides.length && h.by ? ` to ${h.by}` : ''}`);
        }
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

  const undo = async (id: string, item = false) => {
    try { await post({ action: item ? 'undoitem' : 'undo', id }); await refresh(); } catch { setError('That change was not saved - try again'); }
  };

  const practice = async (on: boolean) => {
    setPracticeAsk(null);
    try {
      const res = await post({ action: 'practice', on }) as unknown as { removed: { pickups: number; passes: number; items?: number } };
      setFlash(on
        ? { status: 'waiting', message: 'Practice run started. Scan, sign and hand out passes and items as on the day: none of it counts.' }
        : { status: 'picked_up', message: `Practice run ended. Removed ${plural(res.removed.pickups, 'practice pickup', 'practice pickups')}, ${plural(res.removed.items ?? 0, 'item hand-over', 'item hand-overs')} and ${plural(res.removed.passes, 'coach pass', 'coach passes')}.` });
      await refresh();
    } catch { setError('That change was not saved - try again'); }
  };

  const schools = useMemo(() => {
    const words = query.toLowerCase().split(/\s+/).filter(Boolean);
    return view.schools.filter((s) => {
      if (words.length && !words.every((w) => s.name.toLowerCase().includes(w))) return false;
      if (onlyLeft && !words.length) return leftHere(s, station);
      return true;
    });
  }, [view.schools, query, onlyLeft, station]);

  const left = view.packets - view.pickedUp;
  const schoolOf = useMemo(() => new Map(view.schools.map((s) => [s.teamAccessId, s])), [view.schools]);
  const flashSchool = flash?.teamAccessId ? schoolOf.get(flash.teamAccessId) : undefined;
  const openSchool = open ? schoolOf.get(open.teamAccessId) : undefined;
  const scannerUrl = origin ? `${origin}${api}?code=` : '';
  const hereItems = view.items.filter((i) => handsOut(station, itemKey(i.id)));
  const anyLeft = view.schools.some((s) => leftHere(s, station));
  /** What this station hands out, said in the header: "Hats", "Packets, Hats". */
  const handsWord = station.hands
    ? [handsOut(station, 'packets') ? 'Packets' : '', ...hereItems.map((i) => i.name), handsOut(station, 'passes') ? 'Coach passes' : ''].filter(Boolean).join(', ')
    : '';

  const statusPill = (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${error ? 'bg-amber-500/15 text-amber-300' : view.practice ? 'bg-amber-400/20 text-amber-200' : 'bg-[#e70518]/15 text-red-300'}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-amber-400' : view.practice ? 'bg-amber-300' : 'bg-red-500'}`} />
      {error ? 'Reconnecting' : view.practice ? 'Practice' : 'Live'}
    </span>
  );

  return (
    <div className="min-h-screen bg-[#0a0f24] pb-16 text-gray-100">
      <header className="border-b border-white/10 bg-[#0c1537]">
        <div className="flex flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3 sm:px-6 sm:py-4">
          {/* eslint-disable-next-line @next/next/no-img-element -- a static brand image, as on the dashboard */}
          <img src="/live/primetime-on-dark.png" alt="PrimeTime Timing" className="h-5 w-auto sm:h-7" />
          <div className="order-last w-full min-w-0 lg:order-none lg:w-auto lg:flex-1">
            <h1 className="text-lg font-bold tracking-tight sm:text-xl lg:truncate">{view.meet.name}</h1>
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-400">
              <span>Packet pickup{station.device ? ` · ${station.device}` : ''}{handsWord ? ` · ${handsWord}` : ''}</span>
              {/* Here on phones and tablets: in the top row it wrapped onto a line of its own. */}
              <span className="lg:hidden">{statusPill}</span>
            </p>
          </div>
          {/* Practice run is started from This station: as a second header button it wrapped onto a line of its own on a phone. */}
          <button onClick={() => setSetup((v) => !v)} className="ml-auto rounded-md px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800 lg:ml-0">
            This station
          </button>
          <span className="hidden lg:inline">{statusPill}</span>
        </div>
      </header>

      {view.practice && (
        <div role="status" className="flex flex-col items-start gap-2 border-b border-amber-400/30 bg-amber-400/15 px-4 py-2.5 text-sm text-amber-100 sm:flex-row sm:items-center sm:gap-4 sm:px-6">
          <p className="min-w-0 flex-1">
            <span className="font-semibold text-amber-200">Practice run since {clock(view.practice.since)}.</span>{' '}
            Nothing recorded now counts: pickups, signatures and coach passes are test data, kept apart from the real ones and deleted when the run ends.
          </p>
          <button onClick={() => setPracticeAsk('end')} className="shrink-0 rounded-md bg-amber-300 px-3 py-1.5 text-sm font-semibold text-gray-950 hover:bg-amber-200">
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
                in it, items included, and puts every station back on the real pickups.
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
          <fieldset className="space-y-1 text-sm">
            <legend className="mb-1 text-sm font-semibold">What this station hands out</legend>
            <p className="mb-1 text-xs text-gray-400">
              Everything makes one grouped table. Split it up with a station per item: each scans the same label and opens only its own.
            </p>
            {[
              { key: 'packets', label: 'Packets' },
              ...view.items.map((i) => ({ key: itemKey(i.id), label: `${i.name} (${i.count} ${PER_WORD[i.per]})` })),
              { key: 'passes', label: 'Coach passes' },
            ].map((o, _, all) => (
              <label key={o.key} className="flex items-center gap-2">
                <input type="checkbox" checked={handsOut(station, o.key)} onChange={(e) => {
                  const now = new Set(station.hands ?? all.map((x) => x.key));
                  if (e.target.checked) now.add(o.key); else now.delete(o.key);
                  // Every box ticked is everything, so an item added later comes here too.
                  saveStation({ ...station, hands: all.every((x) => now.has(x.key)) ? null : [...now] });
                }} />
                {o.label}
              </label>
            ))}
            <p className="pt-1 text-xs text-gray-500">
              {view.items.length ? 'The items' : 'Pickup items (hats, water bottles, a banner)'} are set on the desk: Coach portal, Pickup items.
            </p>
          </fieldset>
          <h2 className="pt-2 text-sm font-semibold">What a pickup needs at this station</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={station.askName} onChange={(e) => saveStation({ ...station, askName: e.target.checked })} />
            Require the name of who picked it up
          </label>
          <p className="-mt-2 pl-6 text-xs text-gray-500">Names taken at earlier stations are offered first, one tap each.</p>
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
          {!view.practice && (
            <div className="space-y-2 border-t border-gray-800 pt-3">
              <h2 className="text-sm font-semibold">Practice run</h2>
              <p className="text-xs text-gray-400">Try the whole pickup on this meet with test data: every station switches over, and nothing recorded counts.</p>
              <button onClick={() => { setSetup(false); setPracticeAsk('start'); }} className="rounded-md px-3 py-1.5 text-sm text-amber-200 ring-1 ring-amber-400/40 hover:bg-amber-400/10">
                Start a practice run
              </button>
            </div>
          )}
        </section>
      )}

      <dl className="grid grid-cols-2 gap-2 px-4 pt-4 sm:grid-cols-4 sm:gap-3 sm:px-6">
        {[
          ...(handsOut(station, 'packets') ? [
            { k: 'Packets', v: view.packets, sub: `${view.schools.length} schools`, cls: 'text-gray-100' },
            { k: 'Picked up', v: view.pickedUp, sub: view.waiting.length ? `${view.waiting.length} waiting to sign` : 'handed over', cls: 'text-emerald-300' },
            { k: 'Still here', v: left, sub: left ? 'to hand over' : 'every packet is out', cls: left ? 'text-amber-300' : 'text-gray-500' },
          ] : []),
          ...hereItems.map((i) => ({
            k: i.name, v: `${i.given}/${i.due}`, sub: `${i.schoolsDone} of ${i.schools} schools have theirs`,
            cls: i.due && i.given >= i.due ? 'text-emerald-300' : 'text-violet-200',
          })),
          ...(handsOut(station, 'passes') ? [
            { k: 'Coach passes', v: view.passes.given, sub: view.passes.staff ? `of ${view.passes.staff} on staff lists` : 'handed out', cls: 'text-sky-300' },
          ] : []),
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
          <input id="pk-code" ref={input} value={code} onChange={(e) => setCode(e.target.value)}
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
            {schools.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">{anyLeft ? 'No school matches.' : 'Everything this station hands out has been picked up.'}</li>}
            {schools.map((s) => (
              <li key={s.teamAccessId} className="flex flex-wrap items-center gap-2 px-4 py-2.5">
                <button onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: handsOut(station, 'packets') ? remaining(s) : [], labels: ['A'] })}
                  className="flex min-w-0 flex-1 basis-full items-center gap-2 text-left hover:text-white sm:basis-auto" title="Open this school's packets, items and coach passes">
                  <SchoolBadge name={s.name} badge={s.badge} />
                  <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                </button>
                {handsOut(station, 'passes') && (s.staff.length > 0 || s.checkins.length > 0) && (
                  <button onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: [], labels: [] })}
                    title="Coach passes handed to this school's staff"
                    className="rounded-md bg-gray-800 px-2.5 py-1 text-xs font-medium text-gray-300 ring-1 ring-gray-700 hover:bg-gray-700">
                    Passes {s.checkins.length}{s.staff.length ? `/${s.staff.length}` : ''}
                  </button>
                )}
                {hereItems.map((i) => {
                  const lines = s.items.filter((l) => l.itemId === i.id);
                  if (!lines.length) return null;
                  const due = lines.reduce((n, l) => n + l.due, 0);
                  const given = lines.reduce((n, l) => n + l.given, 0);
                  const done = lines.every((l) => l.given >= l.due);
                  return (
                    <button key={i.id} onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: [], labels: ['A'] })}
                      title={done ? `${i.name}: all ${due} handed over` : `${i.name}: ${given} of ${due} handed over`}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium ring-1 ${done ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
                        : given ? 'bg-violet-500/15 text-violet-200 ring-violet-500/30' : 'bg-gray-800 text-gray-200 ring-gray-700 hover:bg-gray-700'}`}>
                      {i.name} · {given}/{due}{done ? ' ✓' : ''}
                    </button>
                  );
                })}
                {handsOut(station, 'packets') && s.sides.map((x) => {
                  const p = x.pickup;
                  const cls = p?.status === 'picked_up' ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
                    : p?.status === 'waiting' ? 'bg-sky-500/15 text-sky-200 ring-sky-500/30'
                      : 'bg-gray-800 text-gray-200 ring-gray-700 hover:bg-gray-700';
                  return (
                    <button key={x.side} disabled={!!p}
                      onClick={() => setOpen({ teamAccessId: s.teamAccessId, sides: [x.side], labels: [x.side] })}
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
            {view.log.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">{view.practice ? 'No practice pickups yet.' : 'Nothing picked up yet.'}</li>}
            {view.log.slice(0, 60).map((r) => (
              <li key={r.id} className={`flex items-start gap-3 px-4 py-2.5 ${r.undone ? 'opacity-40' : ''}`}>
                <SchoolBadge name={r.teamName} badge={schoolOf.get(r.teamAccessId)?.badge} size={24} />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">
                    {r.teamName} · {r.item ? `${r.item.count} ${r.item.name}${r.side === 'S' || r.side === 'X' ? '' : ` · ${sideWord(r.side, terms)}`}` : sideWord(r.side, terms)}
                  </div>
                  <div className="text-[11px] text-gray-400">
                    {r.undone ? 'Undone: ' : ''}{r.status === 'waiting' ? 'Waiting to sign' : r.undone ? 'picked up' : 'Picked up'}
                    {r.by ? ` by ${r.by}` : ''}{r.byRole ? ` (${r.byRole})` : ''}
                    {r.byRole === null && <span className="text-amber-300"> · not on the staff list</span>}
                    {' · '}{clock(r.at)}{r.via === 'manual' ? '' : ' · scanned'}{r.device ? ` · ${r.device}` : ''}
                    {r.signed && <> · <a className="text-blue-400 underline" href={`${api}?signature=${r.id}`} target="_blank" rel="noreferrer">signature</a></>}
                  </div>
                </div>
                {!r.undone && (
                  <button onClick={() => undo(r.id, !!r.item)} className="shrink-0 rounded-md px-2.5 py-1 text-xs text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800">Undo</button>
                )}
              </li>
            ))}
          </ul>
        </section>
      </main>

      {handsOut(station, 'packets') && <footer className="mt-6 border-t border-gray-800 px-4 py-3 text-xs text-gray-500 sm:px-6">
        <span className="mr-2">Scanner URL (marks a packet picked up straight away, no window):</span>
        <code className="break-all text-gray-300">{scannerUrl}<span className="text-gray-500">{'{label code}'}</span></code>
      </footer>}

      {open && openSchool && (
        <PacketWindow key={openSchool.teamAccessId} school={openSchool} initialSides={open.sides} extraSides={open.sides} labels={open.labels}
          items={view.items} terms={terms} station={station} busy={busy} notice={notice}
          onCancel={closeWindow} onConfirm={(h) => void handOver(openSchool, h)} onTakeBack={(id) => void takeBack(id)}
          onUndoItem={(id) => void undo(id, true)} />
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
 * A school's packet window, opened by a scan or a tap: what this station
 * hands out - the packets (the scanned label's ticked, the others there to
 * tick) and each pickup item still due, counted - who took them (whoever took
 * something at an earlier station first, then the school's staff who cover
 * those packets, head coaches first, or anyone typed), and coach passes for
 * its staff, with the person taking the packets ticked for one. One confirm
 * records it all.
 */
function PacketWindow({ school, initialSides, extraSides, labels, items, terms, station, busy, notice, onCancel, onConfirm, onTakeBack, onUndoItem }: {
  school: PickupSchool; initialSides: Side[]; extraSides: Side[]; labels: Array<Side | 'A'>; items: PickupItem[];
  terms: Terms; station: Station; busy: boolean; notice: string | null;
  onCancel: () => void; onConfirm: (h: HandOver) => void; onTakeBack: (id: string) => void; onUndoItem: (id: string) => void;
}) {
  const [sides, setSides] = useState<Side[]>(initialSides);
  /** The item lines this station hands out, in the meet's order. */
  const lines = school.items.filter((l) => handsOut(station, itemKey(l.itemId)));
  const ticksFor = (ls: Array<Side | 'A'>) => Object.fromEntries(
    lines.filter((l) => l.given < l.due && labelTicks(l, ls)).map((l) => [lineKey(l), l.due - l.given] as const));
  /** How many of each item line go out now; a line not here is not ticked. */
  const [give, setGive] = useState<Record<string, number>>(() => ticksFor(labels));
  const [by, setBy] = useState('');
  const [passes, setPasses] = useState<string[]>([]);
  /** Passes the table unticked by hand: picking that person again does not tick it back. */
  const [untouched, setUntouched] = useState(true);
  const [walkUps, setWalkUps] = useState<string[]>([]);
  const [walkUp, setWalkUp] = useState('');
  const [signed, setSigned] = useState(false);
  const pad = useRef<SignaturePadHandle>(null);

  // Another label of the same school scanned while open adds its packet and items.
  useEffect(() => { setSides((s) => [...new Set([...s, ...extraSides])]); }, [extraSides]);
  const labelsKey = labels.join(',');
  useEffect(() => { setGive((g) => ({ ...ticksFor(labels), ...g })); }, [labelsKey]);

  const showPackets = handsOut(station, 'packets');
  const showPasses = handsOut(station, 'passes');
  const ticked = lines.filter((l) => (give[lineKey(l)] ?? 0) > 0);
  const handing = sides.length > 0 || ticked.length > 0;
  const earlier = earlierNames(school, items);
  const itemsLeft = lines.filter((l) => l.given < l.due).length;

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
    if (m && showPasses && untouched && !passOf(m)) setPasses((p) => (p.includes(m.id) ? p : [...p, m.id]));
  };
  const togglePass = (id: string) => { setUntouched(false); setPasses((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id])); };
  const toggleSide = (s: Side) => setSides((x) => (x.includes(s) ? x.filter((y) => y !== s) : [...x, s]));

  const passCount = passes.length + walkUps.length;
  const needName = station.askName && handing && !typed;
  const needSig = station.sign === 'here' && sides.length > 0 && !signed;
  const nothing = !handing && passCount === 0;
  const verb = !handing ? '' : sides.length && station.sign === 'tablet' ? 'Send to sign-off tablet' : 'Hand over';
  const label = [verb, passCount ? `${verb ? '+ ' : 'Give '}${plural(passCount, 'pass', 'passes')}` : ''].filter(Boolean).join(' ');

  const confirm = () => onConfirm({
    sides, by: typed,
    signature: station.sign === 'here' && sides.length ? pad.current?.value() ?? null : null,
    passes: [...passes.map((staffId) => ({ staffId })), ...walkUps.map((name) => ({ name }))],
    items: ticked.map((l) => ({ itemId: l.itemId, side: l.side, count: give[lineKey(l)] })),
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
              {[
                showPackets ? (toHand.length ? `${plural(toHand.length, 'packet', 'packets')} to hand over` : 'Every packet is out') : '',
                lines.length ? (itemsLeft ? `${plural(itemsLeft, 'item', 'items')} still due` : 'Every item is out') : '',
                showPasses && school.staff.length ? `${school.checkins.length} of ${school.staff.length} staff have a pass` : '',
              ].filter(Boolean).join(' · ') || 'Nothing to hand out here'}
            </p>
          </div>
          <button onClick={onCancel} aria-label="Close" className="rounded-md px-2 py-1 text-xl leading-none text-gray-400 hover:bg-gray-800">×</button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-4">
          {notice && <p role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/10 px-3 py-2 text-sm text-amber-200">{notice}</p>}

          {showPackets && <section className={section}>
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
          </section>}

          {items.filter((it) => lines.some((l) => l.itemId === it.id)).map((it) => (
            <section key={it.id} className={section}>
              <h3 className={heading}>{it.name} <span className="font-normal normal-case tracking-normal text-gray-500">· {it.count} {PER_WORD[it.per]}</span></h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {lines.filter((l) => l.itemId === it.id).map((l) => {
                  const k = lineKey(l);
                  const done = l.given >= l.due;
                  const n = give[k] ?? 0;
                  const on = n > 0;
                  const last = l.handOvers[l.handOvers.length - 1];
                  return (
                    <div key={k} className={`rounded-lg px-3 py-2.5 ring-1 ${done ? 'bg-gray-950/40 text-gray-500 ring-gray-800'
                      : on ? 'bg-violet-600/20 ring-violet-500/60' : 'bg-gray-800/60 ring-gray-700'}`}>
                      <div className="flex items-center gap-3">
                        <button type="button" disabled={done} aria-pressed={on}
                          aria-label={`${it.name}: ${sideWord(l.side, terms)}`}
                          onClick={() => setGive((g) => ({ ...g, [k]: on ? 0 : l.due - l.given }))}
                          className={`flex h-5 w-5 shrink-0 items-center justify-center rounded border text-xs ${done || on ? 'border-violet-300 bg-violet-500/30 text-violet-50' : 'border-gray-500'}`}>
                          {done || on ? '✓' : ''}
                        </button>
                        <span className="min-w-0 flex-1">
                          <span className="block font-medium">{sideWord(l.side, terms)} · {l.given}/{l.due}</span>
                          <span className="block truncate text-xs text-gray-400">
                            {last ? `${last.count} ${last.by ? `to ${last.by} ` : ''}at ${clock(last.at)}${last.device ? ` · ${last.device}` : ''}` : 'None given yet'}
                          </span>
                        </span>
                        {on && (
                          <span className="flex items-center gap-1">
                            <button type="button" aria-label="One fewer" onClick={() => setGive((g) => ({ ...g, [k]: Math.max(0, n - 1) }))}
                              className="h-8 w-8 rounded-md bg-gray-800 text-lg leading-none ring-1 ring-gray-700 hover:bg-gray-700">−</button>
                            <input type="number" inputMode="numeric" min={0} value={n} aria-label={`How many ${it.name}`}
                              onChange={(e) => setGive((g) => ({ ...g, [k]: Math.max(0, Math.min(999, Math.round(Number(e.target.value) || 0))) }))}
                              className="h-8 w-12 rounded-md border border-gray-700 bg-gray-950 text-center tabular-nums [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none" />
                            <button type="button" aria-label="One more" onClick={() => setGive((g) => ({ ...g, [k]: Math.min(999, n + 1) }))}
                              className="h-8 w-8 rounded-md bg-gray-800 text-lg leading-none ring-1 ring-gray-700 hover:bg-gray-700">+</button>
                          </span>
                        )}
                        {!on && last && (
                          <button type="button" onClick={() => onUndoItem(last.id)} className="rounded px-1.5 text-[11px] text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800">Undo</button>
                        )}
                      </div>
                      {on && n < l.due - l.given && <p className="mt-1 pl-8 text-[11px] text-amber-300">{l.due - l.given - n} still owed after this</p>}
                    </div>
                  );
                })}
              </div>
            </section>
          ))}

          {handing && (
            <section className={section}>
              <h3 className={heading}>Picked up by{station.askName ? '' : ' (optional)'}</h3>
              {earlier.length > 0 && (
                // Whoever took something at an earlier station: most likely
                // the same person at this one, so first and one tap.
                <div className="space-y-1.5">
                  <p className="text-[11px] text-gray-400">Here earlier for {school.name}</p>
                  <div className="flex flex-wrap gap-2">
                    {earlier.map((e) => {
                      const on = sameName(e.name, by);
                      return (
                        <button key={e.name} type="button" onClick={() => pick(e.name)}
                          className={`rounded-lg px-3 py-1.5 text-left ring-1 ${on ? 'bg-emerald-600/25 ring-emerald-500/60' : 'bg-gray-800 ring-gray-700 hover:bg-gray-700'}`}>
                          <span className="block text-sm font-medium">{e.name}</span>
                          <span className="block text-[11px] text-gray-400">{e.what} · {clock(e.at)}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
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
              ) : !earlier.length ? (
                <p className="text-sm text-gray-400">No coaches on file for {school.name}. Type who took it.</p>
              ) : null}
              <input value={by} onChange={(e) => setBy(e.target.value)} placeholder={onFile ? 'Someone else: name' : 'Name'}
                className="w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2 text-base" />
              {offList && <p className="text-xs text-amber-300">Not on {school.name}&apos;s staff list. They can still take it; the log will say so.</p>}
            </section>
          )}

          {showPasses && (school.staff.length > 0 || school.checkins.length > 0) && (
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
            {busy ? 'Saving…' : nothing ? 'Tick something to hand over' : needName ? 'Who picked it up?' : needSig ? 'Sign above' : label}
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
export function StaffPicks({ school, side: sideIn, terms, who, onPick }: {
  school: { name: string; staff: StaffMember[]; coaches: string[] };
  side: ItemSide | 'A'; terms: Terms; who: string; onPick: (name: string) => void;
}) {
  const side = sideIn === 'S' ? 'A' : sideIn;
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
