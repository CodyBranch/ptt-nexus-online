'use server';

import { db } from '@/db/client';
import { organizations, rankingTeams } from '@/db/schema';
import { and, asc, eq, ilike, ne, or, sql } from 'drizzle-orm';
import { revalidatePath } from 'next/cache';
import { requireAdmin } from '@/lib/admin-auth';
import { matchPending, pullRankings, type PullOutcome } from '@/lib/rankings/pull';
import { decide, type MatchOrg } from '@/lib/rankings/match';
import { getAutoPull, setAutoPull } from '@/lib/rankings/settings';

/**
 * The USTFCCCA polls and rankings: reading them, looking through them, and
 * saying which of our organizations each ranked team is.
 */

export type TeamTab = 'review' | 'unmatched' | 'linked' | 'ignored';

const rowsOf = <T,>(r: unknown): T[] => ((r as { rows?: unknown[] }).rows ?? r) as T[];

/**
 * A logo in our storage, by way of /logos/ on this site: the storage serves
 * them uncached, so a list of a hundred and thirty schools asked for every
 * logo again on every visit; /logos/ hands the same file on with a long cache.
 */
const STORAGE_LOGOS = `${(process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').replace(/\/$/, '')}/storage/v1/object/public/Logos/`;
function cachedLogo(url: string | null | undefined): string | null {
  if (!url) return null;
  return process.env.NEXT_PUBLIC_SUPABASE_URL && url.startsWith(STORAGE_LOGOS) ? `/logos/${url.slice(STORAGE_LOGOS.length)}` : url;
}

/** The season the last successful read said it was. */
const SEASON = sql`(SELECT season FROM ranking_pulls WHERE status = 'ok' AND season IS NOT NULL ORDER BY started_at DESC LIMIT 1)`;

export interface PageHead {
  linked: number;
  review: number;
  unmatched: number;
  ignored: number;
  currentLists: number;
  newestRelease: string | null;
  last: { status: string; error: string | null; startedAt: string } | null;
  choices: BoardChoice[];
}

/**
 * Everything the top of the page shows, in one round trip: the counts, the
 * last read, the current lists and which divisions have them. Five queries
 * one after another (the connection takes one at a time) were most of the
 * wait before anything appeared.
 */
export async function pageHead(): Promise<PageHead> {
  const [row] = rowsOf<{
    counts: Record<string, number> | null;
    last: { status: string; error: string | null; started_at: string } | null;
    lists: { n: number; newest: string | null } | null;
    choices: Array<{ divisionId: number; divisionName: string | null; gender: 'men' | 'women'; kind: 'national' | 'regional' }> | null;
  }>(await db.execute(sql`
    WITH season AS (SELECT ${SEASON} AS s),
    cur AS (
      SELECT DISTINCT ON (gender, type_id, division_id, region_id) released_at
      FROM ranking_lists WHERE season = (SELECT s FROM season)
      ORDER BY gender, type_id, division_id, region_id, week DESC)
    SELECT
      (SELECT json_object_agg(match_status, n) FROM
        (SELECT match_status, count(*)::int AS n FROM ranking_teams GROUP BY 1) c) AS counts,
      (SELECT row_to_json(p) FROM
        (SELECT status, error, started_at FROM ranking_pulls ORDER BY started_at DESC LIMIT 1) p) AS last,
      (SELECT json_build_object('n', count(*), 'newest', max(released_at)) FROM cur) AS lists,
      (SELECT json_agg(DISTINCT jsonb_build_object('divisionId', division_id, 'divisionName', division_name, 'gender', gender, 'kind', kind))
         FROM ranking_lists WHERE season = (SELECT s FROM season)) AS choices`));
  const by = row?.counts ?? {};
  // NCAA first, then NAIA, then NJCAA, as the USTFCCCA orders them.
  const order = [2030, 2031, 2032, 2028, 19781, 19782, 2034];
  const choices = (row?.choices ?? [])
    .map((c) => ({ ...c, divisionName: c.divisionName ?? String(c.divisionId) }))
    .sort((a, b) => (order.indexOf(a.divisionId) - order.indexOf(b.divisionId)) || a.gender.localeCompare(b.gender) || a.kind.localeCompare(b.kind));
  return {
    linked: (by.auto ?? 0) + (by.confirmed ?? 0),
    review: by.review ?? 0,
    unmatched: by.unmatched ?? 0,
    ignored: by.ignored ?? 0,
    currentLists: row?.lists?.n ?? 0,
    newestRelease: row?.lists?.newest ?? null,
    last: row?.last ? { status: row.last.status, error: row.last.error, startedAt: row.last.started_at } : null,
    choices,
  };
}

