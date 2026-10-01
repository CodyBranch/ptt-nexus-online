/**
 * Put a headshot run into the Headshots bucket and the athlete_headshots table.
 *
 * Reads the index.json the desk app's tools/headshots/index.js writes beside
 * a run's originals/ and cutouts/, and for each photo:
 *
 *   - the cutout (background removed) goes up as WebP with its transparency,
 *     at its own size - never resized - to {season}/cutouts/{school}/...
 *   - the original, as downloaded, goes to {season}/originals/{school}/...
 *   - its row is written: school, season, name, where it came from, the
 *     paths, and anything the cutter flagged (status 'review').
 *
 * File names end in the first eight characters of the file's own hash, so a
 * replaced photo has a new address and nothing cached keeps the old face. A
 * file already in the bucket is not sent again, so a run can be repeated.
 *
 * Without --apply it only says what it would do. Writes go to production.
 *
 *   npx tsx scripts/upload-headshots.ts C:/Meets/headshots/2026            (dry run)
 *   npx tsx scripts/upload-headshots.ts C:/Meets/headshots/2026 --apply
 */

import { config } from 'dotenv';
import { resolve, join, extname } from 'path';
import { readFileSync } from 'fs';
import { createHash } from 'crypto';

config({ path: resolve(process.cwd(), '.env.local') });

const RUN = process.argv[2];
const APPLY = process.argv.includes('--apply');
if (!RUN) { console.error('usage: upload-headshots.ts RUN_DIR [--apply]'); process.exit(1); }

const BUCKET = 'Headshots';
const CONCURRENCY = 6;

interface Item {
  team: string; organizationId: string | null; firstName: string; lastName: string;
  gender: string | null; classYear: string | null; original: string; cutout: string | null;
  rosterUrl: string | null; rosterPlayerId: string | null; photoSourceUrl: string | null;
  review: string[]; fetchedAt: string | null;
}

