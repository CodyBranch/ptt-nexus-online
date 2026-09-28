'use server';

import { db } from '@/db/client';
import { recordSets, records, recordHistory, eventDefinitions, venues, courses, meetSeries } from '@/db/schema';
import { eq, or, sql, and, SQL, desc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import {
  validateFields, findByKey, writeRecord, logChange, loadSnapshot, deleteRecordLogged, revertHistory,
  type RecordFields, type RecordSnapshot,
} from '@/lib/record-changes';

// ═══════════════════════════════════════════════════════════
// Record Sets
// ═══════════════════════════════════════════════════════════

export async function getRecordSets(params?: {
  scope?: string;
  season?: string;
  active?: boolean;
}) {
  const conditions: SQL[] = [];

  if (params?.scope) {
    conditions.push(eq(recordSets.scope, params.scope));
  }

  if (params?.season) {
    conditions.push(eq(recordSets.season, params.season));
  }

  if (params?.active !== false) {
    conditions.push(eq(recordSets.isActive, true));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  const rows = await db
    .select({
      id: recordSets.id,
      name: recordSets.name,
      abbreviation: recordSets.abbreviation,
      description: recordSets.description,
      scope: recordSets.scope,
      gender: recordSets.gender,
      season: recordSets.season,
      organizationId: recordSets.organizationId,
      venueId: recordSets.venueId,
      meetSeriesId: recordSets.meetSeriesId,
      eligibilityRules: recordSets.eligibilityRules,
      isActive: recordSets.isActive,
      isPublic: recordSets.isPublic,
      notes: recordSets.notes,
      createdAt: recordSets.createdAt,
      updatedAt: recordSets.updatedAt,
      recordCount: sql<number>`(SELECT count(*) FROM records WHERE records.record_set_id = record_sets.id)`,
      organizationName: sql<string | null>`(SELECT name FROM organizations WHERE organizations.id = record_sets.organization_id)`,
      anchorName: sql<string | null>`coalesce((SELECT name FROM venues WHERE venues.id = record_sets.venue_id), (SELECT name FROM meet_series WHERE meet_series.id = record_sets.meet_series_id))`,
    })
    .from(recordSets)
    .where(where)
    .orderBy(recordSets.name);

  return rows;
}

export async function getRecordSet(id: string) {
  const rows = await db
    .select()
    .from(recordSets)
    .where(eq(recordSets.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createRecordSet(data: {
  name: string;
  abbreviation: string;
  description?: string;
  scope: string;
  gender?: string;
  season?: string;
  organizationId?: string;
  venueId?: string | null;
  meetSeriesId?: string | null;
  eligibilityRules?: unknown[];
  isPublic?: boolean;
  notes?: string;
}) {
  await requireAdmin();
  const result = await db
    .insert(recordSets)
    .values({
      name: data.name,
      abbreviation: data.abbreviation,
      description: data.description || null,
      scope: data.scope,
      gender: data.gender || null,
      season: data.season || null,
      organizationId: data.organizationId || null,
      venueId: data.venueId || null,
      meetSeriesId: data.meetSeriesId || null,
      eligibilityRules: data.eligibilityRules ?? [],
      isPublic: data.isPublic ?? true,
      notes: data.notes || null,
    })
    .returning({ id: recordSets.id });

  revalidatePath('/records');
  return result[0];
}

export async function updateRecordSet(
  id: string,
  data: Partial<{
    name: string;
    abbreviation: string;
    description: string;
    scope: string;
    gender: string;
    season: string;
    organizationId: string;
    venueId: string | null;
    meetSeriesId: string | null;
    eligibilityRules: unknown[];
    isPublic: boolean;
    notes: string;
  }>
) {
  await requireAdmin();
  await db
    .update(recordSets)
    .set({
      ...data,
      venueId: data.venueId === undefined ? undefined : data.venueId || null,
      meetSeriesId: data.meetSeriesId === undefined ? undefined : data.meetSeriesId || null,
      updatedAt: new Date(),
    })
    .where(eq(recordSets.id, id));

  revalidatePath('/records');
  revalidatePath(`/records/${id}`);
}

export async function deleteRecordSet(id: string) {
  await requireAdmin();
  await db
    .update(recordSets)
    .set({ isActive: false, updatedAt: new Date() })
    .where(eq(recordSets.id, id));

  revalidatePath('/records');
}

// ═══════════════════════════════════════════════════════════
// Records (within a set)
// ═══════════════════════════════════════════════════════════

export async function getRecords(recordSetId: string, params?: {
  eventCode?: string;
  gender?: string;
}) {
  const conditions: SQL[] = [eq(records.recordSetId, recordSetId)];

  if (params?.eventCode) {
    conditions.push(eq(records.eventCode, params.eventCode));
  }

  if (params?.gender) {
    conditions.push(eq(records.gender, params.gender));
  }

  return db
    .select()
    .from(records)
    .where(and(...conditions))
    .orderBy(records.eventCode, records.gender);
}

export async function getRecord(id: string) {
  const rows = await db
    .select()
    .from(records)
    .where(eq(records.id, id))
    .limit(1);
  return rows[0] ?? null;
}

export async function createRecord(data: {
  recordSetId: string;
  eventCode: string;
  gender: string;
  courseId?: string | null;
  level?: string | null;
  divisionKey?: string | null;
  mark: string;
  markSortable: number;
  athleteName?: string;
  teamName?: string;
  organizationId?: string;
  meetName?: string;
  recordDate?: string;
  location?: string;
  wind?: number;
  notes?: string;
  source?: string;
}) {
  const session = await requireAdmin();
  const fields: RecordFields = { ...data, source: data.source || 'manual_entry' };
  const result = await db.transaction(async (tx) => {
    const bad = await validateFields(tx, fields);
    if (bad) throw new Error(bad);
    const holder = await findByKey(tx, fields);
    if (holder) {
      throw new Error(`${holder.athleteName ?? 'A record'} (${holder.mark}) already holds this event, course and level. Change or delete that one.`);
    }
    const after = await writeRecord(tx, null, fields);
    await logChange(tx, 'created', null, after, { changedBy: session.email, source: 'manual_edit' });
    return after;
  });

  revalidatePath(`/records/${data.recordSetId}`);
  return { id: result.id };
}

export async function updateRecord(
  id: string,
  data: Partial<{
    mark: string;
    markSortable: number;
    athleteName: string;
    teamName: string;
    organizationId: string;
    meetName: string;
    recordDate: string;
    location: string;
    wind: number;
    notes: string;
    source: string;
    courseId: string | null;
    level: string | null;
    divisionKey: string | null;
  }>
) {
  const session = await requireAdmin();
  const setId = await db.transaction(async (tx) => {
    const before = await loadSnapshot(tx, id);
    if (!before) throw new Error('That record is not there any more');
    const fields: RecordFields = { ...before, ...data } as RecordFields;
    const bad = await validateFields(tx, fields);
    if (bad) throw new Error(bad);
    const holder = await findByKey(tx, fields);
    if (holder && holder.id !== id) throw new Error('Another record already holds that event, course and level');
    const after = await writeRecord(tx, id, fields, before.revision);
    await logChange(tx, 'edited', before, after, { changedBy: session.email, source: 'manual_edit' });
    return before.recordSetId;
  });
  revalidatePath(`/records/${setId}`);
}

/** Deleted, but logged first: it can be put back from the set's history. */
export async function deleteRecord(id: string) {
  const session = await requireAdmin();
  const before = await db.transaction((tx) => deleteRecordLogged(tx, id, { changedBy: session.email, source: 'manual_edit' }));
  if (before) {
    revalidatePath(`/records/${before.recordSetId}`);
  }
}

// ═══════════════════════════════════════════════════════════
// Record History
// ═══════════════════════════════════════════════════════════

export async function getRecordHistory(recordId: string) {
  return db
    .select()
    .from(recordHistory)
    .where(eq(recordHistory.recordId, recordId))
    .orderBy(desc(recordHistory.createdAt));
}

export interface HistoryEntry {
  id: string;
  changeKind: string | null;
  createdAt: string | null;
  changedBy: string | null;
  source: string | null;
  before: RecordSnapshot | null;
  after: RecordSnapshot | null;
  revertedFromId: string | null;
  /** Written before full history was kept: shown, not revertible. */
  legacy: boolean;
}

/** Every change in a set, newest first. */
export async function getRecordSetHistory(recordSetId: string, limit = 200): Promise<HistoryEntry[]> {
  const rows = await db
    .select()
    .from(recordHistory)
    .where(or(
      eq(recordHistory.recordSetId, recordSetId),
      sql`${recordHistory.recordId} IN (SELECT id FROM records WHERE record_set_id = ${recordSetId})`,
    ))
    .orderBy(desc(recordHistory.createdAt))
    .limit(limit);
  return rows.map((h) => ({
    id: h.id,
    changeKind: h.changeKind ?? (h.source === 'desktop_sync' ? 'broken' : null),
    createdAt: h.createdAt ? new Date(h.createdAt).toISOString() : null,
    changedBy: h.changedBy,
    source: h.source,
    before: (h.beforeJson as RecordSnapshot | null) ?? null,
    after: (h.afterJson as RecordSnapshot | null) ?? null,
    revertedFromId: h.revertedFromId,
    legacy: h.beforeJson == null && h.afterJson == null,
  }));
}

/** Puts the record back as it was before this change. */
export async function revertRecordChange(historyId: string, recordSetId: string): Promise<{ ok: boolean; error?: string }> {
  const session = await requireAdmin();
  const result = await revertHistory(historyId, session.email);
  revalidatePath(`/records/${recordSetId}`);
  return result.ok ? { ok: true } : { ok: false, error: result.error };
}

// ═══════════════════════════════════════════════════════════
// Anchors: venues, courses and meet series for the pickers
// ═══════════════════════════════════════════════════════════

export async function getAnchorOptions() {
  const [v, m] = await Promise.all([
    db.select({ id: venues.id, name: venues.name, state: venues.state }).from(venues).where(eq(venues.isActive, true)).orderBy(venues.name),
    db.select({ id: meetSeries.id, name: meetSeries.name, venueId: meetSeries.venueId }).from(meetSeries).where(eq(meetSeries.isActive, true)).orderBy(meetSeries.name),
  ]);
  return { venues: v, meetSeries: m };
}

/** The courses a record in this set can be pinned to: its venue's, or its series' venue's. */
export async function getSetCourses(recordSetId: string) {
  const set = await getRecordSet(recordSetId);
  if (!set) return [];
  let venueId = set.venueId;
  if (!venueId && set.meetSeriesId) {
    const [ms] = await db.select({ venueId: meetSeries.venueId }).from(meetSeries).where(eq(meetSeries.id, set.meetSeriesId)).limit(1);
    venueId = ms?.venueId ?? null;
  }
  if (!venueId) return [];
  return db
    .select({ id: courses.id, name: courses.name, distanceMeters: courses.distanceMeters, isActive: courses.isActive })
    .from(courses)
    .where(eq(courses.venueId, venueId))
    .orderBy(desc(courses.isActive), courses.name);
}

export async function getSetAnchor(recordSetId: string): Promise<{ kind: 'venue' | 'series'; name: string; href: string } | null> {
  const set = await getRecordSet(recordSetId);
  if (!set) return null;
  if (set.venueId) {
    const [v] = await db.select({ id: venues.id, name: venues.name }).from(venues).where(eq(venues.id, set.venueId)).limit(1);
    if (v) return { kind: 'venue', name: v.name, href: `/venues/${v.id}` };
  }
  if (set.meetSeriesId) {
    const [m] = await db.select({ name: meetSeries.name, venueId: meetSeries.venueId }).from(meetSeries).where(eq(meetSeries.id, set.meetSeriesId)).limit(1);
    if (m) return { kind: 'series', name: m.name, href: m.venueId ? `/venues/${m.venueId}` : '/venues' };
  }
  return null;
}

// ═══════════════════════════════════════════════════════════
// Event Definitions (for dropdown selectors)
// ═══════════════════════════════════════════════════════════

export async function getEventDefinitions(params?: {
  venueFilter?: string; // 'outdoor', 'indoor', 'both'
  category?: string;
}) {
  const conditions: SQL[] = [];

  if (params?.venueFilter && params.venueFilter !== 'both') {
    // Show events for the requested venue + events that work in both venues
    conditions.push(
      or(
        eq(eventDefinitions.venueFilter, params.venueFilter),
        eq(eventDefinitions.venueFilter, 'both')
      )!
    );
  }

  if (params?.category) {
    conditions.push(eq(eventDefinitions.category, params.category));
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;

  return db
    .select({
      id: eventDefinitions.id,
      name: eventDefinitions.name,
      shortName: eventDefinitions.shortName,
      eventType: eventDefinitions.eventType,
      category: eventDefinitions.category,
      venueFilter: eventDefinitions.venueFilter,
      sortOrder: eventDefinitions.sortOrder,
      isWindAffected: eventDefinitions.isWindAffected,
      lowerIsBetter: eventDefinitions.lowerIsBetter,
      markFormat: eventDefinitions.markFormat,
    })
    .from(eventDefinitions)
    .where(where)
    .orderBy(eventDefinitions.sortOrder, eventDefinitions.name);
}