// ── Looking through the rankings ─────────────────────────────────────────────

export interface BoardChoice {
  divisionId: number;
  divisionName: string;
  gender: 'men' | 'women';
  kind: 'national' | 'regional';
}

export interface BoardRow {
  ustfcccaTeamId: number;
  rank: number | null;
  isRv: boolean;
  score: number | null;
  firstPlaceVotes: number | null;
  prevRank: number | null;
  prevIsRv: boolean;
  rankChange: number | null;
  teamName: string;
  teamShort: string | null;
  conference: string | null;
  matchStatus: string;
  organizationId: string | null;
  organizationName: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
}

export interface BoardList {
  id: string;
  divisionId: number;
  gender: 'men' | 'women';
  kind: 'national' | 'regional';
  title: string;
  regionName: string | null;
  week: number;
  releasedAt: string | null;
  listType: string | null;
  rows: BoardRow[];
}

/**
 * Every current list, with who each team is here: the whole season's
 * rankings are about a thousand rows, so they come down once and switching
 * division, gender or kind happens in the browser, without a trip back.
 */
export async function allBoardLists(): Promise<BoardList[]> {
  const rows = rowsOf<{
    list_id: string; division_id: number; gender: 'men' | 'women'; kind: 'national' | 'regional'; division_name: string | null; region_name: string | null; week: number; released_at: Date | null;
    list_type: string | null; ustfccca_team_id: number; rank: number | null; is_rv: boolean; score: number | null;
    first_place_votes: number | null; prev_rank: number | null; prev_is_rv: boolean; rank_change: number | null;
    team_name: string; team_short: string | null; conference: string | null; match_status: string;
    organization_id: string | null; org_name: string | null; logo_url: string | null; logo_dark_url: string | null;
  }>(await db.execute(sql`
    WITH cur AS (
      SELECT DISTINCT ON (gender, type_id, division_id, region_id) *
      FROM ranking_lists
      WHERE season = ${SEASON}
      ORDER BY gender, type_id, division_id, region_id, week DESC
    )
    SELECT cur.id AS list_id, cur.division_id, cur.gender, cur.kind, cur.division_name, cur.region_name, cur.week, cur.released_at, cur.list_type,
           e.ustfccca_team_id, e.rank, e.is_rv, e.score, e.first_place_votes, e.prev_rank, e.prev_is_rv, e.rank_change,
           t.team_name, t.team_short, coalesce(e.conference, t.conference) AS conference, t.match_status,
           t.organization_id, o.name AS org_name, o.logo_url, o.logo_dark_url
    FROM cur
    JOIN ranking_entries e ON e.list_id = cur.id
    JOIN ranking_teams t ON t.ustfccca_team_id = e.ustfccca_team_id
    LEFT JOIN organizations o ON o.id = t.organization_id
    ORDER BY cur.division_id, cur.gender, cur.kind, cur.region_name NULLS FIRST, e.position`));

  const lists = new Map<string, BoardList>();
  for (const r of rows) {
    let list = lists.get(r.list_id);
    if (!list) {
      list = {
        id: r.list_id,
        divisionId: r.division_id,
        gender: r.gender,
        kind: r.kind,
        title: r.region_name ?? r.division_name ?? '',
        regionName: r.region_name,
        week: r.week,
        releasedAt: r.released_at ? new Date(r.released_at).toISOString() : null,
        listType: r.list_type,
        rows: [],
      };
      lists.set(r.list_id, list);
    }
    list.rows.push({
      ustfcccaTeamId: r.ustfccca_team_id, rank: r.rank, isRv: r.is_rv, score: r.score,
      firstPlaceVotes: r.first_place_votes, prevRank: r.prev_rank, prevIsRv: r.prev_is_rv, rankChange: r.rank_change,
      teamName: r.team_name, teamShort: r.team_short, conference: r.conference, matchStatus: r.match_status,
      organizationId: r.organization_id, organizationName: r.org_name,
      logoUrl: cachedLogo(r.logo_url),
      logoDarkUrl: cachedLogo(r.logo_dark_url),
    });
  }
  return [...lists.values()];
}

