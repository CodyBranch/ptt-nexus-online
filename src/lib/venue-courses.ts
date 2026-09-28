import { db } from '@/db/client';
import { venues, courses, meetSeries, records, recordSets, courseRatingLog } from '@/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { loadSnapshot, writeRecord, fieldsOf, logChange, findByKey } from '@/lib/record-changes';
import { isRecordLevel } from '@/types';

/**
 * Courses live at their venue on Nexus Online, so a meet there pulls the
 * course instead of setting it up again: the trace, the difficulty ratings
 * and where the split points usually are.
 */

export interface CourseInput {
  venueId: string;
  /** The course on Nexus Online this came from, when pushing a change. */
  courseId?: string | null;
  /** The revision the desk last had; an edit on top of a newer one is refused. */
  baseRevision?: number | null;
  /**
   * same — an edit to the course (the default).
   * new — a reroute: a new course replaces this one, and records start fresh.
   * new_carry — a reroute that keeps the records: they are copied onto the
   *   new course, marked as set on the layout it replaced.
   */
  mode?: 'same' | 'new' | 'new_carry';
  name: string;
  distanceMeters: number;
  kml?: string | null;
  profile?: unknown;
  totalGainMeters?: number | null;
  totalLossMeters?: number | null;
  difficulty?: unknown[];
  splitPoints?: Array<{ label: string; distanceMeters: number }>;
  notes?: string | null;
  /** The meet the desk had open, for the ratings log. */
  meetName?: string | null;
}

export type CourseRow = typeof courses.$inferSelect;
type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

// ── Ratings ─────────────────────────────────────────────────────────────────

export interface RatingSegment {
  fromMeters: number;
  toMeters: number;
  difficulty: number;
  gainMeters?: number | null;
  lossMeters?: number | null;
  surface?: string | null;
  notes?: string | null;
}

/** Only what a rating is: stretches in order, each with a number. */
export function cleanRatings(v: unknown): RatingSegment[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((r): r is RatingSegment => !!r && Number.isFinite(r.fromMeters) && Number.isFinite(r.toMeters)
      && Number.isFinite(r.difficulty) && r.toMeters > r.fromMeters)
    .map((r) => ({
      fromMeters: r.fromMeters, toMeters: r.toMeters, difficulty: r.difficulty,
      gainMeters: r.gainMeters ?? null, lossMeters: r.lossMeters ?? null,
      surface: r.surface ?? null, notes: r.notes ?? null,
    }))
    .sort((a, b) => a.fromMeters - b.fromMeters);
}

function sameRatings(a: unknown, b: unknown): boolean {
  return JSON.stringify(cleanRatings(a)) === JSON.stringify(cleanRatings(b));
}

async function logRatings(tx: Tx, courseId: string, ratings: RatingSegment[], meta: {
  kind?: 'saved' | 'restored'; meetName?: string | null; changedBy: string; keyId?: string | null; restoredFromId?: string | null;
}): Promise<void> {
  await tx.insert(courseRatingLog).values({
    courseId,
    difficultyJson: ratings,
    segmentCount: ratings.length,
    changeKind: meta.kind ?? 'saved',
    meetName: meta.meetName ?? null,
    changedBy: meta.changedBy,
    desktopKeyId: meta.keyId ?? null,
    restoredFromId: meta.restoredFromId ?? null,
  });
}

export type RatingsResult =
  | { status: 'saved' | 'unchanged'; revision: number; previousRevision: number }
  | { status: 'error'; message: string; httpStatus: number };

/**
 * A desk's new ratings for a course, on their own. Ratings change as the
 * history grows and are not a reason to ask about reroutes; the last one
 * sent is the course's, and every earlier one stays in the log.
 */
export async function setCourseRatings(courseId: string, ratings: unknown, meta: {
  meetName?: string | null; changedBy: string; keyId?: string | null;
}): Promise<RatingsResult> {
  const clean = cleanRatings(ratings);
  return db.transaction(async (tx) => {
    const [c] = await tx.select().from(courses).where(eq(courses.id, courseId)).limit(1);
    if (!c) return { status: 'error' as const, message: 'That course is not on Nexus Online', httpStatus: 404 };
    if (sameRatings(c.difficultyJson, clean)) return { status: 'unchanged' as const, revision: c.revision, previousRevision: c.revision };
    const [row] = await tx.update(courses)
      .set({ difficultyJson: clean, revision: c.revision + 1, updatedByKeyId: meta.keyId ?? null, updatedAt: new Date() })
      .where(eq(courses.id, courseId)).returning({ revision: courses.revision });
    await logRatings(tx, courseId, clean, meta);
    return { status: 'saved' as const, revision: row.revision, previousRevision: c.revision };
  });
}

