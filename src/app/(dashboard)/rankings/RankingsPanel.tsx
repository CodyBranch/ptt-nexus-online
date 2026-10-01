'use client';

import { useState, useTransition } from 'react';
import {
  candidatesFor, ignoreTeam, linkTeam, matchAgain, pullNow, searchColleges, unlinkTeam, type TeamTab,
} from './actions';

interface Team {
  ustfcccaTeamId: number;
  teamName: string;
  teamShort: string | null;
  division: string | null;
  conference: string | null;
  athnetTeamId: number | null;
  matchStatus: string;
  matchNote: string | null;
  matchedBy: string | null;
  organizationId: string | null;
  organizationName: string | null;
}

interface Option { id: string; name: string; conference: string | null; state: string | null; division: string | null; score?: number; why?: string }

/** Pull now, match again, and the teams on one tab with what can be done about each. */
export default function RankingsPanel({ tab, teams }: { tab: TeamTab; teams: Team[] }) {
  const [busy, start] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const pull = () => start(async () => {
    setMessage('Reading the USTFCCCA…');
    const r = await pullNow();
    setMessage(r.status === 'failed'
      ? `The read failed: ${r.error ?? 'no reason given'}`
      : r.status === 'unchanged'
        ? `Nothing new since the last read${r.autoMatched ? `; linked ${r.autoMatched} more team(s)` : ''}.`
        : `Read ${r.listsSeen} lists and ${r.teamsSeen} teams: ${r.listsNew} new list(s), ${r.teamsNew} new team(s), ${r.autoMatched} linked.`);
  });
  const rematch = () => start(async () => {
    const r = await matchAgain();
    setMessage(`Linked ${r.autoMatched}; ${r.review} to review, ${r.unmatched} not found.`);
  });

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <button onClick={pull} disabled={busy}
          className="px-3 py-1.5 rounded bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-sm text-white">
          Pull now
        </button>
        <button onClick={rematch} disabled={busy}
          className="px-3 py-1.5 rounded border border-gray-700 hover:border-gray-500 disabled:opacity-50 text-sm text-gray-300">
          Match again
        </button>
        {message && <span className="text-sm text-gray-400">{message}</span>}
      </div>

      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3">USTFCCCA team</th>
              <th className="px-4 py-3">Division</th>
              <th className="px-4 py-3">Conference</th>
              <th className="px-4 py-3">{tab === 'linked' ? 'Organization' : 'Why'}</th>
              <th className="px-4 py-3 w-[22rem]"></th>
            </tr>
          </thead>
          <tbody>
            {teams.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-10 text-center text-gray-600 text-sm">
                  {tab === 'review' ? 'Nothing waiting for a person.' : 'None.'}
                </td>
              </tr>
            ) : teams.map((t) => <TeamRow key={t.ustfcccaTeamId} team={t} tab={tab} />)}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function TeamRow({ team, tab }: { team: Team; tab: TeamTab }) {
  const [open, setOpen] = useState(false);
  const [options, setOptions] = useState<Option[] | null>(null);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  const show = () => start(async () => {
    setOpen(true);
    setOptions(await candidatesFor(team.ustfcccaTeamId));
  });
  const search = (q: string) => {
    setQuery(q);
    start(async () => setOptions(q.trim().length >= 2 ? await searchColleges(q) : await candidatesFor(team.ustfcccaTeamId)));
  };
  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setError(null);
    const r = await fn();
    if (!r.ok) setError(r.error);
  });

  return (
    <>
      <tr className="border-b border-gray-800/60 last:border-0 align-top">
        <td className="px-4 py-3 text-sm">
          <div className="text-gray-200">{team.teamName}</div>
          {team.teamShort && team.teamShort !== team.teamName && <div className="text-xs text-gray-500">{team.teamShort}</div>}
        </td>
        <td className="px-4 py-3 text-sm text-gray-400">{team.division ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-gray-400">{team.conference ?? '—'}</td>
        <td className="px-4 py-3 text-sm text-gray-400">
          {tab === 'linked'
            ? <>
                <div className="text-gray-200">{team.organizationName}</div>
                <div className="text-xs text-gray-500">
                  {team.matchStatus === 'confirmed' ? `by ${team.matchedBy}` : `matched: ${team.matchNote ?? ''}`}
                </div>
              </>
            : team.matchNote ?? '—'}
        </td>
        <td className="px-4 py-3 text-sm text-right whitespace-nowrap">
          {tab === 'linked' || tab === 'ignored' ? (
            <button disabled={busy} onClick={() => act(() => unlinkTeam(team.ustfcccaTeamId))}
              className="px-2.5 py-1 rounded border border-gray-700 hover:border-gray-500 text-gray-300 disabled:opacity-50">
              {tab === 'linked' ? 'Unlink' : 'Back to matching'}
            </button>
          ) : (
            <span className="inline-flex gap-2">
              <button disabled={busy} onClick={() => (open ? setOpen(false) : show())}
                className="px-2.5 py-1 rounded border border-gray-700 hover:border-gray-500 text-gray-300 disabled:opacity-50">
                {open ? 'Close' : 'Choose…'}
              </button>
              <button disabled={busy} onClick={() => act(() => ignoreTeam(team.ustfcccaTeamId))}
                className="px-2.5 py-1 rounded text-gray-500 hover:text-gray-300 disabled:opacity-50">
                Not ours
              </button>
            </span>
          )}
          {error && <div className="text-xs text-red-400 mt-1 whitespace-normal">{error}</div>}
        </td>
      </tr>
      {open && (
        <tr className="border-b border-gray-800/60 bg-gray-950/40">
          <td colSpan={5} className="px-4 py-3">
            <input
              value={query}
              onChange={(e) => search(e.target.value)}
              placeholder="Search every college by name"
              className="w-full max-w-md mb-3 px-3 py-1.5 rounded bg-gray-900 border border-gray-700 text-sm text-gray-200 placeholder:text-gray-600"
            />
            {options == null ? <div className="text-sm text-gray-500">Looking…</div>
              : options.length === 0 ? <div className="text-sm text-gray-500">Nothing here looks like it. Add the school under Organizations, then Match again.</div>
              : (
                <ul className="space-y-1">
                  {options.map((o) => (
                    <li key={o.id} className="flex items-center gap-3 text-sm">
                      <button disabled={busy} onClick={() => act(() => linkTeam(team.ustfcccaTeamId, o.id))}
                        className="px-2.5 py-0.5 rounded bg-blue-600 hover:bg-blue-500 text-white disabled:opacity-50">
                        Link
                      </button>
                      <span className="text-gray-200">{o.name}</span>
                      <span className="text-gray-500">{[o.division, o.conference, o.state].filter(Boolean).join(' · ')}</span>
                      {o.score != null && <span className="text-xs text-gray-600">{o.score} · {o.why}</span>}
                    </li>
                  ))}
                </ul>
              )}
          </td>
        </tr>
      )}
    </>
  );
}
