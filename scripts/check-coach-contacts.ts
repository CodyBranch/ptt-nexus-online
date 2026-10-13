// Coaches signing up for a meet's texts: the sign-up link's API, the
// confirming text, and the desk's pull. A stand-in Twilio takes the texts.
// LOCAL database only: DATABASE_URL must be the throwaway PGlite on
// 127.0.0.1:54330, never .env.local (production).
//   DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54330/postgres npx tsx scripts/check-coach-contacts.ts
import { randomUUID } from 'node:crypto';
import http from 'node:http';
if (!/127\.0\.0\.1:54330/.test(process.env.DATABASE_URL ?? '')) { console.error('refusing: not the local test database'); process.exit(1); }

const SID = 'AC' + '0'.repeat(32);
const LANDLINE = '+15555550188';
const STOPPED = '+15555550199';
const texts: Array<{ to: string; from: string; body: string }> = [];

async function main() {
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const f = new URLSearchParams(body);
      const send = (code: number, obj: unknown) => { res.writeHead(code, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(obj)); };
      if (f.get('To') === LANDLINE) return send(400, { code: 21614, message: 'To number is not a mobile number' });
      if (f.get('To') === STOPPED) return send(400, { code: 21610, message: 'Attempt to send to unsubscribed recipient' });
      texts.push({ to: f.get('To')!, from: f.get('From')!, body: f.get('Body')! });
      send(201, { sid: 'SM' + String(texts.length).padStart(32, '0'), status: 'queued' });
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  const port = (server.address() as { port: number }).port;
  Object.assign(process.env, {
    TWILIO_ACCOUNT_SID: SID, TWILIO_AUTH_TOKEN: 'test', TWILIO_FROM: '+15555550100', TWILIO_API_URL: `http://127.0.0.1:${port}`,
    RELAY_API_KEY: 'check-relay-key',
  });

  const { NextRequest } = await import('next/server');
  const { db } = await import('@/db/client');
  const { meetDeclarationSessions, teamDeclarationAccess, declarationCoachContacts } = await import('@/db/schema');
  const { eq } = await import('drizzle-orm');
  const signup = await import('@/app/api/declare/coaches/[token]/route');
  const pull = await import('@/app/api/declare/[meetToken]/coaches/route');
  const one = await import('@/app/api/declare/[meetToken]/coaches/[id]/route');
  const update = await import('@/app/api/declare/[meetToken]/update/route');
  const publish = await import('@/app/api/declare/publish/route');

  let fail = 0;
  const ok = (label: string, cond: boolean, detail?: unknown) => { console.log(`  ${cond ? 'ok  ' : 'FAIL'} ${label}${detail !== undefined ? ' -> ' + JSON.stringify(detail) : ''}`); if (!cond) fail++; };

  // A published meet hands back its sign-up token.
  const pub = await publish.POST(new NextRequest('http://x/api/declare/publish', {
    method: 'POST', headers: { Authorization: 'Bearer check-relay-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetName: 'Texts Invitational', meetDate: '2026-10-17', races: [{ id: 'r1', name: 'Girls 5K', gender: 'F' }],
      teams: [{ id: 'T-WEST', name: 'Westview', roster: [] }, { id: 'T-EAST', name: 'Eastland', roster: [] }] }),
  }));
  const pj = await pub.json() as { meetToken: string; contactsToken?: string };
  ok('publishing makes a sign-up link of its own', pub.status === 201 && /^[0-9a-f]{32}$/.test(pj.contactsToken ?? '') && pj.contactsToken !== pj.meetToken);
  const token = pj.contactsToken!;
  const ctx = { params: Promise.resolve({ token }) };

  const g = await signup.GET(new NextRequest(`http://x/api/declare/coaches/${token}`), ctx);
  const gj = await g.json() as { meetName: string; schools: Array<{ id: string; name: string }>; consentText: string };
  ok('the form gets the meet and its schools, A to Z', gj.meetName === 'Texts Invitational' && gj.schools.map((s) => s.name).join() === 'Eastland,Westview');
  ok('schools by access id, never their form token', !JSON.stringify(gj).includes('teamToken') && gj.schools.every((s) => /^[0-9a-f-]{36}$/.test(s.id)));
  ok('the consent names the meet, STOP and HELP', gj.consentText.includes('Texts Invitational') && gj.consentText.includes('STOP') && gj.consentText.includes('HELP'));
  const west = gj.schools.find((s) => s.name === 'Westview')!.id;
  const bad = await signup.GET(new NextRequest('http://x'), { params: Promise.resolve({ token: '0'.repeat(32) }) });
  ok('a wrong link: not found', bad.status === 404);

  const post = (body: Record<string, unknown>) => signup.POST(new NextRequest(`http://x/api/declare/coaches/${token}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), ctx);

  const r1 = await post({ teamId: west, name: '', role: 'Head Coach', email: 'not-an-email', phone: '12345', consent: false });
  const j1 = await r1.json() as { problems: Record<string, string> };
  ok('bad name, email, phone and no consent: each named', r1.status === 422 && !!j1.problems.name && !!j1.problems.email && !!j1.problems.phone && !!j1.problems.consent, Object.keys(j1.problems));
  const r1b = await post({ teamId: randomUUID(), name: 'A', email: 'a@b.co', phone: '5555550111', consent: true });
  ok('a school from another meet: refused', r1b.status === 422);

  const r2 = await post({ teamId: west, name: 'Dana Brooks', role: 'Head Coach', email: 'dbrooks@westview.example', phone: '(555) 555-0111', consent: true });
  const j2 = await r2.json() as { saved: boolean; confirm: string; phone: string };
  ok('a good sign-up: saved, the number as E.164', r2.status === 200 && j2.saved && j2.phone === '+15555550111', j2);
  ok('the confirming text: from the meet number, naming PrimeTime Nexus Messaging, the meet and the school', texts.length === 1 && texts[0].to === '+15555550111'
    && texts[0].from === '+15555550100' && texts[0].body.startsWith('PrimeTime Nexus Messaging') && texts[0].body.includes('Texts Invitational') && texts[0].body.includes('Westview'), texts[0]);

  const r3 = await post({ teamId: west, name: 'Dana Brooks', role: 'Assistant Coach', email: 'dana@westview.example', phone: '555-555-0111', consent: true });
  const rows = await db.select().from(declarationCoachContacts).where(eq(declarationCoachContacts.phone, '+15555550111'));
  ok('the same mobile again: one sign-up, updated, not texted twice', r3.status === 200 && rows.length === 1 && rows[0].role === 'Assistant Coach' && rows[0].email === 'dana@westview.example' && texts.length === 1);
  ok('what they agreed to and when is kept', !!rows[0].consentText?.includes('Texts Invitational') && !!rows[0].optedInAt);

  const r4 = await post({ teamId: west, name: 'Land Line', email: 'll@westview.example', phone: LANDLINE, consent: true });
  const j4 = await r4.json() as { problems?: Record<string, string> };
  ok('a number that cannot take texts: sent back to fix, not kept', r4.status === 422 && /cannot receive texts/.test(j4.problems?.phone ?? '')
    && (await db.select().from(declarationCoachContacts).where(eq(declarationCoachContacts.phone, LANDLINE))).length === 0);

  const r5 = await post({ teamId: west, name: 'Stop Ped', email: 'sp@westview.example', phone: STOPPED, consent: true });
  const j5 = await r5.json() as { confirm: string };
  ok('a number that said STOP before: kept, and told so', r5.status === 200 && j5.confirm === 'opted_out');

  // The desk's pull.
  const [session] = await db.select().from(meetDeclarationSessions).where(eq(meetDeclarationSessions.contactsToken, token));
  const pctx = { params: Promise.resolve({ meetToken: session.meetToken }) };
  const unauth = await pull.GET(new NextRequest('http://x'), pctx);
  ok('the desk pull needs the desk key', unauth.status === 401);
  const p = await pull.GET(new NextRequest('http://x', { headers: { Authorization: 'Bearer check-relay-key' } }), pctx);
  const pj2 = await p.json() as { contacts: Array<{ teamId: string; name: string; phone: string; role: string; optedInAt: string; updatedAt: string }> };
  ok("the desk gets each sign-up under its own team id", p.status === 200 && pj2.contacts.length === 2 && pj2.contacts.every((c) => c.teamId === 'T-WEST' && c.optedInAt && c.updatedAt),
    pj2.contacts.map((c) => `${c.teamId}:${c.name}`));

  // The coach's own form links to the sign-up with the school picked.
  const team = await import('@/app/api/declare/[meetToken]/[teamToken]/route');
  const [access] = await db.select().from(teamDeclarationAccess).where(eq(teamDeclarationAccess.id, west));
  const f = await team.GET(new NextRequest('http://x'), { params: Promise.resolve({ meetToken: session.meetToken, teamToken: access.teamToken }) });
  const fj = await f.json() as { textsUrl?: string };
  ok("the school's form links to the sign-up, the school picked", fj.textsUrl === `/declare/coaches/${token}?team=${west}`, fj.textsUrl);

  // The desk turns the form's invitation off, and on again, with an update.
  const upd = (textSignup?: boolean) => update.POST(new NextRequest('http://x', {
    method: 'POST', headers: { Authorization: 'Bearer check-relay-key', 'Content-Type': 'application/json' },
    body: JSON.stringify({ meetName: 'Texts Invitational', races: [{ id: 'r1', name: 'Girls 5K', gender: 'F' }], teams: [{ id: 'T-WEST', name: 'Westview', roster: [] }, { id: 'T-EAST', name: 'Eastland', roster: [] }], ...(textSignup === undefined ? {} : { textSignup }) }),
  }), { params: Promise.resolve({ meetToken: session.meetToken }) });
  const formUrl = async () => ((await (await team.GET(new NextRequest('http://x'), { params: Promise.resolve({ meetToken: session.meetToken, teamToken: access.teamToken }) })).json()) as { textsUrl?: string | null }).textsUrl;
  await upd(false);
  ok('turned off at the desk: the form does not ask', (await formUrl()) === null);
  await upd();
  ok('an update from a desk that does not say leaves it as it was', (await formUrl()) === null);
  await upd(true);
  ok('turned on again: the form asks', (await formUrl()) === `/declare/coaches/${token}?team=${west}`);

  // The desk corrects and removes a sign-up.
  const dana = pj2.contacts.find((c) => c.name === 'Dana Brooks')!;
  const octx = (id: string) => ({ params: Promise.resolve({ meetToken: session.meetToken, id }) });
  const patch = (id: string, body: unknown, auth = true) => one.PATCH(new NextRequest('http://x', {
    method: 'PATCH', headers: { ...(auth ? { Authorization: 'Bearer check-relay-key' } : {}), 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }), octx(id));
  ok('a correction needs the desk key', (await patch(dana.id, { name: 'X' }, false)).status === 401);
  ok('a correction is checked: a bad email refused', (await patch(dana.id, { email: 'nope' })).status === 422);
  ok('another coach at the school already has that mobile: refused', (await patch(dana.id, { phone: STOPPED })).status === 409);
  const fixed = await patch(dana.id, { name: 'Dana Brooks-Lee', role: 'Head Coach', email: 'dbl@westview.example', phone: '555.555.0112' });
  const fj2 = await fixed.json() as { contact: { name: string; phone: string; updatedAt: string } };
  ok('corrected: saved, the mobile as E.164, a new time for the desk', fixed.status === 200 && fj2.contact.name === 'Dana Brooks-Lee' && fj2.contact.phone === '+15555550112' && fj2.contact.updatedAt > dana.updatedAt, fj2.contact);
  const del = await one.DELETE(new NextRequest('http://x', { method: 'DELETE', headers: { Authorization: 'Bearer check-relay-key' } }), octx(dana.id));
  ok('removed: deleted here, name, email, mobile and consent', del.status === 200 && (await db.select().from(declarationCoachContacts).where(eq(declarationCoachContacts.id, dana.id))).length === 0);
  const again = await one.DELETE(new NextRequest('http://x', { method: 'DELETE', headers: { Authorization: 'Bearer check-relay-key' } }), octx(dana.id));
  ok('removing again is not an error (the desk can finish its own)', again.status === 200);

  await db.delete(meetDeclarationSessions).where(eq(meetDeclarationSessions.id, session.id));
  server.close();
  console.log(fail ? `\n${fail} FAILED` : '\nAll good.');
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error(e); process.exit(1); });
