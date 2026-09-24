/**
 * Tag the schools created for the Gans Creek College meet.
 *
 * Creating the organisation is not enough to be findable. Org matching narrows
 * its search with `?tag=college`, which goes through `organization_tags` — so a
 * school with a correct `organization_type` and no tag row is invisible to the
 * one screen that needed it. That is what happened: fourteen schools were
 * created and none of them could be found under the College filter.
 *
 * NAIA and NJCAA already exist as governing-body tags under College with no
 * members. These are their members.
 *
 * Idempotent: the pair is uniquely indexed and existing pairs are skipped.
 *
 *   npx tsx scripts/tag-gans-college-orgs.ts            (dry run)
 *   npx tsx scripts/tag-gans-college-orgs.ts --apply
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');

/** org name -> the tag slugs it should carry. */
const TAGS: Record<string, string[]> = {
  'Baker University': ['college', 'naia'],
  'Benedictine College': ['college', 'naia'],
  'Bethel University (Ind.)': ['college', 'naia'],
  'Colby Community College': ['college', 'njcaa'],
  'Columbia College (Mo.)': ['college', 'naia'],
  'Cornerstone University': ['college', 'naia'],
  'Doane University': ['college', 'naia'],
  'Indiana Wesleyan University': ['college', 'naia'],
  'Iowa Western Community College': ['college', 'njcaa'],
  'Oklahoma City University': ['college', 'naia'],
  'Park University': ['college', 'naia'],
  'University of Saint Mary': ['college', 'naia'],
  'Taylor University': ['college', 'naia'],
  'Missouri Running Club': ['club'],
};

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags } = await import('../src/db/schema');
  const { inArray, eq, and } = await import('drizzle-orm');

  const names = Object.keys(TAGS);
  const orgs = await db.select({ id: organizations.id, name: organizations.name })
    .from(organizations).where(inArray(organizations.name, names));
  const orgByName = new Map(orgs.map((o) => [o.name, o]));

  const wantedSlugs = [...new Set(Object.values(TAGS).flat())];
  const tags = await db.select({ id: orgTags.id, slug: orgTags.slug, name: orgTags.name })
    .from(orgTags).where(inArray(orgTags.slug, wantedSlugs));
  const tagBySlug = new Map(tags.map((t) => [t.slug, t]));

  const missingTags = wantedSlugs.filter((s) => !tagBySlug.has(s));
  if (missingTags.length) {
    console.log('NO SUCH TAG: ' + missingTags.join(', '));
    process.exit(1);
  }

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');
  let added = 0; let already = 0;
  const problems: string[] = [];

  for (const [name, slugs] of Object.entries(TAGS)) {
    const org = orgByName.get(name);
    if (!org) { problems.push(`no organisation named "${name}"`); continue; }

    const have: string[] = [];
    for (const slug of slugs) {
      const tag = tagBySlug.get(slug)!;
      const existing = await db.select().from(organizationTags)
        .where(and(eq(organizationTags.organizationId, org.id), eq(organizationTags.tagId, tag.id)));
      if (existing.length) { have.push(slug + ' (already)'); already++; continue; }
      have.push(slug);
      if (APPLY) {
        await db.insert(organizationTags).values({ organizationId: org.id, tagId: tag.id });
      }
      added++;
    }
    console.log('  ' + name.padEnd(34) + have.join(', '));
  }

  console.log('');
  console.log(`tags added ${added}, already there ${already}`);
  if (problems.length) { console.log('PROBLEMS:'); problems.forEach((p) => console.log('   ' + p)); }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
