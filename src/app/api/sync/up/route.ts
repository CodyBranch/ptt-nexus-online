import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { syncLogs } from '@/db/schema';
import { relayAuthKey } from '@/lib/relay-auth';
import { applyDeskChange, type DeskRecordChange, type DeskChangeResult } from '@/lib/record-changes';

/**
 * A desk sends the records it changed: marks that broke a record (claim),
 * corrections (edit) and removals (delete).
 *
 * They go live at once. A claim is applied only when it beats what is on
 * Nexus Online, whoever changed that last; an edit or delete only when nobody
 * changed the record since the desk pulled it. Every one is logged with the
 * record before and after, and any of them can be reverted from the
 * dashboard. Each change is its own transaction: one refused claim does not
 * hold up the rest.
 */
export async function POST(request: NextRequest) {
  const auth = await relayAuthKey(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      meetName?: string;
      meetId?: string;
      meetDate?: string;
      changes?: DeskRecordChange[];
    };
    const changes = Array.isArray(body.changes) ? body.changes : null;
    if (!changes) {
      return NextResponse.json({ error: 'changes is required' }, { status: 400 });
    }
    if (changes.length > 500) {
      return NextResponse.json({ error: 'At most 500 changes at a time' }, { status: 400 });
    }

    const meetName = body.meetName?.trim() || null;
    const results: DeskChangeResult[] = [];
    for (let i = 0; i < changes.length; i++) {
      const c = changes[i] ? { ...changes[i] } : changes[i];
      if (!c || (c.kind !== 'claim' && c.kind !== 'edit' && c.kind !== 'delete')) {
        results.push({ index: i, status: 'error', record: null, message: 'kind must be claim, edit or delete' });
        continue;
      }
      // A record broken at this meet was set at this meet, on its date,
      // unless the desk says otherwise.
      if (c.kind === 'claim') {
        c.meetName = c.meetName ?? meetName;
        c.recordDate = c.recordDate ?? body.meetDate ?? null;
      }
      results.push(await applyDeskChange(i, c, {
        changedBy: meetName ? `desk: ${meetName}` : 'desk',
        desktopKeyId: auth.keyId,
        source: 'desktop_sync',
        meetName,
        meetId: body.meetId ?? null,
        meetDate: body.meetDate ?? null,
      }));
    }

    const applied = results.filter((r) => r.status === 'created' || r.status === 'broken' || r.status === 'edited' || r.status === 'deleted').length;
    const failed = results.filter((r) => r.status === 'error');
    await db.insert(syncLogs).values({
      direction: 'up',
      syncType: 'record_sets',
      recordsBroken: results.filter((r) => r.status === 'broken' || r.status === 'created').length,
      recordsSynced: applied,
      desktopMeetName: meetName,
      desktopMeetId: body.meetId ?? null,
      status: failed.length > 0 ? 'partial' : 'completed',
      errorMessage: failed.length > 0 ? JSON.stringify(failed.map((f) => ({ index: f.index, message: f.message }))) : null,
      completedAt: new Date(),
      clientIp: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    });

    return NextResponse.json({ results });
  } catch (error) {
    console.error('Sync up error:', error);
    return NextResponse.json({ error: 'Sync up failed' }, { status: 500 });
  }
}
