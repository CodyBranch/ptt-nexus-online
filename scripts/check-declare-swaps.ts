// Entered runners and alternates: an alternate in for a runner on the coach
// portal, the refusals around it, and Undo. LOCAL database only: DATABASE_URL
// must be the throwaway PGlite on 127.0.0.1:54330, never .env.local (production).
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/postgres npx tsx scripts/check-declare-swaps.ts
import { randomUUID } from 'node:crypto';
if (!/127\.0\.0\.1:54330/.test(process.env.DATABASE_URL ?? '')) { console.error('refusing: not the local test database'); process.exit(1); }

async function main() {
  const { db } = await import('@/db/client');
  const { meetDeclarationSessions, teamDeclarationAccess, declarationSubmissions, declarationFinalizations } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const { NextRequest } = await import('next/server');
  const route = await import('@/app/api/declare/[meetToken]/[teamToken]/route');
  const sync = await import('@/app/api/declare/[meetToken]/sync/route');

  const meetToken = 'm' + randomUUID().slice(0, 8);
  const teamToken = 't' + randomUUID().slice(0, 8);
  const sessionId = randomUUID();
  const races = [
    { id: 'r-men', name: "Men's 8k", gender: 'M', closesAt: null, maxPerSchool: 2 },
    { id: 'r-women', name: "Women's 5k", gender: 'F', closesAt: null },
  ];
  await db.insert(meetDeclarationSessions).values({ id: sessionId, meetToken, meetName: 'Swap check', racesJson: JSON.stringify(races) } as never);
  const roster = [
    { id: 'taj', firstName: 'Taj', lastName: 'Allen', bib: '245', gender: 'M', eligibleRaceIds: ['r-men'], status: 'entered', raceId: 'r-men' },
    { id: 'dev', firstName: 'Dev', lastName: 'Brown', bib: '246', gender: 'M', eligibleRaceIds: ['r-men'], status: 'entered', raceId: 'r-men' },
    { id: 'kofi', firstName: 'Kofi', lastName: 'Mensah', gender: 'M', eligibleRaceIds: ['r-men'], raceId: null, alternate: true },
    { id: 'jaden', firstName: 'Jaden', lastName: 'Laster', gender: 'M', eligibleRaceIds: ['r-men'], raceId: null, alternate: true },
    { id: 'aliyah', firstName: 'Aliyah', lastName: 'Mathis', gender: 'F', eligibleRaceIds: ['r-women'], raceId: null, alternate: true },
  ];
  const [access] = await db.insert(teamDeclarationAccess).values({ meetSessionId: sessionId, teamToken, teamId: 'T1', teamName: 'Grambling', rosterJson: JSON.stringify(roster) } as never).returning();

  const call = async (body: unknown) => {
    const req = new NextRequest(`http://local/api/declare/${meetToken}/${teamToken}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } });
    const res = await route.POST(req, { params: Promise.resolve({ meetToken, teamToken }) });
    return { status: res.status, json: await res.json() as Record<string, unknown> };
  };
  const answers = async () => new Map((await db.select().from(declarationSubmissions)
    .where(eq(declarationSubmissions.teamAccessId, access.id))).map((r) => [r.athleteId, r]));

  let fail = 0;
  const ok = (name: string, cond: boolean, detail?: unknown) => {
    console.log((cond ? '  ok   ' : '  FAIL ') + name + (detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''));
    if (!cond) fail++;
  };

  console.log('Alternates come in only by a swap');
  let r = await call({ declarations: [{ athleteId: 'kofi', status: 'declared', raceId: 'r-men' }] });
  ok('declaring an alternate straight in is refused, with the reason', (r.json.rejected as string[]).includes('kofi') && /swap/.test(String((r.json.reasons as Record<string, string>).kofi)), r.json);
  r = await call({ swap: { alternateId: 'aliyah', forAthleteId: 'taj' } });
  ok('an alternate who cannot run the race is refused', r.status === 409, r.json);
  r = await call({ swap: { alternateId: 'dev', forAthleteId: 'taj' } });
  ok('so is a runner who is not an alternate', r.status === 409, r.json);

  console.log('A swap');
  // The race is at its cap of 2: a swap is one in and one out, so it goes through.
  await call({ declarations: [{ athleteId: 'dev', status: 'declared', raceId: 'r-men' }, { athleteId: 'taj', status: 'declared', raceId: 'r-men' }] });
  r = await call({ swap: { alternateId: 'kofi', forAthleteId: 'taj' } });
  ok('the alternate goes in for an entered runner, in a full race', r.status === 200 && r.json.raceId === 'r-men', r.json);
  let a = await answers();
  ok('the alternate is declared in the race, in for the runner', a.get('kofi')?.status === 'declared' && a.get('kofi')?.raceId === 'r-men' && a.get('kofi')?.swapFor === 'taj');
  ok('the runner is swapped out, not scratched', a.get('taj')?.status === 'swapped' && a.get('taj')?.swapFor === 'kofi');
  r = await call({ swap: { alternateId: 'jaden', forAthleteId: 'taj' } });
  ok('a runner already swapped out cannot be swapped again', r.status === 409, r.json);
  r = await call({ swap: { alternateId: 'kofi', forAthleteId: 'dev' } });
  ok('an alternate already in cannot go in for a second runner', r.status === 409, r.json);
  r = await call({ declarations: [{ athleteId: 'kofi', status: 'scratched', raceId: null }] });
  ok('nor be marked Not running: Undo is the way out', (r.json.rejected as string[]).includes('kofi'), r.json);

  const req = new NextRequest(`http://local/api/declare/${meetToken}/sync`, { headers: { authorization: `Bearer ${process.env.RELAY_API_KEY ?? ''}` } });
  const s = await sync.GET(req, { params: Promise.resolve({ meetToken }) });
  if (s.status === 200) {
    const body = await s.json() as { teams: Array<{ declarations: Array<{ athleteId: string; swapFor: string | null }> }> };
    ok('the desk is told who went in for whom', body.teams[0].declarations.some((d) => d.athleteId === 'kofi' && d.swapFor === 'taj'));
  } else {
    console.log(`  (sync not checked: ${s.status} without a relay key)`);
  }

  console.log('Finalized and Undo');
  await db.insert(declarationFinalizations).values({ teamAccessId: access.id, meetSessionId: sessionId, raceId: 'r-men' } as never);
  r = await call({ unswap: { alternateId: 'kofi' } });
  ok('a finalized race keeps its swap', r.status === 409, r.json);
  await db.delete(declarationFinalizations).where(eq(declarationFinalizations.teamAccessId, access.id));
  r = await call({ unswap: { alternateId: 'kofi' } });
  ok('Undo takes it back', r.status === 200, r.json);
  a = await answers();
  ok('the alternate is marked unswapped, for the desk to put back', a.get('kofi')?.status === 'unswapped' && a.get('kofi')?.swapFor === 'taj');
  ok('and the runner is back as the meet entered them', !a.has('taj'));
  r = await call({ unswap: { alternateId: 'kofi' } });
  ok('there is nothing left to undo', r.status === 409, r.json);
  r = await call({ swap: { alternateId: 'kofi', forAthleteId: 'dev' } });
  ok('and the alternate can go in again, for somebody else', r.status === 200, r.json);

  await db.delete(meetDeclarationSessions).where(eq(meetDeclarationSessions.id, sessionId));
  console.log(fail ? `\n${fail} FAILED` : '\nOK');
  process.exit(fail ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