export async function courseRatingHistory(courseId: string) {
  const rows = await db.select().from(courseRatingLog)
    .where(eq(courseRatingLog.courseId, courseId))
    .orderBy(desc(courseRatingLog.createdAt))
    .limit(100);
  return rows.map((r) => ({
    id: r.id,
    ratings: cleanRatings(r.difficultyJson),
    segmentCount: r.segmentCount,
    changeKind: r.changeKind,
    meetName: r.meetName,
    changedBy: r.changedBy,
    restoredFromId: r.restoredFromId,
    createdAt: r.createdAt ? new Date(r.createdAt).toISOString() : null,
  }));
}

/** Put a course's ratings back to an earlier set from its log. Logged too. */
export async function restoreCourseRatings(logId: string, changedBy: string): Promise<{ ok: boolean; error?: string; courseId?: string }> {
  return db.transaction(async (tx) => {
    const [entry] = await tx.select().from(courseRatingLog).where(eq(courseRatingLog.id, logId)).limit(1);
    if (!entry) return { ok: false, error: 'That set of ratings is not in the log' };
    const [c] = await tx.select().from(courses).where(eq(courses.id, entry.courseId)).limit(1);
    if (!c) return { ok: false, error: 'That course is gone' };
    const ratings = cleanRatings(entry.difficultyJson);
    if (sameRatings(c.difficultyJson, ratings)) return { ok: false, error: 'These are the ratings it has now' };
    await tx.update(courses).set({ difficultyJson: ratings, revision: c.revision + 1, updatedAt: new Date() }).where(eq(courses.id, c.id));
    await logRatings(tx, c.id, ratings, { kind: 'restored', changedBy, restoredFromId: entry.id });
    return { ok: true, courseId: c.id };
  });
}

export function courseOut(c: CourseRow) {
  return {
    id: c.id,
    venueId: c.venueId,
    name: c.name,
    distanceMeters: c.distanceMeters,
    kml: c.kml,
    profile: c.profileJson,
    totalGainMeters: c.totalGainMeters,
    totalLossMeters: c.totalLossMeters,
    difficulty: c.difficultyJson ?? [],
    splitPoints: c.splitPointsJson ?? [],
    notes: c.notes,
    revision: c.revision,
    replacesCourseId: c.replacesCourseId,
    isActive: c.isActive !== false,
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
  };
}

export function courseSummary(c: CourseRow) {
  const splits = Array.isArray(c.splitPointsJson) ? c.splitPointsJson.length : 0;
  const diff = Array.isArray(c.difficultyJson) ? c.difficultyJson.length : 0;
  return {
    id: c.id,
    name: c.name,
    distanceMeters: c.distanceMeters,
    revision: c.revision,
    replacesCourseId: c.replacesCourseId,
    isActive: c.isActive !== false,
    hasMap: !!c.kml,
    splitPointCount: splits,
    difficultySegmentCount: diff,
    updatedAt: c.updatedAt ? new Date(c.updatedAt).toISOString() : null,
  };
}

function cleanSplitPoints(v: CourseInput['splitPoints']): Array<{ label: string; distanceMeters: number }> {
  if (!Array.isArray(v)) return [];
  return v
    .filter((p) => p && Number.isFinite(p.distanceMeters) && p.distanceMeters > 0)
    .map((p) => ({ label: String(p.label ?? '').trim() || `${Math.round(p.distanceMeters)}m`, distanceMeters: p.distanceMeters }))
    .sort((a, b) => a.distanceMeters - b.distanceMeters);
}

export function validateCourse(c: CourseInput): string | null {
  if (!c.venueId) return 'venueId is required';
  if (!c.name?.trim()) return 'The course needs a name';
  if (!Number.isFinite(c.distanceMeters) || c.distanceMeters <= 0) return 'The course needs a distance';
  if (c.mode && c.mode !== 'same' && c.mode !== 'new' && c.mode !== 'new_carry') return 'mode must be same, new or new_carry';
  if ((c.mode === 'new' || c.mode === 'new_carry') && !c.courseId) return 'A reroute needs the course it replaces (courseId)';
  return null;
}

export type PushCourseResult =
  | { status: 'created' | 'updated' | 'replaced'; course: ReturnType<typeof courseOut>; carried: number; replaced?: string | null }
  | { status: 'conflict'; course: ReturnType<typeof courseOut>; message: string }
  | { status: 'error'; message: string; httpStatus: number };

