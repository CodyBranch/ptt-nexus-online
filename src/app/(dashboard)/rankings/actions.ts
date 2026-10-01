'use server';

import { db } from '@/db/client';
import { organizations, rankingPulls, rankingTeams } from '@/db/schema';
import { and, asc, desc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { matchPending, pullRankings, type PullOutcome } from '@/lib/rankings/pull';
import { decide, type MatchOrg } from '@/lib/rankings/match';

/**
 * The USTFCCCA polls and rankings: reading them, and saying which of our
 * organizations each ranked team is.
 */

export type TeamTab = 'review' | 'unmatched' | 'linked' | 'ignored';

export async function rankingSummary() {
  const counts = await db
    .select({ status: rankingTeams.matchStatus, n: sql<number>`count(*)::int` })
    .from(rankingTeams)
    .groupBy(rankingTeams.matchStatus);
  const by: Record<string, number> = {};
  for (const c of counts) by[c.status] = c.n;
  const pulls = await db.select().from(rankingPulls).orderBy(desc(rankingPulls.startedAt)).limit(10);
  const lists = await db.execute(sql`
    SELECT count(*)::int AS n, max(released_at) AS newest FROM (
      SELECT DISTINCT ON (gender, type_id, division_id, region_id) released_at
      FROM ranking_lists
      WHERE season = (SELECT season FROM ranking_pulls WHERE status = 'ok' AND season IS NOT NULL ORDER BY started_at DESC LIMIT 1)
      ORDER BY gender, type_id, division_id, region_id, week DESC) cur`);
  const l = (((lists as unknown as { rows?: unknown[] }).rows ?? lists) as Array<{ n: number; newest: Date | null }>)[0];
  return {
    linked: (by.auto ?? 0) + (by.confirmed ?? 0),
    review: by.review ?? 0,
    unmatched: by.unmatched ?? 0,
    ignored: by.ignored ?? 0,
    currentLists: l?.n ?? 0,
    newestRelease: l?.newest ?? null,
    pulls,
  };
}

export async function teamsFor(tab: TeamTab) {
  const where = tab === 'linked'
    ? or(eq(rankingTeams.matchStatus, 'auto'), eq(rankingTeams.matchStatus, 'confirmed'))
    : eq(rankingTeams.matchStatus, tab);
  return db
    .select({
      ustfcccaTeamId: rankingTeams.ustfcccaTeamId,
      teamName: rankingTeams.teamName,
      teamShort: rankingTeams.teamShort,
      division: rankingTeams.division,
      divisionId: rankingTeams.divisionId,
      conference: rankingTeams.conference,
      athnetTeamId: rankingTeams.athnetTeamId,
      matchStatus: rankingTeams.matchStatus,
      matchNote: rankingTeams.matchNote,
      matchedBy: rankingTeams.matchedBy,
      organizationId: rankingTeams.organizationId,
      organizationName: organizations.name,
    })
    .from(rankingTeams)
    .leftJoin(organizations, eq(organizations.id, rankingTeams.organizationId))
    .where(where)
    .orderBy(asc(rankingTeams.divisionId), asc(rankingTeams.teamName))
    .limit(600);
}

const orgFields = {
  id: organizations.id, name: organizations.name, shortName: organizations.shortName,
  abbreviation: organizations.abbreviation, ncaaDivision: organizations.ncaaDivision,
  naiaMember: organizations.naiaMember, jucoMember: organizations.jucoMember,
  conference: organizations.conference, state: organizations.state,
  athleticNetId: organizations.athleticNetId,
};

/** The organizations a team could be, best first, with why. */
export async function candidatesFor(ustfcccaTeamId: number) {
  await requireAdmin();
  const [team] = await db.select().from(rankingTeams).where(eq(rankingTeams.ustfcccaTeamId, ustfcccaTeamId));
  if (!team) return [];
  const orgs: MatchOrg[] = await db.select(orgFields).from(organizations).where(eq(organizations.organizationType, 'college'));
  return decide(team, orgs).candidates.map((c) => ({
    id: c.org.id, name: c.org.name, conference: c.org.conference, state: c.org.state,
    division: c.org.ncaaDivision ?? (c.org.naiaMember ? 'NAIA' : c.org.jucoMember ? 'NJCAA' : null),
    score: c.score, why: c.why,
  }));
}

/** Any college by name, for a team the matcher found nothing for. */
export async function searchColleges(q: string) {
  await requireAdmin();
  const term = q.trim();
  if (term.length < 2) return [];
  return db.select({ id: organizations.id, name: organizations.name, conference: organizations.conference,
    state: organizations.state, division: organizations.ncaaDivision })
    .from(organizations)
    .where(and(eq(organizations.organizationType, 'college'),
      or(ilike(organizations.name, `%${term}%`), ilike(organizations.shortName, `%${term}%`))))
    .orderBy(asc(organizations.name))
    .limit(12);
}

type Result = { ok: true } | { ok: false; error: string };

export async function linkTeam(ustfcccaTeamId: number, organizationId: string): Promise<Result> {
  const session = await requireAdmin();
  const [other] = await db.select({ id: rankingTeams.ustfcccaTeamId, name: rankingTeams.teamName })
    .from(rankingTeams)
    .where(and(eq(rankingTeams.organizationId, organizationId), ne(rankingTeams.ustfcccaTeamId, ustfcccaTeamId)));
  if (other) return { ok: false, error: `That organization is already linked to ${other.name}. Unlink it there first.` };
  await db.update(rankingTeams).set({
    organizationId, matchStatus: 'confirmed', matchNote: null, matchedAt: new Date(), matchedBy: session.email,
  }).where(eq(rankingTeams.ustfcccaTeamId, ustfcccaTeamId));
  revalidatePath('/rankings');
  return { ok: true };
}

export async function ignoreTeam(ustfcccaTeamId: number): Promise<Result> {
  const session = await requireAdmin();
  await db.update(rankingTeams).set({
    organizationId: null, matchStatus: 'ignored', matchNote: `Set aside by ${session.email}`, matchedAt: new Date(), matchedBy: session.email,
  }).where(eq(rankingTeams.ustfcccaTeamId, ustfcccaTeamId));
  revalidatePath('/rankings');
  return { ok: true };
}

/** Back to the matcher: unlinked, or no longer set aside. */
export async function unlinkTeam(ustfcccaTeamId: number): Promise<Result> {
  await requireAdmin();
  await db.update(rankingTeams).set({
    organizationId: null, matchStatus: 'unmatched', matchNote: null, matchedAt: null, matchedBy: null,
  }).where(eq(rankingTeams.ustfcccaTeamId, ustfcccaTeamId));
  revalidatePath('/rankings');
  return { ok: true };
}

export async function pullNow(): Promise<PullOutcome> {
  await requireAdmin();
  const out = await pullRankings('manual');
  revalidatePath('/rankings');
  return out;
}

export async function matchAgain(): Promise<{ autoMatched: number; review: number; unmatched: number }> {
  await requireAdmin();
  const out = await matchPending();
  revalidatePath('/rankings');
  return out;
}

