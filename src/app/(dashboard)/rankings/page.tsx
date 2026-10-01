import Link from 'next/link';
import { requireAdmin } from '@/lib/admin-auth';
import {
  autoPullState, boardChoices, boardLists, rankingSummary, teamsFor,
  type BoardList, type BoardRow, type TeamTab,
} from './actions';
import Controls from './Controls';
import Logo from './Logo';
import ReviewList from './ReviewList';

export const dynamic = 'force-dynamic';
// "Pull now" runs here: reading, storing and matching five hundred teams.
export const maxDuration = 60;

type Tab = 'rankings' | TeamTab;

interface PageProps {
  searchParams: Promise<{ tab?: string; div?: string; g?: string; kind?: string }>;
}

function when(value: Date | string | null, withTime = true): string {
  if (!value) return 'never';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString('en-US', {
    timeZone: 'America/New_York', month: 'short', day: 'numeric',
    ...(withTime ? { hour: 'numeric', minute: '2-digit' } : {}),
  }) + (withTime ? ' ET' : '');
}

const weekName = (w: number) => (w === 0 ? 'Preseason' : w === 99 ? 'Final' : `Week ${w}`);

/**
 * Cross country polls and rankings from the USTFCCCA: read every afternoon,
 * kept week by week, and each ranked team linked once to one of our schools -
 * which is what lets a desk show its meet's schools' rankings.
 *
 * The Rankings tab is the lists themselves with our school beside each team,
 * logo and all, so it is plain at a glance whether the links are right. The
 * other tabs are the teams by where they stand: waiting for a person, not
 * found, linked, or set aside.
 */
export default async function RankingsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const sp = await searchParams;
  const [summary, choices, autoPull] = await Promise.all([rankingSummary(), boardChoices(), autoPullState()]);
  const tab: Tab = (['rankings', 'review', 'unmatched', 'linked', 'ignored'] as const).find((t) => t === sp.tab) ?? 'rankings';

  const last = summary.pulls[0];
  const counts: Record<Tab, number | null> = {
    rankings: null, review: summary.review, unmatched: summary.unmatched, linked: summary.linked, ignored: summary.ignored,
  };
  const TABS: Array<[Tab, string]> = [
    ['rankings', 'Rankings'], ['review', 'To review'], ['unmatched', 'Not found'], ['linked', 'Linked'], ['ignored', 'Set aside'],
  ];

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4 mb-5">
        <div>
          <h1 className="text-2xl font-bold">XC Rankings</h1>
          <p className="text-sm text-gray-500 mt-1 max-w-2xl">
            USTFCCCA coaches&apos; polls and regional rankings, read every afternoon and kept week by week.
            Each ranked team is linked once to one of our schools; a desk then shows its meet&apos;s schools&apos; rankings.
          </p>
        </div>
        <div className="text-right text-xs text-gray-500 space-y-0.5">
          <div>
            Last read{' '}
            <span className={last?.status === 'failed' ? 'text-red-400' : 'text-gray-300'}>
              {last ? `${when(last.startedAt)} · ${last.status === 'failed' ? 'failed' : last.status === 'running' ? 'running' : last.status === 'unchanged' ? 'no change' : 'updated'}` : 'never'}
            </span>
          </div>
          <div>{summary.currentLists} current lists{summary.newestRelease ? ` · newest ${when(summary.newestRelease)}` : ''}</div>
          <div>{summary.linked} of {summary.linked + summary.review + summary.unmatched + summary.ignored} teams linked</div>
          {last?.status === 'failed' && last.error && <div className="text-red-400/80 max-w-sm">{last.error}</div>}
        </div>
      </div>

      <div className="mb-5">
        <Controls autoPull={{ on: autoPull.on, by: autoPull.updatedBy, at: autoPull.updatedAt ? String(autoPull.updatedAt) : null }} />
      </div>

      <div className="flex items-center gap-1 mb-4 border-b border-gray-800">
        {TABS.map(([value, label]) => (
          <Link key={value} href={`/rankings?tab=${value}`}
            className={`px-3 py-2 -mb-px text-sm border-b-2 transition-colors ${
              tab === value ? 'border-blue-500 text-gray-100' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
            {label}
            {counts[value] ? (
              <span className={`ml-1.5 text-xs px-1.5 rounded ${value === 'review' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500'}`}>
                {counts[value]}
              </span>
            ) : null}
          </Link>
        ))}
      </div>

      {tab === 'rankings'
        ? <Board choices={choices} div={sp.div} g={sp.g} kind={sp.kind} />
        : <ReviewList tab={tab} teams={await teamsFor(tab)} />}

      <p className="text-xs text-gray-600 mt-8">
        Source: USTFCCCA Coaches&apos; Polls and Rankings. Shown anywhere, they are attributed to the USTFCCCA.
      </p>
    </div>
  );
}

