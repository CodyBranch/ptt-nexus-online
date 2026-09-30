/**
 * Tag the 29 high schools created for the Gans Creek Classic HS meet.
 *
 * Org matching narrows its search with `?tag=high-school`, which goes through
 * `organization_tags`, so a school with no tag row is invisible under the High
 * School filter (the college schools learned this first; see
 * tag-gans-college-orgs.ts). Each gets the High School level tag.
 *
 * State association tags (Iowa IHSAA, KSHSAA, AAA, UIL...) are not added: the
 * only high-school governing body in org_tags is MSHSAA, and a new tag family
 * is a taxonomy decision rather than a data fix. The association is on each
 * row in state_association meanwhile.
 *
 * Idempotent: the pair is uniquely indexed and existing pairs are skipped.
 *
 *   npx tsx scripts/tag-gans-hs-orgs.ts            (dry run)
 *   npx tsx scripts/tag-gans-hs-orgs.ts --apply
 */

import { config } from 'dotenv';
import { resolve } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const rows = JSON.parse(readFileSync(resolve(process.cwd(), 'scripts/data/gans-hs-29-orgs.json'), 'utf-8')) as
  Array<{ org: { name: string } }>;
const NAMES = rows.map((r) => r.org.name);

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags } = await import('../src/db/schema');
  const { inArray, eq, and } = await import('drizzle-orm');

  const [tag] = await db.select({ id: orgTags.id }).from(orgTags).where(eq(orgTags.slug, 'high-school'));
  if (!tag) { console.log('NO SUCH TAG: high-school'); process.exit(1); }
  const orgs = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(inArray(organizations.name, NAMES));

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');
  let added = 0; let already = 0;
  const missing = NAMES.filter((n) => !orgs.some((o) => o.name === n));
  for (const org of orgs) {
    const have = await db.select().from(organizationTags)
      .where(and(eq(organizationTags.organizationId, org.id), eq(organizationTags.tagId, tag.id)));
    if (have.length) { already++; continue; }
    if (APPLY) await db.insert(organizationTags).values({ organizationId: org.id, tagId: tag.id });
    added++;
  }
  console.log(`high-school tags added ${added}, already there ${already}`);
  if (missing.length) { console.log('NOT FOUND: ' + missing.join(', ')); process.exit(1); }
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
