import { db } from '@/db/client';
import { records, recordSplits, recordHistory, recordSets, courses, eventDefinitions } from '@/db/schema';
import { and, eq, isNull, SQL } from 'drizzle-orm';
import { isRecordLevel } from '@/types';

/**
 * Every change to a record goes through here, so every change is logged the
 * same way: the whole record, splits included, as it was before and after.
 *
 * Records pushed from a desk go live at once; nobody approves them first.
 * What makes that safe is that any change can be put back — reverting writes
 * the "before" of a history entry back as the record, and is itself logged,
 * so a revert can be reverted too.
 */

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

export interface SplitSnapshot {
  distanceMeters: number;
  label: string | null;
  seconds: number;
}

export interface RecordSnapshot {
  id: string;
  recordSetId: string;
  eventCode: string;
  gender: string;
  courseId: string | null;
  level: string | null;
  divisionKey: string | null;
  holderNo: number;
  mark: string;
  markSortable: number;
  athleteName: string | null;
  teamName: string | null;
  organizationId: string | null;
  meetName: string | null;
  recordDate: string | null;
  location: string | null;
  wind: number | null;
  notes: string | null;
  source: string | null;
  carriedFromCourseId: string | null;
  revision: number;
  updatedAt: string | null;
  splits: SplitSnapshot[];
}

export type ChangeKind = 'created' | 'broken' | 'edited' | 'deleted' | 'reverted' | 'carried_over';

export interface ChangeMeta {
  changedBy: string;
  desktopKeyId?: string | null;
  source: 'desktop_sync' | 'manual_edit' | 'revert' | 'course_carry';
  meetName?: string | null;
  meetId?: string | null;
  meetDate?: string | null;
  revertedFromId?: string | null;
}

/** The fields a change may set; identity and bookkeeping are the server's. */
export interface RecordFields {
  recordSetId: string;
  eventCode: string;
  gender: string;
  courseId?: string | null;
  level?: string | null;
  divisionKey?: string | null;
  holderNo?: number;
  mark: string;
  markSortable: number;
  athleteName?: string | null;
  teamName?: string | null;
  organizationId?: string | null;
  meetName?: string | null;
  recordDate?: string | null;
  location?: string | null;
  wind?: number | null;
  notes?: string | null;
  source?: string | null;
  carriedFromCourseId?: string | null;
  splits?: Array<{ distanceMeters: number; label?: string | null; seconds: number }>;
}

// ── Reading ─────────────────────────────────────────────────────────────────

export async function loadSnapshot(tx: Tx, id: string): Promise<RecordSnapshot | null> {
  const [r] = await tx.select().from(records).where(eq(records.id, id)).limit(1);
  if (!r) return null;
  const splits = await tx
    .select({ distanceMeters: recordSplits.distanceMeters, label: recordSplits.label, seconds: recordSplits.seconds })
    .from(recordSplits)
    .where(eq(recordSplits.recordId, id))
    .orderBy(recordSplits.distanceMeters);
  return toSnapshot(r, splits);
}

export function toSnapshot(r: typeof records.$inferSelect, splits: SplitSnapshot[]): RecordSnapshot {
  return {
    id: r.id,
    recordSetId: r.recordSetId,
    eventCode: r.eventCode,
    gender: r.gender,
    courseId: r.courseId ?? null,
    level: r.level ?? null,
    divisionKey: r.divisionKey ?? null,
    holderNo: r.holderNo,
    mark: r.mark,
    markSortable: r.markSortable,
    athleteName: r.athleteName ?? null,
    teamName: r.teamName ?? null,
    organizationId: r.organizationId ?? null,
    meetName: r.meetName ?? null,
    recordDate: r.recordDate ?? null,
    location: r.location ?? null,
    wind: r.wind ?? null,
    notes: r.notes ?? null,
    source: r.source ?? null,
    carriedFromCourseId: r.carriedFromCourseId ?? null,
    revision: r.revision,
    updatedAt: r.updatedAt ? new Date(r.updatedAt).toISOString() : null,
    splits: splits.map((s) => ({ distanceMeters: s.distanceMeters, label: s.label ?? null, seconds: s.seconds })),
  };
}

