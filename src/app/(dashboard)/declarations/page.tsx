import Link from 'next/link';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
} from '@/db/schema';
import { desc, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

export const dynamic = 'force-dynamic';

/**
 * Every cross country meet published for coaches to declare into.
 *
 * The desk sees its own meet; this is the office's view across all of them:
 * which meets are live, how many schools each has, and how far the coaches
 * have got. Opening one shows its races, cutoffs, schools and every answer.
 */
export default async function DeclarationsPage() {
  await requireAdmin();

  const sessions = await db.select().from(meetDeclarationSessions)
    .orderBy(desc(meetDeclarationSessions.createdAt));

  const teamCounts = await db.select({
    sessionId: teamDeclarationAccess.meetSessionId,
    schools: sql<number>`count(*)::int`,
    runners: sql<number>`coalesce(sum(json_array_length(${teamDeclarationAccess.rosterJson}::json)), 0)::int`,
  }).from(teamDeclarationAccess).groupBy(teamDeclarationAccess.meetSessionId);

  const answerCounts = await db.select({
    sessionId: declarationSubmissions.meetSessionId,
    answered: sql<number>`count(*)::int`,
    declared: sql<number>`count(*) filter (where ${declarationSubmissions.status} = 'declared')::int`,
    scratched: sql<number>`count(*) filter (where ${declarationSubmissions.status} = 'scratched')::int`,
    lastAt: sql<Date | null>`max(${declarationSubmissions.updatedAt})`.mapWith(declarationSubmissions.updatedAt),
  }).from(declarationSubmissions).groupBy(declarationSubmissions.meetSessionId);

  const teamsOf = new Map(teamCounts.map((r) => [r.sessionId, r]));
  const answersOf = new Map(answerCounts.map((r) => [r.sessionId, r]));

  return (
    <div>
      <h1 className="text-2xl font-bold mb-1">Declarations</h1>
      <p className="text-sm text-gray-500 mb-6">
        Cross country meets published for coaches to declare and scratch their runners online.
      </p>

      {sessions.length === 0 ? (
        <div className="bg-gray-900 border border-gray-800 rounded-xl p-10 text-center text-sm text-gray-500">
          No meet has been published for coaches yet. The meet desk publishes one from its Declarations page.
        </div>
      ) : (
        <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto">
          <table className="w-full">
            <thead>
              <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                <th className="px-4 py-3">Meet</th>
                <th className="px-4 py-3">Date</th>
                <th className="px-4 py-3 text-right">Schools</th>
                <th className="px-4 py-3 text-right">Answered</th>
                <th className="px-4 py-3 text-right">Running</th>
                <th className="px-4 py-3 text-right">Out</th>
                <th className="px-4 py-3">Last answer</th>
              </tr>
            </thead>
            <tbody>
              {sessions.map((s) => {
                const t = teamsOf.get(s.id);
                const a = answersOf.get(s.id);
                const races = (JSON.parse(s.racesJson) as unknown[]).length;
                return (
                  <tr key={s.id} className="border-b border-gray-800/60 hover:bg-gray-800/40">
                    <td className="px-4 py-3">
                      <Link href={`/declarations/${s.id}`} className="text-blue-400 hover:text-blue-300 font-medium">
                        {s.meetName}
                      </Link>
                      <div className="text-xs text-gray-600">{races} race{races === 1 ? '' : 's'}</div>
                    </td>
                    <td className="px-4 py-3 text-sm text-gray-400">{s.meetDate ?? '—'}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">{t?.schools ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums">
                      {a?.answered ?? 0}
                      <span className="text-gray-600"> / {t?.runners ?? 0}</span>
                    </td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-300">{a?.declared ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-right tabular-nums text-gray-400">{a?.scratched ?? 0}</td>
                    <td className="px-4 py-3 text-sm text-gray-400">
                      {a?.lastAt ? new Date(a.lastAt).toLocaleString() : '—'}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
