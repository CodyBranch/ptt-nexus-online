import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { organizationSubmissions, organizations } from '@/db/schema';
import { and, eq, sql, desc, SQL } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

/**
 * Schools a meet met that this database does not have.
 *
 * Nexus pushes them from org matching when an operator has no time to fill in
 * a school properly; somebody reviews them later and approval is what creates
 * the organisation. Nothing here reaches the organizations table on its own.
 */

/** Lower case, punctuation gone — how two spellings of one school meet. */
function nameKey(name: string): string {
  return name
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\b(high school|senior high|high|hs|h\.s\.|school|academy)\b/g, ' ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export async function GET(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { searchParams } = new URL(request.url);
    const status = searchParams.get('status') ?? 'pending';
    const limit = Math.min(Number(searchParams.get('limit') ?? 100), 500);

    const conditions: SQL[] = [];
    if (status !== 'all') conditions.push(eq(organizationSubmissions.status, status));

    const rows = await db
      .select()
      .from(organizationSubmissions)
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(organizationSubmissions.timesSeen), desc(organizationSubmissions.lastSeenAt))
      .limit(limit);

    return NextResponse.json({ data: rows, total: rows.length });
  } catch (error) {
    console.error('Organization submissions list error:', error);
    return NextResponse.json({ error: 'Failed to fetch submissions' }, { status: 500 });
  }
}

/**
 * Push a batch of unmatched teams.
 *
 * A school already submitted is not submitted twice: the count goes up and
 * the date moves, so a reviewer can see that fourteen races at one meet — or
 * three meets in a season — all wanted the same school. A school this
 * database already has is refused outright, because org matching not finding
 * it is a matching problem and a new row would not fix it.
 */
export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const body = await request.json() as {
      teams?: Array<{
        name?: string; abbreviation?: string | null; organizationType?: string;
        city?: string | null; state?: string | null; athleteCount?: number | null;
      }>;
      meetName?: string | null;
      meetDate?: string | null;
    };

    const teams = Array.isArray(body.teams) ? body.teams : [];
    if (teams.length === 0) {
      return NextResponse.json({ error: 'teams is required' }, { status: 400 });
    }

    const submitted: string[] = [];
    const bumped: string[] = [];
    const skipped: Array<{ name: string; why: string }> = [];

    for (const t of teams) {
      const name = (t.name ?? '').trim();
      const type = (t.organizationType ?? '').trim();
      if (!name || !type) { skipped.push({ name: name || '(no name)', why: 'Needs a name and a level' }); continue; }

      const key = nameKey(name);
      if (!key) { skipped.push({ name, why: 'Nothing left of the name to match on' }); continue; }

      // Already a real organisation: this is org matching failing to find it,
      // and another row would bury the one that is already right.
      const existing = await db
        .select({ id: organizations.id, name: organizations.name })
        .from(organizations)
        .where(and(
          eq(organizations.organizationType, type),
          sql`lower(regexp_replace(${organizations.name}, '[^a-zA-Z0-9]+', ' ', 'g')) = ${key}`,
        ))
        .limit(1);
      if (existing[0]) {
        skipped.push({ name, why: `Already in the database as "${existing[0].name}"` });
        continue;
      }

      const updated = await db
        .update(organizationSubmissions)
        .set({
          timesSeen: sql`${organizationSubmissions.timesSeen} + 1`,
          lastSeenAt: new Date(),
          meetName: body.meetName ?? null,
          meetDate: body.meetDate ?? null,
        })
        .where(and(
          eq(organizationSubmissions.nameKey, key),
          eq(organizationSubmissions.organizationType, type),
        ))
        .returning({ id: organizationSubmissions.id });

      if (updated[0]) { bumped.push(name); continue; }

      await db.insert(organizationSubmissions).values({
        name,
        nameKey: key,
        abbreviation: t.abbreviation || null,
        organizationType: type,
        city: t.city || null,
        state: t.state || null,
        meetName: body.meetName ?? null,
        meetDate: body.meetDate ?? null,
        athleteCount: t.athleteCount ?? null,
      });
      submitted.push(name);
    }

    return NextResponse.json({ submitted, bumped, skipped }, { status: 201 });
  } catch (error) {
    console.error('Organization submission error:', error);
    return NextResponse.json({ error: 'Failed to submit' }, { status: 500 });
  }
}
