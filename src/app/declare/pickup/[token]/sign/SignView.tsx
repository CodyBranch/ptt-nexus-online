'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PickupView as View } from '@/lib/declare-pickup';
import SignaturePad, { type SignaturePadHandle } from '../SignaturePad';
import { sideWord } from '../PickupView';

/**
 * The sign-off tablet, facing the coach.
 *
 * Shows the oldest school waiting to sign (all of its packets scanned so far
 * together), the coach's name and signature, and Accept. Polls every two
 * seconds, so the packet appears as the table scans it.
 */

const POLL_MS = 2000;

export default function SignView({ token, initial, terms }: { token: string; initial: View; terms: 'men_women' | 'boys_girls' }) {
  const [view, setView] = useState<View>(initial);
  const [who, setWho] = useState('');
  const [signed, setSigned] = useState(false);
  const [busy, setBusy] = useState(false);
  const [thanks, setThanks] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pad = useRef<SignaturePadHandle>(null);
  const api = `/api/declare/pickup/${token}`;

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

  // The first school in line, with every packet of theirs that is waiting.
  const turn = useMemo(() => {
    const first = view.waiting[0];
    if (!first) return null;
    const rows = view.waiting.filter((w) => w.teamAccessId === first.teamAccessId);
    const school = view.schools.find((s) => s.teamAccessId === first.teamAccessId);
    return { rows, school, name: first.teamName };
  }, [view]);

  const turnKey = turn?.rows.map((r) => r.id).join(',') ?? '';
  useEffect(() => { setWho(''); setSigned(false); pad.current?.clear(); }, [turnKey]);

  const accept = async () => {
    if (!turn) return;
    setBusy(true);
    try {
      const r = await fetch(api, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'sign', ids: turn.rows.map((x) => x.id), by: who.trim(), signature: pad.current?.value() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Not saved');
      setThanks(`Thank you. ${turn.name}'s packets are yours.`);
      setTimeout(() => setThanks(null), 4000);
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Not saved - try again');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-[#0a0f24] text-gray-100">
      <header className="flex items-center gap-4 border-b border-white/10 bg-[#0c1537] px-6 py-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- a static brand image, as on the dashboard */}
        <img src="/live/primetime-on-dark.png" alt="PrimeTime Timing" className="h-6 w-auto" />
        <h1 className="min-w-0 flex-1 truncate text-lg font-bold">{view.meet.name}</h1>
        {error && <span className="text-sm text-amber-300">{error}</span>}
      </header>

      <main className="flex flex-1 items-center justify-center p-6">
        {thanks ? (
          <p className="text-center text-2xl font-semibold text-emerald-300">{thanks}</p>
        ) : !turn ? (
          <div className="text-center">
            <p className="text-2xl font-semibold">Packet pickup</p>
            <p className="mt-2 text-gray-400">Your school&apos;s packets appear here when the table scans them.</p>
          </div>
        ) : (
          <div className="w-full max-w-xl space-y-5">
            <div>
              <p className="text-sm uppercase tracking-wider text-gray-400">Sign for</p>
              <h2 className="text-3xl font-bold">{turn.name}</h2>
              <ul className="mt-2 space-y-1 text-gray-300">
                {turn.rows.map((r) => {
                  const side = turn.school?.sides.find((x) => x.side === r.side);
                  return (
                    <li key={r.id}>
                      {sideWord(r.side, terms)}: {side?.athletes ?? 0} athlete{side?.athletes === 1 ? '' : 's'}{side?.bibs ? `, bibs ${side.bibs}` : ''}
                    </li>
                  );
                })}
              </ul>
            </div>
            <div>
              <label htmlFor="sg-who" className="text-sm text-gray-400">Your name</label>
              <input id="sg-who" value={who} onChange={(e) => setWho(e.target.value)} autoComplete="off"
                className="mt-1 w-full rounded-lg border border-gray-700 bg-gray-950 px-4 py-3 text-lg" />
              {(turn.school?.coaches.length ?? 0) > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {turn.school!.coaches.map((c) => (
                    <button key={c} type="button" onClick={() => setWho(c)} className="rounded-md bg-gray-800 px-3 py-1.5 ring-1 ring-gray-700 hover:bg-gray-700">{c}</button>
                  ))}
                </div>
              )}
            </div>
            <SignaturePad ref={pad} onChange={setSigned} />
            <button onClick={() => void accept()} disabled={busy || !who.trim() || !signed}
              className="h-14 w-full rounded-xl bg-emerald-600 text-lg font-semibold text-white hover:bg-emerald-500 disabled:opacity-40">
              I have the packets
            </button>
            {view.waiting.length > turn.rows.length && (
              <p className="text-center text-sm text-gray-500">Next: {view.waiting.find((w) => w.teamAccessId !== turn.rows[0].teamAccessId)?.teamName}</p>
            )}
          </div>
        )}
      </main>
    </div>
  );
}