/** The record that holds this place: set, event, gender, course, level, division, holder. */
export async function findByKey(tx: Tx, k: {
  recordSetId: string; eventCode: string; gender: string;
  courseId?: string | null; level?: string | null; divisionKey?: string | null; holderNo?: number;
}): Promise<RecordSnapshot | null> {
  const nullable = (col: typeof records.courseId | typeof records.level | typeof records.divisionKey, v: string | null | undefined): SQL =>
    v == null || v === '' ? isNull(col) : eq(col, v);
  const [r] = await tx
    .select({ id: records.id })
    .from(records)
    .where(and(
      eq(records.recordSetId, k.recordSetId),
      eq(records.eventCode, k.eventCode),
      eq(records.gender, k.gender),
      nullable(records.courseId, k.courseId),
      nullable(records.level, k.level),
      nullable(records.divisionKey, k.divisionKey),
      eq(records.holderNo, k.holderNo ?? 1),
    ))
    .limit(1);
  return r ? loadSnapshot(tx, r.id) : null;
}

/** Lower is better for times; higher for jumps, throws and points. */
export async function lowerIsBetter(tx: Tx, eventCode: string): Promise<boolean> {
  if (eventCode.startsWith('XC-')) return true;
  const [e] = await tx
    .select({ lower: eventDefinitions.lowerIsBetter })
    .from(eventDefinitions)
    .where(eq(eventDefinitions.id, eventCode))
    .limit(1);
  return e?.lower ?? true;
}

export function isBetter(lower: boolean, candidate: number, current: number): boolean {
  return lower ? candidate < current : candidate > current;
}

// ── Writing ─────────────────────────────────────────────────────────────────

function clean(v: string | null | undefined): string | null {
  const t = typeof v === 'string' ? v.trim() : v;
  return t ? t : null;
}

/** Checks a change's fields before anything is written. Null = fine. */
export async function validateFields(tx: Tx, f: RecordFields): Promise<string | null> {
  if (!f.recordSetId) return 'recordSetId is required';
  if (!f.eventCode) return 'eventCode is required';
  if (f.gender !== 'M' && f.gender !== 'F') return 'gender must be M or F';
  if (!f.mark || typeof f.markSortable !== 'number' || !Number.isFinite(f.markSortable)) return 'mark and markSortable are required';
  if (f.level != null && f.level !== '' && !isRecordLevel(f.level)) return `level "${f.level}" is not one of high_school, college, middle_school, youth, open`;
  const [set] = await tx.select({ id: recordSets.id, active: recordSets.isActive }).from(recordSets).where(eq(recordSets.id, f.recordSetId)).limit(1);
  if (!set || set.active === false) return 'That record set does not exist or was deleted';
  if (f.courseId) {
    const [c] = await tx.select({ id: courses.id }).from(courses).where(eq(courses.id, f.courseId)).limit(1);
    if (!c) return 'That course does not exist on Nexus Online; push the course first';
  }
  return null;
}

/**
 * Writes the record (new when `id` is null or not there any more) and its
 * splits, bumping the revision. Returns what is there now.
 */
export async function writeRecord(tx: Tx, id: string | null, f: RecordFields, prevRevision = 0): Promise<RecordSnapshot> {
  const values = {
    recordSetId: f.recordSetId,
    eventCode: f.eventCode,
    gender: f.gender,
    courseId: f.courseId || null,
    level: clean(f.level),
    divisionKey: clean(f.divisionKey),
    holderNo: f.holderNo && f.holderNo > 0 ? Math.floor(f.holderNo) : 1,
    mark: f.mark.trim(),
    markSortable: f.markSortable,
    athleteName: clean(f.athleteName),
    teamName: clean(f.teamName),
    organizationId: f.organizationId || null,
    meetName: clean(f.meetName),
    recordDate: clean(f.recordDate),
    location: clean(f.location),
    wind: f.wind ?? null,
    notes: clean(f.notes),
    source: clean(f.source),
    carriedFromCourseId: f.carriedFromCourseId || null,
    revision: prevRevision + 1,
    lastSyncedAt: new Date(),
    updatedAt: new Date(),
  };
  let rid = id;
  const exists = id ? (await tx.select({ id: records.id }).from(records).where(eq(records.id, id)).limit(1)).length > 0 : false;
  if (exists && rid) {
    await tx.update(records).set(values).where(eq(records.id, rid));
  } else {
    const [row] = await tx.insert(records).values({ ...(rid ? { id: rid } : {}), ...values }).returning({ id: records.id });
    rid = row.id;
  }
  if (f.splits) {
    await tx.delete(recordSplits).where(eq(recordSplits.recordId, rid!));
    const seen = new Set<number>();
    const rows = f.splits
      .filter((s) => Number.isFinite(s.distanceMeters) && Number.isFinite(s.seconds) && s.seconds > 0)
      .filter((s) => { const k = Math.round(s.distanceMeters); if (seen.has(k)) return false; seen.add(k); return true; })
      .map((s) => ({ recordId: rid!, distanceMeters: s.distanceMeters, label: clean(s.label ?? null), seconds: s.seconds }));
    if (rows.length) await tx.insert(recordSplits).values(rows);
  }
  return (await loadSnapshot(tx, rid!))!;
}

