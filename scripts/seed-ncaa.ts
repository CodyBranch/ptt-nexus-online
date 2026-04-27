// Seed NCAA schools from scraper output into the organizations table.
// Run with:  npx tsx scripts/seed-ncaa.ts
//
// Source: C:\Node\ncaa-scraper\ncaa-schools.json (JSON array)
// Fields used: slug, shortName, institutionName, nickname, headerBgColor,
//              logoDarkUrlRemote, logoLightUrlRemote, division, conference, city, state
//
// Uses remote NCAA logo URLs directly — no Supabase Storage upload required.
// Upserts on ncaa_slug so the script is safe to re-run after re-scraping.
// Skips records that have an 'error' field (failed scrapes) or no slug.

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

import('../src/db/client').then(async ({ db }) => {
  const { organizations } = await import('../src/db/schema');
  const { sql } = await import('drizzle-orm');

  // ── Load JSON ────────────────────────────────────────────────────────────
  const JSON_PATH = join('C:\\Node\\ncaa-scraper\\ncaa-schools.json');

  interface NcaaSchool {
    slug?: string;
    shortName?: string;
    institutionName?: string;
    schoolName?: string;
    nickname?: string | null;
    headerBgColor?: string;
    feedNoThumbColor?: string;
    logoDarkUrlRemote?: string;
    logoLightUrlRemote?: string;
    hasLogoBGD?: boolean;
    hasLogoBGL?: boolean;
    division?: string;
    conference?: string;
    city?: string;
    state?: string;
    error?: string;
  }

  const raw = JSON.parse(readFileSync(JSON_PATH, 'utf8')) as NcaaSchool[];

  // Filter out error records and those without a slug
  const schools = raw.filter((s) => s.slug && !s.error);
  const skippedErrors = raw.length - schools.length;

  console.log(`Loaded ${raw.length} NCAA records; skipping ${skippedErrors} errors/no-slug → ${schools.length} to seed`);

  // ── Map NCAA division string to schema values ─────────────────────────────
  function mapDivision(div?: string): string | null {
    if (!div) return null;
    if (div.includes('I') && !div.includes('II') && !div.includes('III')) return 'D1';
    if (div.includes('II') && !div.includes('III')) return 'D2';
    if (div.includes('III')) return 'D3';
    return null;
  }

  // ── Upsert in batches ────────────────────────────────────────────────────
  const BATCH = 50;
  let processed = 0;

  for (let i = 0; i < schools.length; i += BATCH) {
    const batch = schools.slice(i, i + BATCH);

    const rows = batch.map((s) => {
      const name = s.institutionName || s.schoolName || s.shortName || s.slug!;
      const abbrev = (s.shortName || name).slice(0, 20);

      return {
        name,
        abbreviation: abbrev,
        shortName: s.shortName || null,
        organizationType: 'college',

        mascot: s.nickname || null,

        // Branding — use light URL as primary logo, dark as logo_dark
        primaryColor: s.headerBgColor || null,
        logoUrl: s.logoLightUrlRemote || null,
        logoDarkUrl: s.logoDarkUrlRemote || null,

        // Location
        city: s.city || null,
        state: s.state || null,
        country: 'USA',

        // Classification
        ncaaDivision: mapDivision(s.division),
        conference: s.conference || null,

        // External ID
        ncaaSlug: s.slug!,
      };
    });

    await db
      .insert(organizations)
      .values(rows)
      .onConflictDoUpdate({
        target: organizations.ncaaSlug,
        set: {
          name: sql`EXCLUDED.name`,
          shortName: sql`EXCLUDED.short_name`,
          mascot: sql`EXCLUDED.mascot`,
          primaryColor: sql`EXCLUDED.primary_color`,
          logoUrl: sql`EXCLUDED.logo_url`,
          logoDarkUrl: sql`EXCLUDED.logo_dark_url`,
          ncaaDivision: sql`EXCLUDED.ncaa_division`,
          conference: sql`EXCLUDED.conference`,
          city: sql`EXCLUDED.city`,
          state: sql`EXCLUDED.state`,
          updatedAt: sql`now()`,
        },
      });

    processed += rows.length;
    if (i % 200 === 0) {
      console.log(`  … processed ${Math.min(i + BATCH, schools.length)} / ${schools.length}`);
    }
  }

  console.log(`\nDone. ${processed} NCAA schools upserted.`);
  process.exit(0);
});
