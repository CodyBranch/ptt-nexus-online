import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { recordSets } from '@/db/schema';
import { eq, and, sql, SQL } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

export async function GET(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(request.url);
    const scope = searchParams.get('scope');
    const season = searchParams.get('season');
    const active = searchParams.get('active');
    const venueId = searchParams.get('venue_id');
    const meetSeriesId = searchParams.get('meet_series_id');

    const conditions: SQL[] = [];

    if (scope) conditions.push(eq(recordSets.scope, scope));
    if (season) conditions.push(eq(recordSets.season, season));
    if (active !== 'false') conditions.push(eq(recordSets.isActive, true));
    if (venueId) conditions.push(eq(recordSets.venueId, venueId));
    if (meetSeriesId) conditions.push(eq(recordSets.meetSeriesId, meetSeriesId));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select({
        id: recordSets.id,
        name: recordSets.name,
        abbreviation: recordSets.abbreviation,
        description: recordSets.description,
        scope: recordSets.scope,
        gender: recordSets.gender,
        season: recordSets.season,
        organizationId: recordSets.organizationId,
        venueId: recordSets.venueId,
        meetSeriesId: recordSets.meetSeriesId,
        eligibilityRules: recordSets.eligibilityRules,
        isActive: recordSets.isActive,
        isPublic: recordSets.isPublic,
        createdAt: recordSets.createdAt,
        updatedAt: recordSets.updatedAt,
        recordCount: sql<number>`(SELECT count(*) FROM records WHERE records.record_set_id = record_sets.id)`.mapWith(Number),
      })
      .from(recordSets)
      .where(where)
      .orderBy(recordSets.name);

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Record sets list error:', error);
    return NextResponse.json({ error: 'Failed to fetch record sets' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json();

    if (!data.name || !data.abbreviation || !data.scope) {
      return NextResponse.json(
        { error: 'name, abbreviation, and scope are required' },
        { status: 400 }
      );
    }

    const result = await db
      .insert(recordSets)
      .values({
        name: data.name,
        abbreviation: data.abbreviation,
        description: data.description || null,
        scope: data.scope,
        gender: data.gender || null,
        season: data.season || null,
        organizationId: data.organizationId || null,
        venueId: data.venueId || null,
        meetSeriesId: data.meetSeriesId || null,
        eligibilityRules: data.eligibilityRules ?? [],
        isPublic: data.isPublic ?? true,
        notes: data.notes || null,
      })
      .returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Record set create error:', error);
    return NextResponse.json({ error: 'Failed to create record set' }, { status: 500 });
  }
}
