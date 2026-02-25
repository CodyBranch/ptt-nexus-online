import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { records, recordHistory, syncLogs } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      meetName,
      meetId,
      meetDate,
      brokenRecords,
    } = body as {
      meetName: string;
      meetId: string;
      meetDate: string;
      brokenRecords: Array<{
        recordSetId: string;
        eventCode: string;
        gender: string;
        newMark: string;
        newMarkSortable: number;
        athleteName: string;
        teamName?: string;
        wind?: number;
        resultId: string;
      }>;
    };

    if (!brokenRecords || !Array.isArray(brokenRecords)) {
      return NextResponse.json(
        { error: 'brokenRecords is required' },
        { status: 400 }
      );
    }

    let updated = 0;
    let created = 0;
    const errors: Array<{ eventCode: string; error: string }> = [];

    for (const br of brokenRecords) {
      try {
        // Find existing record
        const existing = await db
          .select()
          .from(records)
          .where(
            and(
              eq(records.recordSetId, br.recordSetId),
              eq(records.eventCode, br.eventCode),
              eq(records.gender, br.gender)
            )
          )
          .limit(1);

        if (existing[0]) {
          const prev = existing[0];

          // Create history entry
          await db.insert(recordHistory).values({
            recordId: prev.id,
            previousMark: prev.mark,
            previousMarkSortable: prev.markSortable,
            previousAthleteName: prev.athleteName,
            previousTeamName: prev.teamName,
            previousMeetName: prev.meetName,
            previousRecordDate: prev.recordDate,
            previousWind: prev.wind,
            newMark: br.newMark,
            newAthleteName: br.athleteName,
            brokenAtMeet: meetName,
            brokenDate: meetDate,
            source: 'desktop_sync',
            syncedFromMeetId: meetId,
          });

          // Update the record
          await db
            .update(records)
            .set({
              mark: br.newMark,
              markSortable: br.newMarkSortable,
              athleteName: br.athleteName,
              teamName: br.teamName || null,
              meetName: meetName,
              recordDate: meetDate,
              wind: br.wind ?? null,
              brokenAtMeet: meetName,
              lastSyncedAt: new Date(),
              updatedAt: new Date(),
            })
            .where(eq(records.id, prev.id));

          updated++;
        } else {
          // Create new record entry
          await db.insert(records).values({
            recordSetId: br.recordSetId,
            eventCode: br.eventCode,
            gender: br.gender,
            mark: br.newMark,
            markSortable: br.newMarkSortable,
            athleteName: br.athleteName,
            teamName: br.teamName || null,
            meetName: meetName,
            recordDate: meetDate,
            wind: br.wind ?? null,
            source: 'desktop_sync',
            brokenAtMeet: meetName,
            lastSyncedAt: new Date(),
          });

          created++;
        }
      } catch (err) {
        errors.push({
          eventCode: br.eventCode,
          error: err instanceof Error ? err.message : 'Unknown error',
        });
      }
    }

    // Log the sync operation
    await db.insert(syncLogs).values({
      direction: 'up',
      syncType: 'record_sets',
      recordsBroken: updated + created,
      desktopMeetName: meetName,
      desktopMeetId: meetId,
      status: errors.length > 0 ? 'partial' : 'completed',
      errorMessage: errors.length > 0 ? JSON.stringify(errors) : null,
      completedAt: new Date(),
      clientIp: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    });

    return NextResponse.json({ updated, created, errors });
  } catch (error) {
    console.error('Sync up error:', error);
    return NextResponse.json(
      { error: 'Sync up failed' },
      { status: 500 }
    );
  }
}
