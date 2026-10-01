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
          // A plain link, so a tab is a whole page load: it either arrives or
          // shows why not, where an in-page navigation could fail and leave
          // the old page sitting there.
          <a key={value} href={`/rankings?tab=${value}`}
            className={`px-3 py-2 -mb-px text-sm border-b-2 transition-colors ${
              tab === value ? 'border-blue-500 text-gray-100' : 'border-transparent text-gray-400 hover:text-gray-200'}`}>
            {label}
            {counts[value] ? (
              <span className={`ml-1.5 text-xs px-1.5 rounded ${value === 'review' ? 'bg-amber-500/20 text-amber-300' : 'text-gray-500'}`}>
                {counts[value]}
              </span>
            ) : null}
          </a>
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
  let teams: Awaited<ReturnType<typeof teamsFor>>;
  try {
    teams = await teamsFor(tab);
  } catch (e) {
    return <LoadFailed what="this list" error={e} />;
  }
  return <ReviewList tab={tab} teams={teams} />;
}

/**
 * Said on the page, with the reason. In production a failure in here would
 * otherwise show as nothing at all - Next hides server errors from the
 * browser - which is no help to anybody working out what went wrong.
 */
function LoadFailed({ what, error }: { what: string; error: unknown }) {
  console.error(`[rankings] could not load ${what}:`, error);
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div className="bg-red-950/30 border border-red-900/60 rounded-xl px-4 py-4 text-sm">
      <div className="text-red-300 font-medium">Could not load {what}.</div>
      <div className="text-red-300/70 mt-1 font-mono text-xs break-all">{msg}</div>
      <div className="text-gray-500 mt-2">Reload to try again. If it keeps happening, send this message on.</div>
    </div>
  );
}

// ── The lists ────────────────────────────────────────────────────────────────

async function Board({ choices, div, g, kind }: {
  choices: BoardChoice[]; div?: string; g?: string; kind?: string;
}) {
  if (!choices.length) {
    return <div className="text-sm text-gray-500 py-10 text-center">No rankings have been read yet. Use Pull now.</div>;
  }
  let lists: Awaited<ReturnType<typeof allBoardLists>>;
  try {
    lists = await allBoardLists();
  } catch (e) {
    return <LoadFailed what="the rankings" error={e} />;
  }
  return <RankingsBoard choices={choices} lists={lists} initial={{ div, g, kind }} />;
}
