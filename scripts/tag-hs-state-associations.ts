/**
 * State association tags for high schools outside Missouri.
 *
 * The only high-school governing body in org_tags was MSHSAA, because the
 * seed was Missouri. The out-of-state schools from Gans Creek Classic HS
 * have their association on the row (state_association) but nothing org
 * matching can filter by. This adds one governing_body tag per association,
 * under High School beside MSHSAA, and tags every high school whose
 * association and state match.
 *
 * Keyed on association AND state, because the acronyms are not unique:
 * IHSAA is Iowa and Indiana, CHSAA is Colorado and New York's Catholic
 * league, NSAA is Nebraska and the North Dakota slug would want it, AAA is
 * everybody. Where an acronym is shared, the tag's name says the state and
 * its slug carries it (ihsaa-ia), so Indiana can have its own later.
 *
 * Iowa splits by sex: IHSAA runs boys' cross country and IGHSAU girls'. The
 * row holds the boys' body, and an Iowa school gets both tags.
 *
 * Idempotent: tags are found by slug before being created, and tag pairs are
 * uniquely indexed. Anything added later with a known association and state
 * is picked up by running it again.
 *
 *   npx tsx scripts/tag-hs-state-associations.ts            (dry run)
 *   npx tsx scripts/tag-hs-state-associations.ts --apply
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');

interface Assoc { slug: string; name: string }
/** `${association}|${state}` -> the tags that school carries. */
const MAP: Record<string, Assoc[]> = {
  'IHSAA|IA': [
    { slug: 'ihsaa-ia', name: 'IHSAA (Iowa)' },
    { slug: 'ighsau', name: 'IGHSAU (Iowa girls)' },
  ],
  'AAA|AR': [{ slug: 'aaa-ar', name: 'AAA (Arkansas)' }],
  'UIL|TX': [{ slug: 'uil', name: 'UIL (Texas)' }],
  'IHSA|IL': [{ slug: 'ihsa', name: 'IHSA (Illinois)' }],
  'KSHSAA|KS': [{ slug: 'kshsaa', name: 'KSHSAA (Kansas)' }],
  'GAPPS|GA': [{ slug: 'gapps', name: 'GAPPS (Georgia)' }],
  'NSAA|NE': [{ slug: 'nsaa-ne', name: 'NSAA (Nebraska)' }],
  'TSSAA|TN': [{ slug: 'tssaa', name: 'TSSAA (Tennessee)' }],
  'OSSAA|OK': [{ slug: 'ossaa', name: 'OSSAA (Oklahoma)' }],
  'CHSAA|CO': [{ slug: 'chsaa-co', name: 'CHSAA (Colorado)' }],
};

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags } = await import('../src/db/schema');
  const { eq, and, isNotNull } = await import('drizzle-orm');

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');

  const [hs] = await db.select({ id: orgTags.id }).from(orgTags).where(eq(orgTags.slug, 'high-school'));
  if (!hs) { console.log('NO SUCH TAG: high-school'); process.exit(1); }

  // The tags: found by slug, or made. Sorted after MSHSAA by name.
  const wanted = [...new Map(Object.values(MAP).flat().map((a) => [a.slug, a])).values()]
    .sort((a, b) => a.name.localeCompare(b.name));
  const tagId = new Map<string, string>();
  let made = 0;
  for (const [i, a] of wanted.entries()) {
    const [have] = await db.select({ id: orgTags.id, parentId: orgTags.parentId }).from(orgTags).where(eq(orgTags.slug, a.slug));
    if (have) {
      if (have.parentId !== hs.id) { console.log(`  ${a.slug} exists but not under High School — left alone`); }
      tagId.set(a.slug, have.id);
      continue;
    }
    console.log(`  tag      ${a.name.padEnd(22)} ${a.slug}`);
    made++;
    if (APPLY) {
      const [row] = await db.insert(orgTags).values({
        kind: 'governing_body', name: a.name, slug: a.slug, parentId: hs.id, sortOrder: 2 + i,
      }).returning({ id: orgTags.id });
      tagId.set(a.slug, row.id);
    }
  }

  // The schools.
  const schools = await db.select({
    id: organizations.id, name: organizations.name, sa: organizations.stateAssociation, st: organizations.state,
  }).from(organizations).where(and(eq(organizations.organizationType, 'high_school'), isNotNull(organizations.stateAssociation)));

  let added = 0; let already = 0; const unknown = new Map<string, number>();
  for (const s of schools) {
    if (s.sa === 'MSHSAA') continue; // tagged by the seed
    const assoc = MAP[`${s.sa}|${s.st}`];
    if (!assoc) { const k = `${s.sa}|${s.st}`; unknown.set(k, (unknown.get(k) ?? 0) + 1); continue; }
    const got: string[] = [];
    for (const a of assoc) {
      const id = tagId.get(a.slug);
      if (id) {
        const [have] = await db.select().from(organizationTags)
          .where(and(eq(organizationTags.organizationId, s.id), eq(organizationTags.tagId, id)));
        if (have) { already++; continue; }
        if (APPLY) await db.insert(organizationTags).values({ organizationId: s.id, tagId: id });
      }
      added++; got.push(a.name);
    }
    if (got.length) console.log(`  ${s.name.slice(0, 44).padEnd(45)} ${got.join(', ')}`);
  }

  console.log(`\ntags created ${made}   school tags added ${added}   already there ${already}`);
  if (unknown.size) {
    console.log('\nNo tag for these associations (add them to MAP):');
    for (const [k, n] of unknown) console.log(`   ${k}  ${n} school(s)`);
  }
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
