/**
 * A tag and a badge for a team that has neither.
 *
 * Every meet runs somebody unattached — an individual with no school, a
 * postgraduate, a school's second squad entered under its own name. There was
 * nothing in the org database for them, so they stayed unmatched forever and
 * their rows on a results page had no colours, no badge and no way to get any.
 *
 * Making an organisation per variant is the wrong shape: "Unattached",
 * "UNA-Missouri" and "UNA-Rockhurst" are not three institutions, and as
 * permanent rows they would be matched against by every meet that ever ran
 * one. One generic organisation under one `unattached` tag is what they all
 * point at.
 *
 * The badge is a plain shield, drawn rather than found. The alternative is a
 * team's initials in a coloured box, which at a glance reads as branding and
 * is not; a shield says the same thing every time — this team has no badge,
 * and nobody has pretended otherwise.
 *
 *   npx tsx scripts/seed-unattached-org.ts            (dry run)
 *   npx tsx scripts/seed-unattached-org.ts --apply
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const LOGO_DIR = process.env.GANS_LOGO_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos';

const ORG_NAME = 'Unattached';
const TAG_SLUG = 'unattached';

/** The submissions this organisation answers for. */
const POINT_AT_IT = ['Unattached', 'UNA-Missouri', 'UNA-Rockhurst'];

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags, organizationSubmissions } = await import('../src/db/schema');
  const { eq, and, inArray, sql } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');

  // ── The badge ────────────────────────────────────────────────────────────
  const files: Array<[string, 'light' | 'dark']> = [
    ['generic-shield-light.svg', 'light'],
    ['generic-shield-dark.svg', 'dark'],
  ];
  const urls: Record<string, string> = {};
  for (const [file, variant] of files) {
    const path = join(LOGO_DIR, file);
    if (!existsSync(path)) { console.log('MISSING ' + path); process.exit(1); }
    const key = `generic/${file}`;
    console.log(`  badge  ${variant.padEnd(6)} ${file} -> Logos/${key}`);
    if (APPLY) {
      const supabase = createAdminClient();
      const { error } = await supabase.storage.from('Logos')
        .upload(key, readFileSync(path), {
          contentType: 'image/svg+xml', cacheControl: '31536000', upsert: true,
        });
      if (error) { console.log('  upload refused: ' + error.message); process.exit(1); }
      urls[variant] = supabase.storage.from('Logos').getPublicUrl(key).data.publicUrl;
    }
  }

  // ── The tag ──────────────────────────────────────────────────────────────
  // A level, beside College and High School, because that is what it is: not a
  // governing body and not a conference.
  let tag = (await db.select().from(orgTags).where(eq(orgTags.slug, TAG_SLUG)))[0];
  if (tag) {
    console.log(`  tag    "${TAG_SLUG}" already there (${tag.id})`);
  } else {
    console.log(`  tag    CREATE "${TAG_SLUG}" (kind=level, no parent)`);
    if (APPLY) {
      const maxOrder = await db.select({ n: sql<number>`coalesce(max(sort_order), 0)::int` })
        .from(orgTags).where(eq(orgTags.kind, 'level'));
      [tag] = await db.insert(orgTags).values({
        kind: 'level', name: 'Unattached', slug: TAG_SLUG,
        parentId: null, sortOrder: (maxOrder[0]?.n ?? 0) + 1,
      }).returning();
    }
  }

  // ── The organisation ─────────────────────────────────────────────────────
  let org = (await db.select().from(organizations).where(eq(organizations.name, ORG_NAME)))[0];
  if (org) {
    console.log(`  org    "${ORG_NAME}" already there (${org.id}) — badge refreshed`);
    if (APPLY) {
      await db.update(organizations)
        .set({ logoUrl: urls.light, logoDarkUrl: urls.dark, updatedAt: new Date() })
        .where(eq(organizations.id, org.id));
    }
  } else {
    console.log(`  org    CREATE "${ORG_NAME}"  type=unattached`);
    if (APPLY) {
      [org] = await db.insert(organizations).values({
        name: ORG_NAME,
        abbreviation: 'UNA',
        shortName: 'Unattached',
        mascot: null,
        organizationType: 'unattached',
        city: null, state: null, country: 'USA',
        primaryColor: null, secondaryColor: null,
        logoUrl: urls.light, logoDarkUrl: urls.dark,
        notes: 'Generic. Every unattached runner and one-off squad points here; '
          + 'do not add a second organisation for a variant spelling.',
        isActive: true,
      }).returning();
    }
  }

  if (APPLY && org && tag) {
    const pair = await db.select().from(organizationTags)
      .where(and(eq(organizationTags.organizationId, org.id), eq(organizationTags.tagId, tag.id)));
    if (!pair.length) await db.insert(organizationTags).values({ organizationId: org.id, tagId: tag.id });
  }

  // ── The submissions it answers for ───────────────────────────────────────
  const subs = await db.select().from(organizationSubmissions)
    .where(inArray(organizationSubmissions.name, POINT_AT_IT));
  for (const s of subs) {
    console.log(`  sub    ${s.name.padEnd(18)} ${s.status} -> approved, pointing at the generic organisation`);
    if (APPLY && org) {
      await db.update(organizationSubmissions).set({
        status: 'approved', organizationId: org.id, organizationType: 'unattached',
        reviewNote: 'Not a school — matched to the generic Unattached organisation.',
        reviewedAt: new Date(),
      }).where(eq(organizationSubmissions.id, s.id));
    }
  }

  console.log('');
  console.log(APPLY ? 'done.' : 'nothing written.');
  process.exit(0);
}).catch((e) => { console.error(e); process.exit(1); });
