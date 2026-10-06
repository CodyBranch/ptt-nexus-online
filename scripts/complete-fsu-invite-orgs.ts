/**
 * Complete the organisation profiles for the nine FSU XC Invitational teams
 * that org matching could not place - four Florida/Alabama junior colleges
 * and five NAIA schools.
 *
 * Run a dry run first - it writes nothing and prints what it would do:
 *   npx tsx scripts/complete-fsu-invite-orgs.ts
 * Then, to write:
 *   npx tsx scripts/complete-fsu-invite-orgs.ts --apply
 *
 * Same shape as complete-joe-piane-orgs.ts, reading the researched details
 * (official name, association, colours, athletics site, logo) from
 * FSU_PLANS_DIR/plans.json, with the logos beside it.
 *
 *   DARK      Coastal Alabama's word mark is black and Thomas's main mark is
 *   GROUNDS   black: each has its own dark-ground file (gold letters; the
 *             white "TU"), uploaded as logoDarkUrl. A mark that reads on both
 *             grounds goes in both fields, as the NCAA badges do.
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DIR = process.env.FSU_PLANS_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos-fsu';

interface Researched {
  meetName: string; abbreviation: string; name: string; shortName: string; mascot: string;
  ncaaDivision: string | null; naiaMember: boolean; jucoMember: boolean; conference: string;
  city: string; state: string; country: string; primaryColor: string; secondaryColor: string;
  website: string; logoFile: string; logoDarkFile: string | null; logoWorksOnDark: boolean; notes: string;
}

/**
 * The conference as the table carries it - one name - with the region and
 * the rest moved into the notes, where whoever reads the profile wants it.
 */
const CONFERENCE: Record<string, { conference: string; note?: string }> = {
  'Coastal Alabama CC': { conference: 'Alabama Community College Conference', note: 'NJCAA Division II, Region 22.' },
  'Eastern Florida': { conference: 'Citrus Conference', note: 'FCSAA Division I (Citrus Conference); NJCAA Division II, Region 8.' },
  'Florida College': { conference: 'Continental Athletic Conference' },
  'Gulf Coast State College': { conference: 'Panhandle Conference', note: 'FCSAA; NJCAA Division II, Region 8.' },
  'Lake-Sumter State': { conference: 'Sun-Lakes Conference', note: 'FCSAA Division II (Sun-Lakes Conference); NJCAA Division II, Region 8.' },
  'Loyola-New Orleans': { conference: 'Southern States Athletic Conference' },
  'Mobile': { conference: 'Southern States Athletic Conference' },
  'Thomas (Ga.)': { conference: 'Southern States Athletic Conference' },
  'USSU': { conference: 'Continental Athletic Conference', note: 'Moving to the Southern States Athletic Conference in 2027-28.' },
  // The two the meet had linked to the wrong school (UCF, Dayton); run with
  // FSU_PLANS_DIR pointed at their own plans.json.
  'Central Florida': { conference: 'Citrus Conference', note: 'FCSAA Division I; NJCAA Division II, Region 8.' },
  'Daytona State College': { conference: 'Citrus Conference', note: 'FCSAA Division I; NJCAA Division II, Region 8.' },
};

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg',
};

const plans = JSON.parse(readFileSync(join(DIR, 'plans.json'), 'utf8')) as Researched[];

