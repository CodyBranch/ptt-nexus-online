/**
 * Everything the live declarations dashboard shows, read in one go.
 *
 * The dashboard (/declare/dashboard/{token}) is for whoever runs the meet:
 * which schools have answered, which have not, how full each race is, who
 * changed what a minute ago — with each school's logo and colors and its
 * runners' headshots where Nexus Online has them.
 *
 * It keeps itself current by asking for `dashboardVersion` every few seconds
 * and reloading only when that changes. The version is made from counts as
 * well as times, so an un-finalize — a row deleted, no timestamp left behind —
 * still moves it.
 */

import { and, eq, inArray, ne, sql } from 'drizzle-orm';
import { db } from '@/db/client';
import {
  meetDeclarationSessions, teamDeclarationAccess, declarationSubmissions,
  declarationFinalizations, organizations, athleteHeadshots,
} from '@/db/schema';
import { closesAtOf, meetTimeZone, schoolRaceIds, type DeadlineRace } from '@/lib/declare-deadline';
import { headshotNameKey, seasonYear } from '@/lib/headshots/name-key';

interface RaceRow extends DeadlineRace {
  id: string; name: string; gender: string; distanceLabel?: string;
}
interface RosterRow {
  id: string; firstName: string; lastName: string; bib?: string; gender?: string; year?: string;
  eligibleRaceIds?: string[];
}

export type RunnerStatus = 'declared' | 'scratched' | 'undecided';

export interface DashRunner {
  id: string;
  firstName: string;
  lastName: string;
  bib: string | null;
  year: string | null;
  gender: string | null;
  status: RunnerStatus;
  raceId: string | null;
  answeredAt: string | null;
  /** A headshot from Nexus Online, when the school's are there. */
  photoUrl: string | null;
}

export interface DashTeam {
  id: string;
  name: string;
  org: {
    name: string; abbreviation: string | null; mascot: string | null;
    primaryColor: string | null; secondaryColor: string | null;
    logoUrl: string | null; logoDarkUrl: string | null;
  } | null;
  runners: DashRunner[];
  total: number;
  answered: number;
  declared: number;
  scratched: number;
  /** The races this school may put runners in. */
  raceIds: string[];
  finalizedRaceIds: string[];
  lastActivity: string | null;
  /** When the coach first opened the form; null if never. */
  openedAt: string | null;
  lastOpenedAt: string | null;
  /**
   * Where the school is: never opened its link, opened it, started answering
   * (a change made after opening - the desk's own seeding does not count),
   * or every runner answered.
   */
  state: SchoolState;
}

export type SchoolState = 'unopened' | 'opened' | 'started' | 'done';

export interface DashRace {
  id: string;
  name: string;
  gender: string;
  distanceLabel: string | null;
  scheduledTime: string | null;
  closesAt: string | null;
  closed: boolean;
  declared: number;
  /** Runners who may run it. */
  eligible: number;
  /** Schools with someone who may run it. */
  schools: number;
  /** Of those, the ones who have said they are done with it. */
  finalized: number;
}

export interface DashActivity {
  at: string;
  teamId: string;
  teamName: string;
  /** Empty for a school opening its form. */
  runnerName: string;
  status: 'declared' | 'scratched' | 'opened';
  raceName: string | null;
}

export interface DashboardData {
  version: string;
  generatedAt: string;
  meet: { name: string; date: string | null; genderTerms: string; timeZone: string | null };
  totals: {
    schools: number; schoolsOpened: number; schoolsStarted: number; schoolsDone: number;
    runners: number; declared: number; scratched: number; undecided: number;
  };
  races: DashRace[];
  teams: DashTeam[];
  activity: DashActivity[];
}

/** The session behind a dashboard link, or null for a link that is not one. */
export async function dashboardSession(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const [s] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.dashboardToken, token)).limit(1);
  return s ?? null;
}

/** Changes whenever anything on the dashboard would. One small query. */
export async function dashboardVersion(sessionId: string): Promise<string> {
  const rows = await db.execute(sql`
    SELECT
      (SELECT extract(epoch FROM updated_at) FROM meet_declaration_sessions WHERE id = ${sessionId}) AS s,
      (SELECT count(*) || ':' || count(opened_at) || ':' || coalesce(extract(epoch FROM max(last_opened_at)), 0)
         FROM team_declaration_access WHERE meet_session_id = ${sessionId}) AS t,
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max(updated_at)), 0)
         FROM declaration_submissions WHERE meet_session_id = ${sessionId}) AS a,
      (SELECT count(*) || ':' || coalesce(extract(epoch FROM max(finalized_at)), 0)
         FROM declaration_finalizations WHERE meet_session_id = ${sessionId}) AS f
  `);
  // postgres-js answers with the rows; PGlite (local checks) with { rows }.
  const list = ((rows as unknown as { rows?: unknown[] }).rows ?? rows) as Array<Record<string, unknown>>;
  const r = list[0] ?? {};
  return [r.s, r.t, r.a, r.f].map((v) => String(v ?? '')).join('|');
}

