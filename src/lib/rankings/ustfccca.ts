/**
 * The USTFCCCA's cross country polls and rankings, read from their public API.
 *
 * One call, `/latest/xc`, returns everything current: every released national
 * poll (or national ranking, which some divisions use instead) and every
 * regional ranking, each list at its own newest week. It is read from the
 * server - the API allows no other origin - with the ETag of the last read, so
 * a read that finds nothing new is a 304 and costs nothing.
 *
 * Their quirks, handled here once so nothing downstream has to know them:
 * a team receiving votes has `rank: null` and `is_rv: true` (and `score` may
 * be null too, so it is not the flag); `prev_rank` 999 means "receiving votes
 * last week", not a rank; and `release_date` is US Eastern local time with no
 * zone on it.
 *
 * Shown anywhere, these are coach-voted polls and rankings published by the
 * USTFCCCA, and are attributed to them.
 */

export const USTFCCCA_BASE = 'https://web4.ustfccca.org/iz/polls-rankings/api/v1/rankings';
export const ATTRIBUTION = 'USTFCCCA Coaches\' Polls and Rankings';

// ── As sent ──────────────────────────────────────────────────────────────────

interface RawTeamRow {
  rank: number | null;
  is_rv: boolean;
  team_id: number;
  team_name: string;
  team_short?: string | null;
  score?: number | null;
  first_place_votes?: number | null;
  prev_rank?: number | null;
  prev_is_rv?: boolean | null;
  rank_change?: number | null;
  conference?: string | null;
  region?: string | null;
}

interface RawList {
  division: number;
  division_name?: string | null;
  gender: string;
  list_type?: string | null;
  type_id?: number | null;
  region_id?: number | null;
  region_name?: string | null;
  collection_id?: number | null;
  week: number;
  release_date?: string | null;
  teams: RawTeamRow[];
}

interface RawTeam {
  team_id: number;
  team_name: string;
  team_short?: string | null;
  abbrev?: string | null;
  conference?: string | null;
  region?: string | null;
  division_id?: number | null;
  division?: string | null;
  athnet_team_id?: number | null;
}

export interface RawLatestXc {
  generated_at: string;
  season: number;
  latest_order: { national_poll?: RawList[]; regional_rankings?: RawList[] };
  by_team: Record<string, RawTeam>;
}

// ── As kept ──────────────────────────────────────────────────────────────────

export type Gender = 'men' | 'women';
export type ListKind = 'national' | 'regional';

export interface SnapshotTeam {
  ustfcccaTeamId: number;
  teamName: string;
  teamShort: string | null;
  abbrev: string | null;
  divisionId: number | null;
  division: string | null;
  conference: string | null;
  region: string | null;
  athnetTeamId: number | null;
}

export interface SnapshotEntry {
  ustfcccaTeamId: number;
  position: number;
  rank: number | null;
  isRv: boolean;
  score: number | null;
  firstPlaceVotes: number | null;
  prevRank: number | null;
  prevIsRv: boolean;
  rankChange: number | null;
  conference: string | null;
  region: string | null;
}

export interface SnapshotList {
  season: number;
  gender: Gender;
  kind: ListKind;
  typeId: number;
  listType: string | null;
  divisionId: number;
  divisionName: string | null;
  regionId: number;
  regionName: string | null;
  week: number;
  releaseDateEt: string | null;
  releasedAt: Date | null;
  collectionId: number | null;
  entries: SnapshotEntry[];
}

export interface Snapshot {
  generatedAt: Date | null;
  season: number;
  teams: SnapshotTeam[];
  lists: SnapshotList[];
}

/** The divisions, by the USTFCCCA's ids. */
export const DIVISIONS: Record<number, string> = {
  2030: 'NCAA DI', 2031: 'NCAA DII', 2032: 'NCAA DIII', 2028: 'NAIA',
  19781: 'NJCAA DI', 19782: 'NJCAA DII', 2034: 'NJCAA DIII',
};

const TYPE_POLL = 6;
const TYPE_REGIONAL = 10;

/**
 * "2026-09-29T14:00:00" in US Eastern time, as an instant.
 *
 * Eastern is UTC-4 or UTC-5 depending on the date, so the offset is the one
 * New York had at that moment rather than a constant.
 */
export function easternToDate(local: string | null | undefined): Date | null {
  if (!local) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(local);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map((v) => Number(v ?? 0));
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s || 0);
  // What New York's clock reads at that UTC instant, and so how far it is off.
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(asUtc));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  const nyAsUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'));
  const offset = nyAsUtc - asUtc;
  return new Date(asUtc - offset);
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.trim() : null);
const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

function entryOf(row: RawTeamRow, position: number): SnapshotEntry {
  const rank = num(row.rank);
  // `is_rv` is the flag; a null rank always comes with it.
  const isRv = row.is_rv === true || rank == null;
  const prevRaw = num(row.prev_rank);
  const prevIsRv = row.prev_is_rv === true || prevRaw === 999;
  return {
    ustfcccaTeamId: row.team_id,
    position,
    rank: isRv ? null : rank,
    isRv,
    score: num(row.score),
    firstPlaceVotes: num(row.first_place_votes),
    prevRank: prevIsRv ? null : prevRaw,
    prevIsRv,
    rankChange: num(row.rank_change),
    conference: str(row.conference),
    region: str(row.region),
  };
}

