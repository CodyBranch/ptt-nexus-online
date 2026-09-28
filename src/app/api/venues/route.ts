import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { venues } from '@/db/schema';
import { and, eq, ilike, or, sql } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';
import { venueOut } from '@/lib/venue-courses';

/** Venues a desk can pick from when saving or pulling a course. */
export async function GET(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const q = new URL(request.url).searchParams.get('q')?.trim();
    const like = q ? `%${q}%` : null;
    const rows = await db
      .select({
        id: venues.id,
        name: venues.name,
        city: venues.city,
        state: venues.state,
        courseCount: sql<number>`(SELECT count(*) FROM courses WHERE courses.venue_id = venues.id AND courses.is_active IS NOT FALSE)`.mapWith(Number),
        recordSetCount: sql<number>`(SELECT count(*) FROM record_sets WHERE record_sets.is_active IS NOT FALSE AND (record_sets.venue_id = venues.id OR record_sets.meet_series_id IN (SELECT id FROM meet_series WHERE meet_series.venue_id = venues.id)))`.mapWith(Number),
      })
      .from(venues)
      .where(and(eq(venues.isActive, true), like ? or(ilike(venues.name, like), ilike(venues.city, like)) : undefined))
      .orderBy(venues.name)
      .limit(100);
    return NextResponse.json({ venues: rows });
  } catch (error) {
    console.error('Venues list error:', error);
    return NextResponse.json({ error: 'Failed to fetch venues' }, { status: 500 });
  }
}

/**
 * Adds a venue. A venue of the same name in the same state is the same
 * venue: that one comes back instead of a second being made.
 */
export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const data = await request.json() as { name?: string; city?: string; state?: string; setting?: string; notes?: string };
    const name = data.name?.trim();
    if (!name) return NextResponse.json({ error: 'name is required' }, { status: 400 });
    const state = data.state?.trim().toUpperCase() || null;

    const [same] = await db
      .select()
      .from(venues)
      .where(and(
        sql`lower(${venues.name}) = lower(${name})`,
        state ? sql`upper(coalesce(${venues.state}, '')) = ${state}` : sql`true`,
        eq(venues.isActive, true),
      ))
      .limit(1);
    if (same) return NextResponse.json({ venue: venueOut(same), existing: true });

    const [row] = await db.insert(venues).values({
      name,
      city: data.city?.trim() || null,
      state,
      setting: data.setting === 'indoor' || data.setting === 'outdoor' ? data.setting : null,
      notes: data.notes?.trim() || null,
    }).returning();
    return NextResponse.json({ venue: venueOut(row), existing: false }, { status: 201 });
  } catch (error) {
    console.error('Venue create error:', error);
    return NextResponse.json({ error: 'Failed to create venue' }, { status: 500 });
  }
}
