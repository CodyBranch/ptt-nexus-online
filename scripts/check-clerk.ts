// The clerks' page: its own link made on publish (and on the first update of
// an older portal), the desk sending the picture with its key, and the page's
// data with each school's Nexus Online logo. LOCAL database only:
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/postgres npx tsx scripts/check-clerk.ts
if (!/127\.0\.0\.1:54330/.test(process.env.DATABASE_URL ?? '')) { console.error('refusing: not the local test database'); process.exit(1); }

async function main() {
  process.env.RELAY_API_KEY = 'check-relay-key';
  const { NextRequest } = await import('next/server');
  const { db } = await import('@/db/client');
  const { meetDeclarationSessions, organizations } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const publish = await import('@/app/api/declare/publish/route');
  const update = await import('@/app/api/declare/[meetToken]/update/route');
  const send = await import('@/app/api/declare/[meetToken]/clerk/route');
  const view = await import('@/app/api/declare/clerk/[token]/route');

  let fail = 0;
  const ok = (label: string, cond: boolean, detail?: unknown) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); if (!cond) fail++; };
  const auth = { Authorization: 'Bearer check-relay-key', 'Content-Type': 'application/json' };
  const [org] = await db.select().from(organizations).limit(1);
  const meet = { meetName: 'Clerk Invitational', races: [{ id: 'r1', name: 'Girls 5K', gender: 'F' }], teams: [{ id: 'T1', name: 'Westview', organizationId: org?.id ?? null, roster: [] }] };

  const pub = await publish.POST(new NextRequest('http://x', { method: 'POST', headers: auth, body: JSON.stringify(meet) }));
  const pj = await pub.json() as { meetToken: string; clerkToken?: string; dashboardToken: string };
  ok('publishing makes the clerks\u2019 link, its own', pub.status === 201 && /^[0-9a-f]{32}$/.test(pj.clerkToken ?? '') && pj.clerkToken !== pj.dashboardToken);
  const mctx = { params: Promise.resolve({ meetToken: pj.meetToken }) };

  // An older portal gets one on its first update, and keeps it.
  await db.update(meetDeclarationSessions).set({ clerkToken: null }).where(eq(meetDeclarationSessions.meetToken, pj.meetToken));
  const u1 = await (await update.POST(new NextRequest('http://x', { method: 'POST', headers: auth, body: JSON.stringify(meet) }), mctx)).json() as { clerkToken?: string };
  const u2 = await (await update.POST(new NextRequest('http://x', { method: 'POST', headers: auth, body: JSON.stringify(meet) }), mctx)).json() as { clerkToken?: string };
  ok('an older portal gets one on update, and keeps it', /^[0-9a-f]{32}$/.test(u1.clerkToken ?? '') && u1.clerkToken === u2.clerkToken);
  const token = u1.clerkToken!;
  const vctx = { params: Promise.resolve({ token }) };

  const before = await (await view.GET(new NextRequest('http://x'), vctx)).json() as { updatedAt: string | null; races: unknown[] };
  ok('before the desk sends anything: the page says so', before.updatedAt === null && before.races.length === 0);

  const snapshot = {
    meetName: 'Clerk Invitational', meetDate: '2026-10-17',
    races: [{ id: 'r1', number: 1, name: 'Girls 5K', gender: 'F', date: '2026-10-17', time: '09:00', status: 'scheduled' }],
    teams: [{ id: 'T1', name: 'Westview', abbreviation: 'WV', organizationId: org?.id ?? null, logoUrl: 'C:\\logos\\wv.png', primaryColor: '#123456' }],
    boxes: [{ raceId: 'r1', teamId: 'T1', label: null, box: 4, part: null, runners: 2 }],
    athletes: [
      { id: 'a1', bib: 101, firstName: 'Ava', lastName: 'Adams', year: 'SR', gender: 'F', teamId: 'T1', raceId: 'r1', status: 'declared', box: 4 },
      { id: 'a2', bib: 102, firstName: 'Bea', lastName: 'Baker', year: 'JR', gender: 'F', teamId: 'T1', raceId: 'r1', status: 'scratched', box: null },
    ],
  };
  const post = (body: unknown, headers: Record<string, string> = auth) => send.POST(new NextRequest('http://x', { method: 'POST', headers, body: JSON.stringify(body) }), mctx);
  ok('sending needs the desk key', (await post({ snapshot }, { 'Content-Type': 'application/json' })).status === 401);
  ok('something that is not the picture: refused', (await post({ snapshot: { meetName: 'x' } })).status === 400);
  ok('the picture: kept', (await post({ snapshot })).status === 200);

  const v = await (await view.GET(new NextRequest('http://x'), vctx)).json() as {
    updatedAt: string | null; races: unknown[]; boxes: unknown[]; athletes: Array<{ status: string }>; teams: Array<{ logoUrl: string | null; logoDarkUrl: string | null }>;
  };
  ok('the page gets races, boxes and runners as sent, and when', !!v.updatedAt && v.races.length === 1 && v.boxes.length === 1 && v.athletes.map((a) => a.status).join() === 'declared,scratched');
  ok("a school's logo from its organization; never a path on the desk's disk",
    org ? v.teams[0].logoUrl === (org.logoUrl ?? null) && v.teams[0].logoDarkUrl === (org.logoDarkUrl ?? null) : v.teams[0].logoUrl === null, v.teams[0]);
  const none = await view.GET(new NextRequest('http://x'), { params: Promise.resolve({ token: '0'.repeat(32) }) });
  ok('a wrong link: not found', none.status === 404);

  await db.delete(meetDeclarationSessions).where(eq(meetDeclarationSessions.meetToken, pj.meetToken));
  console.log(fail ? `\n${fail} FAILED` : '\nAll good.');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
