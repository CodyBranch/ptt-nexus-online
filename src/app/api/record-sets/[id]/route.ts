import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { recordSets } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

const EDITABLE = [
  'name', 'abbreviation', 'description', 'scope', 'gender', 'season',
  'organizationId', 'eligibilityRules', 'isActive', 'isPublic', 'notes',
] as const;

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const rows = await db.select().from(recordSets).where(eq(recordSets.id, id)).limit(1);

    if (!rows[0]) {
      return NextResponse.json({ error: 'Record set not found' }, { status: 404 });
    }

    return NextResponse.json(rows[0]);
  } catch (error) {
    console.error('Record set get error:', error);
    return NextResponse.json({ error: 'Failed to fetch record set' }, { status: 500 });
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const data = await request.json() as Record<string, unknown>;

    // Only the fields a desktop may change. Spreading the body let a caller
    // rewrite the id, the timestamps or who created the set.
    const changes: Partial<typeof recordSets.$inferInsert> = {};
    for (const k of EDITABLE) {
      if (k in data) (changes as Record<string, unknown>)[k] = data[k];
    }

    await db
      .update(recordSets)
      .set({ ...changes, updatedAt: new Date() })
      .where(eq(recordSets.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Record set update error:', error);
    return NextResponse.json({ error: 'Failed to update record set' }, { status: 500 });
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;

    await db
      .update(recordSets)
      .set({ isActive: false, updatedAt: new Date() })
      .where(eq(recordSets.id, id));

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('Record set delete error:', error);
    return NextResponse.json({ error: 'Failed to delete record set' }, { status: 500 });
  }
}
