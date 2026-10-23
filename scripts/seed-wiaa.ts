/**
 * Seed Wisconsin's schools from the WIAA directory package (630 schools,
 * pulled October 2026: data/wiaa_schools.json, data/logo_colors.csv and
 * logos_512_transparent/).
 *
 * Which: the schools with a cross country or track and field team (509 - 484
 * high, 25 middle). Every one is a full WIAA member.
 *
 * Named as Missouri's are: "Abbotsford High School", with WIAA's own short
 * name ("Abbotsford") as the abbreviation, unless the name already says what
 * it is (School, Academy, Prep...). Middle schools: "Abbotsford Middle
 * School", "Ben Franklin Junior High School". WIAA's list cuts long names off
 * ("...Conservatory of Lif..."); the three it cut are spelled out from their
 * WIAA profile pages.
 *
 * Colors, as the package's README says: its primary and secondary from the
 * logo, except where the logo is black, white and gray only, where it has no
 * logo, or where the logo plainly disagrees with WIAA's listed colors
 * (MISMATCH): there WIAA's listed colors, as standard shades.
 *
 * Tags: high schools carry WIAA (Wisconsin), a governing body under High
 * School (slug wiaa-wi: Washington's association is also WIAA); middle
 * schools carry Middle School.
 *
 * Logos to the Logos bucket under wiaa/. Idempotent: a school is found again
 * by state association WIAA + abbreviation, and updated rather than added.
 *
 *   npx tsx scripts/seed-wiaa.ts             (dry run)
 *   npx tsx scripts/seed-wiaa.ts --apply
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DIR = process.env.WIAA_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/wiaa-in/pkg/WIAA_Wisconsin_Schools';

interface School {
  org_id: number; name: string; level: string; school_class: string; city: string; nickname: string | null;
  colors: string | null; conference: string | null; member_type: string; wiaa_district: string | null;
  enrollment: number | null; state: string; website: string | null; logo_file: string | null;
  teams: Array<{ sport: string }>;
}

/** WIAA's list cut these off; the full names are on their profile pages. */
const FULL_NAMES: Record<number, string> = {
  271: 'Milwaukee WI Conservatory of Lifelong Learning',
  5084: 'Providence Academy Middle (La Crosse)',
  5086: 'Saint Paul Lutheran School (Stevens Point)',
};

/** Abbreviated places in WIAA's names, spelled out in the full name only. */
const PLACES: Array<[RegExp, string]> = [[/\(Wms Bay\)/, '(Williams Bay)']];

/** WIAA's color words, as standard shades. */
const SHADES: Array<[RegExp, string]> = [
  [/^navy( blue)?$/, '#0C2340'], [/^royal( blue)?$/, '#0033A0'], [/^columbia blue$/, '#9BCBEB'], [/^(light|sky) blue$/, '#6CACE4'],
  [/^blue$/, '#0033A0'], [/^cardinal$/, '#9D2235'], [/^scarlet$/, '#BB0000'], [/^crimson$/, '#9E1B32'], [/^maroon$/, '#7A0019'],
  [/^red$/, '#C8102E'], [/^burnt orange$/, '#BF5700'], [/^orange$/, '#F47321'], [/^vegas gold$/, '#C5B358'], [/^old gold$/, '#CFB53B'],
  [/^(royal )?gold$/, '#FFC72C'], [/^maize$/, '#FFCB05'], [/^yellow$/, '#FFD100'], [/^kelly green$/, '#4CBB17'],
  [/^forest green$/, '#154734'], [/^green$/, '#006A4E'], [/^teal$/, '#00797C'], [/^purple$/, '#4F2683'], [/^magenta$/, '#C4007A'],
  [/^black$/, '#000000'], [/^white$/, '#FFFFFF'], [/^silver$/, '#A2AAAD'], [/^gr[ae]y$/, '#8A8D8F'], [/^brown$/, '#4E3629'],
];

function listedShades(colors: string | null): string[] {
  if (!colors || /not provided/i.test(colors)) return [];
  return colors.toLowerCase().split(/,|&|\band\b|\bwith\b/).map((w) => w.trim()).filter(Boolean)
    .map((w) => SHADES.find(([re]) => re.test(w))?.[1]).filter((h): h is string => !!h);
}

function parseCsv(text: string): Array<Record<string, string>> {
  const rows: string[][] = []; let row: string[] = []; let cell = ''; let q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (c === '"') q = false; else cell += c; continue; }
    if (c === '"') q = true; else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n') { row.push(cell.replace(/\r$/, '')); rows.push(row); row = []; cell = ''; } else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  const [head, ...body] = rows;
  return body.filter((r) => r.length > 1).map((r) => Object.fromEntries(head.map((h, i) => [h, r[i] ?? ''])));
}

const SAYS_WHAT_IT_IS = /\b(school|academy|high|prep|preparatory|institute|conservatory|collegiate|learning center)\b/i;

function fullName(s: School, short: string): string {
  if (s.level === 'Middle School') {
    if (/\bjunior high$/i.test(short)) return `${short} School`;
    if (/\bmiddle$/i.test(short)) return `${short} School`;
    return SAYS_WHAT_IT_IS.test(short) || /middle school/i.test(short) ? short : `${short} Middle School`;
  }
  if (SAYS_WHAT_IT_IS.test(short)) return short;
  const paren = short.match(/^(.*?)\s*(\([^)]*\))$/);
  return paren ? `${paren[1]} High School ${paren[2]}` : `${short} High School`;
}

const slugOf = (s: string) => s.toLowerCase().normalize('NFKD').replace(/[^\w\s-]/g, '').trim().replace(/[\s_]+/g, '-').replace(/-+/g, '-');

