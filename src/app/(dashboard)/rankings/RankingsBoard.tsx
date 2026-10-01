'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import Logo from './Logo';
import type { BoardChoice, BoardList, BoardRow } from './actions';

/**
 * The current rankings, one division, gender and kind at a time.
 *
 * Every current list comes down with the page, so choosing another one is
 * immediate and happens here rather than as a navigation: the address bar is
 * kept in step, so a link or a reload still opens the same list.
 */
export default function RankingsBoard({ choices, lists, initial }: {
  choices: BoardChoice[];
  lists: BoardList[];
  initial: { div?: string; g?: string; kind?: string };
}) {
  const divisions = useMemo(() => [...new Map(choices.map((c) => [c.divisionId, c.divisionName])).entries()], [choices]);

  // A choice that does not exist for this division falls back to the first that does.
  const resolve = (div: number | string | undefined, g: string | undefined, kind: string | undefined) => {
    const divisionId = divisions.find(([id]) => String(id) === String(div))?.[0] ?? divisions[0][0];
    const genders = [...new Set(choices.filter((c) => c.divisionId === divisionId).map((c) => c.gender))];
    const gender = genders.find((x) => x === g) ?? genders[0];
    const kinds = [...new Set(choices.filter((c) => c.divisionId === divisionId && c.gender === gender).map((c) => c.kind))];
    return { divisionId, gender, kind: kinds.find((x) => x === kind) ?? kinds[0], genders, kinds };
  };

  const [sel, setSel] = useState(() => resolve(initial.div, initial.g, initial.kind));
  const choose = (p: { div?: number; g?: string; kind?: string }) => {
    const next = resolve(p.div ?? sel.divisionId, p.g ?? sel.gender, p.kind ?? sel.kind);
    setSel(next);
    window.history.replaceState(null, '', `/rankings?tab=rankings&div=${next.divisionId}&g=${next.gender}&kind=${next.kind}`);
  };

  const shown = lists.filter((l) => l.divisionId === sel.divisionId && l.gender === sel.gender && l.kind === sel.kind);
  const all = shown.flatMap((l) => l.rows);
  const linked = all.filter((r) => r.organizationId).length;
  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs transition-colors ${active ? 'bg-gray-200 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
        <div className="flex flex-wrap gap-1">
          {divisions.map(([id, name]) => (
            <button key={id} onClick={() => choose({ div: id })} className={chip(id === sel.divisionId)}>{name}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['men', 'women'] as const).filter((x) => sel.genders.includes(x)).map((x) => (
            <button key={x} onClick={() => choose({ g: x })} className={chip(x === sel.gender)}>{x === 'men' ? 'Men' : 'Women'}</button>
          ))}
        </div>
        <div className="flex gap-1">
          {(['national', 'regional'] as const).filter((x) => sel.kinds.includes(x)).map((x) => (
            <button key={x} onClick={() => choose({ kind: x })} className={chip(x === sel.kind)}>{x === 'national' ? 'National' : 'Regional'}</button>
          ))}
        </div>
        <span className={`text-xs ${linked === all.length ? 'text-emerald-400' : 'text-amber-300'}`}>
          {linked} of {all.length} on {shown.length === 1 ? 'this list' : 'these lists'} linked
        </span>
      </div>

      {sel.kind === 'national' ? (
        <div className="max-w-3xl">{shown.map((l) => <ListCard key={l.id} list={l} national />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {shown.map((l) => <ListCard key={l.id} list={l} national={false} />)}
        </div>
      )}
    </div>
  );
}

const weekName = (w: number) => (w === 0 ? 'Preseason' : w === 99 ? 'Final' : `Week ${w}`);

function released(iso: string | null): string {
  if (!iso) return '';
  return new Date(iso).toLocaleDateString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric' });
}

function ListCard({ list, national }: { list: BoardList; national: boolean }) {
  const title = list.regionName
    ? list.regionName.replace(/\s*\(.*\)$/, '')
    : `${list.title} ${list.listType === 'ranking' ? 'National Ranking' : 'Coaches’ Poll'}`;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-gray-800">
        <div className="text-sm font-semibold text-gray-200">{title}</div>
        <div className="text-xs text-gray-500 whitespace-nowrap">{weekName(list.week)} · {released(list.releasedAt)}</div>
      </div>
      <table className="w-full">
        <tbody>
          {list.rows.map((r) => <RankRow key={r.ustfcccaTeamId} r={r} national={national} />)}
        </tbody>
      </table>
    </div>
  );
}

function Move({ r }: { r: BoardRow }) {
  if (r.isRv) return null;
  if (r.prevIsRv || r.prevRank == null) return <span className="text-[11px] text-sky-400">new</span>;
  if (!r.rankChange) return <span className="text-[11px] text-gray-600">–</span>;
  return r.rankChange > 0
    ? <span className="text-[11px] text-emerald-400">▲{r.rankChange}</span>
    : <span className="text-[11px] text-red-400">▼{-r.rankChange}</span>;
}

function RankRow({ r, national }: { r: BoardRow; national: boolean }) {
  const name = r.organizationName ?? r.teamShort ?? r.teamName;
  const status = r.organizationId ? null : r.matchStatus === 'review' ? 'review' : r.matchStatus === 'ignored' ? 'ignored' : 'unmatched';
  return (
    <tr className={`border-b border-gray-800/60 last:border-0 ${r.isRv ? 'opacity-70' : ''}`}>
      <td className="pl-4 pr-2 py-1.5 w-10 text-right text-sm tabular-nums text-gray-300">{r.isRv ? 'RV' : r.rank}</td>
      <td className="px-1 py-1.5 w-9 text-center tabular-nums"><Move r={r} /></td>
      <td className="px-2 py-1.5 w-9"><Logo url={r.logoUrl} darkUrl={r.logoDarkUrl} name={name} size={26} /></td>
      <td className="px-2 py-1.5 min-w-0">
        <div className="text-sm text-gray-100 truncate" title={`USTFCCCA: ${r.teamName}`}>{name}</div>
        {r.conference && <div className="text-[11px] text-gray-500 truncate">{r.conference}</div>}
      </td>
      <td className="px-2 py-1.5 text-right whitespace-nowrap">
        {status ? (
          <Link href={`/rankings?tab=${status}`}
            className={`text-[11px] px-1.5 py-0.5 rounded ${status === 'review' ? 'bg-amber-500/20 text-amber-300' : status === 'ignored' ? 'bg-gray-800 text-gray-500' : 'bg-red-500/15 text-red-300'}`}>
            {status === 'review' ? 'Review' : status === 'ignored' ? 'Set aside' : 'Not found'}
          </Link>
        ) : national && r.score != null ? (
          <span className="text-xs text-gray-500 tabular-nums">
            {r.score}{r.firstPlaceVotes ? <span className="text-gray-600"> ({r.firstPlaceVotes})</span> : null}
          </span>
        ) : null}
      </td>
    </tr>
  );
}
