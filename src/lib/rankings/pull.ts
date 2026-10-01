/**
 * Read the USTFCCCA's polls and rankings and keep them.
 *
 * Run by the daily cron and by "Pull now" on the dashboard. Each run reads
 * `/latest/xc` with the last ETag, stores any list it has not seen (or that
 * has changed since), and then matches any team not yet matched to an
 * organization. Every run is logged in ranking_pulls, the failures included,
 * so the dashboard can say when it last worked and why it did not.
 */

import { db } from '@/db/client';
import { organizations, rankingEntries, rankingLists, rankingPulls, rankingTeams } from '@/db/schema';
import { and, desc, eq, inArray, isNotNull, or, sql } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { fetchLatestXc, type Snapshot } from './ustfccca';
import { decide, type MatchOrg } from './match';

export interface PullOutcome {
  status: 'ok' | 'unchanged' | 'failed';
  listsSeen: number;
  listsNew: number;
  teamsSeen: number;
  teamsNew: number;
  autoMatched: number;
  error?: string;
}

/** The ETag of the last read that got an answer. */
async function lastEtag(): Promise<string | null> {
  const [row] = await db
    .select({ etag: rankingPulls.etag })
    .from(rankingPulls)
    .where(and(inArray(rankingPulls.status, ['ok', 'unchanged']), isNotNull(rankingPulls.etag)))
    .orderBy(desc(rankingPulls.startedAt))
    .limit(1);
  return row?.etag ?? null;
}

/** Store a snapshot. Returns how many lists and teams were new. */
export async function storeSnapshot(snap: Snapshot): Promise<{ listsNew: number; teamsNew: number }> {
  return db.transaction(async (tx) => {
    const ids = snap.teams.map((t) => t.ustfcccaTeamId);
    const known = ids.length
      ? new Set((await tx.select({ id: rankingTeams.ustfcccaTeamId }).from(rankingTeams)
        .where(inArray(rankingTeams.ustfcccaTeamId, ids))).map((r) => r.id))
      : new Set<number>();

    for (let i = 0; i < snap.teams.length; i += 200) {
      const chunk = snap.teams.slice(i, i + 200);
      await tx.insert(rankingTeams).values(chunk.map((t) => ({ ...t, lastSeenAt: new Date() })))
        .onConflictDoUpdate({
          target: rankingTeams.ustfcccaTeamId,
          set: {
            teamName: sql`excluded.team_name`,
            teamShort: sql`excluded.team_short`,
            abbrev: sql`excluded.abbrev`,
            divisionId: sql`excluded.division_id`,
            division: sql`excluded.division`,
            conference: sql`excluded.conference`,
            region: sql`excluded.region`,
            // A mapping they have dropped is not forgotten here.
            athnetTeamId: sql`coalesce(excluded.athnet_team_id, ${rankingTeams.athnetTeamId})`,
            lastSeenAt: sql`now()`,
          },
        });
    }

    let listsNew = 0;
    const keyOf = (l: { season: number; gender: string; typeId: number; divisionId: number; regionId: number; week: number }) =>
      `${l.season}|${l.gender}|${l.typeId}|${l.divisionId}|${l.regionId}|${l.week}`;
    const knownLists = new Map((await tx.select({
      id: rankingLists.id, season: rankingLists.season, gender: rankingLists.gender, typeId: rankingLists.typeId,
      divisionId: rankingLists.divisionId, regionId: rankingLists.regionId, week: rankingLists.week,
    }).from(rankingLists).where(eq(rankingLists.season, snap.season))).map((l) => [keyOf(l), l.id]));
    for (const list of snap.lists) {
      const { entries, ...head } = list;
      let listId = knownLists.get(keyOf(head));
      if (listId) {
        await tx.update(rankingLists).set({
          listType: head.listType, divisionName: head.divisionName, regionName: head.regionName,
          releaseDateEt: head.releaseDateEt, releasedAt: head.releasedAt, collectionId: head.collectionId,
        }).where(eq(rankingLists.id, listId));
        // A week can be corrected after release; the list as sent now is the list.
        await tx.delete(rankingEntries).where(eq(rankingEntries.listId, listId));
      } else {
        const [made] = await tx.insert(rankingLists).values(head).returning({ id: rankingLists.id });
        listId = made.id;
        listsNew++;
      }
      if (entries.length) {
        await tx.insert(rankingEntries).values(entries.map((e) => ({ ...e, listId: listId! })));
      }
    }
    return { listsNew, teamsNew: ids.filter((id) => !known.has(id)).length };
  });
}

/** Every college organization, as the matcher reads them. */
async function collegeOrgs(): Promise<MatchOrg[]> {
  return db.select({
    id: organizations.id, name: organizations.name, shortName: organizations.shortName,
    abbreviation: organizations.abbreviation, ncaaDivision: organizations.ncaaDivision,
    naiaMember: organizations.naiaMember, jucoMember: organizations.jucoMember,
    conference: organizations.conference, state: organizations.state,
    athleticNetId: organizations.athleticNetId,
  }).from(organizations).where(eq(organizations.organizationType, 'college'));
}

