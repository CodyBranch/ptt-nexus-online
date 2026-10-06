'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { OutstandingBib, ReturnScan, ReturnStatus } from '@/lib/declare-returns';

/**
 * The bib-return desk, kept current.
 *
 * Polls every few seconds so TagTool's scans show up as they land; a scan or
 * a correction made here redraws at once. The box at the top takes a typed
 * bib or tag - or a USB scanner that types and presses Enter.
 */

const POLL_MS = 3000;

interface View {
  meet: { name: string; date: string | null };
  scratched: number;
  returned: number;
  outstanding: OutstandingBib[];
  /** Bibs handed in for runners since put back in a race (scratchedAt is when the bib came back). */
  backButRunning: OutstandingBib[];
  scans: ReturnScan[];
  generatedAt: string;
}

const SCROLL_CSS = `
  html, .ret-scroll { scrollbar-width: thin; scrollbar-color: rgba(148,163,184,.28) transparent; }
  html::-webkit-scrollbar, .ret-scroll::-webkit-scrollbar { width: 8px; }
  html::-webkit-scrollbar-thumb, .ret-scroll::-webkit-scrollbar-thumb {
    background: rgba(148,163,184,.28); border-radius: 999px; border: 2px solid transparent; background-clip: padding-box;
  }
`;

