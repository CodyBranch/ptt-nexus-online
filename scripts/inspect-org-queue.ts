// What is sitting in the organisation review queue, and how complete it is.
// Read-only. Run with:  npx tsx scripts/inspect-org-queue.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

import('../src/db/client').then(async ({ db }) => {
  const { organizationSubmissions, organizations } = await import('../src/db/schema');
  const { sql, inArray } = await import('drizzle-orm');

  const subs = await db.select().from(organizationSubmissions)
    .orderBy(organizationSubmissions.status, organizationSubmissions.name);

  const byStatus = new Map<string, typeof subs>();
  for (const s of subs) {
    if (!byStatus.has(s.status)) byStatus.set(s.status, [] as unknown as typeof subs);
    byStatus.get(s.status)!.push(s);
  }

  console.log(`submissions: ${subs.length}`);
  for (const [status, rows] of byStatus) console.log(`   ${status}: ${rows.length}`);
  console.log('');

  for (const [status, rows] of byStatus) {
    console.log('='.repeat(78));
    console.log(status.toUpperCase());
    for (const s of rows) {
      const where = [s.city, s.state].filter(Boolean).join(', ') || '—';
      console.log(
        '  ' + s.name.padEnd(28)
        + (s.abbreviation ?? '').padEnd(8)
        + (s.organizationType ?? '').padEnd(14)
        + where.padEnd(22)
        + 'x' + s.timesSeen
        + (s.meetName ? '  from: ' + s.meetName : ''),
      );
    }
    console.log('');
  }

  // How complete the organisations these would become need to be: measure the
  // ones already there, so a new row is filled in to the same standard.
  const names = subs.map((s) => s.name);
  if (names.length) {
    const existing = await db.select().from(organizations).where(inArray(organizations.name, names));
    console.log('already in organizations under the same name: ' + existing.length);
    for (const o of existing) console.log('   ' + o.name + '  ' + o.id);
  }

  const total = await db.select({ n: sql<number>`count(*)::int` }).from(organizations);
  console.log('');
  console.log('organizations rows: ' + total[0].n);

  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
