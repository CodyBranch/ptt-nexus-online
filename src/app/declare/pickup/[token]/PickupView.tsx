'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PickupResult, PickupSchool, PickupView as View, Side } from '@/lib/declare-pickup';
import SignaturePad, { type SignaturePadHandle } from './SignaturePad';

/**
 * The packet table.
 *
 * The box at the top takes a team label's code: a USB or Bluetooth scanner
 * types it and presses Enter, an Android scanner in keyboard mode does the
 * same, and the PTT Nexus Tablet app's Scan button hands its camera's read
 * over as a 'nexus-scan' event. Each station chooses what a pickup needs
 * (kept on this device): nothing, the name of who took it, their signature
 * here, or their signature on the sign-off tablet facing the coach.
 */

const POLL_MS = 3000;
const STATION_KEY = 'nexus-pickup-station';

type SignMode = 'none' | 'here' | 'tablet';
interface Station { askName: boolean; sign: SignMode; device: string }
const DEFAULT_STATION: Station = { askName: false, sign: 'none', device: '' };

interface Pending {
  school: PickupSchool;
  /** What to send: the scanned code, or the school and side tapped. */
  send: { action: 'scan'; code: string } | { action: 'manual'; teamAccessId: string; side: Side | 'A' };
  label: string;
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

export function sideWord(side: Side | 'A', terms: 'men_women' | 'boys_girls'): string {
  if (side === 'A') return 'All packets';
  if (side === 'X') return 'Packet';
  return side === 'F' ? (terms === 'men_women' ? 'Women' : 'Girls') : (terms === 'men_women' ? 'Men' : 'Boys');
}

export default function PickupView({ token, initial, terms }: { token: string; initial: View; terms: 'men_women' | 'boys_girls' }) {
  const [view, setView] = useState<View>(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ status: PickupResult['status']; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [station, setStation] = useState<Station>(DEFAULT_STATION);
  const [setup, setSetup] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const [who, setWho] = useState('');
  const [signed, setSigned] = useState(false);
  const [query, setQuery] = useState('');
  const [onlyLeft, setOnlyLeft] = useState(true);
  const [origin, setOrigin] = useState('');
  const pad = useRef<SignaturePadHandle>(null);
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

  const send = useCallback(async (what: Pending['send'], extra: { by?: string; signature?: string | null; wait?: boolean }) => {
    setBusy(true);
    try {
      const r = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...what, ...extra, device: station.device || undefined }),
      });
      const res = await r.json() as PickupResult & { held?: boolean; error?: string };
      if (res.held) setFlash({ status: 'waiting', message: 'No connection: held on this tablet, and sent as soon as it is back online.' });
      else if (!r.ok) setFlash({ status: 'unknown', message: res.error ?? 'Not recorded' });
      else setFlash({ status: res.status, message: res.message });
      await refresh();
    } catch {
      setFlash({ status: 'unknown', message: 'Not recorded - check the connection and scan again.' });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  }, [api, refresh, station.device]);

  /** A code or a tap: straight in, or first the name and signature this station asks for. */
  const start = useCallback((p: Pending) => {
    const wait = station.sign === 'tablet';
    if (wait || (!station.askName && station.sign === 'none')) {
      void send(p.send, { wait });
      return;
    }
    setWho('');
    setSigned(false);
    setPending(p);
  }, [send, station]);

  const scanned = useCallback((raw: string) => {
    const c = raw.trim();
    if (!c) return;
    const m = LABEL_CODE.exec(c);
    const school = m ? view.schools.find((s) => s.teamId === m[1].toLowerCase()) : undefined;
    if (!m || !school) {
      // Let the server say what it is: an unknown code is logged nowhere, but answered.
      void send({ action: 'scan', code: c }, {});
      return;
    }
    const side = m[2].toUpperCase() as Side | 'A';
    start({ school, send: { action: 'scan', code: c }, label: `${school.name} - ${sideWord(side, terms)}` });
  }, [view.schools, send, start, terms]);

  // The tablet app's camera.
  useEffect(() => {
    const onScan = (e: Event) => scanned(String((e as CustomEvent).detail ?? ''));
    window.addEventListener('nexus-scan', onScan);
    return () => window.removeEventListener('nexus-scan', onScan);
  }, [scanned]);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    scanned(code);
    setCode('');
  };

  const confirm = async () => {
    if (!pending) return;
    const signature = station.sign === 'here' ? pad.current?.value() ?? null : null;
    const p = pending;
    setPending(null);
    await send(p.send, { by: who.trim() || undefined, signature });
  };

  const undo = async (id: string) => {
    try {
      await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undo', id }) });
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
  const needName = station.askName && !who.trim();
  const needSig = station.sign === 'here' && !signed;
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
          <button onClick={() => setSetup((v) => !v)} className="ml-auto rounded-md px-3 py-1.5 text-sm text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800 sm:ml-0">
            This station
          </button>
          <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ${error ? 'bg-amber-500/15 text-amber-300' : 'bg-[#e70518]/15 text-red-300'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${error ? 'bg-amber-400' : 'bg-red-500'}`} />
            {error ? 'Reconnecting' : 'Live'}
          </span>
        </div>
      </header>

      {setup && (
        <section className="mx-4 mt-4 space-y-3 rounded-xl bg-gray-900/70 p-4 ring-1 ring-gray-800 sm:mx-6">
          <h2 className="text-sm font-semibold">What a pickup needs at this station</h2>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={station.askName} onChange={(e) => saveStation({ ...station, askName: e.target.checked })} />
            Ask the name of who picked it up
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
              the tablet facing the coach. Each packet scanned here waits there until it is signed.
            </p>
          )}
          <label className="block text-sm">
            <span className="text-gray-400">This station&apos;s name (shown in the log)</span>
            <input value={station.device} onChange={(e) => saveStation({ ...station, device: e.target.value.slice(0, 40) })}
              placeholder="Packet table 1" className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-900 px-3 py-2" />
          </label>
        </section>
      )}

      <dl className="grid grid-cols-3 gap-2 px-4 pt-4 sm:gap-3 sm:px-6">
        {[
          { k: 'Packets', v: view.packets, sub: `${view.schools.length} schools`, cls: 'text-gray-100' },
          { k: 'Picked up', v: view.pickedUp, sub: view.waiting.length ? `${view.waiting.length} waiting to sign` : 'handed over', cls: 'text-emerald-300' },
          { k: 'Still here', v: left, sub: left ? 'to hand over' : 'every packet is out', cls: left ? 'text-amber-300' : 'text-gray-500' },
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
            className="rounded-lg bg-blue-600 px-5 font-semibold hover:bg-blue-500 disabled:opacity-40">Record</button>
        </form>
        {flash && <p role="status" className={`mt-3 rounded-lg border px-4 py-2.5 text-sm ${FLASH[flash.status]}`}>{flash.message}</p>}
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
                <span className="min-w-0 flex-1 truncate font-medium">{s.name}</span>
                {s.sides.map((x) => {
                  const p = x.pickup;
                  const cls = p?.status === 'picked_up' ? 'bg-emerald-500/15 text-emerald-200 ring-emerald-500/30'
                    : p?.status === 'waiting' ? 'bg-sky-500/15 text-sky-200 ring-sky-500/30'
                      : 'bg-gray-800 text-gray-200 ring-gray-700 hover:bg-gray-700';
                  return (
                    <button key={x.side} disabled={!!p}
                      onClick={() => start({ school: s, send: { action: 'manual', teamAccessId: s.teamAccessId, side: x.side }, label: `${s.name} - ${sideWord(x.side, terms)}` })}
                      title={p ? `${p.status === 'waiting' ? 'Waiting to sign' : 'Picked up'}${p.by ? ` by ${p.by}` : ''} at ${clock(p.at)}` : `Mark picked up (${x.bibs || 'no bibs'})`}
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
            {view.log.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">No packets picked up yet.</li>}
            {view.log.slice(0, 60).map((r) => (
              <li key={r.id} className={`flex items-start gap-3 px-4 py-2.5 ${r.undone ? 'opacity-40' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{r.teamName} · {sideWord(r.side, terms)}</div>
                  <div className="text-[11px] text-gray-400">
                    {r.undone ? 'Undone: ' : ''}{r.status === 'waiting' ? 'Waiting to sign' : r.undone ? 'picked up' : 'Picked up'}
                    {r.by ? ` by ${r.by}` : ''} · {clock(r.at)}{r.via === 'manual' ? ' · by hand' : ''}{r.device ? ` · ${r.device}` : ''}
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
        <span className="mr-2">Scanner URL:</span>
        <code className="break-all text-gray-300">{scannerUrl}<span className="text-gray-500">{'{label code}'}</span></code>
      </footer>

      {pending && (
        <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/70 p-4 sm:items-center" role="dialog" aria-modal="true">
          <div className="w-full max-w-lg space-y-4 rounded-2xl bg-gray-900 p-5 ring-1 ring-gray-700">
            <h2 className="text-lg font-semibold">{pending.label}</h2>
            {station.askName && (
              <div>
                <label htmlFor="pk-who" className="text-sm text-gray-400">Picked up by</label>
                <input id="pk-who" autoFocus value={who} onChange={(e) => setWho(e.target.value)} placeholder="Name"
                  className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-3 py-2.5 text-base" />
                {pending.school.coaches.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {pending.school.coaches.map((c) => (
                      <button key={c} type="button" onClick={() => setWho(c)} className="rounded-md bg-gray-800 px-2.5 py-1 text-sm ring-1 ring-gray-700 hover:bg-gray-700">{c}</button>
                    ))}
                  </div>
                )}
              </div>
            )}
            {station.sign === 'here' && <SignaturePad ref={pad} onChange={setSigned} />}
            <div className="flex gap-2">
              <button onClick={() => { setPending(null); input.current?.focus(); }} className="h-12 flex-1 rounded-xl text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800">Cancel</button>
              <button onClick={() => void confirm()} disabled={needName || needSig}
                className="h-12 flex-1 rounded-xl bg-emerald-600 font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">Picked up</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