export async function pushCourse(input: CourseInput, keyId: string | null, changedBy: string): Promise<PushCourseResult> {
  const bad = validateCourse(input);
  if (bad) return { status: 'error', message: bad, httpStatus: 400 };

  return db.transaction(async (tx) => {
    const [venue] = await tx.select({ id: venues.id }).from(venues).where(eq(venues.id, input.venueId)).limit(1);
    if (!venue) return { status: 'error' as const, message: 'That venue does not exist on Nexus Online', httpStatus: 404 };

    const fields = {
      venueId: input.venueId,
      name: input.name.trim(),
      distanceMeters: input.distanceMeters,
      kml: input.kml ?? null,
      profileJson: input.profile ?? null,
      totalGainMeters: input.totalGainMeters ?? null,
      totalLossMeters: input.totalLossMeters ?? null,
      difficultyJson: cleanRatings(input.difficulty),
      splitPointsJson: cleanSplitPoints(input.splitPoints),
      notes: input.notes?.trim() || null,
      updatedByKeyId: keyId,
      updatedAt: new Date(),
    };

    const ratingsMeta = { meetName: input.meetName ?? null, changedBy, keyId };

    if (!input.courseId) {
      const [row] = await tx.insert(courses).values(fields).returning();
      if (fields.difficultyJson.length) await logRatings(tx, row.id, fields.difficultyJson, ratingsMeta);
      return { status: 'created' as const, course: courseOut(row), carried: 0 };
    }

    const [old] = await tx.select().from(courses).where(eq(courses.id, input.courseId)).limit(1);
    if (!old) return { status: 'error' as const, message: 'That course is not on Nexus Online any more', httpStatus: 404 };

    const mode = input.mode ?? 'same';
    if (mode === 'same') {
      if (input.baseRevision != null && input.baseRevision !== old.revision) {
        return { status: 'conflict' as const, course: courseOut(old), message: 'Someone changed this course on Nexus Online since this desk pulled it' };
      }
      const [row] = await tx.update(courses).set({ ...fields, revision: old.revision + 1 }).where(eq(courses.id, old.id)).returning();
      if (!sameRatings(old.difficultyJson, fields.difficultyJson)) await logRatings(tx, row.id, fields.difficultyJson, ratingsMeta);
      return { status: 'updated' as const, course: courseOut(row), carried: 0 };
    }

    // A reroute: a new course, and the old one retired rather than edited.
    const [row] = await tx.insert(courses).values({ ...fields, replacesCourseId: old.id }).returning();
    if (fields.difficultyJson.length) await logRatings(tx, row.id, fields.difficultyJson, ratingsMeta);
    await tx.update(courses).set({ isActive: false, updatedAt: new Date() }).where(eq(courses.id, old.id));

    let carried = 0;
    if (mode === 'new_carry') {
      const onOld = await tx.select({ id: records.id }).from(records).where(eq(records.courseId, old.id));
      for (const { id } of onOld) {
        const snap = await loadSnapshot(tx, id);
        if (!snap) continue;
        const key = { ...snap, courseId: row.id };
        if (await findByKey(tx, key)) continue;
        const note = `Set on the previous layout (${old.name}).`;
        const after = await writeRecord(tx, null, {
          ...fieldsOf(snap),
          courseId: row.id,
          carriedFromCourseId: old.id,
          notes: snap.notes ? `${snap.notes} ${note}` : note,
        });
        await logChange(tx, 'carried_over', null, after, { changedBy, desktopKeyId: keyId, source: 'course_carry' });
        carried++;
      }
    }
    return { status: 'replaced' as const, course: courseOut(row), carried, replaced: old.id };
  });
}

export async function venueDetail(id: string) {
  const [venue] = await db.select().from(venues).where(eq(venues.id, id)).limit(1);
  if (!venue) return null;
  const [courseRows, series, sets] = await Promise.all([
    db.select().from(courses).where(eq(courses.venueId, id)).orderBy(courses.name, courses.createdAt),
    db.select().from(meetSeries).where(and(eq(meetSeries.venueId, id), eq(meetSeries.isActive, true))).orderBy(meetSeries.name),
    db.select({
      id: recordSets.id, name: recordSets.name, abbreviation: recordSets.abbreviation, scope: recordSets.scope,
      venueId: recordSets.venueId, meetSeriesId: recordSets.meetSeriesId,
      recordCount: sql<number>`(SELECT count(*) FROM records WHERE records.record_set_id = record_sets.id)`.mapWith(Number),
    }).from(recordSets).where(and(eq(recordSets.isActive, true),
      sql`(${recordSets.venueId} = ${id} OR ${recordSets.meetSeriesId} IN (SELECT id FROM meet_series WHERE venue_id = ${id}))`)),
  ]);
  return {
    venue: venueOut(venue),
    courses: courseRows.map(courseSummary),
    meetSeries: series.map(seriesOut),
    recordSets: sets,
  };
}

export function venueOut(v: typeof venues.$inferSelect) {
  return { id: v.id, name: v.name, city: v.city, state: v.state, country: v.country, setting: v.setting, notes: v.notes, isActive: v.isActive !== false };
}

export function seriesOut(s: typeof meetSeries.$inferSelect) {
  return { id: s.id, name: s.name, venueId: s.venueId, level: s.level, notes: s.notes };
}

export function cleanLevel(v: unknown): string | null {
  return isRecordLevel(v) ? v : null;
}