/**
 * Match every team nobody has decided about yet: unmatched, or waiting for
 * review. A team a person confirmed or ignored is left alone, and so is one
 * the matcher already linked. Returns how many were linked.
 */
export async function matchPending(): Promise<{ autoMatched: number; review: number; unmatched: number }> {
  const pending = await db.select().from(rankingTeams)
    .where(or(eq(rankingTeams.matchStatus, 'unmatched'), eq(rankingTeams.matchStatus, 'review')));
  if (!pending.length) return { autoMatched: 0, review: 0, unmatched: 0 };

  const orgs = await collegeOrgs();
  const taken = new Set((await db.select({ id: rankingTeams.organizationId }).from(rankingTeams)
    .where(isNotNull(rankingTeams.organizationId))).map((r) => r.id!));

  // Decided in memory, then written in a few statements rather than one per
  // team: one at a time, five hundred teams outlasted the function.
  const out = { autoMatched: 0, review: 0, unmatched: 0 };
  const writes: Array<{ id: number; org: string | null; status: string; note: string }> = [];
  for (const team of pending) {
    const d = decide(team, orgs, taken);
    if (d.status === 'auto') {
      taken.add(d.org.id);
      out.autoMatched++;
      writes.push({ id: team.ustfcccaTeamId, org: d.org.id, status: 'auto', note: d.note });
    } else {
      out[d.status]++;
      if (team.matchStatus !== d.status || team.matchNote !== d.note) {
        writes.push({ id: team.ustfcccaTeamId, org: null, status: d.status, note: d.note });
      }
    }
  }
  for (let i = 0; i < writes.length; i += 200) {
    const rows: SQL[] = writes.slice(i, i + 200).map((w) =>
      sql`(${w.id}::int, ${w.org}::uuid, ${w.status}::text, ${w.note}::text)`);
    await db.execute(sql`
      UPDATE ranking_teams AS t SET
        organization_id = v.org,
        match_status = v.status,
        match_note = v.note,
        matched_at = CASE WHEN v.status = 'auto' THEN now() ELSE t.matched_at END,
        matched_by = CASE WHEN v.status = 'auto' THEN 'matcher' ELSE t.matched_by END
      FROM (VALUES ${sql.join(rows, sql`, `)}) AS v(id, org, status, note)
      WHERE t.ustfccca_team_id = v.id
        AND t.match_status IN ('unmatched', 'review')`);
  }
  return out;
}

/** One pull, start to finish, logged. Never throws: a failure is an outcome. */
export async function pullRankings(trigger: 'cron' | 'manual'): Promise<PullOutcome> {
  const startedAt = new Date();
  // Written now and finished at the end, so a pull that is cut short shows as
  // still running rather than leaving no trace.
  let logId: string | null = null;
  try {
    const [row] = await db.insert(rankingPulls).values({ trigger, status: 'running', startedAt })
      .returning({ id: rankingPulls.id });
    logId = row?.id ?? null;
  } catch (e) {
    console.error('[rankings] could not log the pull:', e);
  }
  const outcome: PullOutcome = { status: 'failed', listsSeen: 0, listsNew: 0, teamsSeen: 0, teamsNew: 0, autoMatched: 0 };
  let httpStatus: number | null = null;
  let etag: string | null = null;
  let generatedAt: Date | null = null;
  let season: number | null = null;
  try {
    const res = await fetchLatestXc(await lastEtag(), AbortSignal.timeout(25_000));
    httpStatus = res.httpStatus;
    etag = res.etag;
    if (res.status === 'unchanged') {
      outcome.status = 'unchanged';
    } else {
      const snap = res.snapshot;
      generatedAt = snap.generatedAt;
      season = snap.season;
      outcome.listsSeen = snap.lists.length;
      outcome.teamsSeen = snap.teams.length;
      const stored = await storeSnapshot(snap);
      outcome.listsNew = stored.listsNew;
      outcome.teamsNew = stored.teamsNew;
      outcome.status = 'ok';
    }
    // Matching runs after an unchanged read too: an organization added since
    // the last pull may be the one a waiting team needed.
    outcome.autoMatched = (await matchPending()).autoMatched;
  } catch (e) {
    outcome.error = e instanceof Error ? e.message : String(e);
    console.error('[rankings] pull failed:', outcome.error);
  }
  try {
    const done = {
      trigger, status: outcome.status, httpStatus, etag, generatedAt, season,
      listsSeen: outcome.listsSeen, listsNew: outcome.listsNew,
      teamsSeen: outcome.teamsSeen, teamsNew: outcome.teamsNew,
      autoMatched: outcome.autoMatched, error: outcome.error ?? null,
      startedAt, finishedAt: new Date(),
    };
    if (logId) await db.update(rankingPulls).set(done).where(eq(rankingPulls.id, logId));
    else await db.insert(rankingPulls).values(done);
  } catch (e) {
    console.error('[rankings] could not log the pull:', e);
  }
  return outcome;
}
