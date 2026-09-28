import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetSeries, venues } from '@/db/schema';
import { and, eq, ilike, sql } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';
import { seriesOut, cleanLevel } from '@/lib/venue-courses';

/**
 * Meet series: a meet as it comes round each year, which meet records
 * belong to. Gans Creek Classic College and Gans Creek Classic HS are two.
 */
export async function GET(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const sp = new URL(request.url).searchParams;
    const q = sp.get('q')?.trim();
    const venueId = sp.get('venue_id');
    const rows = await db
      .select()
      .from(meetSeries)
      .where(and(
        eq(meetSeries.isActive, true),
        q ? ilike(meetSeries.name, `%${q}%`) : undefined,
        venueId ? eq(meetSeries.venueId, venueId) : undefined,
      ))
      .orderBy(meetSeries.name)
      .limit(100);
    return NextResponse.json({ meetSeries: rows.map(seriesOut) });
  } catch (error) {
    console.error('Meet series list error:', error);
    return NextResponse.json({ error: 'Failed to fetch meet series' }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json() as { name?: string; venueId?: string; level?: string; notes?: string };
    const name = data.name?.trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    if (data.venueId) {
      const [v] = await db.select({ id: venues.id }).from(venues).where(eq(venues.id, data.venueId)).limit(1);
      if (!v) return NextResponse.json({ error: 'That venue does not exist on Nexus Online' }, { status: 404 });
    }
    // Same name at the same venue is the same series.
    const [same] = await db
      .select()
      .from(meetSeries)
      .where(and(
        sql`lower(${meetSeries.name}) = lower(${name})`,
        data.venueId ? eq(meetSeries.venueId, data.venueId) : sql`${meetSeries.venueId} IS NULL`,
        eq(meetSeries.isActive, true),
      ))
      .limit(1);
    if (same) return NextResponse.json({ meetSeries: seriesOut(same), existing: true });

    const [row] = await db.insert(meetSeries).values({
      name,
      venueId: data.venueId || null,
      level: cleanLevel(data.level),
      notes: data.notes?.trim() || null,
    }).returning();
    return NextResponse.json({ meetSeries: seriesOut(row), existing: false }, { status: 201 });
  } catch (error) {
    console.error('Meet series create error:', error);
    return NextResponse.json({ error: 'Failed to create meet series' }, { status: 500 });
  }
}