export function fieldsOf(s: RecordSnapshot): RecordFields {
  return {
    recordSetId: s.recordSetId, eventCode: s.eventCode, gender: s.gender, courseId: s.courseId,
    level: s.level, divisionKey: s.divisionKey, holderNo: s.holderNo, mark: s.mark, markSortable: s.markSortable,
    athleteName: s.athleteName, teamName: s.teamName, organizationId: s.organizationId, meetName: s.meetName,
    recordDate: s.recordDate, location: s.location, wind: s.wind, notes: s.notes, source: s.source,
    carriedFromCourseId: s.carriedFromCourseId, splits: s.splits,
  };
}

export async function logChange(
  tx: Tx,
  kind: ChangeKind,
  before: RecordSnapshot | null,
  after: RecordSnapshot | null,
  meta: ChangeMeta,
): Promise<string> {
  const [h] = await tx.insert(recordHistory).values({
    recordId: after?.id ?? before?.id ?? null,
    recordSetId: after?.recordSetId ?? before?.recordSetId ?? null,
    changeKind: kind,
    beforeJson: before,
    afterJson: after,
    revertedFromId: meta.revertedFromId ?? null,
    desktopKeyId: meta.desktopKeyId ?? null,
    changedBy: meta.changedBy,
    previousMark: before?.mark ?? null,
    previousMarkSortable: before?.markSortable ?? null,
    previousAthleteName: before?.athleteName ?? null,
    previousTeamName: before?.teamName ?? null,
    previousMeetName: before?.meetName ?? null,
    previousRecordDate: before?.recordDate ?? null,
    previousWind: before?.wind ?? null,
    newMark: after?.mark ?? null,
    newAthleteName: after?.athleteName ?? null,
    brokenAtMeet: kind === 'broken' ? (meta.meetName ?? after?.meetName ?? null) : null,
    brokenDate: kind === 'broken' ? (meta.meetDate ?? after?.recordDate ?? null) : null,
    source: meta.source,
    syncedFromMeetId: meta.meetId ?? null,
  }).returning({ id: recordHistory.id });
  return h.id;
}

/** Deletes the record, logging it first so it can be put back. */
export async function deleteRecordLogged(tx: Tx, id: string, meta: ChangeMeta, kind: ChangeKind = 'deleted'): Promise<RecordSnapshot | null> {
  const before = await loadSnapshot(tx, id);
  if (!before) return null;
  await logChange(tx, kind, before, null, meta);
  await tx.delete(records).where(eq(records.id, id));
  return before;
}

// ── Reverting ───────────────────────────────────────────────────────────────

export type RevertResult =
  | { ok: true; record: RecordSnapshot | null }
  | { ok: false; error: string };

/**
 * Puts the record back as it was before history entry `historyId`.
 *
 * - The entry created the record: reverting deletes it.
 * - The entry changed or deleted it: the "before" is written back, under the
 *   same id, whatever has happened to the record since.
 *
 * Logged as 'reverted', pointing at the entry it undid.
 */
export async function revertHistory(historyId: string, changedBy: string): Promise<RevertResult> {
  try {
    return await db.transaction(async (tx) => {
      const [h] = await tx.select().from(recordHistory).where(eq(recordHistory.id, historyId)).limit(1);
      if (!h) return { ok: false as const, error: 'That change is not in the history' };
      const target = h.beforeJson as RecordSnapshot | null;
      const after = h.afterJson as RecordSnapshot | null;
      if (!target && !after) return { ok: false as const, error: 'This entry was written before full history was kept, so it cannot be reverted' };
      const id = target?.id ?? after?.id ?? h.recordId;
      if (!id) return { ok: false as const, error: 'This entry does not say which record it was' };
      const meta: ChangeMeta = { changedBy, source: 'revert', revertedFromId: historyId };

      const current = await loadSnapshot(tx, id);
      if (!target) {
        if (!current) return { ok: false as const, error: 'That record is already gone' };
        await deleteRecordLogged(tx, id, meta, 'reverted');
        return { ok: true as const, record: null };
      }
      // Something else may hold the place the old record would go back to
      // (a new record set at the same key after this one was deleted).
      const holder = await findByKey(tx, target);
      if (holder && holder.id !== id) {
        return { ok: false as const, error: `${holder.athleteName ?? 'Another record'} (${holder.mark}) now holds that place. Revert or delete that one first.` };
      }
      const [set] = await tx.select({ id: recordSets.id }).from(recordSets).where(eq(recordSets.id, target.recordSetId)).limit(1);
      if (!set) return { ok: false as const, error: 'The record set this record was in no longer exists' };
      const restored = await writeRecord(tx, id, fieldsOf(target), current?.revision ?? target.revision);
      await logChange(tx, 'reverted', current, restored, meta);
      return { ok: true as const, record: restored };
    });
  } catch (err) {
    console.error('Record revert failed:', err);
    return { ok: false, error: err instanceof Error ? err.message : 'Revert failed' };
  }
}

