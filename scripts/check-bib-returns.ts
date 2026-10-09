// A bib scanned in before the coach scratched the runner counts as back once
// they are scratched. LOCAL database only: DATABASE_URL must be the throwaway
// PGlite on 127.0.0.1:54330, never .env.local (production).
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/postgres npx tsx scripts/check-bib-returns.ts
import { randomUUID } from 'node:crypto';
if (!/127\.0\.0\.1:54330/.test(process.env.DATABASE_URL ?? '')) { console.error('refusing: not the local test database'); process.exit(1); }

async function main() {
  const { db } = await import('@/db/client');
  const { meetDeclarationSessions, teamDeclarationAccess, declarationSubmissions } = await import('@/db/schema');
  const R = await import('@/lib/declare-returns');

  const sessionId = randomUUID();
  const meetToken = 'm' + randomUUID().slice(0, 8);
  await db.insert(meetDeclarationSessions).values({ id: sessionId, meetToken, meetName: 'Bib check', returnsToken: 'r' + randomUUID().slice(0, 8) } as never);
  const team = randomUUID();
  const roster = [{ id: 'a1', firstName: 'Early', lastName: 'Hander', bib: '101', tags: [] }, { id: 'a2', firstName: 'Usual', lastName: 'Order', bib: '102', tags: [] }];
  await db.insert(teamDeclarationAccess).values({ id: team, meetSessionId: sessionId, teamToken: 't' + randomUUID().slice(0, 8), teamId: 'T1', teamName: 'Check U', rosterJson: JSON.stringify(roster) } as never);
  const answer = (athleteId: string, status: string) => db.insert(declarationSubmissions)
    .values({ teamAccessId: team, meetSessionId: sessionId, athleteId, status, raceId: status === 'declared' ? 'race1' : null } as never)
    .onConflictDoUpdate({ target: [declarationSubmissions.teamAccessId, declarationSubmissions.athleteId], set: { status, updatedAt: new Date() } as never });

  const [session] = await db.select().from(meetDeclarationSessions).where((await import('drizzle-orm')).eq(meetDeclarationSessions.id, sessionId));
  let fail = 0;
  const ok = (label: string, cond: boolean, detail?: unknown) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); if (!cond) fail++; };

  // a1: bib handed in while still declared, then the COACH scratches online.
  await answer('a1', 'declared');
  const first = await R.recordReturn(session, '101', { via: 'manual' });
  ok('handed in before the scratch: kept, not yet counted', first.status === 'not_scratched' && !(await R.returnState(sessionId)).has(`${team}|a1`), first.message);
  const again = await R.recordReturn(session, '101', { via: 'manual' });
  ok('scanned again: already in hand', again.status === 'already_returned', again.message);
  await answer('a1', 'scratched');
  const state = await R.returnState(sessionId);
  ok('the coach scratches them: the bib counts as back', state.has(`${team}|a1`));
  const view = await R.returnsView(session);
  ok('staff page: none outstanding, the scan reads Returned', view.outstanding.length === 0 && view.scans.find((s) => s.bib === '101')?.status === 'returned',
    { outstanding: view.outstanding.map((o) => o.bib), scan: view.scans.find((s) => s.bib === '101')?.status });

  // a2: the usual order still works: scratched, then the bib comes in.
  await answer('a2', 'scratched');
  ok('scratched with the bib still out: outstanding', (await R.returnsView(session)).outstanding.some((o) => o.bib === '102'));
  const r2 = await R.recordReturn(session, '102', { via: 'scan' });
  ok('then scanned: returned', r2.status === 'returned' && (await R.returnState(sessionId)).has(`${team}|a2`), r2.message);

  // Undone scans never count.
  const v = await R.returnsView(session);
  await R.undoReturn(session, v.scans.find((s) => s.bib === '101')!.id);
  ok('a scan taken back: the bib is out again', !(await R.returnState(sessionId)).has(`${team}|a1`));

  console.log(fail ? `\n${fail} FAILED` : '\nAll good.');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
