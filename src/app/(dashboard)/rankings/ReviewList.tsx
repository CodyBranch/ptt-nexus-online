'use client';

import { useState, useTransition } from 'react';
import { useRouter } from 'next/navigation';
import Logo from './Logo';
import { explainFailure } from './explain';
import {
  ignoreTeam, linkMany, linkTeam, searchColleges, unlinkTeam,
  type Suggestion, type TeamRow, type TeamTab,
} from './actions';

/**
 * The teams on one tab, each with what can be done about it.
 *
 * A team waiting for review shows the matcher's best guess beside it, logo
 * and all, so most of them are one click: Link. "Other…" opens the next
 * guesses and a search for when the guess is wrong. A row that has been dealt
 * with goes at once rather than waiting for the page to redraw.
 */
export default function ReviewList({ tab, teams }: { tab: TeamTab; teams: TeamRow[] }) {
  const [done, setDone] = useState<Set<number>>(new Set());
  const [busy, start] = useTransition();
  const [bulkNote, setBulkNote] = useState<string | null>(null);
  const router = useRouter();
  const shown = teams.filter((t) => !done.has(t.ustfcccaTeamId));
  const finish = (id: number) => setDone((s) => new Set(s).add(id));

  // Only strong guesses go in one go: below this the first guess is as often
  // a neighbour (Stanislaus State's is Chico) as the school itself.
  const STRONG = 75;
  const withGuess = shown.filter((t) => (t.suggestions[0]?.score ?? 0) >= STRONG);
  const acceptAll = () => {
    if (!window.confirm(`Link ${withGuess.length} teams to the school suggested for each (every suggestion scored ${STRONG} or more)? Look down the list first: this is ${withGuess.length} links in one go.`)) return;
    setBulkNote(`Linking ${withGuess.length}…`);
    start(async () => {
      try {
        const r = await linkMany(withGuess.map((t) => ({ ustfcccaTeamId: t.ustfcccaTeamId, organizationId: t.suggestions[0].id })));
        setBulkNote(`Linked ${r.linked}.${r.errors.length ? ` ${r.errors.length} could not be: ${r.errors[0]}` : ''}`);
        router.refresh();
      } catch (e) {
        setBulkNote(explainFailure(e));
      }
    });
  };

  if (!shown.length) {
    return (
      <div className="bg-gray-900 border border-gray-800 rounded-xl px-4 py-12 text-center text-sm text-gray-500">
        {tab === 'review' ? 'Nothing is waiting for a person.' : tab === 'unmatched' ? 'Every ranked team has been found.' : 'None.'}
      </div>
    );
  }

  return (
    <div>
      {tab === 'review' && withGuess.length > 1 && (
        <div className="flex items-center gap-3 mb-3 text-sm">
          <button onClick={acceptAll} disabled={busy}
            className="px-3 py-1.5 rounded border border-gray-700 hover:border-gray-500 text-gray-300 disabled:opacity-50">
            Accept the {withGuess.length} strong suggestions ({STRONG}+)
          </button>
          {bulkNote && <span className="text-gray-400">{bulkNote}</span>}
        </div>
      )}
      <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800">
        {shown.map((t) => <Row key={t.ustfcccaTeamId} team={t} tab={tab} onDone={() => finish(t.ustfcccaTeamId)} />)}
      </div>
    </div>
  );
}

function TeamCell({ team }: { team: TeamRow }) {
  return (
    <div className="min-w-0">
      <div className="text-sm text-gray-100 truncate" title={team.teamName}>{team.teamShort || team.teamName}</div>
      <div className="text-xs text-gray-500 truncate">
        {[team.teamShort && team.teamShort !== team.teamName ? team.teamName : null, team.division, team.conference].filter(Boolean).join(' · ')}
      </div>
      {team.standing && (
        <span className="inline-block mt-1 text-[11px] px-1.5 py-0.5 rounded bg-gray-800 text-gray-300">{team.standing}</span>
      )}
    </div>
  );
}

function SchoolCell({ s, note }: { s: Pick<Suggestion, 'name' | 'logoUrl' | 'logoDarkUrl' | 'division' | 'conference' | 'state'>; note?: string | null }) {
  return (
    <div className="flex items-center gap-2.5 min-w-0">
      <Logo url={s.logoUrl} darkUrl={s.logoDarkUrl} name={s.name} />
      <div className="min-w-0">
        <div className="text-sm text-gray-200 truncate">{s.name}</div>
        <div className="text-xs text-gray-500 truncate">{note ?? [s.division, s.conference, s.state].filter(Boolean).join(' · ')}</div>
      </div>
    </div>
  );
}

