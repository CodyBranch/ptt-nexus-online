import Link from 'next/link';
import { notFound } from 'next/navigation';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
  declarationFinalizations,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';
import { closesAtOf, meetTimeZone, meetTime, type DeadlineRace } from '@/lib/declare-deadline';

export const dynamic = 'force-dynamic';

/**
 * One meet's declarations, as the coaches have left them.
 *
 * The races and when each closes; every school, how far it has got and which
 * races it has finalised; and, opened, each school's runners with the answer
 * against each. Read-only: the desk pulls these answers into the meet, and a
 * change belongs there (or with the coach), not here.
 */

interface Race extends DeadlineRace { name: string; gender: string; distanceLabel?: string }
interface Runner { id: string; firstName: string; lastName: string; bib?: string; gender?: string; year?: string }

const side = (g: string | undefined | null): 'M' | 'F' | 'X' => {
  const v = (g ?? '').trim().toUpperCase();
  if (v.startsWith('M') || v === 'B' || v.startsWith('BOY')) return 'M';
  if (v.startsWith('F') || v === 'W' || v === 'G' || v.startsWith('GIRL') || v.startsWith('WOM')) return 'F';
  return 'X';
};


export default async function DeclarationMeetPage({ params }: { params: Promise<{ id: string }> }) {
  await requireAdmin();
  const { id } = await params;

  const [session] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.id, id)).limit(1);
  if (!session) notFound();

  const races = JSON.parse(session.racesJson) as Race[];
  // On the meet's clock — this page is rendered on a server in UTC, which is
  // nobody's meet. The zone is named beside every time.
  const tz = meetTimeZone(races);
  const when = (d: Date | null): string => (d ? meetTime(d, tz, { month: 'short', day: 'numeric' }) : '—');
  const raceName = new Map(races.map((r) => [r.id, r.name]));
  const teams = (await db.select().from(teamDeclarationAccess)
    .where(eq(teamDeclarationAccess.meetSessionId, session.id)))
    .sort((a, b) => a.teamName.localeCompare(b.teamName));
  const answers = await db.select().from(declarationSubmissions)
    .where(eq(declarationSubmissions.meetSessionId, session.id));
  const finals = await db.select().from(declarationFinalizations)
    .where(eq(declarationFinalizations.meetSessionId, session.id));

  const words = session.genderTerms === 'men_women' ? { M: 'Men', F: 'Women', X: 'Open' } : { M: 'Boys', F: 'Girls', X: 'Open' };
  const now = new Date();

  const perRace = new Map<string, number>();
  for (const a of answers) if (a.status === 'declared' && a.raceId) perRace.set(a.raceId, (perRace.get(a.raceId) ?? 0) + 1);

  return (
    <div>
      <Link href="/declarations" className="text-sm text-gray-500 hover:text-gray-300">&larr; Declarations</Link>
      <h1 className="text-2xl font-bold mt-2">{session.meetName}</h1>
      <p className="text-sm text-gray-500 mb-6">
        {session.meetDate ?? 'No date'} · published {when(session.createdAt ? new Date(session.createdAt) : null)}
        {session.updatedAt && session.createdAt && new Date(session.updatedAt).getTime() - new Date(session.createdAt).getTime() > 60_000
          && ` · updated ${when(new Date(session.updatedAt))}`}
      </p>

      {/* ── Races and their cutoffs ── */}
      <h2 className="text-lg font-semibold mb-3 text-gray-300">Races</h2>
      <div className="bg-gray-900 border border-gray-800 rounded-xl overflow-x-auto mb-8">
        <table className="w-full">
          <thead>
            <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
              <th className="px-4 py-3">Race</th>
              <th className="px-4 py-3">Starts</th>
              <th className="px-4 py-3">Declarations close</th>
              <th className="px-4 py-3 text-right">Declared</th>
            </tr>
          </thead>
          <tbody>
            {races.map((r) => {
              const closes = closesAtOf(r);
              const closed = closes != null && closes.getTime() <= now.getTime();
              const start = r.scheduledTime ? new Date(r.scheduledTime) : null;
              return (
                <tr key={r.id} className="border-b border-gray-800/60">
                  <td className="px-4 py-3 text-sm">
                    <span className="font-medium text-gray-200">{r.name}</span>
                    <span className="ml-2 text-xs text-gray-600">{words[side(r.gender)]}</span>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-400">{start && !Number.isNaN(start.getTime()) ? when(start) : '—'}</td>
                  <td className="px-4 py-3 text-sm">
                    {closes == null ? <span className="text-gray-600">never</span>
                      : <span className={closed ? 'text-red-400' : 'text-gray-300'}>{closed ? 'closed ' : ''}{when(closes)}</span>}
                  </td>
                  <td className="px-4 py-3 text-sm text-right tabular-nums">{perRace.get(r.id) ?? 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* ── Schools ── */}
      <h2 className="text-lg font-semibold mb-3 text-gray-300">Schools</h2>
      <div className="space-y-2">
        {teams.map((t) => {
          const roster = JSON.parse(t.rosterJson) as Runner[];
          const mine = answers.filter((a) => a.teamAccessId === t.id);
          const byAthlete = new Map(mine.map((a) => [a.athleteId, a]));
          const done = finals.filter((f) => f.teamAccessId === t.id).map((f) => raceName.get(f.raceId) ?? f.raceId);
          const declared = mine.filter((a) => a.status === 'declared').length;
          const scratched = mine.filter((a) => a.status === 'scratched').length;
          const last = mine.reduce<Date | null>((m, a) => {
            const d = a.updatedAt ? new Date(a.updatedAt) : null;
            return d && (!m || d > m) ? d : m;
          }, null);
          const sorted = [...roster].sort((a, b) =>
            side(a.gender).localeCompare(side(b.gender)) || a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName));
          return (
            <details key={t.id} className="bg-gray-900 border border-gray-800 rounded-xl group">
              <summary className="px-4 py-3 cursor-pointer list-none flex flex-wrap items-center gap-x-6 gap-y-1">
                <span className="font-medium text-gray-200 min-w-[12rem]">{t.teamName}</span>
                <span className="text-sm tabular-nums">
                  {mine.length === 0
                    ? <span className="text-amber-400">not opened</span>
                    : <span className={mine.length >= roster.length ? 'text-green-400' : 'text-gray-300'}>{mine.length} of {roster.length} answered</span>}
                </span>
                <span className="text-sm text-gray-400 tabular-nums">{declared} running · {scratched} out</span>
                {done.length > 0 && <span className="text-xs text-green-400">finalised: {done.join(', ')}</span>}
                <span className="text-xs text-gray-600 ml-auto">{last ? `last ${when(last)}` : ''}</span>
              </summary>
              <div className="px-4 pb-4">
                <p className="text-xs text-gray-600 mb-2">
                  The school&rsquo;s form:{' '}
                  <a href={`/declare/${session.meetToken}/${t.teamToken}`} target="_blank" rel="noreferrer"
                    className="text-blue-400 hover:text-blue-300 font-mono break-all">
                    /declare/{session.meetToken}/{t.teamToken}
                  </a>
                  {' '}— anything changed there is changed as the coach.
                </p>
                <table className="w-full">
                  <thead>
                    <tr className="text-left text-xs text-gray-500 uppercase tracking-wider border-b border-gray-800">
                      <th className="py-2 pr-3 w-16">Bib</th>
                      <th className="py-2 pr-3">Name</th>
                      <th className="py-2 pr-3 w-16"></th>
                      <th className="py-2 pr-3 w-12">Yr</th>
                      <th className="py-2 pr-3">Answer</th>
                      <th className="py-2">When</th>
                    </tr>
                  </thead>
                  <tbody>
                    {sorted.map((r) => {
                      const a = byAthlete.get(r.id);
                      return (
                        <tr key={r.id} className="border-b border-gray-800/40 text-sm">
                          <td className="py-1.5 pr-3 font-mono text-gray-500">{r.bib ?? ''}</td>
                          <td className="py-1.5 pr-3 text-gray-200">{r.firstName} {r.lastName}</td>
                          <td className="py-1.5 pr-3 text-xs text-gray-600">{words[side(r.gender)]}</td>
                          <td className="py-1.5 pr-3 text-gray-500">{r.year ?? ''}</td>
                          <td className="py-1.5 pr-3">
                            {!a ? <span className="text-amber-400/80">no answer</span>
                              : a.status === 'scratched' ? <span className="text-red-300">not running</span>
                                : <span className="text-gray-200">{raceName.get(a.raceId ?? '') ?? 'a race'}</span>}
                          </td>
                          <td className="py-1.5 text-xs text-gray-600">{a?.updatedAt ? when(new Date(a.updatedAt)) : ''}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          );
        })}
      </div>
    </div>
  );
}
