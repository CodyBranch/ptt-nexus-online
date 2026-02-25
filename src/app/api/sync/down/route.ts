import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { recordSets, records, organizations, syncLogs } from '@/db/schema';
import { eq, inArray, and, gte } from 'drizzle-orm';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const {
      recordSetIds,
      includeOrganizations = false,
      organizationIds,
      lastSyncedAt,
    } = body as {
      recordSetIds: string[];
      includeOrganizations?: boolean;
      organizationIds?: string[];
      lastSyncedAt?: string;
    };

    if (!recordSetIds || !Array.isArray(recordSetIds) || recordSetIds.length === 0) {
      return NextResponse.json(
        { error: 'recordSetIds is required and must be a non-empty array' },
        { status: 400 }
      );
    }

    // Fetch record sets
    const sets = await db
      .select()
      .from(recordSets)
      .where(
        and(
          inArray(recordSets.id, recordSetIds),
          eq(recordSets.isActive, true)
        )
      );

    // Fetch records for each set
    const setsWithRecords = await Promise.all(
      sets.map(async (rs) => {
        const recs = await db
          .select()
          .from(records)
          .where(eq(records.recordSetId, rs.id));

        return {
          id: rs.id,
          name: rs.name,
          abbreviation: rs.abbreviation,
          scope: rs.scope,
          gender: rs.gender,
          season: rs.season,
          organization: rs.organizationId,
          eligibilityRules: rs.eligibilityRules,
          records: recs.map((r) => ({
            id: r.id,
            eventCode: r.eventCode,
            gender: r.gender,
            mark: r.mark,
            markSortable: r.markSortable,
            athleteName: r.athleteName,
            teamName: r.teamName,
            meetName: r.meetName,
            recordDate: r.recordDate,
            wind: r.wind,
          })),
        };
      })
    );

    // Fetch organizations if requested
    let orgs: typeof organizations.$inferSelect[] = [];
    if (includeOrganizations) {
      if (organizationIds && organizationIds.length > 0) {
        orgs = await db
          .select()
          .from(organizations)
          .where(
            and(
              inArray(organizations.id, organizationIds),
              eq(organizations.isActive, true)
            )
          );
      } else {
        orgs = await db
          .select()
          .from(organizations)
          .where(eq(organizations.isActive, true));
      }
    }

    const syncTimestamp = new Date().toISOString();

    // Log the sync operation
    await db.insert(syncLogs).values({
      direction: 'down',
      syncType: 'record_sets',
      recordSetsSynced: sets.length,
      recordsSynced: setsWithRecords.reduce((sum, s) => sum + s.records.length, 0),
      organizationsSynced: orgs.length,
      status: 'completed',
      completedAt: new Date(),
      clientIp: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    });

    return NextResponse.json({
      recordSets: setsWithRecords,
      organizations: orgs.map((o) => ({
        id: o.id,
        name: o.name,
        abbreviation: o.abbreviation,
        shortName: o.shortName,
        mascot: o.mascot,
        organizationType: o.organizationType,
        conference: o.conference,
        city: o.city,
        state: o.state,
        country: o.country,
        primaryColor: o.primaryColor,
        secondaryColor: o.secondaryColor,
        logoUrl: o.logoUrl,
        logoDarkUrl: o.logoDarkUrl,
      })),
      syncTimestamp,
    });
  } catch (error) {
    console.error('Sync down error:', error);
    return NextResponse.json(
      { error: 'Sync down failed' },
      { status: 500 }
    );
  }
}
