/**
 * Complete the organisation profiles for the 29 Gans Creek Classic HS teams
 * that org matching could not place: the out-of-state schools. The seed was
 * MSHSAA, so no Iowa, Kansas, Arkansas or Texas high school was ever in the
 * table, and every one of them sat in the review queue with initials for a
 * badge.
 *
 * The research is scripts/data/gans-hs-29-orgs.json (summary beside it in
 * .md): name, city, association, mascot, colours, website, Athletic.net id,
 * and a logo in scripts/data/gans-hs-logos/. Twenty-eight are plain creates.
 * The twenty-ninth, Transformed Courageous Christian Homeschoolers, was left
 * as a decision; it is created as its own organisation, which is what the
 * research recommended (Hannibal Area Home Educators is still a separate,
 * active group), with the name's "Christain" corrected.
 *
 * Run a dry run first — it writes nothing and prints what it would do:
 *   npx tsx scripts/complete-gans-hs-orgs.ts
 * Then, to write:
 *   npx tsx scripts/complete-gans-hs-orgs.ts --apply
 *
 * Logos go into the Logos bucket under hs/, not hotlinked: a school's site is
 * no place for a results page to fetch a badge from on race day. A reversed
 * (white) file goes in logoDarkUrl.
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DATA = resolve(process.cwd(), 'scripts/data/gans-hs-29-orgs.json');
const LOGO_DIR = resolve(process.cwd(), 'scripts/data/gans-hs-logos');

interface Row {
  order: number;
  meetName: string;
  submissionId: string | null;
  abbreviation: string;
  decision: 'create' | 'link' | 'reject' | 'decide';
  linkToExisting: string | null;
  reject: string | null;
  org: {
    name: string; abbreviation: string; shortName: string | null; mascot: string | null;
    organizationType: string; genderDesignation: string | null;
    ncaaDivision: string | null; naiaMember: boolean; jucoMember: boolean;
    conference: string | null; subConference: string | null; stateAssociation: string | null;
    city: string | null; state: string | null; country: string | null;
    primaryColor: string | null; secondaryColor: string | null;
    website: string | null; athleticNetId: string | null; milesplitId: string | null; mshsaaId: string | null;
    notes: string | null; isActive: boolean;
    logoFile: string | null; logoReversed: boolean; logoDarkFile: string | null;
  };
}

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
};

const rows: Row[] = JSON.parse(readFileSync(DATA, 'utf-8'));

import('../src/db/client').then(async ({ db }) => {
  const { organizations, organizationSubmissions } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');
  const supabase = APPLY ? createAdminClient() : null;

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');
  let created = 0; let uploaded = 0; let closed = 0;
  const problems: string[] = [];

  const upload = async (file: string, tag: string): Promise<string | null> => {
    const path = join(LOGO_DIR, file);
    if (!existsSync(path)) { problems.push(`logo file missing: ${path}`); return null; }
    const ext = file.split('.').pop()!.toLowerCase();
    const key = `hs/${file}`;
    console.log(tag + '  logo   ' + file + ' -> Logos/' + key);
    if (!APPLY || !supabase) return null;
    const { error } = await supabase.storage.from('Logos')
      .upload(key, readFileSync(path), { contentType: MIME[ext], cacheControl: '31536000', upsert: true });
    if (error) { problems.push(`upload failed for ${file}: ${error.message}`); return null; }
    uploaded++;
    return supabase.storage.from('Logos').getPublicUrl(key).data.publicUrl;
  };

  for (const r of rows) {
    const tag = r.meetName.slice(0, 30).padEnd(31);
    if (r.decision === 'reject' || r.decision === 'link') {
      problems.push(`${r.meetName}: decision "${r.decision}" is not handled by this script`);
      continue;
    }
    const o = r.org;

    const sub = r.submissionId
      ? (await db.select().from(organizationSubmissions).where(eq(organizationSubmissions.id, r.submissionId)))[0]
      : (await db.select().from(organizationSubmissions).where(eq(organizationSubmissions.name, r.meetName)))[0];
    if (!sub) console.log(tag + '(no submission row — creating the organisation anyway)');
    else if (sub.status !== 'pending') { console.log(tag + `already ${sub.status} — left alone`); continue; }

    // Never a second row under a name already taken.
    const clash = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, o.name));
    if (clash.length) {
      problems.push(`"${o.name}" already exists (${clash[0].id}) — link it instead`);
      console.log(tag + 'NAME ALREADY TAKEN -> ' + clash[0].id);
      continue;
    }

    let logoUrl: string | null = null;
    let logoDarkUrl: string | null = null;
    if (o.logoFile) {
      const url = await upload(o.logoFile, tag);
      if (o.logoReversed) logoDarkUrl = url; else logoUrl = url;
    }
    if (o.logoDarkFile) logoDarkUrl = await upload(o.logoDarkFile, tag);

    console.log(tag + 'CREATE   ' + o.name.slice(0, 44).padEnd(45) + (o.stateAssociation ?? '—').padEnd(9)
      + `${o.city ?? '?'}, ${o.state ?? '?'}`.padEnd(22) + (o.mascot ?? '—'));

    if (APPLY) {
      const [row] = await db.insert(organizations).values({
        name: o.name,
        abbreviation: o.abbreviation || r.abbreviation,
        shortName: o.shortName,
        mascot: o.mascot,
        organizationType: o.organizationType as 'high_school',
        genderDesignation: o.genderDesignation,
        ncaaDivision: o.ncaaDivision,
        naiaMember: o.naiaMember,
        jucoMember: o.jucoMember,
        conference: o.conference,
        subConference: o.subConference,
        stateAssociation: o.stateAssociation,
        city: o.city,
        state: o.state,
        country: o.country ?? 'USA',
        primaryColor: o.primaryColor,
        secondaryColor: o.secondaryColor,
        logoUrl,
        logoDarkUrl,
        website: o.website,
        athleticNetId: o.athleticNetId,
        milesplitId: o.milesplitId,
        mshsaaId: o.mshsaaId,
        notes: o.notes,
        isActive: o.isActive !== false,
      } as typeof organizations.$inferInsert).returning({ id: organizations.id });

      if (sub) {
        await db.update(organizationSubmissions)
          .set({
            status: 'approved', organizationId: row.id, reviewedAt: new Date(),
            organizationType: o.organizationType as 'high_school',
            city: o.city, state: o.state,
          })
          .where(eq(organizationSubmissions.id, sub.id));
        closed++;
      }
    }
    created++;
  }

  console.log('');
  console.log(`create ${created}` + (APPLY ? `   logos uploaded ${uploaded}   review entries approved ${closed}` : ''));
  if (problems.length) {
    console.log('\nPROBLEMS:');
    for (const x of problems) console.log('   ' + x);
  }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