// ── A desk's change ─────────────────────────────────────────────────────────

export interface DeskRecordChange extends RecordFields {
  /**
   * claim — "this mark is the record now": applied only when it is better
   *   than what is there (or nothing is there), whoever changed it last.
   * edit — a correction to a record the desk pulled: applied only if nobody
   *   changed it since (baseRevision).
   * delete — the same, removing it.
   */
  kind: 'claim' | 'edit' | 'delete';
  recordId?: string | null;
  baseRevision?: number | null;
}

export type DeskChangeStatus = 'created' | 'broken' | 'edited' | 'deleted' | 'not_better' | 'conflict' | 'error';

export interface DeskChangeResult {
  index: number;
  status: DeskChangeStatus;
  record: RecordSnapshot | null;
  message?: string;
}

export async function applyDeskChange(index: number, c: DeskRecordChange, meta: ChangeMeta): Promise<DeskChangeResult> {
  try {
    return await db.transaction(async (tx) => {
      if (c.kind === 'delete' || c.kind === 'edit') {
        if (!c.recordId) return { index, status: 'error' as const, record: null, message: 'recordId is required' };
        const current = await loadSnapshot(tx, c.recordId);
        if (!current) return { index, status: 'conflict' as const, record: null, message: 'That record was deleted on Nexus Online' };
        if (c.baseRevision != null && c.baseRevision !== current.revision) {
          return { index, status: 'conflict' as const, record: current, message: 'Changed on Nexus Online since this desk pulled it' };
        }
        if (c.kind === 'delete') {
          await deleteRecordLogged(tx, current.id, meta);
          return { index, status: 'deleted' as const, record: null };
        }
        const bad = await validateFields(tx, c);
        if (bad) return { index, status: 'error' as const, record: current, message: bad };
        const holder = await findByKey(tx, c);
        if (holder && holder.id !== current.id) {
          return { index, status: 'conflict' as const, record: holder, message: 'Another record already holds that event, course and level' };
        }
        const after = await writeRecord(tx, current.id, c, current.revision);
        await logChange(tx, 'edited', current, after, meta);
        return { index, status: 'edited' as const, record: after };
      }

      // claim
      const bad = await validateFields(tx, c);
      if (bad) return { index, status: 'error' as const, record: null, message: bad };
      const byId = c.recordId ? await loadSnapshot(tx, c.recordId) : null;
      const current = byId && byId.recordSetId === c.recordSetId ? byId : await findByKey(tx, c);
      if (!current) {
        const after = await writeRecord(tx, null, c);
        await logChange(tx, 'created', null, after, meta);
        return { index, status: 'created' as const, record: after };
      }
      const lower = await lowerIsBetter(tx, c.eventCode);
      if (!isBetter(lower, c.markSortable, current.markSortable)) {
        return {
          index, status: 'not_better' as const, record: current,
          message: c.markSortable === current.markSortable ? 'Ties the record; it stands' : 'The record on Nexus Online is better',
        };
      }
      // The new holder's splits replace the old holder's, none or not.
      const after = await writeRecord(tx, current.id, { ...c, splits: c.splits ?? [], courseId: current.courseId, level: current.level, divisionKey: current.divisionKey, holderNo: current.holderNo }, current.revision);
      await logChange(tx, 'broken', current, after, meta);
      return { index, status: 'broken' as const, record: after };
    });
  } catch (err) {
    console.error('Desk record change failed:', err);
    return { index, status: 'error', record: null, message: err instanceof Error ? err.message : 'Failed' };
  }
}
