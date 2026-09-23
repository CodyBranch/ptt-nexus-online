'use server';

import { db } from '@/db/client';
import { organizationSubmissions, organizations } from '@/db/schema';
import { and, desc, eq, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * Schools a meet met that this database does not have.
 *
 * Nexus pushes them from org matching; nothing reaches the organisations
 * table until somebody here says so. Approving is what creates the
 * organisation, which is the entire point of the queue — race-day entry files
 * carry misspellings and one-off names, and each one that went straight in
 * would be permanent in the data every results page reads.
 */
export async function getSubmissions(status = 'pending') {
  return db
    .select()
    .from(organizationSubmissions)
    .where(status === 'all' ? undefined : eq(organizationSubmissions.status, status))
    .orderBy(desc(organizationSubmissions.timesSeen), desc(organizationSubmissions.lastSeenAt))
    .limit(300);
}

export async function countByStatus() {
  const rows = await db
    .select({ status: organizationSubmissions.status, n: sql<number>`count(*)` })
    .from(organizationSubmissions)
    .groupBy(organizationSubmissions.status);
  const out: Record<string, number> = { pending: 0, approved: 0, rejected: 0 };
  for (const r of rows) out[r.status] = Number(r.n);
  return out;
}

/**
 * Schools already here that look like the one submitted.
 *
 * Shown beside each row, because the commonest right answer is not "create
 * it" — it is "that is Battle High School spelled differently", and the
 * reviewer cannot see that without being shown it.
 */
export async function nearMatches(name: string, limit = 5) {
  const key = name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const first = key.split(' ')[0] ?? '';
  if (!first) return [];
  return db
    .select({
      id: organizations.id,
      name: organizations.name,
      city: organizations.city,
      state: organizations.state,
      organizationType: organizations.organizationType,
    })
    .from(organizations)
    .where(sql`lower(${organizations.name}) LIKE ${'%' + first + '%'}`)
    .limit(limit);
}

export async function approveSubmission(
  id: string,
  fields: {
    name?: string; abbreviation?: string; organizationType?: string;
    city?: string; state?: string; conference?: string; stateAssociation?: string;
    primaryColor?: string; secondaryColor?: string; logoUrl?: string; logoDarkUrl?: string;
    website?: string;
  },
): Promise<{ ok: true; organizationId: string } | { ok: false; error: string }> {
  await requireAdmin();

  const rows = await db.select().from(organizationSubmissions)
    .where(eq(organizationSubmissions.id, id)).limit(1);
  const sub = rows[0];
  if (!sub) return { ok: false, error: 'That submission is gone' };
  if (sub.status !== 'pending') return { ok: false, error: `Already ${sub.status}` };

  const pick = (v: string | undefined, fallback: string | null): string | null =>
    (v && v.trim() ? v.trim() : fallback);

  const name = pick(fields.name, sub.name)!;
  const abbreviation = pick(fields.abbreviation, sub.abbreviation)
    ?? name.split(/\s+/).map((w) => w[0]).join('').slice(0, 5).toUpperCase();

  const [org] = await db.insert(organizations).values({
    name,
    abbreviation,
    organizationType: pick(fields.organizationType, sub.organizationType)!,
    city: pick(fields.city, sub.city),
    state: pick(fields.state, sub.state),
    conference: pick(fields.conference, null),
    stateAssociation: pick(fields.stateAssociation, null),
    primaryColor: pick(fields.primaryColor, null),
    secondaryColor: pick(fields.secondaryColor, null),
    logoUrl: pick(fields.logoUrl, null),
    logoDarkUrl: pick(fields.logoDarkUrl, null),
    website: pick(fields.website, null),
    notes: `Submitted from ${sub.meetName ?? 'a meet'}`,
  }).returning();

  await db.update(organizationSubmissions)
    .set({ status: 'approved', organizationId: org.id, reviewedAt: new Date() })
    .where(eq(organizationSubmissions.id, id));

  revalidatePath('/submissions');
  revalidatePath('/organizations');
  return { ok: true, organizationId: org.id };
}

/**
 * Turn one down, with the reason kept.
 *
 * A rejected row is not deleted: the same school will be pushed again from
 * the next meet, and "we looked at this and it is a misspelling of Battle"
 * is worth more the second time than the first.
 */
export async function rejectSubmission(
  id: string, note: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  await requireAdmin();
  const updated = await db.update(organizationSubmissions)
    .set({ status: 'rejected', reviewNote: note.trim() || null, reviewedAt: new Date() })
    .where(and(
      eq(organizationSubmissions.id, id),
      eq(organizationSubmissions.status, 'pending'),
    ))
    .returning({ id: organizationSubmissions.id });

  if (!updated[0]) return { ok: false, error: 'It had already been dealt with' };
  revalidatePath('/submissions');
  return { ok: true };
}

/** Put one back in the queue, for a decision made too quickly. */
export async function reopenSubmission(id: string): Promise<{ ok: true }> {
  await requireAdmin();
  await db.update(organizationSubmissions)
    .set({ status: 'pending', reviewNote: null, reviewedAt: null, organizationId: null })
    .where(eq(organizationSubmissions.id, id));
  revalidatePath('/submissions');
  return { ok: true };
}