const slug = (s: string) => s.toLowerCase().replace(/&/g, 'and').replace(/['’]/g, '')
  .replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'x';
const sha = (b: Buffer) => createHash('sha256').update(b).digest('hex');
const TYPES: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

(async () => {
  const sharp = (await import('sharp')).default;
  const { createClient } = await import('@supabase/supabase-js');
  const { db } = await import('../src/db/client');
  const { organizations, athleteHeadshots } = await import('../src/db/schema');
  const { inArray, sql } = await import('drizzle-orm');
  const { headshotNameKey } = await import('../src/lib/headshots/name-key');

  const index = JSON.parse(readFileSync(join(RUN, 'index.json'), 'utf8')) as { season: number; meet: string; photos: Item[] };
  const season = index.season;
  const items = index.photos.filter((p) => p.organizationId);
  console.log(`${items.length} photos from ${index.meet}, season ${season}${APPLY ? '' : ' (dry run: nothing is written)'}`);

  const orgIds = [...new Set(items.map((p) => p.organizationId!))];
  const orgRows = await db.select({ id: organizations.id, name: organizations.name, shortName: organizations.shortName })
    .from(organizations).where(inArray(organizations.id, orgIds));
  const orgSlug = new Map(orgRows.map((o) => [o.id, slug(o.shortName || o.name)]));
  const missingOrgs = orgIds.filter((id) => !orgSlug.has(id));
  if (missingOrgs.length) console.log(`  ${missingOrgs.length} school(s) not in Nexus Online; their photos are skipped`);

  // Whether the table is there yet: the files can go up before it is.
  let tableReady = true;
  try { await db.execute(sql`SELECT 1 FROM athlete_headshots LIMIT 1`); } catch { tableReady = false; }
  if (!tableReady) console.log('  athlete_headshots does not exist yet: files only, rows on a later run');

  const storage = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!, {
    auth: { persistSession: false },
  }).storage.from(BUCKET);

  /** Upload unless already there; "already there" is success. */
  const put = async (path: string, body: Buffer, type: string): Promise<'sent' | 'there'> => {
    const { error } = await storage.upload(path, body, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (!error) return 'sent';
    if (/exists|duplicate/i.test(error.message)) return 'there';
    throw new Error(`${path}: ${error.message}`);
  };

  const tally = { sent: 0, there: 0, rows: 0, skipped: 0, failed: 0, bytes: 0, pngBytes: 0 };
  const failures: string[] = [];
  let next = 0;
  const work = async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      const p = items[i];
      const school = orgSlug.get(p.organizationId!);
      if (!school) { tally.skipped++; continue; }
      try {
        const who = slug(`${p.lastName}-${p.firstName}`);
        // The cutout: WebP with its transparency, at the size it was cut.
        let cutoutPath: string | null = null, width: number | null = null, height: number | null = null, bytes: number | null = null, hash: string | null = null;
        if (p.cutout) {
          const png = readFileSync(join(RUN, p.cutout));
          tally.pngBytes += png.length;
          const webp = await sharp(png).webp({ quality: 90, alphaQuality: 100, effort: 5 }).toBuffer();
          const meta = await sharp(webp).metadata();
          hash = sha(webp); width = meta.width ?? null; height = meta.height ?? null; bytes = webp.length;
          cutoutPath = `${season}/cutouts/${school}/${who}-${hash.slice(0, 8)}.webp`;
          tally.bytes += webp.length;
          if (APPLY) tally[await put(cutoutPath, webp, 'image/webp')]++;
        }
        // The original, as it came.
        const orig = readFileSync(join(RUN, p.original));
        const ext = extname(p.original).toLowerCase();
        const originalPath = `${season}/originals/${school}/${who}-${sha(orig).slice(0, 8)}${ext === '.jpeg' ? '.jpg' : ext}`;
        tally.bytes += orig.length;
        if (APPLY) tally[await put(originalPath, orig, TYPES[ext] ?? 'application/octet-stream')]++;

        if (APPLY && tableReady) {
          const row = {
            organizationId: p.organizationId!, season, firstName: p.firstName, lastName: p.lastName,
            nameKey: headshotNameKey(p.firstName, p.lastName), gender: p.gender, classYear: p.classYear,
            rosterUrl: p.rosterUrl, rosterPlayerId: p.rosterPlayerId, photoSourceUrl: p.photoSourceUrl,
            cutoutPath, originalPath, width, height, bytes, sha256: hash,
            status: p.review.length ? 'review' : 'ok', review: p.review,
            fetchedAt: p.fetchedAt ? new Date(p.fetchedAt) : null,
          };
          await db.insert(athleteHeadshots).values(row).onConflictDoUpdate({
            target: [athleteHeadshots.organizationId, athleteHeadshots.season, athleteHeadshots.nameKey],
            // A person's 'hidden' stands: a new upload does not bring a photo back.
            set: { ...row, status: sql`CASE WHEN ${athleteHeadshots.status} = 'hidden' THEN 'hidden' ELSE ${row.status} END`, updatedAt: new Date() },
          });
          tally.rows++;
        }
      } catch (e) {
        tally.failed++;
        failures.push(`${p.team} ${p.firstName} ${p.lastName}: ${e instanceof Error ? e.message : e}`);
      }
      if ((i + 1) % 100 === 0) console.log(`  ${i + 1} of ${items.length}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, work));

  const mb = (n: number) => (n / 1048576).toFixed(0) + ' MB';
  console.log(`done: ${tally.sent} files sent, ${tally.there} already there, ${tally.rows} rows written, ${tally.skipped} skipped, ${tally.failed} failed`);
  console.log(`  storage: ${mb(tally.bytes)} (the cutouts as WebP; ${mb(tally.pngBytes)} as PNG)`);
  failures.slice(0, 10).forEach((f) => console.log('  FAILED ' + f));
  process.exit(tally.failed ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
