'use server';

import { db } from '@/db/client';
import { recordSets, records, recordHistory, organizations, eventDefinitions } from '@/db/schema';
import { eq, ilike, or, sql, and, SQL, desc } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';

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
      eligibilityRules: recordSets.eligibilityRules,
      isActive: recordSets.isActive,
      isPublic: recordSets.isPublic,
      notes: recordSets.notes,
      createdAt: recordSets.createdAt,
      updatedAt: recordSets.updatedAt,
      recordCount: sql<number>`(SELECT count(*) FROM records WHERE records.record_set_id = record_sets.id)`,
      organizationName: sql<string | null>`(SELECT name FROM organizations WHERE organizations.id = record_sets.organization_id)`,
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
  eligibilityRules?: unknown[];
  isPublic?: boolean;
  notes?: string;
}) {
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
    eligibilityRules: unknown[];
    isPublic: boolean;
    notes: string;
  }>
) {
  await db
    .update(recordSets)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(recordSets.id, id));

  revalidatePath('/records');
  revalidatePath(`/records/${id}`);
}

export async function deleteRecordSet(id: string) {
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
  const result = await db
    .insert(records)
    .values({
      recordSetId: data.recordSetId,
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
      source: data.source || 'manual_entry',
    })
    .returning({ id: records.id });

  revalidatePath(`/records/${data.recordSetId}`);
  return result[0];
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
    verified: boolean;
  }>
) {
  await db
    .update(records)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(records.id, id));

  // Get record set ID for revalidation
  const rec = await db.select({ recordSetId: records.recordSetId }).from(records).where(eq(records.id, id)).limit(1);
  if (rec[0]) {
    revalidatePath(`/records/${rec[0].recordSetId}`);
  }
}

export async function deleteRecord(id: string) {
  // Get record set ID for revalidation before deleting
  const rec = await db.select({ recordSetId: records.recordSetId }).from(records).where(eq(records.id, id)).limit(1);

  await db.delete(records).where(eq(records.id, id));

  if (rec[0]) {
    revalidatePath(`/records/${rec[0].recordSetId}`);
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
