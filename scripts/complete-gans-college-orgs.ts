/**
 * Complete the organisation profiles for the Gans Creek Classic College teams
 * that org matching could not place.
 *
 * Run a dry run first — it writes nothing and prints what it would do:
 *   npx tsx scripts/complete-gans-college-orgs.ts
 * Then, to write:
 *   npx tsx scripts/complete-gans-college-orgs.ts --apply
 *
 * Three kinds of outcome, and the difference matters:
 *
 *   LINK      the school is already an organisation and matching simply missed
 *             it. Colorado School of Mines is in here twice over — approving a
 *             second one would give every results page two of it forever.
 *
 *   CREATE    an NAIA or NJCAA programme the table genuinely does not have.
 *             The seed was NCAA plus MSHSAA, so these were never in it.
 *
 *   REJECT    "Unattached" and the UNA- rows. They are not schools; they are
 *             how a meet records somebody running for nobody. A permanent
 *             organisation called Unattached would be matched against by every
 *             meet that ever ran one.
 *
 * Logos are uploaded to the Logos bucket rather than linked where they sit.
 * Every athletics site here is behind a WAF that already refuses automated
 * requests, so a hotlink would be a badge that works until the first timing
 * laptop tries to fetch it. Three of them are reversed marks — white artwork
 * meant for a dark background — and those go in logoDarkUrl, because the
 * desktop draws a badge on a white tile and a white logo on it is nothing.
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const LOGO_DIR = process.env.GANS_LOGO_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/logos';

interface Plan {
  /** The name the meet used — how the submission is found. */
  meetName: string;
  abbreviation: string;
  /** LINK to an existing org by exact name, instead of creating one. */
  linkToExisting?: string;
  reject?: string;
  org?: {
    name: string;
    shortName: string;
    mascot: string | null;
    organizationType: 'college' | 'club';
    ncaaDivision: string | null;
    naiaMember: boolean;
    jucoMember: boolean;
    conference: string | null;
    city: string;
    state: string;
    primaryColor: string | null;
    secondaryColor: string | null;
    website: string | null;
    notes: string | null;
    /** File in LOGO_DIR. `reversed` means it is white artwork for dark grounds. */
    logoFile?: string;
    logoReversed?: boolean;
  };
}

