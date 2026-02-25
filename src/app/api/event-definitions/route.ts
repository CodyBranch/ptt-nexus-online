import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { eventDefinitions } from '@/db/schema';
import { eq, SQL, and } from 'drizzle-orm';

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const venue = searchParams.get('venue');
    const category = searchParams.get('category');
    const windAffected = searchParams.get('wind_affected');

    const conditions: SQL[] = [];

    if (venue) conditions.push(eq(eventDefinitions.venueFilter, venue));
    if (category) conditions.push(eq(eventDefinitions.category, category));
    if (windAffected === 'true') conditions.push(eq(eventDefinitions.isWindAffected, true));

    const where = conditions.length > 0 ? and(...conditions) : undefined;

    const rows = await db
      .select()
      .from(eventDefinitions)
      .where(where)
      .orderBy(eventDefinitions.sortOrder);

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Event definitions error:', error);
    return NextResponse.json({ error: 'Failed to fetch event definitions' }, { status: 500 });
  }
}