// ── Reviewing the links ──────────────────────────────────────────────────────

export interface Suggestion {
  id: string;
  name: string;
  division: string | null;
  conference: string | null;
  state: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  score?: number;
  why?: string;
}

export interface TeamRow {
  ustfcccaTeamId: number;
  teamName: string;
  teamShort: string | null;
  division: string | null;
  conference: string | null;
  matchStatus: string;
  matchNote: string | null;
  matchedBy: string | null;
  organizationId: string | null;
  organizationName: string | null;
  logoUrl: string | null;
  logoDarkUrl: string | null;
  /** Where the team stands now, so a reviewer knows who matters first. */
  standing: string | null;
  suggestions: Suggestion[];
}

const orgFields = {
  id: organizations.id, name: organizations.name, shortName: organizations.shortName,
  abbreviation: organizations.abbreviation, ncaaDivision: organizations.ncaaDivision,
  naiaMember: organizations.naiaMember, jucoMember: organizations.jucoMember,
  conference: organizations.conference, state: organizations.state,
  athleticNetId: organizations.athleticNetId,
  logoUrl: organizations.logoUrl, logoDarkUrl: organizations.logoDarkUrl,
};
type OrgWithLogo = MatchOrg & { logoUrl: string | null; logoDarkUrl: string | null };

function suggestionOf(o: OrgWithLogo, score?: number, why?: string): Suggestion {
  return {
    id: o.id, name: o.name, conference: o.conference, state: o.state,
    division: o.ncaaDivision ?? (o.naiaMember ? 'NAIA' : o.jucoMember ? 'NJCAA' : null),
    logoUrl: cachedLogo(o.logoUrl), logoDarkUrl: cachedLogo(o.logoDarkUrl), score, why,
  };
}

/**
 * The teams on one tab. Waiting and not-found teams come with the matcher's
 * best guesses already worked out, so reviewing one is a click rather than a
 * click to ask and another to answer. Ranked teams first: a team ranked
 * nationally is the one a meet will show.
 */
export async function teamsFor(tab: TeamTab): Promise<TeamRow[]> {
  const where = tab === 'linked'
    ? or(eq(rankingTeams.matchStatus, 'auto'), eq(rankingTeams.matchStatus, 'confirmed'))
    : eq(rankingTeams.matchStatus, tab);
  const teams = await db
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
      logoUrl: organizations.logoUrl,
      logoDarkUrl: organizations.logoDarkUrl,
    })
    .from(rankingTeams)
    .leftJoin(organizations, eq(organizations.id, rankingTeams.organizationId))
    .where(where)
    .orderBy(asc(rankingTeams.divisionId), asc(rankingTeams.teamName))
    .limit(600);
  if (!teams.length) return [];

  // Where each stands this week: "#4 nationally" or "#3 Mountain".
  const standings = new Map<number, { text: string; weight: number }>();
  const ids = teams.map((t) => t.ustfcccaTeamId);
  const placed = rowsOf<{ id: number; rank: number | null; is_rv: boolean; kind: string; gender: string; region_name: string | null }>(
    await db.execute(sql`
      WITH cur AS (
        SELECT DISTINCT ON (gender, type_id, division_id, region_id) id, kind, gender, region_name
        FROM ranking_lists WHERE season = ${SEASON}
        ORDER BY gender, type_id, division_id, region_id, week DESC)
      SELECT e.ustfccca_team_id AS id, e.rank, e.is_rv, cur.kind, cur.gender, cur.region_name
      FROM ranking_entries e JOIN cur ON cur.id = e.list_id
      WHERE e.ustfccca_team_id IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`));
  for (const p of placed) {
    const g = p.gender === 'men' ? 'men' : 'women';
    const where = p.kind === 'national' ? 'national' : (p.region_name ?? 'regional').replace(/\s*\(.*\)$/, '');
    const text = p.is_rv ? `RV ${where}, ${g}` : `#${p.rank} ${where}, ${g}`;
    const weight = (p.kind === 'national' ? 0 : 1000) + (p.is_rv ? 500 : p.rank ?? 999);
    const was = standings.get(p.id);
    if (!was || weight < was.weight) standings.set(p.id, { text, weight });
  }

  let orgs: OrgWithLogo[] = [];
  if (tab === 'review' || tab === 'unmatched') {
    orgs = await db.select(orgFields).from(organizations).where(eq(organizations.organizationType, 'college'));
  }
  const out: TeamRow[] = teams.map((t) => ({
    ustfcccaTeamId: t.ustfcccaTeamId, teamName: t.teamName, teamShort: t.teamShort, division: t.division,
    conference: t.conference, matchStatus: t.matchStatus, matchNote: t.matchNote, matchedBy: t.matchedBy,
    organizationId: t.organizationId, organizationName: t.organizationName,
    logoUrl: cachedLogo(t.logoUrl),
    logoDarkUrl: cachedLogo(t.logoDarkUrl),
    standing: standings.get(t.ustfcccaTeamId)?.text ?? null,
    suggestions: orgs.length
      ? decide(t, orgs).candidates.slice(0, 3).map((c) => suggestionOf(c.org as OrgWithLogo, c.score, c.why))
      : [],
  }));
  return out.sort((a, b) =>
    (standings.get(a.ustfcccaTeamId)?.weight ?? 9999) - (standings.get(b.ustfcccaTeamId)?.weight ?? 9999));
}