const PLANS: Plan[] = [
  {
    meetName: 'Colo. Sch. of Mines', abbreviation: 'MINE',
    linkToExisting: 'Colorado School of Mines',
  },
  {
    meetName: 'Baker', abbreviation: 'BAKS',
    org: {
      name: 'Baker University', shortName: 'Baker', mascot: 'Wildcats',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Heart of America Athletic Conference',
      city: 'Baldwin City', state: 'KS',
      primaryColor: '#002D62', secondaryColor: '#F58025',
      website: 'https://bakerwildcats.com/', notes: null,
      logoFile: 'baker.svg',
    },
  },
  {
    meetName: 'Benedictine (Kan.)', abbreviation: 'BEKS',
    org: {
      name: 'Benedictine College', shortName: 'Benedictine (Kan.)', mascot: 'Ravens',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Heart of America Athletic Conference',
      city: 'Atchison', state: 'KS',
      primaryColor: '#000000', secondaryColor: '#C8102E',
      website: 'https://ravenathletics.com/',
      notes: 'Not Benedictine University (NCAA D3, Lisle, Ill.) — a different school.',
      logoFile: 'benedictine-kan.svg',
    },
  },
  {
    meetName: 'Bethel (Ind.)', abbreviation: 'BEIN',
    org: {
      // Disambiguated on purpose: Bethel University (NCAA D3, St. Paul, Minn.)
      // is already in this table under the bare name.
      name: 'Bethel University (Ind.)', shortName: 'Bethel (Ind.)', mascot: 'Pilots',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Crossroads League',
      city: 'Mishawaka', state: 'IN',
      primaryColor: '#00539B', secondaryColor: '#FFFFFF',
      website: 'https://bupilots.com/',
      notes: 'Distinct from Bethel University (NCAA D3, St. Paul, Minn.), which shares the name.',
      logoFile: 'bethel-ind.svg',
    },
  },
  {
    meetName: 'Colby CC', abbreviation: 'CCC2',
    org: {
      name: 'Colby Community College', shortName: 'Colby CC', mascot: 'Trojans',
      organizationType: 'college', ncaaDivision: null, naiaMember: false, jucoMember: true,
      conference: 'Kansas Jayhawk Community College Conference',
      city: 'Colby', state: 'KS',
      primaryColor: '#003D7D', secondaryColor: '#FFFFFF',
      website: 'https://colbytrojans.com/',
      notes: 'NJCAA Division I. Not Colby College (Maine) or Colby-Sawyer.',
      logoFile: 'colby-cc.png',
    },
  },
  {
    meetName: 'Columbia (Mo.)', abbreviation: 'COL1',
    org: {
      name: 'Columbia College (Mo.)', shortName: 'Columbia (Mo.)', mascot: 'Cougars',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'American Midwest Conference',
      city: 'Columbia', state: 'MO',
      primaryColor: '#041E42', secondaryColor: '#A2AAAD',
      website: 'https://www.columbiacougars.com/',
      notes: 'Light-background badge still wanted; only the reversed mark was available.',
      logoFile: 'columbia-mo.svg', logoReversed: true,
    },
  },
  {
    meetName: 'Cornerstone', abbreviation: 'COM3',
    org: {
      name: 'Cornerstone University', shortName: 'Cornerstone', mascot: 'Golden Eagles',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Wolverine-Hoosier Athletic Conference',
      city: 'Grand Rapids', state: 'MI',
      primaryColor: '#001F5B', secondaryColor: '#C5B358',
      website: 'https://cugoldeneagles.com/', notes: null,
      logoFile: 'cornerstone.svg',
    },
  },
  {
    meetName: 'Doane', abbreviation: 'DOAN',
    org: {
      name: 'Doane University', shortName: 'Doane', mascot: 'Tigers',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Great Plains Athletic Conference',
      city: 'Crete', state: 'NE',
      primaryColor: '#F47920', secondaryColor: '#000000',
      website: 'https://doaneathletics.com/',
      notes: 'Institutional wordmark; an athletics mark would be better.',
      logoFile: 'doane.svg',
    },
  },
  {
    meetName: 'Indiana Wesleyan', abbreviation: 'INI3',
    org: {
      name: 'Indiana Wesleyan University', shortName: 'Indiana Wesleyan', mascot: 'Wildcats',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Crossroads League',
      city: 'Marion', state: 'IN',
      primaryColor: '#B3121D', secondaryColor: '#808285',
      website: 'https://iwuwildcats.com/', notes: null,
      logoFile: 'indiana-wesleyan.webp',
    },
  },
  {
    meetName: 'Iowa Western CC', abbreviation: 'IAWE',
    org: {
      name: 'Iowa Western Community College', shortName: 'Iowa Western CC', mascot: 'Reivers',
      organizationType: 'college', ncaaDivision: null, naiaMember: false, jucoMember: true,
      conference: 'Iowa Community College Athletic Conference',
      city: 'Council Bluffs', state: 'IA',
      primaryColor: '#00539B', secondaryColor: '#FFFFFF',
      website: 'https://goreivers.com/',
      notes: 'NJCAA Division I. Light-background badge still wanted; only the reversed mark was available.',
      logoFile: 'iowa-western.png', logoReversed: true,
    },
  },
  {
    meetName: 'Oklahoma City', abbreviation: 'OKO2',
    org: {
      name: 'Oklahoma City University', shortName: 'Oklahoma City', mascot: 'Stars',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Sooner Athletic Conference',
      city: 'Oklahoma City', state: 'OK',
      primaryColor: '#003DA5', secondaryColor: '#FFFFFF',
      website: 'https://www.ocusports.com/', notes: null,
      logoFile: 'oklahoma-city.webp',
    },
  },
  {
    meetName: 'Park U.', abbreviation: 'PAMO',
    org: {
      name: 'Park University', shortName: 'Park', mascot: 'Pirates',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Heart of America Athletic Conference',
      city: 'Parkville', state: 'MO',
      primaryColor: '#7B2132', secondaryColor: '#F2C75C',
      website: 'https://parkathletics.com/',
      notes: 'Parkville campus (Pirates); the Gilbert, Ariz. campus competes as the Buccaneers.',
      logoFile: 'park.webp',
    },
  },
  {
    meetName: 'St. Mary (Kan.)', abbreviation: 'SMKS',
    org: {
      name: 'University of Saint Mary', shortName: 'St. Mary (Kan.)', mascot: 'Spires',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Kansas Collegiate Athletic Conference',
      city: 'Leavenworth', state: 'KS',
      primaryColor: '#002F6C', secondaryColor: '#FFC72C',
      website: 'https://www.gospires.com/',
      notes: 'Not any of the several St. Mary\'s colleges already in this table.',
      logoFile: 'st-mary-kan.webp',
    },
  },
  {
    meetName: 'Taylor', abbreviation: 'TAYL',
    org: {
      name: 'Taylor University', shortName: 'Taylor', mascot: 'Trojans',
      organizationType: 'college', ncaaDivision: null, naiaMember: true, jucoMember: false,
      conference: 'Crossroads League',
      city: 'Upland', state: 'IN',
      primaryColor: '#4B2E83', secondaryColor: '#C5B358',
      website: 'https://taylortrojans.com/',
      notes: 'Light-background badge still wanted; only the reversed mark was available.',
      logoFile: 'taylor.png', logoReversed: true,
    },
  },
  {
    meetName: 'Missouri Running Club', abbreviation: 'MIS2',
    org: {
      name: 'Missouri Running Club', shortName: 'Missouri Run Club', mascot: null,
      organizationType: 'club', ncaaDivision: null, naiaMember: false, jucoMember: false,
      conference: null,
      city: 'Columbia', state: 'MO',
      primaryColor: null, secondaryColor: null,
      website: null,
      notes: 'Student running club, not a varsity programme. Entered at Gans Creek 2026.',
    },
  },
  { meetName: 'Unattached', abbreviation: 'UNA', reject: 'Not a school — how a meet records a runner with no team.' },
  { meetName: 'UNA-Missouri', abbreviation: 'U-M3', reject: 'Unattached runners, not an organisation.' },
  { meetName: 'UNA-Rockhurst', abbreviation: 'U-RO', reject: 'Unattached runners, not an organisation.' },
];

