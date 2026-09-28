import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { records } from '@/db/schema';
import { eq, and, SQL } from 'drizzle-orm';
import { checkRelayAuth, relayAuthKey } from '@/lib/relay-auth';
import { validateFields, findByKey, writeRecord, logChange, type RecordFields } from '@/lib/record-changes';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

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
  const auth = await relayAuthKey(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const data = await request.json();

    if (!data.eventCode || !data.gender || !data.mark || data.markSortable === undefined) {
      return NextResponse.json(
        { error: 'eventCode, gender, mark, and markSortable are required' },
        { status: 400 }
      );
    }

    // Logged like every other change, so it can be reverted.
    const fields: RecordFields = { ...data, recordSetId: id, source: data.source || 'api' };
    const result = await db.transaction(async (tx) => {
      const bad = await validateFields(tx, fields);
      if (bad) return { status: 400, body: { error: bad } };
      const holder = await findByKey(tx, fields);
      if (holder) return { status: 409, body: { error: 'A record already holds that event, course and level', record: holder } };
      const after = await writeRecord(tx, null, fields);
      await logChange(tx, 'created', null, after, { changedBy: 'api', desktopKeyId: auth.keyId, source: 'desktop_sync' });
      return { status: 201, body: after };
    });

    return NextResponse.json(result.body, { status: result.status });
  } catch (error) {
    console.error('Record create error:', error);
    return NextResponse.json({ error: 'Failed to create record' }, { status: 500 });
  }
}