function listOf(raw: RawList, season: number, kind: ListKind): SnapshotList | null {
  const gender = raw.gender === 'men' || raw.gender === 'women' ? raw.gender : null;
  if (!gender || typeof raw.division !== 'number' || typeof raw.week !== 'number') return null;
  const typeId = num(raw.type_id) ?? (kind === 'regional' ? TYPE_REGIONAL : TYPE_POLL);
  return {
    season,
    gender,
    kind,
    typeId,
    listType: str(raw.list_type),
    divisionId: raw.division,
    divisionName: str(raw.division_name) ?? DIVISIONS[raw.division] ?? null,
    regionId: kind === 'regional' ? num(raw.region_id) ?? 0 : 0,
    regionName: kind === 'regional' ? str(raw.region_name) : null,
    week: raw.week,
    releaseDateEt: str(raw.release_date),
    releasedAt: easternToDate(raw.release_date),
    collectionId: num(raw.collection_id),
    entries: (raw.teams ?? []).filter((t) => typeof t?.team_id === 'number').map(entryOf),
  };
}

/** `/latest/xc`, as kept. Teams on a list but missing from `by_team` are added from the list row. */
export function parseLatestXc(raw: RawLatestXc): Snapshot {
  if (!raw || typeof raw !== 'object' || typeof raw.season !== 'number' || !raw.latest_order) {
    throw new Error('The USTFCCCA answer was not the shape expected (no season or lists)');
  }
  const season = raw.season;
  const lists = [
    ...(raw.latest_order.national_poll ?? []).map((l) => listOf(l, season, 'national')),
    ...(raw.latest_order.regional_rankings ?? []).map((l) => listOf(l, season, 'regional')),
  ].filter((l): l is SnapshotList => l != null);

  const teams = new Map<number, SnapshotTeam>();
  for (const t of Object.values(raw.by_team ?? {})) {
    if (typeof t?.team_id !== 'number' || !str(t.team_name)) continue;
    teams.set(t.team_id, {
      ustfcccaTeamId: t.team_id,
      teamName: str(t.team_name)!,
      teamShort: str(t.team_short),
      abbrev: str(t.abbrev),
      divisionId: num(t.division_id),
      division: str(t.division),
      conference: str(t.conference),
      region: str(t.region),
      athnetTeamId: num(t.athnet_team_id),
    });
  }
  // Every team on a list has to exist as a team, or its entry has nowhere to point.
  for (const list of [...(raw.latest_order.national_poll ?? []), ...(raw.latest_order.regional_rankings ?? [])]) {
    for (const row of list.teams ?? []) {
      if (typeof row?.team_id !== 'number' || teams.has(row.team_id)) continue;
      teams.set(row.team_id, {
        ustfcccaTeamId: row.team_id,
        teamName: str(row.team_name) ?? `USTFCCCA team ${row.team_id}`,
        teamShort: str(row.team_short),
        abbrev: null,
        divisionId: list.division ?? null,
        division: str(list.division_name) ?? DIVISIONS[list.division] ?? null,
        conference: str(row.conference),
        region: str(row.region),
        athnetTeamId: null,
      });
    }
  }

  const generated = raw.generated_at ? new Date(raw.generated_at) : null;
  return {
    generatedAt: generated && !Number.isNaN(generated.getTime()) ? generated : null,
    season,
    teams: [...teams.values()],
    lists,
  };
}

export type FetchResult =
  | { status: 'ok'; httpStatus: number; etag: string | null; snapshot: Snapshot }
  | { status: 'unchanged'; httpStatus: 304; etag: string | null };

/**
 * Read `/latest/xc`. With the ETag of the last read, an unchanged answer is a
 * 304. Throws with the reason on anything else, including an HTML page in
 * place of JSON (a block in front of the API rather than the API answering).
 */
export async function fetchLatestXc(etag: string | null, signal?: AbortSignal): Promise<FetchResult> {
  const res = await fetch(`${USTFCCCA_BASE}/latest/xc`, {
    headers: {
      Accept: 'application/json',
      'User-Agent': 'PTT-Nexus-Online/1.0 (+https://primetime-nexus.com; rankings sync)',
      ...(etag ? { 'If-None-Match': etag } : {}),
    },
    cache: 'no-store',
    signal,
  });
  const newTag = res.headers.get('etag');
  if (res.status === 304) return { status: 'unchanged', httpStatus: 304, etag: newTag ?? etag };
  const type = res.headers.get('content-type') ?? '';
  if (!res.ok || !type.includes('json')) {
    const blocked = type.includes('html') ? ' (an HTML page came back instead of the API: something in front of it refused the request)' : '';
    throw new Error(`USTFCCCA answered ${res.status}${blocked}`);
  }
  const body = await res.json() as RawLatestXc;
  return { status: 'ok', httpStatus: res.status, etag: newTag, snapshot: parseLatestXc(body) };
}
