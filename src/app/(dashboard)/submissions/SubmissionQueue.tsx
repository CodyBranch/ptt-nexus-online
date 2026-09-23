'use client';

import { useState, useTransition } from 'react';
import { approveSubmission, rejectSubmission, reopenSubmission, nearMatches } from './actions';

interface Submission {
  id: string;
  name: string;
  abbreviation: string | null;
  organizationType: string;
  city: string | null;
  state: string | null;
  meetName: string | null;
  athleteCount: number | null;
  timesSeen: number;
  status: string;
  reviewNote: string | null;
}

interface Near {
  id: string; name: string; city: string | null; state: string | null; organizationType: string;
}

const input = 'px-2 py-1 bg-gray-900 border border-gray-700 rounded text-xs text-gray-200 w-full';

export default function SubmissionQueue({ rows, status }: { rows: Submission[]; status: string }) {
  const [busy, startTransition] = useTransition();
  const [note, setNote] = useState<{ text: string; bad?: boolean } | null>(null);
  /** The row open for a decision, and what the reviewer is filling in. */
  const [open, setOpen] = useState<string | null>(null);
  const [fields, setFields] = useState<Record<string, string>>({});
  const [near, setNear] = useState<Record<string, Near[]>>({});
  const [rejectNote, setRejectNote] = useState('');

  const openRow = (s: Submission) => {
    setOpen(s.id);
    setRejectNote('');
    setNote(null);
    setFields({
      name: s.name,
      abbreviation: s.abbreviation ?? '',
      organizationType: s.organizationType,
      city: s.city ?? '',
      state: s.state ?? '',
    });
    // What is already here that looks like it. The commonest right answer is
    // not "create it" but "that is one we have, spelled differently".
    if (!near[s.id]) {
      startTransition(async () => {
        const found = await nearMatches(s.name);
        setNear((n) => ({ ...n, [s.id]: found }));
      });
    }
  };

  const set = (k: string, v: string) => setFields((f) => ({ ...f, [k]: v }));

  const approve = (id: string) => startTransition(async () => {
    const r = await approveSubmission(id, fields);
    if (r.ok) { setOpen(null); setNote({ text: 'Created, and the submission is closed' }); }
    else setNote({ text: r.error, bad: true });
  });

  const reject = (id: string) => startTransition(async () => {
    const r = await rejectSubmission(id, rejectNote);
    if (r.ok) { setOpen(null); setNote({ text: 'Turned down' }); }
    else setNote({ text: r.error, bad: true });
  });

  const reopen = (id: string) => startTransition(async () => {
    await reopenSubmission(id);
    setNote({ text: 'Back in the queue' });
  });

  if (rows.length === 0) {
    return (
      <p className="py-8 text-sm text-gray-500">
        {status === 'pending'
          ? 'Nothing waiting. Unmatched teams arrive here when somebody sends them from Org Matching in Nexus.'
          : `No ${status} submissions.`}
      </p>
    );
  }

  return (
    <div>
      {note && (
        <div className={`mb-4 px-3 py-2 rounded text-sm border ${
          note.bad
            ? 'bg-red-500/10 border-red-500/30 text-red-300'
            : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
        }`}>{note.text}</div>
      )}

      <div className="space-y-2">
        {rows.map((s) => (
          <div key={s.id} className="border border-gray-800 rounded-lg overflow-hidden">
            <div className="flex items-center gap-3 px-4 py-3 hover:bg-gray-800/40">
              <div className="min-w-0 flex-1">
                <div className="text-sm text-gray-100 truncate">
                  {s.name}
                  {s.abbreviation && <span className="ml-2 text-xs text-gray-500">{s.abbreviation}</span>}
                </div>
                <div className="text-[11px] text-gray-500 mt-0.5">
                  {s.organizationType.replace('_', ' ')}
                  {(s.city || s.state) && ` · ${[s.city, s.state].filter(Boolean).join(', ')}`}
                  {s.meetName && ` · from ${s.meetName}`}
                  {s.timesSeen > 1 && (
                    <span className="ml-2 text-amber-400">seen {s.timesSeen} times</span>
                  )}
                </div>
                {s.reviewNote && (
                  <div className="text-[11px] text-gray-600 mt-0.5">“{s.reviewNote}”</div>
                )}
              </div>

              {s.status === 'pending' ? (
                <button onClick={() => (open === s.id ? setOpen(null) : openRow(s))}
                  className="px-3 py-1.5 border border-gray-600 text-gray-300 hover:bg-gray-700/40 rounded text-xs">
                  {open === s.id ? 'Close' : 'Review'}
                </button>
              ) : (
                <button onClick={() => reopen(s.id)} disabled={busy}
                  className="px-3 py-1.5 text-xs text-gray-500 hover:text-gray-300">
                  Put back
                </button>
              )}
            </div>

            {open === s.id && (
              <div className="px-4 py-4 bg-gray-800/40 border-t border-gray-800">
                {(near[s.id]?.length ?? 0) > 0 && (
                  <div className="mb-4">
                    <p className="text-[11px] uppercase tracking-wider text-amber-400 mb-1">
                      Already here — is it one of these?
                    </p>
                    <ul className="text-xs text-gray-400 space-y-0.5">
                      {near[s.id].map((m) => (
                        <li key={m.id}>
                          <a href={`/organizations/${m.id}`} className="text-blue-400 hover:text-blue-300">
                            {m.name}
                          </a>
                          <span className="text-gray-600">
                            {' '}· {m.organizationType.replace('_', ' ')}
                            {(m.city || m.state) && ` · ${[m.city, m.state].filter(Boolean).join(', ')}`}
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="text-[10px] text-gray-600 mt-1">
                      If so, turn this down with the name — org matching failing to find it
                      is a matching problem, and a second row would bury the one that is right.
                    </p>
                  </div>
                )}

                <p className="text-[11px] text-gray-500 mb-2">
                  The meet knew the name, the level and not much else. Anything filled in
                  here wins over what it sent.
                </p>
                <div className="grid grid-cols-2 lg:grid-cols-3 gap-2 mb-3">
                  {[
                    ['name', 'Name'], ['abbreviation', 'Abbreviation'],
                    ['city', 'City'], ['state', 'State'],
                    ['conference', 'Conference'], ['stateAssociation', 'State association'],
                    ['primaryColor', 'Primary colour'], ['secondaryColor', 'Secondary colour'],
                    ['website', 'Website'],
                    ['logoUrl', 'Logo URL'], ['logoDarkUrl', 'Logo URL (dark)'],
                  ].map(([key, label]) => (
                    <label key={key} className="block">
                      <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                        {label}
                      </span>
                      <input value={fields[key] ?? ''} onChange={(e) => set(key, e.target.value)}
                        className={input} />
                    </label>
                  ))}
                  <label className="block">
                    <span className="block text-[10px] uppercase tracking-wider text-gray-500 mb-0.5">
                      Level
                    </span>
                    <select value={fields.organizationType ?? ''}
                      onChange={(e) => set('organizationType', e.target.value)} className={input}>
                      {['high_school', 'college', 'middle_school', 'club', 'professional', 'other']
                        .map((t) => <option key={t} value={t}>{t.replace('_', ' ')}</option>)}
                    </select>
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button onClick={() => approve(s.id)} disabled={busy || !fields.name?.trim()}
                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 rounded text-sm font-semibold">
                    {busy ? 'Working…' : 'Create the organisation'}
                  </button>
                  <span className="text-gray-700">or</span>
                  <input value={rejectNote} onChange={(e) => setRejectNote(e.target.value)}
                    placeholder="Why not — e.g. misspelling of Battle High School"
                    className={`${input} flex-1 max-w-md`} />
                  <button onClick={() => reject(s.id)} disabled={busy}
                    className="px-3 py-2 border border-gray-600 text-gray-300 hover:bg-gray-700/40 rounded text-sm">
                    Turn down
                  </button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