const MIME: Record<string, string> = {
  svg: 'image/svg+xml', png: 'image/png', webp: 'image/webp', jpg: 'image/jpeg', gif: 'image/gif',
};

import('../src/db/client').then(async ({ db }) => {
  const { organizations, organizationSubmissions } = await import('../src/db/schema');
  const { eq, and } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');

  const supabase = APPLY ? createAdminClient() : null;

  console.log(APPLY ? 'WRITING\n' : 'DRY RUN — nothing is written\n');

  let created = 0; let linked = 0; let rejected = 0; let uploaded = 0;
  const problems: string[] = [];

  for (const p of PLANS) {
    const subs = await db.select().from(organizationSubmissions)
      .where(eq(organizationSubmissions.name, p.meetName));
    const sub = subs[0];
    const tag = p.meetName.padEnd(24);

    // A school can be unmatched in the meet without ever having been submitted
    // — Cornerstone is. The organisation is still worth creating; there is just
    // no review row to close afterwards.
    if (!sub && !p.reject && !p.linkToExisting) {
      console.log(tag + '(no submission row — creating the organisation anyway)');
    } else if (!sub) {
      console.log(tag + 'NO SUBMISSION ROW — nothing to do');
      continue;
    } else if (sub.status !== 'pending') {
      console.log(tag + `already ${sub.status} — left alone`);
      continue;
    }

    // ── Reject ──
    if (p.reject) {
      console.log(tag + 'REJECT   ' + p.reject);
      if (APPLY && sub) {
        await db.update(organizationSubmissions)
          .set({ status: 'rejected', reviewNote: p.reject, reviewedAt: new Date() })
          .where(eq(organizationSubmissions.id, sub.id));
      }
      rejected++;
      continue;
    }

    // ── Link to one already here ──
    if (p.linkToExisting) {
      const found = await db.select().from(organizations)
        .where(eq(organizations.name, p.linkToExisting));
      if (!found.length) { problems.push(`"${p.linkToExisting}" is not in organizations`); console.log(tag + 'LINK TARGET MISSING'); continue; }
      console.log(tag + 'LINK     -> ' + found[0].name + '  (' + found[0].id + ')');
      if (APPLY && sub) {
        await db.update(organizationSubmissions)
          .set({
            status: 'approved', organizationId: found[0].id, reviewedAt: new Date(),
            organizationType: 'college',
            reviewNote: 'Already in the org table — matching missed it.',
          })
          .where(eq(organizationSubmissions.id, sub.id));
      }
      linked++;
      continue;
    }

    const o = p.org!;

    // Refuse to create a second row under a name that is already taken, which
    // is the one mistake here that cannot be quietly undone later.
    const clash = await db.select({ id: organizations.id, name: organizations.name })
      .from(organizations).where(eq(organizations.name, o.name));
    if (clash.length) {
      problems.push(`"${o.name}" already exists (${clash[0].id}) — link it instead of creating`);
      console.log(tag + 'NAME ALREADY TAKEN -> ' + clash[0].id);
      continue;
    }

    // ── Logo into our own storage ──
    let logoUrl: string | null = null;
    let logoDarkUrl: string | null = null;
    if (o.logoFile) {
      const file = join(LOGO_DIR, o.logoFile);
      if (!existsSync(file)) {
        problems.push(`logo file missing: ${file}`);
      } else {
        const ext = o.logoFile.split('.').pop()!.toLowerCase();
        const key = `naia/${o.logoFile}`;
        const where = o.logoReversed ? 'logoDarkUrl' : 'logoUrl';
        console.log(tag + '  logo   ' + o.logoFile + ' -> Logos/' + key + '  (' + where + ')');
        if (APPLY && supabase) {
          const body = readFileSync(file);
          const { error } = await supabase.storage.from('Logos')
            .upload(key, body, { contentType: MIME[ext], cacheControl: '31536000', upsert: true });
          if (error) { problems.push(`upload failed for ${o.logoFile}: ${error.message}`); }
          else {
            const { data } = supabase.storage.from('Logos').getPublicUrl(key);
            if (o.logoReversed) logoDarkUrl = data.publicUrl; else logoUrl = data.publicUrl;
            uploaded++;
          }
        }
      }
    }

    const level = o.ncaaDivision ? 'NCAA ' + o.ncaaDivision : o.naiaMember ? 'NAIA' : o.jucoMember ? 'NJCAA' : o.organizationType;
    console.log(tag + 'CREATE   ' + o.name.padEnd(34) + level.padEnd(7)
      + (o.city + ', ' + o.state).padEnd(20) + (o.mascot ?? '—'));

    if (APPLY) {
      const [row] = await db.insert(organizations).values({
        name: o.name,
        abbreviation: p.abbreviation,
        shortName: o.shortName,
        mascot: o.mascot,
        organizationType: o.organizationType,
        ncaaDivision: o.ncaaDivision,
        naiaMember: o.naiaMember,
        jucoMember: o.jucoMember,
        conference: o.conference,
        city: o.city,
        state: o.state,
        country: 'USA',
        primaryColor: o.primaryColor,
        secondaryColor: o.secondaryColor,
        logoUrl,
        logoDarkUrl,
        website: o.website,
        notes: o.notes,
        isActive: true,
      }).returning({ id: organizations.id });

      if (sub) {
        await db.update(organizationSubmissions)
          .set({
            status: 'approved', organizationId: row.id, reviewedAt: new Date(),
            organizationType: o.organizationType,
            city: o.city, state: o.state,
          })
          .where(eq(organizationSubmissions.id, sub.id));
      }
    }
    created++;
  }

  console.log('');
  console.log(`create ${created}   link ${linked}   reject ${rejected}` + (APPLY ? `   logos uploaded ${uploaded}` : ''));
  if (problems.length) {
    console.log('');
    console.log('PROBLEMS:');
    for (const x of problems) console.log('   ' + x);
  }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
