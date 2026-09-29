/**
 * Complete the organisation profiles for the Joe Piane Notre Dame Invitational
 * teams that org matching could not place: Goshen, the University of Rio Grande,
 * and the first two Canadian schools in the table.
 *
 * Run a dry run first — it writes nothing and prints what it would do:
 *   npx tsx scripts/complete-joe-piane-orgs.ts
 * Then, to write:
 *   npx tsx scripts/complete-joe-piane-orgs.ts --apply
 *
 * Same shape as complete-gans-college-orgs.ts, with two differences:
 *
 *   COUNTRY   Western and Windsor are in Ontario. The approval form has no
 *             country field and the column defaults to USA, which would file
 *             them as a state called "ON".
 *
 *   BOTH      All three marks are full colour with their own outline, so each
 *   GROUNDS   one serves light and dark grounds alike — the same file goes in
 *             logoUrl and logoDarkUrl, as the NCAA badges do.
 *
 * Canadian schools compete in U SPORTS, which the table has no column for;
 * it is recorded in the notes, and ncaaDivision / naiaMember stay empty.
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const LOGO_DIR = process.env.JOE_PIANE_LOGO_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos-jp';

interface Plan {
  /** The name the meet used — how the submission is found. */
  meetName: string;
  abbreviation: string;
  org: {
    name: string;
    shortName: string;
    mascot: string;
    naiaMember: boolean;
    conference: string;
    city: string;
    state: string;
    country: string;
    primaryColor: string;
    secondaryColor: string;
    website: string;
    notes: string | null;
    /** File in LOGO_DIR, and where it goes in the Logos bucket. */
    logoFile: string;
    logoKey: string;
  };
}

const PLANS: Plan[] = [
  {
    meetName: 'Goshen', abbreviation: 'GOSH',
    org: {
      name: 'Goshen College', shortName: 'Goshen', mascot: 'Maple Leafs',
      naiaMember: true, conference: 'Crossroads League',
      city: 'Goshen', state: 'IN', country: 'USA',
      primaryColor: '#49176D', secondaryColor: '#FFFFFF',
      website: 'https://goleafs.net/', notes: null,
      logoFile: 'goshen.svg', logoKey: 'naia/goshen.svg',
    },
  },
  {
    meetName: 'Western Ontario', abbreviation: 'ONWE',
    org: {
      // The legal name, and what results services call it. It brands itself
      // Western University, which next to a table full of American "Western"
      // schools would say nothing about where it is.
      name: 'University of Western Ontario', shortName: 'Western Ontario', mascot: 'Mustangs',
      naiaMember: false, conference: 'Ontario University Athletics',
      city: 'London', state: 'ON', country: 'Canada',
      primaryColor: '#4F2683', secondaryColor: '#FFFFFF',
      website: 'https://westernmustangs.ca/',
      notes: 'U SPORTS (Canada). Brands itself as Western University.',
      logoFile: 'western-ontario.svg', logoKey: 'usports/western-ontario.svg',
    },
  },
  {
    meetName: 'Windsor', abbreviation: 'WIN1',
    org: {
      name: 'University of Windsor', shortName: 'Windsor', mascot: 'Lancers',
      naiaMember: false, conference: 'Ontario University Athletics',
      city: 'Windsor', state: 'ON', country: 'Canada',
      // The Lancer team colours, not the university's blue and gold.
      primaryColor: '#0E1B2A', secondaryColor: '#FFC425',
      website: 'https://golancers.ca/',
      notes: 'U SPORTS (Canada). Not Windsor High School or Windsor (Imperial), both Missouri high schools.',
      logoFile: 'windsor.png', logoKey: 'usports/windsor.png',
    },
  },
  {
    // Never submitted: org matching linked it to UT Rio Grande Valley, the only
    // Rio Grande in the table, until the desk unlinked it.
    meetName: 'Rio Grande', abbreviation: 'RIOG',
    org: {
      name: 'University of Rio Grande', shortName: 'Rio Grande', mascot: 'RedStorm',
      naiaMember: true, conference: 'River States Conference',
      city: 'Rio Grande', state: 'OH', country: 'USA',
      primaryColor: '#B5121B', secondaryColor: '#FFFFFF',
      website: 'https://www.rioredstorm.com/',
      notes: 'NAIA, Rio Grande, Ohio. Not the University of Texas Rio Grande Valley (NCAA D1).',
      logoFile: 'rio-grande.png', logoKey: 'naia/rio-grande.png',
    },
  },
];

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg',
};

import('../src/db/client').then(async ({ db }) => {
  const { organizations, organizationSubmissions } = await import('../src/db/schema');
  const { eq } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');

  const supabase = APPLY ? createAdminClient() : null;

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');

  let created = 0; let uploaded = 0;
  const problems: string[] = [];

  for (const p of PLANS) {
    const o = p.org;
    const tag = p.meetName.padEnd(18);
    const subs = await db.select().from(organizationSubmissions)
      .where(eq(organizationSubmissions.name, p.meetName));
    const sub = subs.find((s) => s.status === 'pending') ?? subs[0];
    if (!sub) console.log(tag + '(no submission row — creating the organisation anyway)');
    else if (sub.status !== 'pending') { console.log(tag + `already ${sub.status} — left alone`); continue; }

    const clash = await db.select({ id: organizations.id }).from(organizations)
      .where(eq(organizations.name, o.name));
    if (clash.length) {
      problems.push(`"${o.name}" already exists (${clash[0].id}) — link it instead of creating`);
      console.log(tag + 'NAME ALREADY TAKEN -> ' + clash[0].id);
      continue;
    }

    let logoUrl: string | null = null;
    const file = join(LOGO_DIR, o.logoFile);
    if (!existsSync(file)) {
      problems.push(`logo file missing: ${file}`);
    } else {
      console.log(tag + '  logo   ' + o.logoFile + ' -> Logos/' + o.logoKey + '  (light and dark)');
      if (APPLY && supabase) {
        const ext = o.logoFile.split('.').pop()!.toLowerCase();
        const { error } = await supabase.storage.from('Logos')
          .upload(o.logoKey, readFileSync(file), { contentType: MIME[ext], cacheControl: '31536000', upsert: true });
        if (error) problems.push(`upload failed for ${o.logoFile}: ${error.message}`);
        else { logoUrl = supabase.storage.from('Logos').getPublicUrl(o.logoKey).data.publicUrl; uploaded++; }
      }
    }

    console.log(tag + 'CREATE   ' + o.name.padEnd(32) + (o.naiaMember ? 'NAIA' : 'U SPORTS').padEnd(10)
      + `${o.city}, ${o.state}, ${o.country}`.padEnd(26) + o.mascot);

    if (APPLY) {
      const [row] = await db.insert(organizations).values({
        name: o.name,
        abbreviation: p.abbreviation,
        shortName: o.shortName,
        mascot: o.mascot,
        organizationType: 'college',
        ncaaDivision: null,
        naiaMember: o.naiaMember,
        jucoMember: false,
        conference: o.conference,
        city: o.city,
        state: o.state,
        country: o.country,
        primaryColor: o.primaryColor,
        secondaryColor: o.secondaryColor,
        logoUrl,
        logoDarkUrl: logoUrl,
        website: o.website,
        notes: o.notes,
        isActive: true,
      }).returning({ id: organizations.id });

      if (sub) {
        await db.update(organizationSubmissions)
          .set({
            status: 'approved', organizationId: row.id, reviewedAt: new Date(),
            organizationType: 'college', city: o.city, state: o.state,
          })
          .where(eq(organizationSubmissions.id, sub.id));
      }
      console.log(tag + '         -> ' + row.id);
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
