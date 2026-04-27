// Seed Missouri high schools from MSHSAA scraper output into the organizations table.
// Run with:  npx tsx scripts/seed-mshsaa.ts
//
// Source: C:\Node\mshsaa-scraper\out\mshsaa-schools.jsonl (one JSON object per line)
// Fields used: s, schoolName, teamHex, teamHexSecondary, mascot, boyMascot, girlMascot,
//              logoUrl, city, state
//
// Uses remote MSHSAA logo URLs directly — no Supabase Storage upload required.
// Upserts on mshsaa_id so the script is safe to re-run after re-scraping.

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { createReadStream } from 'fs';
import { createInterface } from 'readline';

config({ path: resolve(process.cwd(), '.env.local') });

// Import DB after env is loaded
import('../src/db/client').then(async ({ db }) => {
  const { organizations } = await import('../src/db/schema');
  const { sql } = await import('drizzle-orm');

  // ── Parse JSONL ──────────────────────────────────────────────────────────
  const JSONL_PATH = join('C:\\Node\\mshsaa-scraper\\out\\mshsaa-schools.jsonl');

  interface MshsaaSchool {
    s: number;
    schoolName: string;
    teamHex: string;
    teamHexSecondary: string;
    mascot: string;
    boyMascot: string;
    girlMascot: string;
    logoUrl: string;
    logoFile: string;
    city: string;
    state: string;
  }

  const schools: MshsaaSchool[] = [];

  const rl = createInterface({
    input: createReadStream(JSONL_PATH, 'utf8'),
    crlfDelay: Infinity,
  });

  for await (const line of rl) {
    if (!line.trim()) continue;
    schools.push(JSON.parse(line) as MshsaaSchool);
  }

  console.log(`Parsed ${schools.length} MSHSAA schools from JSONL`);

  // ── Upsert in batches ────────────────────────────────────────────────────
  const BATCH = 50;
  let inserted = 0;
  let updated = 0;
  let skipped = 0;

  for (let i = 0; i < schools.length; i += BATCH) {
    const batch = schools.slice(i, i + BATCH);

    const rows = batch.map((s) => ({
      // Required fields
      name: s.schoolName,
      abbreviation: s.schoolName.replace(/High School$/i, '').trim().slice(0, 20) || s.schoolName.slice(0, 20),
      organizationType: 'high_school',

      // Branding
      primaryColor: s.teamHex || null,
      secondaryColor: s.teamHexSecondary || null,
      mascot: s.mascot || s.boyMascot || null,
      logoUrl: s.logoUrl || null,

      // Location
      city: s.city || null,
      state: s.state || 'MO',
      country: 'USA',
      stateAssociation: 'MSHSAA',

      // External ID
      mshsaaId: String(s.s),
    }));

    await db
      .insert(organizations)
      .values(rows)
      .onConflictDoUpdate({
        target: organizations.mshsaaId,
        set: {
          name: sql`EXCLUDED.name`,
          primaryColor: sql`EXCLUDED.primary_color`,
          secondaryColor: sql`EXCLUDED.secondary_color`,
          mascot: sql`EXCLUDED.mascot`,
          logoUrl: sql`EXCLUDED.logo_url`,
          city: sql`EXCLUDED.city`,
          state: sql`EXCLUDED.state`,
          updatedAt: sql`now()`,
        },
      });

    inserted += rows.length;
    if (i % 200 === 0) {
      console.log(`  … processed ${Math.min(i + BATCH, schools.length)} / ${schools.length}`);
    }
  }

  console.log(`\nDone. ${inserted} rows upserted (${updated} updated, ${skipped} skipped).`);
  process.exit(0);
});