import('../src/db/client').then(async ({ db }) => {
  const { organizations, organizationSubmissions } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');

  const supabase = APPLY ? createAdminClient() : null;
  console.log(APPLY ? 'WRITING\n' : 'DRY RUN - nothing is written\n');

  let created = 0; let uploaded = 0;
  const problems: string[] = [];

  const upload = async (file: string, key: string): Promise<string | null> => {
    const path = join(DIR, file);
    if (!existsSync(path)) { problems.push(`logo file missing: ${path}`); return null; }
    if (!APPLY || !supabase) return `(would be Logos/${key})`;
    const ext = file.split('.').pop()!.toLowerCase();
    const { error } = await supabase.storage.from('Logos')
      .upload(key, readFileSync(path), { contentType: MIME[ext], cacheControl: '31536000', upsert: true });
    if (error) { problems.push(`upload failed for ${file}: ${error.message}`); return null; }
    uploaded++;
    return supabase.storage.from('Logos').getPublicUrl(key).data.publicUrl;
  };

  for (const p of plans) {
    const tag = p.meetName.padEnd(26);
    const conf = CONFERENCE[p.meetName];
    if (!conf) { problems.push(`no conference mapping for ${p.meetName}`); continue; }

    const subs = await db.select().from(organizationSubmissions).where(eq(organizationSubmissions.name, p.meetName));
    const sub = subs.find((s) => s.status === 'pending') ?? subs[0];
    if (!sub) console.log(tag + '(no submission row - creating the organisation anyway)');
    else if (sub.status !== 'pending') { console.log(tag + `already ${sub.status} - left alone`); continue; }

    const clash = await db.select({ id: organizations.id }).from(organizations).where(eq(organizations.name, p.name));
    if (clash.length) {
      problems.push(`"${p.name}" already exists (${clash[0].id}) - link it instead of creating`);
      console.log(tag + 'NAME ALREADY TAKEN -> ' + clash[0].id);
      continue;
    }

    const folder = p.jucoMember ? 'njcaa' : p.naiaMember ? 'naia' : 'other';
    const logoUrl = await upload(p.logoFile, `${folder}/${p.logoFile}`);
    const logoDarkUrl = p.logoDarkFile
      ? await upload(p.logoDarkFile, `${folder}/${p.logoDarkFile}`)
      : p.logoWorksOnDark ? logoUrl : null;

    const assoc = p.jucoMember ? 'NJCAA' : p.naiaMember ? 'NAIA' : (p.ncaaDivision ? `NCAA ${p.ncaaDivision}` : '?');
    console.log(tag + 'CREATE   ' + p.name.padEnd(36) + assoc.padEnd(7) + `${p.city}, ${p.state}`.padEnd(22) + p.mascot);
    console.log(' '.repeat(26) + `         ${conf.conference} | ${p.primaryColor} ${p.secondaryColor} | ${p.website}`);
    console.log(' '.repeat(26) + `         logo ${p.logoFile}` + (p.logoDarkFile ? ` + dark ${p.logoDarkFile}` : p.logoWorksOnDark ? ' (both grounds)' : ' (light only)'));

    const notes = [conf.note, p.notes].filter(Boolean).join(' ');
    if (APPLY) {
      const [row] = await db.insert(organizations).values({
        name: p.name,
        abbreviation: p.abbreviation,
        shortName: p.shortName,
        mascot: p.mascot,
        organizationType: 'college',
        ncaaDivision: p.ncaaDivision,
        naiaMember: p.naiaMember,
        jucoMember: p.jucoMember,
        conference: conf.conference,
        city: p.city,
        state: p.state,
        country: p.country || 'USA',
        primaryColor: p.primaryColor,
        secondaryColor: p.secondaryColor,
        logoUrl,
        logoDarkUrl,
        website: p.website,
        notes,
        isActive: true,
      }).returning({ id: organizations.id });

      if (sub) {
        await db.update(organizationSubmissions)
          .set({ status: 'approved', organizationId: row.id, reviewedAt: new Date(), organizationType: 'college', city: p.city, state: p.state })
          .where(eq(organizationSubmissions.id, sub.id));
      }
      console.log(' '.repeat(26) + '         -> ' + row.id);
    }
    created++;
  }

  console.log('');
  console.log(`create ${created}` + (APPLY ? `   logos uploaded ${uploaded}` : ''));
  if (problems.length) {
    console.log('\nPROBLEMS:');
    for (const x of problems) console.log('   ' + x);
  }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
