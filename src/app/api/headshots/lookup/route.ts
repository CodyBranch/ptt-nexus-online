import { NextRequest, NextResponse } from 'next/server';
import { and, inArray, ne } from 'drizzle-orm';
import { db } from '@/db/client';
import { athleteHeadshots } from '@/db/schema';
import { checkRelayAuth } from '@/lib/relay-auth';
import { headshotNameKey } from '@/lib/headshots/name-key';

/**
 * A desk asks for its meet's headshots.
 *
 * Body: `{ season, athletes: [{ ref, organizationId, firstName, lastName }] }`
 * - `ref` is the desk's own id for the runner, handed back unchanged.
 *
 * Each runner is looked for by school, season and name ("last|first",
 * letters only). With `fallbackSeasons` (default 1) a runner with no photo
 * this season gets last season's: a returning runner looks much the same,
 * and early in a season most rosters still carry last year's pictures.
 * Photos a person has hidden are never returned.
 *
 * Each found headshot comes back with `path` (in the Headshots bucket, to
 * fetch through /headshots/{path}?w=...), its size, its hash, the season it
 * is from, and whether the cutter flagged it for review.
 */
export const dynamic = 'force-dynamic';

const MAX = 3000;

interface Asked { ref: string; organizationId: string; firstName: string; lastName: string }

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let body: { season?: unknown; athletes?: unknown; fallbackSeasons?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'The body is not JSON' }, { status: 400 });
  }
  const season = Number(body.season);
  if (!Number.isInteger(season) || season < 2000 || season > 2100) {
    return NextResponse.json({ error: 'season must be a year, e.g. 2026' }, { status: 400 });
  }
  const fallback = body.fallbackSeasons == null ? 1 : Math.max(0, Math.min(3, Number(body.fallbackSeasons) || 0));
  const asked = (Array.isArray(body.athletes) ? body.athletes : []).filter((a): a is Asked =>
    !!a && typeof a.ref === 'string' && typeof a.organizationId === 'string'
    && /^[0-9a-f-]{36}$/i.test(a.organizationId) && typeof a.firstName === 'string' && typeof a.lastName === 'string');
  if (asked.length > MAX) return NextResponse.json({ error: `At most ${MAX} athletes at a time` }, { status: 400 });
  if (!asked.length) return NextResponse.json({ season, found: [] });

  const seasons = Array.from({ length: fallback + 1 }, (_, i) => season - i);
  const orgIds = [...new Set(asked.map((a) => a.organizationId))];
  try {
    const rows = await db.select().from(athleteHeadshots).where(and(
      inArray(athleteHeadshots.organizationId, orgIds),
      inArray(athleteHeadshots.season, seasons),
      ne(athleteHeadshots.status, 'hidden'),
    ));
    // The newest season first, so this season beats last season.
    const byKey = new Map<string, typeof rows[number]>();
    for (const r of rows.sort((a, b) => b.season - a.season)) {
      const k = `${r.organizationId}|${r.nameKey}`;
      if (!byKey.has(k)) byKey.set(k, r);
    }
    const found = asked.flatMap((a) => {
      const r = byKey.get(`${a.organizationId}|${headshotNameKey(a.firstName, a.lastName)}`);
      if (!r || !r.cutoutPath) return [];
      return [{
        ref: a.ref,
        id: r.id,
        path: r.cutoutPath,
        width: r.width,
        height: r.height,
        sha256: r.sha256,
        season: r.season,
        status: r.status,
        review: r.review,
      }];
    });
    return NextResponse.json({ season, found });
  } catch (e) {
    console.error('[headshots] lookup:', e);
    return NextResponse.json({ error: 'Could not read the headshots' }, { status: 500 });
  }
}
