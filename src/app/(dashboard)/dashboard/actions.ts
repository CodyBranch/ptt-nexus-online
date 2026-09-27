'use server';

import { db } from '@/db/client';
import {
  organizations, organizationSubmissions, recordSets, records,
  syncLogs, meetRelaySessions, desktopApiKeys,
} from '@/db/schema';
import { and, desc, eq, isNotNull, sql } from 'drizzle-orm';
import { requireAdmin } from '@/lib/admin-auth';

/**
 * What the dashboard shows.
 *
 * It previously showed three zeros and an empty activity panel — literal
 * zeros, written into the markup, while the database held 2,834
 * organizations. A number that is always zero is worse than no number: it
 * says the system is empty, and the first thing anybody does is go and check
 * whether something is broken.
 *
 * Everything here is counted. Where there is genuinely nothing to show, the
 * panel says so in its own words rather than showing a zero that looks like a
 * fault.
 */

export interface DashboardData {
  organizations: { total: number; withLogo: number; missingLogo: number };
  submissions: { pending: number; recent: Array<{ id: string; name: string; state: string | null; meetName: string | null; timesSeen: number }> };
  records: { sets: number; total: number };
  relay: { sessions: number };
  keys: { active: number; lastUsedAt: Date | null };
  activity: Array<{
    kind: 'sync' | 'organization';
    at: Date;
    title: string;
    detail: string | null;
  }>;
}

/**
 * A logo address that will actually draw something.
 *
 * Not simply "not null". Two kinds of value in this column never render: a
 * relative path with no host, and MSHSAA's "no image available" placeholder,
 * which loads perfectly and paints a white rectangle. Counting those as
 * covered would put a number on the dashboard that disagrees with what an
 * operator sees on the timing laptop.
 */
const USABLE_LOGO = sql<boolean>`(
  ${organizations.logoUrl} IS NOT NULL
  AND ${organizations.logoUrl} <> ''
  AND ${organizations.logoUrl} ILIKE 'http%'
  AND ${organizations.logoUrl} NOT ILIKE '%no-logo.%'
  AND ${organizations.logoUrl} NOT ILIKE '%nologo.%'
)`;

export async function getDashboardData(): Promise<DashboardData> {
  await requireAdmin();

  const [orgCounts] = await db
    .select({
      total: sql<number>`count(*)::int`,
      withLogo: sql<number>`count(*) FILTER (WHERE ${USABLE_LOGO})::int`,
    })
    .from(organizations)
    .where(eq(organizations.isActive, true));

  const [subCount] = await db
    .select({ pending: sql<number>`count(*)::int` })
    .from(organizationSubmissions)
    .where(eq(organizationSubmissions.status, 'pending'));

  // The ones seen most often first: a school that has turned up in four meets
  // is costing four operators the same minute every time.
  const recentSubs = await db
    .select({
      id: organizationSubmissions.id,
      name: organizationSubmissions.name,
      state: organizationSubmissions.state,
      meetName: organizationSubmissions.meetName,
      timesSeen: organizationSubmissions.timesSeen,
    })
    .from(organizationSubmissions)
    .where(eq(organizationSubmissions.status, 'pending'))
    .orderBy(desc(organizationSubmissions.timesSeen), desc(organizationSubmissions.lastSeenAt))
    .limit(6);

  const [setCount] = await db.select({ n: sql<number>`count(*)::int` }).from(recordSets);
  const [recCount] = await db.select({ n: sql<number>`count(*)::int` }).from(records);
  const [relayCount] = await db.select({ n: sql<number>`count(*)::int` }).from(meetRelaySessions);

  const [keyCount] = await db
    .select({
      active: sql<number>`count(*)::int`,
      // Decoded as the column is: raw sql comes back from the driver as a
      // string, and the page's "time ago" called .getTime() on it.
      lastUsedAt: sql<Date | null>`max(${desktopApiKeys.lastUsedAt})`.mapWith(desktopApiKeys.lastUsedAt),
    })
    .from(desktopApiKeys)
    .where(eq(desktopApiKeys.isActive, true));

  // Activity, from the two things that actually record any.
  const syncRows = await db
    .select({
      at: syncLogs.startedAt,
      direction: syncLogs.direction,
      syncType: syncLogs.syncType,
      status: syncLogs.status,
      meetName: syncLogs.desktopMeetName,
      orgs: syncLogs.organizationsSynced,
      recs: syncLogs.recordsSynced,
    })
    .from(syncLogs)
    .orderBy(desc(syncLogs.startedAt))
    .limit(8);

  const orgRows = await db
    .select({ name: organizations.name, at: organizations.updatedAt })
    .from(organizations)
    .where(and(eq(organizations.isActive, true), isNotNull(organizations.updatedAt)))
    .orderBy(desc(organizations.updatedAt))
    .limit(8);

  const activity: DashboardData['activity'] = [
    ...syncRows.filter((r) => r.at).map((r) => ({
      kind: 'sync' as const,
      at: r.at as Date,
      title: `${r.syncType ?? 'sync'} ${r.direction ?? ''}`.trim() + (r.status ? ` — ${r.status}` : ''),
      detail: [r.meetName, r.orgs ? `${r.orgs} orgs` : null, r.recs ? `${r.recs} records` : null]
        .filter(Boolean).join(' · ') || null,
    })),
    ...orgRows.filter((r) => r.at).map((r) => ({
      kind: 'organization' as const,
      at: r.at as Date,
      title: r.name,
      detail: 'updated',
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime()).slice(0, 8);

  return {
    organizations: {
      total: orgCounts?.total ?? 0,
      withLogo: orgCounts?.withLogo ?? 0,
      missingLogo: (orgCounts?.total ?? 0) - (orgCounts?.withLogo ?? 0),
    },
    submissions: { pending: subCount?.pending ?? 0, recent: recentSubs },
    records: { sets: setCount?.n ?? 0, total: recCount?.n ?? 0 },
    relay: { sessions: relayCount?.n ?? 0 },
    keys: { active: keyCount?.active ?? 0, lastUsedAt: keyCount?.lastUsedAt ?? null },
    activity,
  };
}
