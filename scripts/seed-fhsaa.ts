/**
 * Seed Florida's high schools (FHSAA) from the researched dataset
 * (FHSAA_DIR/schools.json and logos/), built from the Hy-Tek team list (822
 * schools), FHSAA's team codes and classes, and three logo sets.
 *
 * Named by each school's official name, with its Hy-Tek team code as the
 * abbreviation (the code an entry file carries, so org matching finds it) and
 * the common name ("Admiral Farragut") as the short name. City, mascot,
 * colors and website as researched; FHSAA id, codes and classes in the notes.
 *
 * Tagged FHSAA (Florida), a governing body under High School, so a High
 * School search finds them. Logos to the Logos bucket under fhsaa/{code}.png,
 * and a dark-ground file where the research found an official one.
 *
 * Idempotent: a school is found again by state association FHSAA + its code,
 * and updated rather than added.
 *
 *   npx tsx scripts/seed-fhsaa.ts             (dry run)
 *   npx tsx scripts/seed-fhsaa.ts --apply
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, existsSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const APPLY = process.argv.includes('--apply');
const DIR = process.env.FHSAA_DIR
  ?? 'C:/Users/PTT/AppData/Local/Temp/claude/C--Development-ptt-nexus-manager-xc/28974cc2-4ef8-4c24-82e4-3a3a4491f7c3/scratchpad/fhsaa-out';

interface School {
  hytekCode: string; hytekName: string | null; commonName: string | null; name: string; shortName: string | null;
  city: string | null; state: string | null; mascot: string | null; primaryColor: string | null; secondaryColor: string | null;
  website: string | null; fhsaaId: string | number | null; fhsaaCode: string | null; tfrrsCode: string | null;
  trackClass: string | null; xcClass: string | null; public: boolean | null;
  logoFile: string | null; logoWorksOnDark: boolean | null; logoDarkFile: string | null;
  confidence: string | null; notes: string | null;
}

const HEX = /^#[0-9A-Fa-f]{6}$/;
const hex = (c: string | null) => (c && HEX.test(c) ? c.toUpperCase() : null);

const schools = JSON.parse(readFileSync(join(DIR, 'schools.json'), 'utf8')) as School[];

import('../src/db/client').then(async ({ db }) => {
  const { organizations, orgTags, organizationTags } = await import('../src/db/schema');
  const { eq, and } = await import('drizzle-orm');
  const { createAdminClient } = await import('../src/lib/supabase/admin');
  const supabase = APPLY ? createAdminClient() : null;
  console.log(APPLY ? 'WRITING\n' : 'DRY RUN - nothing is written\n');

  const [hs] = await db.select().from(orgTags).where(eq(orgTags.slug, 'high-school'));
  if (!hs) throw new Error('high-school tag missing');
  let [fhsaa] = await db.select().from(orgTags).where(eq(orgTags.slug, 'fhsaa'));
  if (!fhsaa) {
    console.log('tag      FHSAA (Florida)  fhsaa  (under High School)');
    if (APPLY) [fhsaa] = await db.insert(orgTags).values({ kind: 'governing_body', name: 'FHSAA (Florida)', slug: 'fhsaa', parentId: hs.id, sortOrder: 21 }).returning();
  }

  const upload = async (file: string, key: string): Promise<string | null> => {
    const path = join(DIR, 'logos', file);
    if (!existsSync(path)) return null;
    if (!APPLY || !supabase) return `(Logos/${key})`;
    const { error } = await supabase.storage.from('Logos').upload(key, readFileSync(path), { contentType: 'image/png', cacheControl: '31536000', upsert: true });
    if (error) throw new Error(`logo ${file}: ${error.message}`);
    return supabase.storage.from('Logos').getPublicUrl(key).data.publicUrl;
  };

  const tally = { created: 0, updated: 0, logos: 0, dark: 0, noLogo: 0, mascot: 0, colors: 0, failed: 0 };
  const problems: string[] = [];
  const seen = new Set<string>();

  for (const s of schools) {
    const code = (s.hytekCode ?? '').trim().toUpperCase();
    if (!code || !s.name) { problems.push(`no code or name: ${JSON.stringify(s).slice(0, 120)}`); continue; }
    if (seen.has(code)) { problems.push(`code ${code} twice - second skipped`); continue; }
    seen.add(code);
    try {
      const logoUrl = s.logoFile ? await upload(s.logoFile, `fhsaa/${code}.png`) : null;
      const darkUrl = s.logoDarkFile ? await upload(s.logoDarkFile, `fhsaa/${code}-dark.png`)
        : s.logoWorksOnDark ? logoUrl : null;
      if (logoUrl) tally.logos++; else tally.noLogo++;
      if (s.logoDarkFile && darkUrl) tally.dark++;
      if (s.mascot) tally.mascot++;
      if (hex(s.primaryColor)) tally.colors++;

      const notes = [
        s.fhsaaId ? `FHSAA #${s.fhsaaId}` : null,
        s.public === true ? 'Public' : s.public === false ? 'Private' : null,
        s.trackClass ? `track ${s.trackClass}` : null, s.xcClass ? `cross country ${s.xcClass}` : null,
        s.hytekName ? `Hy-Tek: ${s.hytekName}` : null, s.tfrrsCode && s.tfrrsCode !== code ? `TFRRS code ${s.tfrrsCode}` : null,
        s.notes || null,
      ].filter(Boolean).join('; ');
      const values = {
        name: s.name.trim(), abbreviation: code, shortName: s.shortName?.trim() || null, mascot: s.mascot?.trim() || null,
        organizationType: 'high_school', stateAssociation: 'FHSAA',
        city: s.city?.trim() || null, state: 'FL', country: 'USA',
        primaryColor: hex(s.primaryColor), secondaryColor: hex(s.secondaryColor),
        ...(logoUrl && !logoUrl.startsWith('(') ? { logoUrl } : {}),
        ...(darkUrl && !darkUrl.startsWith('(') ? { logoDarkUrl: darkUrl } : {}),
        website: s.website?.trim() || null, notes: notes ? `${notes}.` : null, isActive: true,
      };
      const [have] = await db.select({ id: organizations.id }).from(organizations)
        .where(and(eq(organizations.stateAssociation, 'FHSAA'), eq(organizations.abbreviation, code), eq(organizations.state, 'FL')));
      let id = have?.id;
      if (APPLY) {
        if (id) await db.update(organizations).set({ ...values, updatedAt: new Date() }).where(eq(organizations.id, id));
        else [{ id }] = await db.insert(organizations).values(values).returning({ id: organizations.id });
        await db.insert(organizationTags).values({ organizationId: id!, tagId: fhsaa!.id }).onConflictDoNothing();
      }
      if (have) tally.updated++; else tally.created++;
    } catch (e) {
      tally.failed++; problems.push(`${code} ${s.name}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  console.log(`${schools.length} schools in the dataset`);
  console.log(`create ${tally.created}   update ${tally.updated}   failed ${tally.failed}`);
  console.log(`logos ${tally.logos} (dark-ground files ${tally.dark})   without a logo ${tally.noLogo}`);
  console.log(`with a mascot ${tally.mascot}   with colors ${tally.colors}`);
  if (problems.length) { console.log('\nPROBLEMS:'); for (const p of problems) console.log('   ' + p); }
  process.exit(problems.length ? 1 : 0);
}).catch((e) => { console.error(e); process.exit(1); });
