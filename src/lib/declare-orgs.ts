/**
 * Which of the organizations a desk names for its schools are real ones here.
 *
 * The desk sends each school's Nexus Online organization when it has matched
 * one, for the dashboard's logos and headshots. An id from an organization
 * since deleted, or one the desk made up, would fail the foreign key and take
 * the whole publish with it — so only ids that exist are kept; the rest go in
 * as no organization, which costs a logo and nothing else.
 */

import { inArray } from 'drizzle-orm';
import { db } from '@/db/client';
import { organizations } from '@/db/schema';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function knownOrganizations(ids: Array<string | null | undefined>): Promise<Set<string>> {
  const asked = [...new Set(ids.filter((id): id is string => typeof id === 'string' && UUID.test(id)))];
  if (!asked.length) return new Set();
  const rows = await db.select({ id: organizations.id }).from(organizations).where(inArray(organizations.id, asked));
  return new Set(rows.map((r) => r.id));
}
