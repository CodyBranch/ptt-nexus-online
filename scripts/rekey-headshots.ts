/**
 * Move headshots filed under the wrong school to the right one.
 *
 * A headshot run keys each photo by the school its team was linked to when it
 * was fetched. When that link was wrong (Marquette to Marquette High School,
 * Rio Grande to Texas Rio Grande Valley), the photo is the right runner's -
 * the roster it came from was read by name - but it is filed under the wrong
 * school, and a meet linked correctly never finds it.
 *
 * For each team given, the photos the run's index has for that team move from
 * the school they were filed under to the one given: the rows change, the
 * files stay where they are. The index is updated to match. Only rows from
 * that run's runners move; anything else filed under the old school is left.
 *
 *   npx tsx scripts/rekey-headshots.ts RUN_DIR "Team=organizationId" ...            (dry run)
 *   npx tsx scripts/rekey-headshots.ts RUN_DIR "Team=organizationId" ... --apply
 */

import { config } from 'dotenv';
import { resolve, join } from 'path';
import { readFileSync, writeFileSync } from 'fs';

config({ path: resolve(process.cwd(), '.env.local') });

const args = process.argv.slice(2);
const APPLY = args.includes('--apply');
const RUN = args.find((a) => !a.startsWith('--') && !a.includes('='));
const moves = args.filter((a) => a.includes('=')).map((a) => { const [team, org] = a.split('='); return { team, org }; });
if (!RUN || !moves.length) { console.error('usage: rekey-headshots.ts RUN_DIR "Team=orgId" ... [--apply]'); process.exit(1); }

(async () => {
  const { db } = await import('../src/db/client');
  const { athleteHeadshots, organizations } = await import('../src/db/schema');
  const { and, eq, inArray, sql } = await import('drizzle-orm');
  const { headshotNameKey } = await import('../src/lib/headshots/name-key');

  const indexPath = join(RUN, 'index.json');
  const index = JSON.parse(readFileSync(indexPath, 'utf8')) as {
    season: number; photos: Array<{ team: string; organizationId: string | null; firstName: string; lastName: string }>;
  };
  let total = 0;
  for (const m of moves) {
    const [to] = await db.select({ id: organizations.id, name: organizations.name }).from(organizations).where(eq(organizations.id, m.org));
    if (!to) { console.log(`${m.team}: no organization ${m.org}`); continue; }
    const photos = index.photos.filter((p) => p.team === m.team);
    const from = [...new Set(photos.map((p) => p.organizationId).filter((x): x is string => !!x && x !== m.org))];
    if (!from.length) { console.log(`${m.team}: already filed under ${to.name}`); continue; }
    const keys = photos.map((p) => headshotNameKey(p.firstName, p.lastName));
    const rows = await db.select({ id: athleteHeadshots.id, org: athleteHeadshots.organizationId }).from(athleteHeadshots).where(and(
      eq(athleteHeadshots.season, index.season), inArray(athleteHeadshots.organizationId, from), inArray(athleteHeadshots.nameKey, keys)));
    const [fromOrg] = await db.select({ name: organizations.name }).from(organizations).where(eq(organizations.id, from[0]));
    console.log(`${m.team}: ${rows.length} of ${photos.length} photos move from ${fromOrg?.name ?? from[0]} to ${to.name}`);
    total += rows.length;
    if (APPLY && rows.length) {
      await db.update(athleteHeadshots).set({ organizationId: m.org, updatedAt: sql`now()` })
        .where(inArray(athleteHeadshots.id, rows.map((r) => r.id)));
      for (const p of photos) p.organizationId = m.org;
    }
  }
  if (APPLY) writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`${APPLY ? 'moved' : 'would move'} ${total} headshots${APPLY ? '; index.json updated' : ' (dry run)'}`);
  process.exit(0);
})().catch((e) => { console.error(e); process.exit(1); });
