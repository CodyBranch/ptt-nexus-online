'use server';

import { db } from '@/db/client';
import { venues, meetSeries, courses } from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { venueDetail, cleanLevel, courseOut, courseRatingHistory, restoreCourseRatings } from '@/lib/venue-courses';

export async function getVenues() {
  return db
    .select({
      id: venues.id,
      name: venues.name,
      city: venues.city,
      state: venues.state,
      courseCount: sql<number>`(SELECT count(*) FROM courses WHERE courses.venue_id = venues.id AND courses.is_active IS NOT FALSE)`.mapWith(Number),
      seriesCount: sql<number>`(SELECT count(*) FROM meet_series WHERE meet_series.venue_id = venues.id AND meet_series.is_active IS NOT FALSE)`.mapWith(Number),
      recordSetCount: sql<number>`(SELECT count(*) FROM record_sets WHERE record_sets.is_active IS NOT FALSE AND (record_sets.venue_id = venues.id OR record_sets.meet_series_id IN (SELECT id FROM meet_series WHERE meet_series.venue_id = venues.id)))`.mapWith(Number),
    })
    .from(venues)
    .where(eq(venues.isActive, true))
    .orderBy(venues.name);
}

export async function getVenue(id: string) {
  return venueDetail(id);
}

export async function createVenue(data: { name: string; city?: string; state?: string }) {
  await requireAdmin();
  const name = data.name.trim();
  if (!name) throw new Error('The venue needs a name');
  const state = data.state?.trim().toUpperCase() || null;
  const [same] = await db
    .select({ id: venues.id })
    .from(venues)
    .where(and(sql`lower(${venues.name}) = lower(${name})`, eq(venues.isActive, true),
      state ? sql`upper(coalesce(${venues.state}, '')) = ${state}` : sql`true`))
    .limit(1);
  if (same) throw new Error('A venue with that name is already there');
  const [row] = await db.insert(venues).values({ name, city: data.city?.trim() || null, state }).returning({ id: venues.id });
  revalidatePath('/venues');
  return row;
}

export async function updateVenue(id: string, data: { name: string; city?: string; state?: string; notes?: string }) {
  await requireAdmin();
  if (!data.name.trim()) throw new Error('The venue needs a name');
  await db.update(venues).set({
    name: data.name.trim(),
    city: data.city?.trim() || null,
    state: data.state?.trim().toUpperCase() || null,
    notes: data.notes?.trim() || null,
    updatedAt: new Date(),
  }).where(eq(venues.id, id));
  revalidatePath('/venues');
  revalidatePath(`/venues/${id}`);
}

export async function createMeetSeries(data: { name: string; venueId: string; level?: string }) {
  await requireAdmin();
  const name = data.name.trim();
  if (!name) throw new Error('The meet series needs a name');
  const [same] = await db
    .select({ id: meetSeries.id })
    .from(meetSeries)
    .where(and(sql`lower(${meetSeries.name}) = lower(${name})`, eq(meetSeries.venueId, data.venueId), eq(meetSeries.isActive, true)))
    .limit(1);
  if (same) throw new Error('That meet series is already at this venue');
  await db.insert(meetSeries).values({ name, venueId: data.venueId, level: cleanLevel(data.level) });
  revalidatePath(`/venues/${data.venueId}`);
}

/** A course with its ratings, split points and every set of ratings it has had. */
export async function getCourseDetail(courseId: string) {
  const [row] = await db.select().from(courses).where(eq(courses.id, courseId)).limit(1);
  if (!row) return null;
  const [venue] = await db.select({ name: venues.name }).from(venues).where(eq(venues.id, row.venueId)).limit(1);
  const replaces = row.replacesCourseId
    ? (await db.select({ id: courses.id, name: courses.name }).from(courses).where(eq(courses.id, row.replacesCourseId)).limit(1))[0] ?? null
    : null;
  const [replacedBy] = await db.select({ id: courses.id, name: courses.name }).from(courses).where(eq(courses.replacesCourseId, courseId)).limit(1);
  const out = courseOut(row);
  return {
    course: {
      ...out,
      difficulty: (out.difficulty as Array<{ fromMeters: number; toMeters: number; difficulty: number; gainMeters?: number | null; lossMeters?: number | null; surface?: string | null; notes?: string | null }>),
      splitPoints: (out.splitPoints as Array<{ label: string; distanceMeters: number }>),
    },
    venueName: venue?.name ?? 'Venue',
    replaces,
    replacedBy: replacedBy ?? null,
    ratingLog: await courseRatingHistory(courseId),
  };
}

export async function restoreRatings(logId: string, courseId: string, venueId: string) {
  const session = await requireAdmin();
  const r = await restoreCourseRatings(logId, session.email);
  revalidatePath(`/venues/${venueId}/courses/${courseId}`);
  revalidatePath(`/venues/${venueId}`);
  return r;
}