const schools = (JSON.parse(readFileSync(join(DIR, 'data', 'wiaa_schools.json'), 'utf8')) as School[])
  .filter((s) => s.teams.some((t) => /cross country|track/i.test(t.sport)));
const colorRows = new Map(parseCsv(readFileSync(join(DIR, 'data', 'logo_colors.csv'), 'utf8')).map((r) => [Number(r.org_id), r]));

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags } = await import('../src/db/schema');
  const { eq, and } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');
  const supabase = APPLY ? createAdminClient() : null;
  console.log(APPLY ? 'WRITING\n' : 'DRY RUN - nothing is written\n');

  // Tags: WIAA (Wisconsin) under High School, made if missing; Middle School.
  const [hs] = await db.select().from(orgTags).where(eq(orgTags.slug, 'high-school'));
  const [ms] = await db.select().from(orgTags).where(eq(orgTags.slug, 'middle-school'));
  if (!hs || !ms) throw new Error('high-school or middle-school tag missing');
  let [wiaa] = await db.select().from(orgTags).where(eq(orgTags.slug, 'wiaa-wi'));
  if (!wiaa) {
    console.log('tag      WIAA (Wisconsin)  wiaa-wi  (under High School)');
    if (APPLY) [wiaa] = await db.insert(orgTags).values({ kind: 'governing_body', name: 'WIAA (Wisconsin)', slug: 'wiaa-wi', parentId: hs.id, sortOrder: 20 }).returning();
  }

  const tally = { created: 0, updated: 0, logos: 0, noLogo: 0, colorFromLogo: 0, colorFromWiaa: 0, colorNone: 0, failed: 0 };
  const problems: string[] = [];
  const renamed: string[] = [];

  for (const s of schools) {
    const short = FULL_NAMES[s.org_id] ?? s.name;
    const name = PLACES.reduce((n, [re, to]) => n.replace(re, to), fullName(s, short));
    if (name !== `${short} High School`) renamed.push(`${s.name} -> ${name}`);
    const middle = s.level === 'Middle School';

    // Colors.
    const c = colorRows.get(s.org_id);
    const listed = listedShades(s.colors);
    const useListed = !c || c.wiaa_match === 'logo is neutrals only' || c.wiaa_match === 'MISMATCH' || !c.primary_hex;
    let primary: string | null; let secondary: string | null;
    if (!useListed) { primary = c!.primary_hex || null; secondary = c!.secondary_hex || null; tally.colorFromLogo++; }
    else if (listed.length) { primary = listed[0]; secondary = listed[1] ?? null; tally.colorFromWiaa++; }
    else { primary = c?.primary_hex || null; secondary = c?.secondary_hex || null; tally.colorNone++; }

    // The logo.
    const png = c?.logo_png;
    const logoPath = png ? join(DIR, 'logos_512_transparent', png) : null;
    let logoUrl: string | null = null;
    if (logoPath && existsSync(logoPath)) {
      const key = `wiaa/${slugOf(name)}.png`;
      if (APPLY && supabase) {
        const { error } = await supabase.storage.from('Logos').upload(key, readFileSync(logoPath), { contentType: 'image/png', cacheControl: '31536000', upsert: true });
        if (error) { problems.push(`logo ${png}: ${error.message}`); } else { logoUrl = supabase.storage.from('Logos').getPublicUrl(key).data.publicUrl; tally.logos++; }
      } else { logoUrl = `(Logos/${key})`; tally.logos++; }
    } else tally.noLogo++;

    const notes = [`WIAA #${s.org_id}`, s.school_class, s.wiaa_district ? `WIAA district ${s.wiaa_district}` : null,
      s.enrollment ? `enrollment ${s.enrollment}` : null, s.colors ? `WIAA colors: ${s.colors}` : null].filter(Boolean).join('; ') + '.';
    const values = {
      name, abbreviation: short, mascot: s.nickname || null,
      organizationType: middle ? 'middle_school' : 'high_school',
      conference: s.conference || null, stateAssociation: 'WIAA',
      city: s.city || null, state: 'WI', country: 'USA',
      primaryColor: primary, secondaryColor: secondary,
      ...(logoUrl && !logoUrl.startsWith('(') ? { logoUrl } : {}),
      website: s.website || null, notes, isActive: true,
    };

    try {
      const [have] = await db.select({ id: organizations.id }).from(organizations)
        .where(and(eq(organizations.stateAssociation, 'WIAA'), eq(organizations.abbreviation, short), eq(organizations.state, 'WI')));
      let id = have?.id;
      if (APPLY) {
        if (id) await db.update(organizations).set({ ...values, updatedAt: new Date() }).where(eq(organizations.id, id));
        else [{ id }] = await db.insert(organizations).values(values).returning({ id: organizations.id });
        const tag = middle ? ms.id : wiaa!.id;
        await db.insert(organizationTags).values({ organizationId: id!, tagId: tag }).onConflictDoNothing();
      }
      if (have) tally.updated++; else tally.created++;
    } catch (e) {
      tally.failed++; problems.push(`${name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`${schools.length} schools with cross country or track (${schools.filter((s) => s.level === 'Middle School').length} middle)`);
  console.log(`create ${tally.created}   update ${tally.updated}   failed ${tally.failed}`);
  console.log(`logos ${tally.logos}   without a logo ${tally.noLogo}`);
  console.log(`colors: from the logo ${tally.colorFromLogo}   WIAA's listed ${tally.colorFromWiaa}   neither (logo's neutrals kept) ${tally.colorNone}`);
  console.log(`\nnamed otherwise than "<WIAA name> High School" (${renamed.length}):`);
  for (const r of renamed) console.log('   ' + r);
  if (problems.length) { console.log('\nPROBLEMS:'); for (const p of problems) console.log('   ' + p); }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