function Row({ team, tab, onDone }: { team: TeamRow; tab: TeamTab; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [found, setFound] = useState<Suggestion[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();
  const best = team.suggestions[0];

  const act = (fn: () => Promise<{ ok: true } | { ok: false; error: string }>) => start(async () => {
    setError(null);
    try {
      const r = await fn();
      if (!r.ok) { setError(r.error); return; }
      // Gone from the list at once. No redraw of the page: that queued every
      // later click behind a second of server work.
      onDone();
    } catch (e) {
      setError(explainFailure(e));
    }
  });
  const search = (q: string) => {
    setQuery(q);
    if (q.trim().length < 2) { setFound(null); return; }
    start(async () => {
      try { setFound(await searchColleges(q)); } catch (e) { setError(explainFailure(e)); }
    });
  };

  const btn = 'px-2.5 py-1 rounded text-sm disabled:opacity-50';
  const options = found ?? team.suggestions.slice(1);

  return (
    <div className="px-4 py-3">
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1.3fr)_auto] items-center gap-4">
        <TeamCell team={team} />
        <span className="text-gray-600">→</span>
        {tab === 'linked' && team.organizationName ? (
          <SchoolCell
            s={{ name: team.organizationName, logoUrl: team.logoUrl, logoDarkUrl: team.logoDarkUrl, division: null, conference: null, state: null }}
            note={team.matchStatus === 'confirmed' ? `linked by ${team.matchedBy}` : `matched: ${team.matchNote ?? ''}`} />
        ) : tab === 'ignored' ? (
          <span className="text-sm text-gray-500">{team.matchNote ?? 'Set aside'}</span>
        ) : best ? (
          <SchoolCell s={best} note={`${best.why} · ${best.score}`} />
        ) : (
          <span className="text-sm text-gray-500">No school here looks like it. Search, or add it under Organizations.</span>
        )}
        <div className="flex items-center gap-1.5 justify-end whitespace-nowrap">
          {tab === 'linked' || tab === 'ignored' ? (
            <button disabled={busy} onClick={() => act(() => unlinkTeam(team.ustfcccaTeamId))}
              className={`${btn} border border-gray-700 hover:border-gray-500 text-gray-300`}>
              {tab === 'linked' ? 'Unlink' : 'Back to matching'}
            </button>
          ) : (
            <>
              {best && (
                <button disabled={busy} onClick={() => act(() => linkTeam(team.ustfcccaTeamId, best.id))}
                  className={`${btn} bg-blue-600 hover:bg-blue-500 text-white`}>
                  Link
                </button>
              )}
              <button disabled={busy} onClick={() => setOpen((o) => !o)}
                className={`${btn} border border-gray-700 hover:border-gray-500 text-gray-300`}>
                {open ? 'Close' : best ? 'Other…' : 'Search…'}
              </button>
              <button disabled={busy} onClick={() => act(() => ignoreTeam(team.ustfcccaTeamId))}
                className={`${btn} text-gray-500 hover:text-gray-300`}>
                Not ours
              </button>
            </>
          )}
        </div>
      </div>
      {error && <div className="text-xs text-red-400 mt-2">{error}</div>}
      {open && (
        <div className="mt-3 ml-1 pl-4 border-l border-gray-800">
          <input value={query} onChange={(e) => search(e.target.value)} autoFocus
            placeholder="Search every college by name"
            className="w-full max-w-md mb-2 px-3 py-1.5 rounded bg-gray-950 border border-gray-700 text-sm text-gray-200 placeholder:text-gray-600" />
          {options.length === 0 ? (
            <div className="text-sm text-gray-500 py-1">{found ? 'No college by that name.' : 'No other suggestions. Search above.'}</div>
          ) : (
            <ul className="space-y-1.5">
              {options.map((o) => (
                <li key={o.id} className="flex items-center gap-3">
                  <button disabled={busy} onClick={() => act(() => linkTeam(team.ustfcccaTeamId, o.id))}
                    className={`${btn} bg-gray-800 hover:bg-blue-600 text-gray-200 hover:text-white`}>
                    Link
                  </button>
                  <SchoolCell s={o} note={o.why ? `${[o.division, o.conference].filter(Boolean).join(' · ')} — ${o.why} · ${o.score}` : undefined} />
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
