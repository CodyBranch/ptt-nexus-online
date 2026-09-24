// Do the Gans Creek College submissions already exist as organisations under
// their proper names? Approving a duplicate is worse than leaving it pending.
// Read-only. Run with:  npx tsx scripts/inspect-college-candidates.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

/** Meet spelling -> words to look for in the org table. */
const LOOK: Record<string, string[]> = {
  'Baker': ['Baker'],
  'Benedictine (Kan.)': ['Benedictine'],
  'Bethel (Ind.)': ['Bethel'],
  'Colby CC': ['Colby'],
  'Colo. Sch. of Mines': ['Mines', 'Colorado School'],
  'Columbia (Mo.)': ['Columbia'],
  'Cornerstone': ['Cornerstone'],
  'Doane': ['Doane'],
  'Indiana Wesleyan': ['Indiana Wesleyan', 'Wesleyan'],
  'Iowa Western CC': ['Iowa Western'],
  'Missouri Running Club': ['Missouri Running', 'Run Club'],
  'Oklahoma City': ['Oklahoma City'],
  'Park U.': ['Park University', 'Park U'],
  'St. Mary (Kan.)': ['Saint Mary', 'St. Mary'],
  'Taylor': ['Taylor'],
};

import('../src/db/client').then(async ({ db }) => {
  const { organizations } = await import('../src/db/schema');
  const { sql, or, ilike } = await import('drizzle-orm');

  for (const [meetName, needles] of Object.entries(LOOK)) {
    const hits = await db.select({
      id: organizations.id, name: organizations.name, abbr: organizations.abbreviation,
      type: organizations.organizationType, div: organizations.ncaaDivision,
      naia: organizations.naiaMember, juco: organizations.jucoMember,
      conf: organizations.conference, city: organizations.city, state: organizations.state,
      c1: organizations.primaryColor, logo: organizations.logoUrl,
    }).from(organizations)
      .where(or(...needles.map((n) => ilike(organizations.name, `%${n}%`))))
      .limit(12);

    console.log('');
    console.log(meetName);
    if (!hits.length) { console.log('   -- nothing in the org table --'); continue; }
    for (const h of hits) {
      const level = h.div ? 'NCAA ' + h.div : h.naia ? 'NAIA' : h.juco ? 'JUCO' : h.type;
      const where = [h.city, h.state].filter(Boolean).join(', ') || '—';
      console.log('   ' + h.name.padEnd(38) + level.padEnd(12) + where.padEnd(20)
        + (h.c1 ? 'colors ' : '       ') + (h.logo ? 'logo' : 'no logo'));
    }
  }

  const counts = await db.select({
    type: organizations.organizationType,
    n: sql<number>`count(*)::int`,
  }).from(organizations).groupBy(organizations.organizationType);
  console.log('');
  console.log('org types in the table:');
  for (const c of counts) console.log('   ' + String(c.type).padEnd(18) + c.n);

  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
