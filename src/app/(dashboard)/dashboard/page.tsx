import { getDashboardData } from './actions';

export const dynamic = 'force-dynamic';

/**
 * The first screen after signing in.
 *
 * It used to be a mock: three cards reading 0, and a panel saying "No recent
 * activity", none of it connected to anything. The database had 2,834
 * organizations at the time. A hard-coded zero is worse than an empty space —
 * it reports that the system is empty, and the first thing anybody does is go
 * looking for the fault.
 *
 * What it shows now is ordered by what somebody can act on. The submissions
 * queue is first because it is the only thing here that is waiting on a
 * person; counts come after; activity last, because it is a record of what
 * already happened.
 */

function Stat({ label, value, hint, href }: {
  label: string; value: string | number; hint?: string; href?: string;
}) {
  const body = (
    <div className="bg-gray-900 border border-gray-800 rounded-xl p-6 h-full transition-colors hover:border-gray-700">
      <div className="text-sm text-gray-500 mb-1">{label}</div>
      <div className="text-3xl font-bold text-gray-100 tabular-nums">{value}</div>
      {hint && <div className="text-xs text-gray-600 mt-2">{hint}</div>}
    </div>
  );
  return href ? <a href={href} className="block">{body}</a> : body;
}

function timeAgo(d: Date): string {
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  if (days < 30) return `${days} day${days === 1 ? '' : 's'} ago`;
  return d.toISOString().slice(0, 10);
}

export default async function DashboardPage() {
  const d = await getDashboardData();
  const coverage = d.organizations.total
    ? Math.round((d.organizations.withLogo / d.organizations.total) * 100)
    : 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Dashboard</h1>

      {/* The only thing on this page that is waiting on a person. */}
      {d.submissions.pending > 0 && (
        <a
          href="/submissions"
          className="block mb-6 rounded-xl border border-amber-700/50 bg-amber-950/30 p-5 transition-colors hover:border-amber-600"
        >
          <div className="flex items-baseline gap-3 flex-wrap">
            <span className="text-2xl font-bold text-amber-300 tabular-nums">{d.submissions.pending}</span>
            <span className="text-amber-200 font-medium">
              school{d.submissions.pending === 1 ? '' : 's'} waiting to be reviewed
            </span>
            <span className="text-xs text-amber-200/60">
              sent up from meets where nothing in the database matched
            </span>
          </div>
          {d.submissions.recent.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {d.submissions.recent.map((s) => (
                <span key={s.id} className="text-xs px-2 py-1 rounded bg-amber-900/40 text-amber-100/90">
                  {s.name}
                  {s.state ? <span className="text-amber-200/50"> · {s.state}</span> : null}
                  {s.timesSeen > 1 ? <span className="text-amber-200/50"> · seen {s.timesSeen}×</span> : null}
                </span>
              ))}
            </div>
          )}
        </a>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
        <Stat
          label="Organizations"
          value={d.organizations.total.toLocaleString()}
          hint="Schools, colleges and clubs"
          href="/organizations"
        />
        <Stat
          label="With a usable logo"
          value={`${coverage}%`}
          hint={
            d.organizations.missingLogo > 0
              ? `${d.organizations.missingLogo.toLocaleString()} still without one`
              : 'Every organization has one'
          }
          href="/organizations"
        />
        <Stat
          label="Record sets"
          value={d.records.sets}
          hint={d.records.total > 0 ? `${d.records.total.toLocaleString()} records` : 'No records entered yet'}
          href="/records"
        />
        <Stat
          label="Desktop keys"
          value={d.keys.active}
          hint={d.keys.lastUsedAt ? `Last used ${timeAgo(d.keys.lastUsedAt)}` : 'Never used'}
          href="/settings"
        />
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4 text-gray-300">Quick Actions</h2>
        <div className="flex flex-wrap gap-3">
          <a href="/organizations/new" className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg transition-colors">
            + Add Organization
          </a>
          {d.submissions.pending > 0 && (
            <a href="/submissions" className="px-4 py-2 bg-amber-700 hover:bg-amber-600 text-white text-sm rounded-lg transition-colors">
              Review {d.submissions.pending} submission{d.submissions.pending === 1 ? '' : 's'}
            </a>
          )}
          <a href="/records/new" className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors">
            + New Record Set
          </a>
          <a href="/tags" className="px-4 py-2 bg-gray-700 hover:bg-gray-600 text-white text-sm rounded-lg transition-colors">
            Manage tags
          </a>
        </div>
      </div>

      <div className="mt-8">
        <h2 className="text-lg font-semibold mb-4 text-gray-300">Recent Activity</h2>
        {d.activity.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-600">
            <p>Nothing has changed yet</p>
            <p className="text-sm mt-1">Edits and desktop syncs will appear here</p>
          </div>
        ) : (
          <div className="bg-gray-900 border border-gray-800 rounded-xl divide-y divide-gray-800">
            {d.activity.map((a, i) => (
              <div key={i} className="flex items-baseline gap-3 px-5 py-3">
                <span
                  className={`text-[10px] uppercase tracking-wider px-2 py-0.5 rounded shrink-0 ${
                    a.kind === 'sync' ? 'bg-blue-950 text-blue-300' : 'bg-gray-800 text-gray-400'
                  }`}
                >
                  {a.kind === 'sync' ? 'sync' : 'edit'}
                </span>
                <span className="text-sm text-gray-200 truncate">{a.title}</span>
                {a.detail && <span className="text-xs text-gray-500 truncate">{a.detail}</span>}
                <span className="text-xs text-gray-600 ml-auto shrink-0 tabular-nums">{timeAgo(a.at)}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
