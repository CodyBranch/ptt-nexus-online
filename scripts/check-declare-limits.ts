// A race's cap on runners per school holds on the coach portal's save route,
// one at a time and in a batch. LOCAL database only: DATABASE_URL must be the
// throwaway PGlite on 127.0.0.1:54330, never .env.local (production).
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/postgres npx tsx scripts/check-declare-limits.ts
import { randomUUID } from 'node:crypto';
if (!/127\.0\.0\.1:54330/.test(process.env.DATABASE_URL ?? '')) { console.error('refusing: not the local test database'); process.exit(1); }

async function main() {
  const { db } = await import('@/db/client');
  const { meetDeclarationSessions, teamDeclarationAccess } = await import('@/db/schema');
  const { NextRequest } = await import('next/server');
  const route = await import('@/app/api/declare/[meetToken]/[teamToken]/route');

  const meetToken = 'm' + randomUUID().slice(0, 8);
  const teamToken = 't' + randomUUID().slice(0, 8);
  const sessionId = randomUUID();
  const races = [
    { id: 'r-cap', name: "Women's B Race 6k", gender: 'F', closesAt: null, maxPerSchool: 2 },
    { id: 'r-open', name: "Women's Championship 6k", gender: 'F', closesAt: null },
  ];
  await db.insert(meetDeclarationSessions).values({ id: sessionId, meetToken, meetName: 'Cap check', racesJson: JSON.stringify(races) } as never);
  const roster = ['a1', 'a2', 'a3', 'a4', 'a5'].map((id) => ({ id, firstName: id, lastName: 'Runner', gender: 'F', eligibleRaceIds: ['r-cap', 'r-open'] }));
  await db.insert(teamDeclarationAccess).values({ meetSessionId: sessionId, teamToken, teamId: 'T1', teamName: 'Cap U', rosterJson: JSON.stringify(roster) } as never);

  const post = async (declarations: Array<{ athleteId: string; status: string; raceId: string | null }>) => {
    const req = new NextRequest(`http://local/api/declare/${meetToken}/${teamToken}`, { method: 'POST', body: JSON.stringify({ declarations }), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req, { params: Promise.resolve({ meetToken, teamToken }) });
    return res.json() as Promise<{ saved: number; rejected: string[]; reasons?: Record<string, string> }>;
  };
  const put = (athleteId: string, raceId: string | null) => ({ athleteId, status: raceId ? 'declared' : 'scratched', raceId });

  let fail = 0;
  const ok = (label: string, cond: boolean, detail?: unknown) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); if (!cond) fail++; };

  const one = await post([put('a1', 'r-cap')]);
  const two = await post([put('a2', 'r-cap')]);
  ok('up to the cap: accepted', one.saved === 1 && two.saved === 1);
  const three = await post([put('a3', 'r-cap')]);
  ok('one past it: refused, and says why', three.rejected.includes('a3') && /is full: 2 of 2/.test(three.reasons?.a3 ?? ''), three.reasons);
  const again = await post([put('a1', 'r-cap')]);
  ok('somebody already in it answered again: fine', again.saved === 1 && again.rejected.length === 0);
  const other = await post([put('a3', 'r-open'), put('a4', 'r-open'), put('a5', 'r-open')]);
  ok('a race with no cap takes everybody', other.saved === 3);
  const out = await post([put('a2', null)]);
  const inAfter = await post([put('a3', 'r-cap')]);
  ok('one scratched out of the full race: a place for another', out.saved === 1 && inAfter.saved === 1 && inAfter.rejected.length === 0);
  const batch = await post([put('a4', 'r-cap'), put('a5', 'r-cap')]);
  ok('a batch stops at the cap: both refused, the race already full', batch.saved === 0 && batch.rejected.length === 2 && Object.keys(batch.reasons ?? {}).length === 2, batch);
  await post([put('a1', 'r-open')]);
  const half = await post([put('a4', 'r-cap'), put('a5', 'r-cap')]);
  ok('a batch with one place left: the first in, the second refused', half.saved === 1 && half.rejected.join() === 'a5', half);

  console.log(fail ? `\n${fail} FAILED` : '\nAll good.');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