// ── The lists ────────────────────────────────────────────────────────────────

async function Board({ choices, div, g, kind }: {
  choices: Awaited<ReturnType<typeof boardChoices>>; div?: string; g?: string; kind?: string;
}) {
  if (!choices.length) {
    return <div className="text-sm text-gray-500 py-10 text-center">No rankings have been read yet. Use Pull now.</div>;
  }
  const divisions = [...new Map(choices.map((c) => [c.divisionId, c.divisionName])).entries()];
  const divisionId = divisions.find(([id]) => String(id) === div)?.[0] ?? divisions[0][0];
  const genders = [...new Set(choices.filter((c) => c.divisionId === divisionId).map((c) => c.gender))];
  const gender = genders.find((x) => x === g) ?? genders[0];
  const kinds = [...new Set(choices.filter((c) => c.divisionId === divisionId && c.gender === gender).map((c) => c.kind))];
  const k = kinds.find((x) => x === kind) ?? kinds[0];
  const lists = await boardLists(divisionId, gender, k);

  const href = (p: { div?: number; g?: string; kind?: string }) =>
    `/rankings?tab=rankings&div=${p.div ?? divisionId}&g=${p.g ?? gender}&kind=${p.kind ?? k}`;
  const chip = (active: boolean) =>
    `px-2.5 py-1 rounded text-xs transition-colors ${active ? 'bg-gray-200 text-gray-900' : 'bg-gray-800 text-gray-400 hover:text-gray-200'}`;

  const all = lists.flatMap((l) => l.rows);
  const linked = all.filter((r) => r.organizationId).length;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 mb-4">
        <div className="flex flex-wrap gap-1">
          {divisions.map(([id, name]) => (
            <Link key={id} href={href({ div: id, g: gender, kind: k })} className={chip(id === divisionId)}>{name}</Link>
          ))}
        </div>
        <div className="flex gap-1">
          {(['men', 'women'] as const).filter((x) => genders.includes(x)).map((x) => (
            <Link key={x} href={href({ g: x })} className={chip(x === gender)}>{x === 'men' ? 'Men' : 'Women'}</Link>
          ))}
        </div>
        <div className="flex gap-1">
          {(['national', 'regional'] as const).filter((x) => kinds.includes(x)).map((x) => (
            <Link key={x} href={href({ kind: x })} className={chip(x === k)}>{x === 'national' ? 'National' : 'Regional'}</Link>
          ))}
        </div>
        <span className={`text-xs ${linked === all.length ? 'text-emerald-400' : 'text-amber-300'}`}>
          {linked} of {all.length} on {lists.length === 1 ? 'this list' : 'these lists'} linked
        </span>
      </div>

      {k === 'national' ? (
        <div className="max-w-3xl">{lists.map((l) => <ListCard key={l.id} list={l} national />)}</div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
          {lists.map((l) => <ListCard key={l.id} list={l} national={false} />)}
        </div>
      )}
    </div>
  );
}

function ListCard({ list, national }: { list: BoardList; national: boolean }) {
  const title = list.regionName ? list.regionName.replace(/\s*\(.*\)$/, '') : `${list.title} ${list.listType === 'ranking' ? 'National Ranking' : 'Coaches’ Poll'}`;
  return (
    <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-hidden">
      <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 border-b border-gray-800">
        <div className="text-sm font-semibold text-gray-200">{title}</div>
        <div className="text-xs text-gray-500 whitespace-nowrap">{weekName(list.week)} · {when(list.releasedAt, false)}</div>
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