const PILL: Record<ReturnScan['status'], { label: string; cls: string }> = {
  returned: { label: 'Returned', cls: 'bg-emerald-500/15 text-emerald-300 ring-emerald-500/30' },
  not_scratched: { label: 'Not scratched', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  ambiguous: { label: 'Two runners', cls: 'bg-amber-500/15 text-amber-300 ring-amber-500/30' },
  unknown_bib: { label: 'Unknown', cls: 'bg-rose-500/15 text-rose-300 ring-rose-500/30' },
};

const FLASH: Record<ReturnStatus, string> = {
  returned: 'border-emerald-500/50 bg-emerald-500/10 text-emerald-200',
  already_returned: 'border-sky-500/40 bg-sky-500/10 text-sky-200',
  not_scratched: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  ambiguous: 'border-amber-500/50 bg-amber-500/10 text-amber-200',
  unknown_bib: 'border-rose-500/50 bg-rose-500/10 text-rose-200',
};

function clock(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', second: '2-digit' });
}

function codeLabel(s: { code: string; bib: string | null }) {
  return s.bib && s.bib !== s.code ? <>Tag {s.code} <span className="text-gray-500">· bib {s.bib}</span></> : <>Bib {s.code}</>;
}

export default function ReturnsView({ token, initial }: { token: string; initial: View }) {
  const [view, setView] = useState<View>(initial);
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [flash, setFlash] = useState<{ status: ReturnStatus; message: string } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [origin, setOrigin] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const api = `/api/declare/returns/${token}`;

  useEffect(() => { setOrigin(window.location.origin); }, []);

  const refresh = useCallback(async () => {
    try {
      const r = await fetch(api, { cache: 'no-store' });
      if (!r.ok) throw new Error(String(r.status));
      setView({ ...(await r.json()), generatedAt: new Date().toISOString() });
      setError(null);
    } catch {
      setError('Lost touch with the server - retrying');
    }
  }, [api]);

  useEffect(() => {
    const t = setInterval(() => { if (!document.hidden) void refresh(); }, POLL_MS);
    const onVis = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', onVis);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', onVis); };
  }, [refresh]);

  const post = async (body: Record<string, string>) => {
    const r = await fetch(api, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? 'Not recorded');
    return r.json();
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    const c = code.trim();
    if (!c || busy) return;
    setBusy(true);
    try {
      const res = await post({ action: 'manual', code: c });
      setFlash({ status: res.status, message: res.message });
      setCode('');
      await refresh();
    } catch (err) {
      setFlash({ status: 'unknown_bib', message: err instanceof Error ? err.message : 'Not recorded' });
    } finally {
      setBusy(false);
      input.current?.focus();
    }
  };

  const act = async (action: 'undo' | 'scratch', id: string) => {
    try { await post({ action, id }); await refresh(); } catch { setError('That change was not saved - try again'); }
  };

  const bySchool = useMemo(() => {
    const m = new Map<string, OutstandingBib[]>();
    for (const o of view.outstanding) m.set(o.teamName, [...(m.get(o.teamName) ?? []), o]);
    return [...m.entries()];
  }, [view.outstanding]);

  const tagToolUrl = origin ? `${origin}${api}?bib=` : '';
  const out = view.outstanding.length;
  const needsLook = view.scans.filter((s) => !s.undone && s.status !== 'returned').length;

  return (
    <div className="min-h-screen bg-gray-950 text-gray-100 lg:h-screen lg:flex lg:flex-col lg:overflow-hidden">
      <style>{SCROLL_CSS}</style>
      <header className="border-b border-gray-800 px-4 py-4 sm:px-6">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            {/* eslint-disable-next-line @next/next/no-img-element -- a static brand image, as on the dashboard */}
            <img src="/live/primetime-on-dark.png" alt="PrimeTime Timing" className="mb-3 h-5 w-auto sm:h-7" />
            <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Bib returns</p>
            <h1 className="text-xl font-semibold text-balance sm:text-2xl">{view.meet.name}</h1>
          </div>
          <dl className="grid w-full grid-cols-3 gap-2 sm:w-auto sm:gap-3">
            {[
              { k: 'Scratched', v: view.scratched, cls: 'text-gray-100' },
              { k: 'Returned', v: view.returned, cls: 'text-emerald-300' },
              { k: 'Still out', v: out, cls: out ? 'text-amber-300' : 'text-gray-500' },
            ].map((s) => (
              <div key={s.k} className="rounded-lg bg-gray-900 px-3 py-2 ring-1 ring-gray-800 sm:min-w-28">
                <dt className="text-[11px] uppercase tracking-wider text-gray-500">{s.k}</dt>
                <dd className={`text-2xl font-semibold tabular-nums ${s.cls}`}>{s.v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </header>

      <div className="px-4 py-4 sm:px-6">
        <form onSubmit={submit} className="flex gap-2">
          <label htmlFor="ret-code" className="sr-only">Bib or tag</label>
          <input id="ret-code" ref={input} autoFocus value={code} onChange={(e) => setCode(e.target.value)}
            inputMode="text" autoComplete="off" spellCheck={false} placeholder="Scan or type a bib or tag"
            className="min-w-0 flex-1 rounded-lg border border-gray-700 bg-gray-900 px-4 py-3 text-lg tabular-nums placeholder:text-gray-600 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/40" />
          <button type="submit" disabled={busy || !code.trim()}
            className="rounded-lg bg-blue-600 px-5 font-semibold hover:bg-blue-500 disabled:opacity-40 focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-300">
            Record
          </button>
        </form>
        {flash && (
          <p role="status" className={`mt-3 rounded-lg border px-4 py-2.5 text-sm ${FLASH[flash.status]}`}>{flash.message}</p>
        )}
        {error && <p className="mt-2 text-sm text-rose-300">{error}</p>}
      </div>

      <main className="grid gap-4 px-4 pb-6 sm:px-6 lg:min-h-0 lg:flex-1 lg:grid-cols-2">
        <section className="flex min-h-0 flex-col rounded-xl bg-gray-900/60 ring-1 ring-gray-800">
          <h2 className="flex items-center justify-between border-b border-gray-800 px-4 py-3 text-sm font-semibold">
            Scans
            {needsLook > 0 && <span className="rounded-full bg-amber-500/15 px-2 py-0.5 text-xs text-amber-300">{needsLook} to look at</span>}
          </h2>
          <ul className="ret-scroll divide-y divide-gray-800/70 lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {view.scans.length === 0 && <li className="px-4 py-8 text-center text-sm text-gray-500">No bibs scanned yet.</li>}
            {view.scans.map((s) => (
              <li key={s.id} className={`flex items-start gap-3 px-4 py-2.5 ${s.undone ? 'opacity-40' : ''}`}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                    <span className={`rounded-full px-2 py-0.5 text-xs ring-1 ${PILL[s.status].cls}`}>{s.undone ? 'Undone' : PILL[s.status].label}</span>
                    <span className="font-medium tabular-nums">{codeLabel(s)}</span>
                  </div>
                  {s.runner && <div className="mt-0.5 truncate text-sm text-gray-300">{s.runner.name} · {s.runner.teamName}</div>}
                  <div className="text-[11px] tabular-nums text-gray-500">
                    {clock(s.at)}{s.via === 'manual' ? ' · typed' : s.device ? ` · ${s.device}` : ''}
                  </div>
                </div>
                {!s.undone && (
                  <div className="flex shrink-0 flex-col items-end gap-1.5 sm:flex-row sm:items-center">
                    {s.status === 'not_scratched' && (
                      <button onClick={() => act('scratch', s.id)}
                        className="rounded-md bg-amber-500/15 px-2.5 py-1 text-xs font-medium text-amber-200 ring-1 ring-amber-500/30 hover:bg-amber-500/25">
                        Scratch and accept
                      </button>
                    )}
                    <button onClick={() => act('undo', s.id)}
                      className="rounded-md px-2.5 py-1 text-xs text-gray-400 ring-1 ring-gray-700 hover:bg-gray-800 hover:text-gray-200">
                      Undo
                    </button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>

        <section className="flex min-h-0 flex-col rounded-xl bg-gray-900/60 ring-1 ring-gray-800">
          <h2 className="border-b border-gray-800 px-4 py-3 text-sm font-semibold">Still out <span className="text-gray-500">({out})</span></h2>
          <div className="ret-scroll lg:min-h-0 lg:flex-1 lg:overflow-y-auto">
            {view.backButRunning.length > 0 && (
              <div className="border-b border-amber-500/30 bg-amber-500/5 px-4 py-3">
                <h3 className="mb-1.5 text-sm font-semibold text-amber-200">Handed in, now running again - give the bib back</h3>
                <ul className="grid gap-1">
                  {view.backButRunning.map((o) => (
                    <li key={`${o.teamAccessId}|${o.athleteId}`} className="flex items-baseline gap-2 text-sm">
                      <span className="w-12 shrink-0 font-semibold tabular-nums text-amber-100">{o.bib ?? '-'}</span>
                      <span className="min-w-0 truncate text-gray-200">{o.name}</span>
                      <span className="ml-auto shrink-0 truncate text-xs text-gray-400">{o.teamName}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            {out === 0 && <p className="px-4 py-8 text-center text-sm text-gray-500">{view.scratched ? 'Every scratched bib is back.' : 'Nobody has been scratched yet.'}</p>}
            {bySchool.map(([school, list]) => (
              <div key={school} className="border-b border-gray-800/70 px-4 py-3 last:border-0">
                <h3 className="mb-1.5 flex items-baseline justify-between text-sm font-semibold">
                  {school} <span className="text-xs font-normal text-amber-300">{list.length} out</span>
                </h3>
                <ul className="grid gap-1 sm:grid-cols-2">
                  {list.map((o) => (
                    <li key={o.athleteId} className="flex items-baseline gap-2 text-sm">
                      <span className="w-12 shrink-0 font-semibold tabular-nums text-gray-200">{o.bib ?? '-'}</span>
                      <span className="min-w-0 truncate text-gray-300">{o.name}</span>
                      {o.tags.length > 0 && <span className="shrink-0 text-[11px] tabular-nums text-gray-600">{o.tags.join(', ')}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      </main>

      <footer className="border-t border-gray-800 px-4 py-3 text-xs text-gray-500 sm:px-6">
        <span className="mr-2">TagTool URL:</span>
        <code className="break-all text-gray-300">{tagToolUrl}<span className="text-gray-500">{'{bib or tag}'}</span></code>
        <button onClick={() => { void navigator.clipboard.writeText(tagToolUrl).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); }}
          className="ml-3 rounded px-2 py-0.5 text-gray-300 ring-1 ring-gray-700 hover:bg-gray-800">
          {copied ? 'Copied' : 'Copy'}
        </button>
      </footer>
    </div>
  );
}
