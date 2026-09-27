import { db } from '@/db/client';
import { syncLogs, desktopApiKeys } from '@/db/schema';
import { desc, eq, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * What the desktop has been doing against this database.
 *
 * This page used to be a drawing: a table with headers and one row reading
 * "No sync operations yet", hard-coded, never querying anything. It said that
 * whether there had been none or a thousand — and it told people to go to
 * Settings and configure keys that were already configured and in daily use.
 *
 * There is a real table behind it, and two live desktop keys. Both are read
 * here now, so an empty state means empty rather than unwired.
 */

function ago(value: Date | string | null): string {
  if (!value) return 'never';
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) return 'never';
  const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h} hour${h === 1 ? '' : 's'} ago`;
  const days = Math.round(h / 24);
  return days < 30 ? `${days} day${days === 1 ? '' : 's'} ago` : d.toISOString().slice(0, 10);
}

export default async function SyncPage() {
  await requireAdmin();

  const rows = await db
    .select()
    .from(syncLogs)
    .orderBy(desc(syncLogs.startedAt))
    .limit(50);

  const [keys] = await db
    .select({
      active: sql<number>`count(*)::int`,
      lastUsedAt: sql<Date | null>`max(${desktopApiKeys.lastUsedAt})`.mapWith(desktopApiKeys.lastUsedAt),
    })
    .from(desktopApiKeys)
    .where(eq(desktopApiKeys.isActive, true));

  const active = keys?.active ?? 0;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">Sync</h1>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-6 mb-8">
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="text-sm text-gray-500 mb-1">Desktop keys</div>
          <div className="text-3xl font-bold text-gray-100 tabular-nums">{active}</div>
          <div className="text-xs text-gray-600 mt-2">
            {active === 0
              ? 'No desktop can reach this database'
              : `Last used ${ago(keys?.lastUsedAt ?? null)}`}
          </div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="text-sm text-gray-500 mb-1">Sync operations</div>
          <div className="text-3xl font-bold text-gray-100 tabular-nums">{rows.length}</div>
          <div className="text-xs text-gray-600 mt-2">Most recent 50</div>
        </div>
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="text-sm text-gray-500 mb-1">Last operation</div>
          <div className="text-xl font-bold text-gray-100">{ago(rows[0]?.startedAt ?? null)}</div>
          <div className="text-xs text-gray-600 mt-2">{rows[0]?.desktopMeetName ?? '—'}</div>
        </div>
      </div>

      <h2 className="text-lg font-semibold mb-4 text-gray-300">Recent Sync Operations</h2>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3">Direction</th>
              <th className="px-4 py-3">Type</th>
              <th className="px-4 py-3">Meet</th>
              <th className="px-4 py-3">Counts</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3">Started</th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-600 text-sm">
                  <p>Nothing has synced yet</p>
                  <p className="text-xs mt-1">
                    {active > 0
                      ? 'A desktop key exists, so a sync will appear here the first time one runs.'
                      : 'Create a desktop API key in Settings first.'}
                  </p>
                </td>
              </tr>
            ) : (
              rows.map((r) => {
                const counts = [
                  r.organizationsSynced ? `${r.organizationsSynced} orgs` : null,
                  r.recordSetsSynced ? `${r.recordSetsSynced} sets` : null,
                  r.recordsSynced ? `${r.recordsSynced} records` : null,
                  r.recordsBroken ? `${r.recordsBroken} broken` : null,
                ].filter(Boolean).join(' · ');
                const bad = r.status && r.status !== 'success' && r.status !== 'completed';
                return (
                  <tr key={r.id} className="border-b border-gray-800/60 last:border-0">
                    <td className="px-4 py-3 text-sm text-gray-300">{r.direction ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-300">{r.syncType ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">{r.desktopMeetName ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-gray-400 tabular-nums">{counts || '—'}</td>
                    <td className="px-4 py-3 text-sm">
                      <span className={`text-xs px-2 py-0.5 rounded ${
                        bad ? 'bg-red-950 text-red-300' : 'bg-emerald-950 text-emerald-300'
                      }`}>
                        {r.status ?? 'unknown'}
                      </span>
                      {r.errorMessage && (
                        <div className="text-xs text-red-400/80 mt-1 max-w-md truncate" title={r.errorMessage}>
                          {r.errorMessage}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-500 tabular-nums">{ago(r.startedAt)}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