export async function loadDashboard(session: NonNullable<Awaited<ReturnType<typeof dashboardSession>>>): Promise<DashboardData> {
  const races = JSON.parse(session.racesJson || '[]') as RaceRow[];
  const tz = meetTimeZone(races) ?? null;
  const raceName = new Map(races.map((r) => [r.id, r.name]));
  const now = new Date();

  const [teams, answers, finals, version] = await Promise.all([
    db.select().from(teamDeclarationAccess).where(eq(teamDeclarationAccess.meetSessionId, session.id)),
    db.select().from(declarationSubmissions).where(eq(declarationSubmissions.meetSessionId, session.id)),
    db.select().from(declarationFinalizations).where(eq(declarationFinalizations.meetSessionId, session.id)),
    dashboardVersion(session.id),
  ]);

  const orgIds = [...new Set(teams.map((t) => t.organizationId).filter((id): id is string => !!id))];
  const orgRows = orgIds.length
    ? await db.select().from(organizations).where(inArray(organizations.id, orgIds))
    : [];
  const orgById = new Map(orgRows.map((o) => [o.id, o]));

  // Headshots: this season first, last season for anyone without one yet -
  // the same order the desk's own lookup uses.
  const season = seasonYear(session.meetDate) ?? now.getFullYear();
  const shots = orgIds.length
    ? await db.select({
      organizationId: athleteHeadshots.organizationId, nameKey: athleteHeadshots.nameKey,
      season: athleteHeadshots.season, cutoutPath: athleteHeadshots.cutoutPath,
    }).from(athleteHeadshots).where(and(
      inArray(athleteHeadshots.organizationId, orgIds),
      inArray(athleteHeadshots.season, [season, season - 1]),
      ne(athleteHeadshots.status, 'hidden'),
    ))
    : [];
  const photo = new Map<string, string>();
  for (const s of shots.sort((a, b) => b.season - a.season)) {
    const k = `${s.organizationId}|${s.nameKey}`;
    if (s.cutoutPath && !photo.has(k)) photo.set(k, `/headshots/${s.cutoutPath}?w=160`);
  }

  const answerOf = new Map(answers.map((a) => [`${a.teamAccessId}|${a.athleteId}`, a]));
  const finalsOf = new Map<string, string[]>();
  for (const f of finals) {
    if (!finalsOf.has(f.teamAccessId)) finalsOf.set(f.teamAccessId, []);
    finalsOf.get(f.teamAccessId)!.push(f.raceId);
  }

  const dashTeams: DashTeam[] = teams.map((t) => {
    const roster = JSON.parse(t.rosterJson || '[]') as RosterRow[];
    const org = t.organizationId ? orgById.get(t.organizationId) : undefined;
    let last: Date | null = null;
    const runners: DashRunner[] = roster.map((a) => {
      const ans = answerOf.get(`${t.id}|${a.id}`);
      if (ans?.updatedAt && (!last || ans.updatedAt > last)) last = ans.updatedAt;
      return {
        id: a.id, firstName: a.firstName, lastName: a.lastName,
        bib: a.bib ? String(a.bib) : null, year: a.year ?? null, gender: a.gender ?? null,
        status: (ans?.status === 'declared' || ans?.status === 'scratched' ? ans.status : 'undecided') as RunnerStatus,
        raceId: ans?.status === 'declared' ? ans.raceId ?? null : null,
        answeredAt: ans?.updatedAt ? ans.updatedAt.toISOString() : null,
        photoUrl: org ? photo.get(`${org.id}|${headshotNameKey(a.firstName, a.lastName)}`) ?? null : null,
      };
    });
    for (const f of finals) if (f.teamAccessId === t.id && f.finalizedAt && (!last || f.finalizedAt > last)) last = f.finalizedAt;
    const lastAt = last as Date | null;
    const opened = t.openedAt ?? null;
    const answered = runners.filter((r) => r.status !== 'undecided').length;
    // Started: something the coach did, after opening. What the desk seeded
    // at publish time predates any opening and does not count.
    const coachActed = !!opened && (
      answers.some((a) => a.teamAccessId === t.id && a.updatedAt && a.updatedAt >= opened)
      || finals.some((f) => f.teamAccessId === t.id));
    const state: SchoolState = !opened ? 'unopened'
      : runners.length > 0 && answered === runners.length && coachActed ? 'done'
        : coachActed ? 'started' : 'opened';
    return {
      id: t.id,
      name: t.teamName,
      org: org ? {
        name: org.name, abbreviation: org.abbreviation ?? null, mascot: org.mascot ?? null,
        primaryColor: org.primaryColor ?? null, secondaryColor: org.secondaryColor ?? null,
        logoUrl: org.logoUrl ?? null, logoDarkUrl: org.logoDarkUrl ?? null,
      } : null,
      runners: runners.sort((a, b) => a.lastName.localeCompare(b.lastName) || a.firstName.localeCompare(b.firstName)),
      total: runners.length,
      answered,
      declared: runners.filter((r) => r.status === 'declared').length,
      scratched: runners.filter((r) => r.status === 'scratched').length,
      raceIds: [...schoolRaceIds(roster)],
      finalizedRaceIds: finalsOf.get(t.id) ?? [],
      lastActivity: lastAt ? lastAt.toISOString() : null,
      openedAt: opened ? opened.toISOString() : null,
      lastOpenedAt: t.lastOpenedAt ? t.lastOpenedAt.toISOString() : null,
      state,
    };
  }).sort((a, b) => a.name.localeCompare(b.name));

  const dashRaces: DashRace[] = races.map((r) => {
    const closes = closesAtOf(r);
    const schools = dashTeams.filter((t) => t.raceIds.includes(r.id));
    return {
      id: r.id, name: r.name, gender: r.gender, distanceLabel: r.distanceLabel ?? null,
      scheduledTime: r.scheduledTime ?? null,
      closesAt: closes ? closes.toISOString() : null,
      closed: !!closes && closes.getTime() <= now.getTime(),
      declared: dashTeams.reduce((n, t) => n + t.runners.filter((x) => x.status === 'declared' && x.raceId === r.id).length, 0),
      eligible: teams.reduce((n, t) => n + (JSON.parse(t.rosterJson || '[]') as RosterRow[])
        .filter((a) => (a.eligibleRaceIds ?? []).includes(r.id)).length, 0),
      schools: schools.length,
      finalized: schools.filter((t) => t.finalizedRaceIds.includes(r.id)).length,
    };
  });

  const nameOf = new Map<string, { team: DashTeam; runner: DashRunner }>();
  for (const t of dashTeams) for (const r of t.runners) nameOf.set(`${t.id}|${r.id}`, { team: t, runner: r });
  const answered: DashActivity[] = answers
    .filter((a) => a.updatedAt && (a.status === 'declared' || a.status === 'scratched'))
    .flatMap((a) => {
      const who = nameOf.get(`${a.teamAccessId}|${a.athleteId}`);
      // The desk's own seeding is not a coach's answer.
      if (!who || who.team.state === 'unopened' || (who.team.openedAt && a.updatedAt!.toISOString() < who.team.openedAt)) return [];
      return [{
        at: a.updatedAt!.toISOString(), teamId: who.team.id, teamName: who.team.name,
        runnerName: `${who.runner.firstName} ${who.runner.lastName}`,
        status: a.status as 'declared' | 'scratched',
        raceName: a.status === 'declared' && a.raceId ? raceName.get(a.raceId) ?? null : null,
      }];
    });
  const openings: DashActivity[] = dashTeams.filter((t) => t.openedAt).map((t) => ({
    at: t.openedAt!, teamId: t.id, teamName: t.name, runnerName: '', status: 'opened' as const, raceName: null,
  }));
  const activity = [...answered, ...openings].sort((a, b) => b.at.localeCompare(a.at)).slice(0, 40);

  const runners = dashTeams.flatMap((t) => t.runners);
  return {
    version,
    generatedAt: now.toISOString(),
    meet: { name: session.meetName, date: session.meetDate ?? null, genderTerms: session.genderTerms, timeZone: tz },
    totals: {
      schools: dashTeams.length,
      schoolsOpened: dashTeams.filter((t) => t.state !== 'unopened').length,
      schoolsStarted: dashTeams.filter((t) => t.state === 'started' || t.state === 'done').length,
      schoolsDone: dashTeams.filter((t) => t.state === 'done').length,
      runners: runners.length,
      declared: runners.filter((r) => r.status === 'declared').length,
      scratched: runners.filter((r) => r.status === 'scratched').length,
      undecided: runners.filter((r) => r.status === 'undecided').length,
    },
    races: dashRaces,
    teams: dashTeams,
    activity,
  };
}