/** Any college by name, for a team the matcher found nothing right for. */
export async function searchColleges(q: string): Promise<Suggestion[]> {
  await requireAdmin();
  const term = q.trim();
  if (term.length < 2) return [];
  const rows = await db.select(orgFields)
    .from(organizations)
    .where(and(eq(organizations.organizationType, 'college'),
      or(ilike(organizations.name, `%${term}%`), ilike(organizations.shortName, `%${term}%`))))
    .orderBy(asc(organizations.name))
    .limit(12);
  return rows.map((o) => suggestionOf(o));
}

type Result = { ok: true } | { ok: false; error: string };

export async function linkTeam(ustfcccaTeamId: number, organizationId: string): Promise<Result> {
  const session = await requireAdmin();
  const [other] = await db.select({ id: rankingTeams.ustfcccaTeamId, name: rankingTeams.teamName })
    .from(rankingTeams)
    .where(and(eq(rankingTeams.organizationId, organizationId), ne(rankingTeams.ustfcccaTeamId, ustfcccaTeamId)));
  if (other) return { ok: false, error: `That school is already linked to ${other.name}. Unlink it there first.` };
  await db.update(rankingTeams).set({
    organizationId, matchStatus: 'confirmed', matchNote: null, matchedAt: new Date(), matchedBy: session.email,
  }).where(eq(rankingTeams.ustfcccaTeamId, ustfcccaTeamId));
  revalidatePath('/rankings');
  return { ok: true };
}

/** Accept the matcher's first suggestion for several teams at once. */
export async function linkMany(pairs: Array<{ ustfcccaTeamId: number; organizationId: string }>): Promise<{ linked: number; errors: string[] }> {
  await requireAdmin();
  const errors: string[] = [];
  let linked = 0;
  for (const p of pairs) {
    const r = await linkTeam(p.ustfcccaTeamId, p.organizationId);
    if (r.ok) linked++; else errors.push(r.error);
  }
  revalidatePath('/rankings');
  return { linked, errors };
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


export async function autoPullState() {
  return getAutoPull();
}

/** Switch the daily read on or off. "Pull now" works either way. */
export async function setAutoPullOn(on: boolean): Promise<Result> {
  const session = await requireAdmin();
  try {
    await setAutoPull(on, session.email);
  } catch (e) {
    console.error('[rankings] auto pull switch:', e);
    return { ok: false, error: 'Could not save the switch. Has supabase/migrations/xc_rankings_settings.sql been run?' };
  }
  revalidatePath('/rankings');
  return { ok: true };
}
