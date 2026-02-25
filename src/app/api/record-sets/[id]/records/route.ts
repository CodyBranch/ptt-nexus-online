import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { records } from '@/db/schema';
import { eq, and, SQL } from 'drizzle-orm';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const { searchParams } = new URL(request.url);
    const eventCode = searchParams.get('event_code');
    const gender = searchParams.get('gender');

    const conditions: SQL[] = [eq(records.recordSetId, id)];
    if (eventCode) conditions.push(eq(records.eventCode, eventCode));
    if (gender) conditions.push(eq(records.gender, gender));

    const rows = await db
      .select()
      .from(records)
      .where(and(...conditions))
      .orderBy(records.eventCode, records.gender);

    return NextResponse.json(rows);
  } catch (error) {
    console.error('Records list error:', error);
    return NextResponse.json({ error: 'Failed to fetch records' }, { status: 500 });
  }
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const data = await request.json();

    if (!data.eventCode || !data.gender || !data.mark || data.markSortable === undefined) {
      return NextResponse.json(
        { error: 'eventCode, gender, mark, and markSortable are required' },
        { status: 400 }
      );
    }

    const result = await db
      .insert(records)
      .values({
        recordSetId: id,
        eventCode: data.eventCode,
        gender: data.gender,
        mark: data.mark,
        markSortable: data.markSortable,
        athleteName: data.athleteName || null,
        teamName: data.teamName || null,
        organizationId: data.organizationId || null,
        meetName: data.meetName || null,
        recordDate: data.recordDate || null,
        location: data.location || null,
        wind: data.wind ?? null,
        notes: data.notes || null,
        source: data.source || 'api',
      })
      .returning();

    return NextResponse.json(result[0], { status: 201 });
  } catch (error) {
    console.error('Record create error:', error);
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 });
  }
}
