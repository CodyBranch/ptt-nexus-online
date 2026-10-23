/**
 * Create the organisation profiles for the nine FCSAA Cross Country
 * Championships teams that org matching could not place - Florida College
 * System (NJCAA) schools none of which was in the database.
 *
 * Run a dry run first - it writes nothing and prints what it would do:
 *   npx tsx scripts/complete-fcsaa-orgs.ts
 * Then, to write:
 *   npx tsx scripts/complete-fcsaa-orgs.ts --apply
 *
 * Same shape as complete-fsu-invite-orgs.ts, reading the researched details
 * (official name, association, colours, athletics site, logo) from
 * FCSAA_PLANS_DIR/plans.json, with the logos beside it. Seminole State's
 * blue word mark gets its white-letter header file as logoDarkUrl; PHSC's
 * black lettering has no official white version, so it is light-ground only.
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DIR = process.env.FCSAA_PLANS_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos-fcsaa';

interface Researched {
  meetName: string; abbreviation: string; name: string; shortName: string; mascot: string;
  ncaaDivision: string | null; naiaMember: boolean; jucoMember: boolean; conference: string;
  city: string; state: string; country: string; primaryColor: string; secondaryColor: string;
  website: string; association: string; logoFile: string; logoDarkFile: string | null; logoWorksOnDark: boolean; notes: string;
}

/**
 * The conference as the table carries it - one name - with the association
 * and region moved into the notes. Cross country has no conference of its
 * own here; the research took each school's FCSAA (baseball) conference.
 */
function conferenceOf(p: Researched): { conference: string; note?: string } {
  const [head, ...rest] = p.conference.split(',').map((x) => x.trim());
  const conference = head.startsWith('FCSAA') ? 'FCSAA' : head.replace(/\s*\(.*\)$/, '');
  return { conference, note: `FCSAA; ${p.association}${rest.length ? `, ${rest.join(', ')}` : ''}.` };
}

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
    const conf = conferenceOf(p);

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
