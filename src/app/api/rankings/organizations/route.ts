import { NextRequest, NextResponse } from 'next/server';
import { checkRelayAuth } from '@/lib/relay-auth';
import { currentRankingsFor } from '@/lib/rankings/current';

/**
 * A desk asks what its meet's schools are ranked.
 *
 * Body: `{ organizationIds: string[] }`, the organizations its teams are
 * linked to. Answers each one's current national and regional rank, by
 * gender, with the season, when Nexus Online last read the USTFCCCA, and
 * the attribution every display of these has to carry.
 */
export const dynamic = 'force-dynamic';

const MAX_ORGS = 500;

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  let organizationIds: unknown;
  try {
    ({ organizationIds } = await request.json() as { organizationIds?: unknown });
  } catch {
    return NextResponse.json({ error: 'The body is not JSON' }, { status: 400 });
  }
  if (!Array.isArray(organizationIds) || organizationIds.some((s) => typeof s !== 'string')) {
    return NextResponse.json({ error: 'organizationIds must be an array of organization ids' }, { status: 400 });
  }
  if (organizationIds.length > MAX_ORGS) {
    return NextResponse.json({ error: `At most ${MAX_ORGS} organizations at a time` }, { status: 400 });
  }
  try {
    return NextResponse.json(await currentRankingsFor(organizationIds as string[]));
  } catch (e) {
    console.error('[rankings] organizations:', e);
    return NextResponse.json({ error: 'Could not read the rankings' }, { status: 500 });
  }
}
