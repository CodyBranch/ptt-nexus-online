// Does org matching's own query find the new schools under the College filter?
// Mirrors the tag subquery in src/app/api/organizations/route.ts exactly.
// Read-only. Run with:  npx tsx scripts/verify-college-search.ts

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

/** What org matching actually types: the meet's team name. */
const QUERIES = [
  'Baker', 'Benedictine (Kan.)', 'Bethel (Ind.)', 'Colby CC', 'Colo. Sch. of Mines',
  'Columbia (Mo.)', 'Cornerstone', 'Doane', 'Indiana Wesleyan', 'Iowa Western CC',
  'Oklahoma City', 'Park U.', 'St. Mary (Kan.)', 'Taylor', 'Missouri Running Club',
];

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags } = await import('../src/db/schema');
  const { and, eq, or, ilike, sql } = await import('drizzle-orm');

  const underTag = (slug: string) => sql`EXISTS (
    SELECT 1 FROM ${organizationTags} ot
    WHERE ot.organization_id = ${organizations.id}
      AND ot.tag_id IN (
        WITH RECURSIVE below AS (
          SELECT id FROM ${orgTags} WHERE slug = ${slug}
          UNION ALL
          SELECT t.id FROM ${orgTags} t JOIN below b ON t.parent_id = b.id
        )
        SELECT id FROM below
      )
  )`;

  let found = 0;
  for (const q of QUERIES) {
    const search = `%${q}%`;
    const rows = await db.select({ name: organizations.name, logo: organizations.logoUrl, dark: organizations.logoDarkUrl })
      .from(organizations)
      .where(and(
        eq(organizations.isActive, true),
        or(
          ilike(organizations.name, search),
          ilike(organizations.abbreviation, search),
          ilike(organizations.shortName, search),
          ilike(organizations.city, search),
        )!,
        underTag(q === 'Missouri Running Club' ? 'club' : 'college'),
      ))
      .orderBy(organizations.name).limit(5);

    const hit = rows.length > 0;
    if (hit) found++;
    console.log('  ' + (hit ? 'FOUND ' : 'NONE  ') + q.padEnd(24)
      + rows.map((r) => r.name + (r.logo ? ' [logo]' : r.dark ? ' [dark logo]' : ' [no logo]')).join(' | '));
  }

  console.log('');
  console.log(`${found} of ${QUERIES.length} searchable under their level filter`);
  process.exit(found === QUERIES.length ? 0 : 1);
}).catch((e) => { console.error(e); process.exit(1); });
