import { NextResponse } from 'next/server';
import { db } from '@/db/client';
import { recordSets, records, organizations, syncLogs } from '@/db/schema';
import { sql, eq, desc } from 'drizzle-orm';

export async function GET() {
  try {
    // Get active record sets with counts
    const sets = await db
      .select({
        id: recordSets.id,
        name: recordSets.name,
        abbreviation: recordSets.abbreviation,
        recordCount: sql<number>`(SELECT count(*) FROM records WHERE records.record_set_id = record_sets.id)`,
        lastUpdated: recordSets.updatedAt,
      })
      .from(recordSets)
      .where(eq(recordSets.isActive, true))
      .orderBy(recordSets.name);

    // Organization count
    const [orgCount] = await db
      .select({ count: sql<number>`count(*)` })
      .from(organizations)
      .where(eq(organizations.isActive, true));

    // Last sync operations
    const lastDown = await db
      .select({ startedAt: syncLogs.startedAt })
      .from(syncLogs)
      .where(eq(syncLogs.direction, 'down'))
      .orderBy(desc(syncLogs.startedAt))
      .limit(1);

    const lastUp = await db
      .select({ startedAt: syncLogs.startedAt })
      .from(syncLogs)
      .where(eq(syncLogs.direction, 'up'))
      .orderBy(desc(syncLogs.startedAt))
      .limit(1);

    return NextResponse.json({
      recordSets: sets,
      organizationCount: Number(orgCount?.count ?? 0),
      lastSyncDown: lastDown[0]?.startedAt?.toISOString() ?? null,
      lastSyncUp: lastUp[0]?.startedAt?.toISOString() ?? null,
    });
  } catch (error) {
    console.error('Sync status error:', error);
    return NextResponse.json(
      { error: 'Failed to fetch sync status' },
      { status: 500 }
    );
  }
}
