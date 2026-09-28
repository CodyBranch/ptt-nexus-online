'use client';

import { useState, useTransition } from 'react';
import { restoreRatings } from '../../../actions';

interface Segment { fromMeters: number; toMeters: number; difficulty: number }
interface Entry {
  id: string;
  ratings: Segment[];
  segmentCount: number;
  changeKind: string;
  meetName: string | null;
  changedBy: string | null;
  createdAt: string | null;
}

function when(iso: string | null): string {
  return iso ? new Date(iso).toLocaleString([], { month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
}

/** The whole course as one number: the distance-weighted mean rating. */
function overall(r: Segment[]): string {
  const len = r.reduce((s, x) => s + (x.toMeters - x.fromMeters), 0);
  if (!len) return '—';
  return (r.reduce((s, x) => s + x.difficulty * (x.toMeters - x.fromMeters), 0) / len).toFixed(3);
}

export default function RatingLog({ courseId, venueId, entries, current }: {
  courseId: string; venueId: string; entries: Entry[]; current: Segment[];
}) {
  const [isPending, startTransition] = useTransition();
  const [confirm, setConfirm] = useState<Entry | null>(null);
  const [error, setError] = useState('');
  const now = JSON.stringify(current.map((s) => [s.fromMeters, s.toMeters, s.difficulty]));

  return (
    <>
      {error && <div className="px-3 py-2 mb-3 bg-red-500/10 border border-red-500/20 rounded text-sm text-red-400">{error}</div>}
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
        {entries.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-gray-600">No ratings logged yet.</div>
        ) : (
          <ul className="divide-y divide-gray-800/60">
            {entries.map((e) => {
              const isCurrent = JSON.stringify(e.ratings.map((s) => [s.fromMeters, s.toMeters, s.difficulty])) === now;
              return (
                <li key={e.id} className="px-4 py-3 flex items-center gap-4 text-sm">
                  <div className="w-44 shrink-0 text-xs text-gray-500">{when(e.createdAt)}</div>
                  <div className="flex-1 min-w-0">
                    <div className="text-gray-200">
                      {e.segmentCount === 0 ? 'Ratings cleared' : `${e.segmentCount} stretches · overall ${overall(e.ratings)}`}
                      {e.changeKind === 'restored' && <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">restored</span>}
                      {isCurrent && <span className="ml-2 px-1.5 py-0.5 text-[10px] rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">current</span>}
                    </div>
                    <div className="text-[11px] text-gray-600">{e.meetName ?? e.changedBy ?? ''}</div>
                  </div>
                  {!isCurrent && (
                    <button onClick={() => { setError(''); setConfirm(e); }}
                      className="px-2.5 py-1 text-xs bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 rounded-lg">
                      Restore
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>

      {confirm && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50" onClick={() => setConfirm(null)}>
          <div className="bg-gray-900 border border-gray-700 rounded-xl p-6 max-w-sm w-full mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="text-lg font-semibold mb-2">Restore these ratings?</h3>
            <p className="text-sm text-gray-400 mb-6">
              The {confirm.segmentCount} stretches from {when(confirm.createdAt)} become this course&apos;s ratings. The ones it has now stay in the history.
            </p>
            <div className="flex justify-end gap-3">
              <button onClick={() => setConfirm(null)} className="px-4 py-2 text-sm bg-gray-700 hover:bg-gray-600 rounded-lg">Cancel</button>
              <button
                disabled={isPending}
                onClick={() => startTransition(async () => {
                  const r = await restoreRatings(confirm.id, courseId, venueId);
                  if (!r.ok) setError(r.error ?? 'Could not restore them');
                  setConfirm(null);
                })}
                className="px-4 py-2 text-sm bg-amber-600 hover:bg-amber-500 text-white rounded-lg disabled:opacity-50"
              >
                {isPending ? 'Restoring…' : 'Restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
