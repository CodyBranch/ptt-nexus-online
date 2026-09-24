// Did the Gans Creek College profiles actually land, and do their badges serve?
// Read-only. Run with:  npx tsx scripts/verify-gans-college-orgs.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const NAMES = [
  'Baker University', 'Benedictine College', 'Bethel University (Ind.)',
  'Colby Community College', 'Columbia College (Mo.)', 'Cornerstone University',
  'Doane University', 'Indiana Wesleyan University', 'Iowa Western Community College',
  'Oklahoma City University', 'Park University', 'University of Saint Mary',
  'Taylor University', 'Missouri Running Club',
];

import('../src/db/client').then(async ({ db }) => {
  const { organizations, organizationSubmissions } = await import('../src/db/schema');
  const { inArray, eq, and } = await import('drizzle-orm');

  const rows = await db.select().from(organizations).where(inArray(organizations.name, NAMES));
  console.log(`organisations found: ${rows.length} of ${NAMES.length}`);
  console.log('');

  let incomplete = 0;
  const urls: Array<[string, string]> = [];
  for (const o of rows) {
    const missing: string[] = [];
    for (const [k, v] of Object.entries({
      abbreviation: o.abbreviation, city: o.city, state: o.state,
      organizationType: o.organizationType,
    })) if (!v) missing.push(k);
    // A club has no conference, mascot or colours, and that is not incomplete.
    if (o.organizationType !== 'club') {
      if (!o.conference) missing.push('conference');
      if (!o.mascot) missing.push('mascot');
      if (!o.primaryColor) missing.push('primaryColor');
      if (!o.logoUrl && !o.logoDarkUrl) missing.push('logo');
    }
    if (missing.length) incomplete++;
    const badge = o.logoUrl ? 'light' : o.logoDarkUrl ? 'DARK ONLY' : 'none';
    console.log('  ' + o.name.padEnd(34) + (o.city + ', ' + o.state).padEnd(20)
      + badge.padEnd(11) + (missing.length ? 'MISSING: ' + missing.join(', ') : 'complete'));
    if (o.logoUrl) urls.push([o.name, o.logoUrl]);
    if (o.logoDarkUrl) urls.push([o.name + ' (dark)', o.logoDarkUrl]);
  }

  console.log('');
  console.log('badges, fetched:');
  for (const [name, url] of urls) {
    try {
      const r = await fetch(url, { method: 'GET' });
      const buf = Buffer.from(await r.arrayBuffer());
      console.log('  ' + String(r.status) + '  ' + String(r.headers.get('content-type')).padEnd(16)
        + String(buf.length).padStart(7) + 'b  ' + name);
    } catch (e) {
      console.log('  ERR  ' + name + '  ' + (e as Error).message);
    }
  }

  const pend = await db.select().from(organizationSubmissions)
    .where(eq(organizationSubmissions.status, 'pending'));
  const college = pend.filter((s) => s.meetName === 'Gans Creek Classic College');
  console.log('');
  console.log('still pending overall: ' + pend.length);
  console.log('still pending from the College meet: ' + college.length
    + (college.length ? ' -> ' + college.map((s) => s.name).join(', ') : ''));
  console.log(incomplete ? `\n${incomplete} incomplete` : '\nevery profile is complete.');
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
