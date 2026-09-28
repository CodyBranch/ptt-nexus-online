import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { recordSets, records, recordSplits, recordHistory, organizations, syncLogs } from '@/db/schema';
import { eq, inArray, and, gt } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';
import { toSnapshot, type RecordSnapshot, type SplitSnapshot } from '@/lib/record-changes';

/**
 * A desk pulls the record sets a meet uses.
 *
 * With `since` (the syncTimestamp of its last pull) only the records changed
 * after it come back, plus the ids of records deleted after it; without it,
 * every record in the set. Reverts count as changes, so a record put back on
 * the dashboard reaches the desk on its next pull.
 */
export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json();
    const {
      recordSetIds,
      includeOrganizations = false,
      organizationIds,
      since,
    } = body as {
      recordSetIds: string[];
      includeOrganizations?: boolean;
      organizationIds?: string[];
      since?: string;
    };

    if (!recordSetIds || !Array.isArray(recordSetIds) || recordSetIds.length === 0) {
      return NextResponse.json(
        { error: 'recordSetIds is required and must be a non-empty array' },
        { status: 400 }
      );
    }
    const sinceDate = since ? new Date(since) : null;
    if (sinceDate && Number.isNaN(sinceDate.getTime())) {
      return NextResponse.json({ error: 'since is not a date' }, { status: 400 });
    }
    // Taken before reading, so a change made while this pull runs is in the
    // next one rather than in neither.
    const syncTimestamp = new Date().toISOString();

    const sets = await db
      .select()
      .from(recordSets)
      .where(inArray(recordSets.id, recordSetIds));
    const live = sets.filter((s) => s.isActive !== false);

    const setsWithRecords = await Promise.all(
      live.map(async (rs) => {
        const recs = await db
          .select()
          .from(records)
          .where(sinceDate
            ? and(eq(records.recordSetId, rs.id), gt(records.updatedAt, sinceDate))
            : eq(records.recordSetId, rs.id));
        const splits = recs.length
          ? await db.select().from(recordSplits).where(inArray(recordSplits.recordId, recs.map((r) => r.id)))
          : [];
        const byRecord = new Map<string, SplitSnapshot[]>();
        for (const s of splits) {
          const list = byRecord.get(s.recordId) ?? [];
          list.push({ distanceMeters: s.distanceMeters, label: s.label ?? null, seconds: s.seconds });
          byRecord.set(s.recordId, list);
        }
        const deleted = sinceDate
          ? (await db
              .select({ recordId: recordHistory.recordId, before: recordHistory.beforeJson, after: recordHistory.afterJson })
              .from(recordHistory)
              .where(and(eq(recordHistory.recordSetId, rs.id), gt(recordHistory.createdAt, sinceDate))))
              .filter((h) => h.after == null && h.before != null)
              .map((h) => (h.before as RecordSnapshot).id)
          : [];
        const current = new Set(recs.map((r) => r.id));

        return {
          id: rs.id,
          name: rs.name,
          abbreviation: rs.abbreviation,
          description: rs.description,
          scope: rs.scope,
          gender: rs.gender,
          season: rs.season,
          organization: rs.organizationId,
          venueId: rs.venueId,
          meetSeriesId: rs.meetSeriesId,
          eligibilityRules: rs.eligibilityRules,
          records: recs.map((r) => toSnapshot(r, (byRecord.get(r.id) ?? []).sort((a, b) => a.distanceMeters - b.distanceMeters))),
          // Deleted since `since` and not put back since.
          deletedRecordIds: [...new Set(deleted)].filter((id) => !current.has(id)),
        };
      })
    );
    // Asked for, but deleted on Nexus Online: the desk should let go of them.
    const removedSetIds = recordSetIds.filter((id) => !live.some((s) => s.id === id));

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

    await db.insert(syncLogs).values({
      direction: 'down',
      syncType: 'record_sets',
      recordSetsSynced: live.length,
      recordsSynced: setsWithRecords.reduce((sum, s) => sum + s.records.length, 0),
      organizationsSynced: orgs.length,
      status: 'completed',
      completedAt: new Date(),
      clientIp: request.headers.get('x-forwarded-for') || request.headers.get('x-real-ip') || 'unknown',
    });

    return NextResponse.json({
      recordSets: setsWithRecords,
      removedSetIds,
      full: !sinceDate,
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
