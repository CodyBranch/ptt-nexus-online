/**
 * Correct submissions filed under a value that is not an organisation type.
 *
 * The desktop's matching screen sent the value of its search filter as the
 * organisation type. That filter holds a tag slug, and the slugs for the five
 * levels are the type values with hyphens instead of underscores — so every
 * row went in as `high-school`, which no code anywhere treats as a type.
 *
 * Two reasons this matters beyond looking wrong:
 *
 *   approving one creates an organisation, and it would be created with that
 *   value in `organization_type`, where every filter and every results page
 *   reads it;
 *
 *   `idx_org_subs_key` is unique on (name_key, organization_type), and it is
 *   the thing that stops one school being reviewed fourteen times. Keyed on a
 *   type that changes with a filter setting, it stops nothing.
 *
 * The mapping is only the hyphen-for-underscore one. Nothing here guesses that
 * a `conf-big-ten` row was a college — if one of those exists it is reported
 * and left, because the right answer is not recoverable from the row.
 *
 *   npx tsx scripts/fix-submission-types.ts            (dry run)
 *   npx tsx scripts/fix-submission-types.ts --apply
 */

import { config } from 'dotenv';
import { resolve } from 'path';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');

const VALID = [
  'professional', 'college', 'high_school', 'middle_school',
  'club', 'national_federation', 'unattached', 'other',
];

/** Level tag slug -> the type it meant. The only correction made. */
const FROM_LEVEL_SLUG: Record<string, string> = {
  'high-school': 'high_school',
  'middle-school': 'middle_school',
  'college': 'college',
  'club': 'club',
  'professional': 'professional',
  'unattached': 'unattached',
};

import('../src/db/client').then(async ({ db }) => {
  const { organizationSubmissions } = await import('../src/db/schema');
  const { eq, and, sql } = await import('drizzle-orm');

  const all = await db.select().from(organizationSubmissions);
  const bad = all.filter((s) => !VALID.includes(s.organizationType));

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');
  console.log(`submissions: ${all.length}, with a type that is not a type: ${bad.length}`);
  const byValue = new Map<string, number>();
  for (const s of bad) byValue.set(s.organizationType, (byValue.get(s.organizationType) ?? 0) + 1);
  for (const [v, n] of byValue) console.log(`   "${v}"  x${n}`);
  console.log('');

  let fixed = 0; let collided = 0; let unmappable = 0;

  for (const s of bad) {
    const target = FROM_LEVEL_SLUG[s.organizationType];
    if (!target) {
      console.log(`  LEAVE   ${s.name.padEnd(36)} "${s.organizationType}" names no type — decide by hand`);
      unmappable++;
      continue;
    }

    // The pair is uniquely indexed, so a row may already be sitting on the
    // corrected key — the same school submitted again with the filter off.
    const clash = all.find((o) => o.id !== s.id
      && o.nameKey === s.nameKey && o.organizationType === target);
    if (clash) {
      console.log(`  CLASH   ${s.name.padEnd(36)} ${target} already held by ${clash.id} (${clash.status})`);
      collided++;
      continue;
    }

    console.log(`  FIX     ${s.name.padEnd(36)} ${s.organizationType} -> ${target}   [${s.status}]`);
    if (APPLY) {
      await db.update(organizationSubmissions)
        .set({ organizationType: target })
        .where(eq(organizationSubmissions.id, s.id));
    }
    fixed++;
  }

  console.log('');
  console.log(`fixed ${fixed}   clashes ${collided}   left alone ${unmappable}`);

  if (APPLY) {
    const after = await db.select().from(organizationSubmissions);
    const stillBad = after.filter((s) => !VALID.includes(s.organizationType));
    console.log('');
    console.log('after: ' + stillBad.length + ' rows still carry a non-type'
      + (stillBad.length ? ' -> ' + stillBad.map((s) => s.name).join(', ') : ''));
    const counts = new Map<string, number>();
    for (const s of after) counts.set(s.organizationType, (counts.get(s.organizationType) ?? 0) + 1);
    console.log('types now: ' + [...counts].map(([k, v]) => `${k}=${v}`).join('  '));
  }

  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
