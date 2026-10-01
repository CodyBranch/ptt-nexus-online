import { requireAdmin } from '@/lib/admin-auth';
import { rankingSummary, teamsFor, type TeamTab } from './actions';
import RankingsPanel from './RankingsPanel';

export const dynamic = 'force-dynamic';

interface PageProps {
  searchParams: Promise<{ tab?: string }>;
}

const TABS: Array<[TeamTab, string]> = [
  ['review', 'To review'],
  ['unmatched', 'Not found'],
  ['linked', 'Linked'],
  ['ignored', 'Set aside'],
];

function when(value: Date | string | null): string {
  if (!value) return 'never';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  return d.toLocaleString('en-US', { timeZone: 'America/New_York', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) + ' ET';
}

/**
 * Cross country polls and rankings, read from the USTFCCCA every day, and the
 * link from each ranked team to one of our organizations - which is what lets
 * a desk ask what its meet's schools are ranked.
 */
export default async function RankingsPage({ searchParams }: PageProps) {
  await requireAdmin();
  const { tab: raw } = await searchParams;
  const tab: TeamTab = (TABS.find(([t]) => t === raw)?.[0]) ?? 'review';
  const [summary, teams] = await Promise.all([rankingSummary(), teamsFor(tab)]);
  const last = summary.pulls[0];
  const lastGood = summary.pulls.find((p) => p.status !== 'failed');
  const counts: Record<TeamTab, number> = {
    review: summary.review, unmatched: summary.unmatched, linked: summary.linked, ignored: summary.ignored,
  };

  return (
    <div>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Rankings</h1>
        <p className="text-sm text-gray-500 mt-1 max-w-3xl">
          Cross country coaches&apos; polls and regional rankings from the USTFCCCA, read every afternoon
          and kept week by week. Each ranked team is linked to one of our organizations once; a desk then
          gets its meet&apos;s schools&apos; rankings by the organizations it already knows.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-sm text-gray-500 mb-1">Last read</div>
          <div className={`text-xl font-bold ${last?.status === 'failed' ? 'text-red-400' : 'text-gray-100'}`}>
            {last ? (last.status === 'failed' ? 'Failed' : last.status === 'unchanged' ? 'No change' : 'Updated') : 'Never'}
          </div>
          <div className="text-xs text-gray-600 mt-2">
            {last ? when(last.startedAt) : 'Use Pull now, or wait for the daily read'}
            {last?.status === 'failed' && last.error ? <span className="block text-red-400/80 mt-1">{last.error}</span> : null}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-sm text-gray-500 mb-1">Current lists</div>
          <div className="text-3xl font-bold text-gray-100 tabular-nums">{summary.currentLists}</div>
          <div className="text-xs text-gray-600 mt-2">
            {summary.newestRelease ? `Newest released ${when(summary.newestRelease)}` : 'None yet'}
            {lastGood && lastGood !== last ? ` · last worked ${when(lastGood.startedAt)}` : ''}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-sm text-gray-500 mb-1">Teams linked</div>
          <div className="text-3xl font-bold text-gray-100 tabular-nums">{summary.linked}</div>
          <div className="text-xs text-gray-600 mt-2">
            of {summary.linked + summary.review + summary.unmatched + summary.ignored} ranked teams
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
          <div className="text-sm text-gray-500 mb-1">Waiting for a person</div>
          <div className={`text-3xl font-bold tabular-nums ${summary.review ? 'text-amber-300' : 'text-gray-100'}`}>{summary.review}</div>
          <div className="text-xs text-gray-600 mt-2">{summary.unmatched} with nothing that looks like them</div>
        </div>
      </div>

      <div className="flex items-center gap-1 mb-4">
        {TABS.map(([value, label]) => (
          <a
            key={value}
            href={`/rankings?tab=${value}`}
            className={`px-3 py-1.5 rounded text-sm transition-colors ${
              tab === value ? 'bg-gray-700 text-gray-100' : 'text-gray-400 hover:text-gray-200'
            }`}
          >
            {label}
            {counts[value] > 0 && <span className="ml-1.5 text-xs text-gray-500">{counts[value]}</span>}
          </a>
        ))}
      </div>

      <RankingsPanel tab={tab} teams={teams} />

      <p className="text-xs text-gray-600 mt-8">
        Source: USTFCCCA Coaches&apos; Polls and Rankings. Shown anywhere, they are attributed to the USTFCCCA.
      </p>
    </div>
  );
}
