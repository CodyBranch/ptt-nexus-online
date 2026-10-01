'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import { matchAgain, pullNow, setAutoPullOn } from './actions';

/**
 * Pull now, Match again, and the daily read's switch.
 *
 * Messages are set before each transition starts: an update inside one only
 * shows when it ends, which made a minute-long pull look like nothing. The
 * page is redrawn afterwards so the counts above follow.
 */
export default function Controls({ autoPull }: { autoPull: { on: boolean; by: string | null; at: string | null } }) {
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  const router = useRouter();

  const pull = () => {
    setMessage('Reading the USTFCCCA and matching teams…');
    start(async () => {
      const r = await pullNow();
      setMessage(r.status === 'failed'
        ? `The read failed: ${r.error ?? 'no reason given'}`
        : r.status === 'unchanged'
          ? `Nothing new since the last read${r.autoMatched ? `; linked ${r.autoMatched} more` : ''}.`
          : `Read ${r.listsSeen} lists and ${r.teamsSeen} teams: ${r.listsNew} new list${r.listsNew === 1 ? '' : 's'}, ${r.autoMatched} linked.`);
      router.refresh();
    });
  };
  const rematch = () => {
    setMessage('Matching teams…');
    start(async () => {
      const r = await matchAgain();
      setMessage(`Linked ${r.autoMatched}; ${r.review} to review, ${r.unmatched} not found.`);
      router.refresh();
    });
  };
  const toggle = () => {
    const on = !autoPull.on;
    setMessage(on ? 'Turning the daily read on…' : 'Turning the daily read off…');
    start(async () => {
      const r = await setAutoPullOn(on);
      setMessage(r.ok ? (on ? 'The daily read is on.' : 'The daily read is off until it is switched back on. Pull now still works.') : r.error);
      router.refresh();
    });
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <button onClick={pull} disabled={busy}
        className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm text-white">
        {busy ? 'Working…' : 'Pull now'}
      </button>
      <button onClick={rematch} disabled={busy}
        className="px-3 py-1.5 rounded border border-gray-700 hover:border-gray-500 disabled:opacity-50 text-sm text-gray-300">
        Match again
      </button>
      <button onClick={toggle} disabled={busy} role="switch" aria-checked={autoPull.on}
        title={autoPull.by ? `Last changed by ${autoPull.by}` : undefined}
        className="ml-2 inline-flex items-center gap-2 text-sm text-gray-300 disabled:opacity-50">
        <span className={`relative inline-block w-9 h-5 rounded-full transition-colors ${autoPull.on ? 'bg-emerald-600' : 'bg-gray-700'}`}>
          <span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-all ${autoPull.on ? 'left-[18px]' : 'left-0.5'}`} />
        </span>
        Daily read {autoPull.on ? 'on' : 'off'}
      </button>
      {message && <span className="text-sm text-gray-400 ml-2">{message}</span>}
    </div>
  );
}
