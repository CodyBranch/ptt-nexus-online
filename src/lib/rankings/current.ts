/**
 * What an organization is ranked right now.
 *
 * "Right now" is each list at its newest week this season: the national poll
 * (or national ranking) and the regional ranking for each division, gender
 * and region. A team that has dropped off this week's poll is not ranked,
 * whatever it was last week - which is why this starts from the current lists
 * and looks for the team on them, rather than from the team's newest entry.
 *
 * The season is the one the last successful pull said it was, so a division
 * that has released nothing yet this season shows nothing rather than last
 * season's final poll.
 */

import { db } from '@/db/client';
import { sql } from 'drizzle-orm';
import { ATTRIBUTION, type Gender } from './ustfccca';

export interface CurrentNational {
  rank: number | null;
  isRv: boolean;
  week: number;
  releasedAt: string | null;
  listType: 'poll' | 'ranking' | null;
  divisionName: string | null;
  score: number | null;
  firstPlaceVotes: number | null;
  prevRank: number | null;
  prevIsRv: boolean;
  rankChange: number | null;
}

export interface CurrentRegional {
  rank: number | null;
  isRv: boolean;
  week: number;
  releasedAt: string | null;
  regionId: number;
  regionName: string | null;
  divisionName: string | null;
  prevRank: number | null;
  prevIsRv: boolean;
  rankChange: number | null;
}

export interface CurrentForGender { national?: CurrentNational; regional?: CurrentRegional }

export interface CurrentForOrganization {
  organizationId: string;
  ustfcccaTeamId: number;
  teamName: string;
  teamShort: string | null;
  division: string | null;
  men?: CurrentForGender;
  women?: CurrentForGender;
}

export interface CurrentRankings {
  attribution: string;
  season: number | null;
  /** When Nexus Online last read the USTFCCCA, successfully. */
  checkedAt: string | null;
  organizations: Record<string, CurrentForOrganization>;
}

interface Row {
  organization_id: string; ustfccca_team_id: number; team_name: string; team_short: string | null;
  division: string | null; gender: Gender; kind: 'national' | 'regional'; list_type: string | null;
  division_name: string | null; region_id: number; region_name: string | null; week: number;
  released_at: Date | string | null; rank: number | null; is_rv: boolean; score: number | null;
  first_place_votes: number | null; prev_rank: number | null; prev_is_rv: boolean; rank_change: number | null;
}

const iso = (d: Date | string | null): string | null => (d == null ? null : new Date(d).toISOString());

export async function currentRankingsFor(organizationIds: string[]): Promise<CurrentRankings> {
  const ids = [...new Set(organizationIds.filter((s) => typeof s === 'string' && /^[0-9a-f-]{36}$/i.test(s)))];
  const pullRes = await db.execute(sql`
    SELECT season, finished_at FROM ranking_pulls
    WHERE status IN ('ok', 'unchanged') ORDER BY started_at DESC LIMIT 1`);
  const pulls = ((pullRes as unknown as { rows?: unknown[] }).rows ?? pullRes) as Array<{ season: number | null; finished_at: Date | string | null }>;
  // The season comes from the last read that carried one.
  const seasonRes = await db.execute(sql`
    SELECT season FROM ranking_pulls WHERE status = 'ok' AND season IS NOT NULL ORDER BY started_at DESC LIMIT 1`);
  const seasonRow = (((seasonRes as unknown as { rows?: unknown[] }).rows ?? seasonRes) as Array<{ season: number }>)[0];
  const season = seasonRow?.season ?? null;

  const out: CurrentRankings = {
    attribution: ATTRIBUTION,
    season,
    checkedAt: iso(pulls[0]?.finished_at ?? null),
    organizations: {},
  };
  if (!ids.length || season == null) return out;

  const res = await db.execute(sql`
    WITH cur AS (
      SELECT DISTINCT ON (gender, type_id, division_id, region_id) *
      FROM ranking_lists
      WHERE season = ${season}
      ORDER BY gender, type_id, division_id, region_id, week DESC
    )
    SELECT t.organization_id, t.ustfccca_team_id, t.team_name, t.team_short, t.division,
           cur.gender, cur.kind, cur.list_type, cur.division_name, cur.region_id, cur.region_name,
           cur.week, cur.released_at,
           e.rank, e.is_rv, e.score, e.first_place_votes, e.prev_rank, e.prev_is_rv, e.rank_change
    FROM ranking_teams t
    JOIN ranking_entries e ON e.ustfccca_team_id = t.ustfccca_team_id
    JOIN cur ON cur.id = e.list_id
    WHERE t.organization_id IN (${sql.join(ids.map((id) => sql`${id}::uuid`), sql`, `)})
      AND t.match_status IN ('auto', 'confirmed')`);
  const rows = ((res as unknown as { rows?: unknown[] }).rows ?? res) as Row[];

  for (const r of rows) {
    const org = out.organizations[r.organization_id] ??= {
      organizationId: r.organization_id, ustfcccaTeamId: r.ustfccca_team_id,
      teamName: r.team_name, teamShort: r.team_short, division: r.division,
    };
    const g = org[r.gender] ??= {};
    const releasedAt = iso(r.released_at);
    if (r.kind === 'national') {
      // A division with both a poll and a national ranking: the newer one.
      if (g.national && (g.national.releasedAt ?? '') > (releasedAt ?? '')) continue;
      g.national = {
        rank: r.rank, isRv: r.is_rv, week: r.week, releasedAt,
        listType: r.list_type === 'ranking' ? 'ranking' : r.list_type === 'poll' ? 'poll' : null,
        divisionName: r.division_name, score: r.score, firstPlaceVotes: r.first_place_votes,
        prevRank: r.prev_rank, prevIsRv: r.prev_is_rv, rankChange: r.rank_change,
      };
    } else {
      if (g.regional && (g.regional.releasedAt ?? '') > (releasedAt ?? '')) continue;
      g.regional = {
        rank: r.rank, isRv: r.is_rv, week: r.week, releasedAt, regionId: r.region_id,
        regionName: r.region_name, divisionName: r.division_name,
        prevRank: r.prev_rank, prevIsRv: r.prev_is_rv, rankChange: r.rank_change,
      };
    }
  }
  return out;
}
