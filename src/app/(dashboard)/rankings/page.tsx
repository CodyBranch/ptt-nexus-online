import Link from 'next/link';
import { Suspense } from 'react';
import { requireAdmin } from '@/lib/admin-auth';
import {
  allBoardLists, autoPullState, pageHead, teamsFor,
  type BoardChoice, type TeamTab,
} from './actions';
import RankingsBoard from './RankingsBoard';
import Controls from './Controls';
import ReviewList from './ReviewList';
import ListSkeleton from './ListSkeleton';

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
  const [summary, autoPull] = await Promise.all([pageHead(), autoPullState()]);
  const choices = summary.choices;
  const tab: Tab = (['rankings', 'review', 'unmatched', 'linked', 'ignored'] as const).find((t) => t === sp.tab) ?? 'rankings';

  const last = summary.last;
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

      {/* The lists stream in under the header: keyed on the tab, so a change
          of tab shows the placeholder at once rather than the old list
          sitting there until the new one is ready. */}
      <Suspense key={tab} fallback={<ListSkeleton rows={tab === 'rankings' ? 12 : 8} />}>
        {tab === 'rankings'
          ? <Board choices={choices} div={sp.div} g={sp.g} kind={sp.kind} />
          : <ReviewTab tab={tab} />}
      </Suspense>

      <p className="text-xs text-gray-600 mt-8">
        Source: USTFCCCA Coaches&apos; Polls and Rankings. Shown anywhere, they are attributed to the USTFCCCA.
      </p>
    </div>
  );
}

async function ReviewTab({ tab }: { tab: TeamTab }) {
  return <ReviewList tab={tab} teams={await teamsFor(tab)} />;
}

// ── The lists ────────────────────────────────────────────────────────────────

async function Board({ choices, div, g, kind }: {
  choices: BoardChoice[]; div?: string; g?: string; kind?: string;
}) {
  if (!choices.length) {
    return <div className="text-sm text-gray-500 py-10 text-center">No rankings have been read yet. Use Pull now.</div>;
  }
  return <RankingsBoard choices={choices} lists={await allBoardLists()} initial={{ div, g, kind }} />;
}
