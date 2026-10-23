import { returnState } from '@/lib/declare-returns';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
  declarationFinalizations,
} from '@/db/schema';
import { and, eq, sql } from 'drizzle-orm';
import { isClosed, type DeadlineRace } from '@/lib/declare-deadline';
import { checkSwap, checkUnswap, inSwap, type SwapRosterRow } from '@/lib/declare-swap';

/**
 * The coach's own endpoint.
 *
 * No bearer token: the team token in the URL is the credential, the way the
 * relay portal works. It is a long random string that only reaches the school
 * whose squad it opens, and it grants exactly one school's roster in one meet.
 */

interface SubmissionInput {
  athleteId: string;
  status: 'declared' | 'scratched';
  raceId?: string | null;
}

async function lookup(meetToken: string, teamToken: string) {
  const [session] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
  if (!session) return null;

  const [access] = await db.select().from(teamDeclarationAccess)
    .where(and(
      eq(teamDeclarationAccess.teamToken, teamToken),
      eq(teamDeclarationAccess.meetSessionId, session.id),
    )).limit(1);
  if (!access) return null;

  return { session, access };
}

// ── GET — the form as it stands ─────────────────────────────────────────────

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ meetToken: string; teamToken: string }> },
) {
  const { meetToken, teamToken } = await params;

  try {
    const found = await lookup(meetToken, teamToken);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { session, access } = found;

    // The coach has the form open: the dashboard says so, and from when. A
    // failure here costs the dashboard a word, never the coach their form.
    await db.update(teamDeclarationAccess).set({
      openedAt: sql`coalesce(${teamDeclarationAccess.openedAt}, now())`,
      lastOpenedAt: sql`now()`,
    }).where(eq(teamDeclarationAccess.id, access.id)).catch((e) => console.warn('[declare] opened:', e));

    const submissions = await db.select().from(declarationSubmissions)
      .where(eq(declarationSubmissions.teamAccessId, access.id));

    const finalized = await db.select().from(declarationFinalizations)
      .where(eq(declarationFinalizations.teamAccessId, access.id));

    return NextResponse.json({
      meetName: session.meetName,
      meetDate: session.meetDate,
      genderTerms: session.genderTerms,
      races: JSON.parse(session.racesJson),
      teamName: access.teamName,
      // The meet's sign-up for coach texts, with this school already picked.
      // Only when the desk has asked for it.
      textsUrl: session.contactsToken && session.textSignup ? `/declare/coaches/${session.contactsToken}?team=${access.id}` : null,
      roster: JSON.parse(access.rosterJson),
      // Only athletes the coach (or the desktop) has answered for appear here.
      // Anything absent is undecided, which the form shows as such.
      declarations: submissions.map((s) => ({
        athleteId: s.athleteId,
        status: s.status,
        raceId: s.raceId,
        swapFor: s.swapFor ?? null,
        updatedAt: s.updatedAt,
      })),
      finalized: finalized.map((f) => ({
        raceId: f.raceId,
        finalizedAt: f.finalizedAt,
      })),
      // Every bib the office has, scratched yet or not: see returnState.
      bibsReturned: [...(await returnState(session.id, { evenIfRunning: true })).entries()]
        .filter(([k]) => k.startsWith(`${access.id}|`))
        .map(([k, returnedAt]) => ({ athleteId: k.slice(access.id.length + 1), returnedAt })),
    });
  } catch (error) {
    console.error('Declaration fetch error:', error);
    return NextResponse.json({ error: 'Failed to load' }, { status: 500 });
  }
}

// ── POST — the coach answers for some runners ───────────────────────────────

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string; teamToken: string }> },
) {
  const { meetToken, teamToken } = await params;

  try {
    const found = await lookup(meetToken, teamToken);
    if (!found) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { session, access } = found;
    const body = await request.json() as {
      declarations?: SubmissionInput[];
      /** An alternate in for an entered runner. */
      swap?: { alternateId: string; forAthleteId: string };
      /** That taken back. */
      unswap?: { alternateId: string };
    };
    if (body.swap || body.unswap) return swapAnswer(session, access, body);
    const incoming = body.declarations ?? [];

    if (!Array.isArray(incoming)) {
      return NextResponse.json({ error: 'declarations[] is required' }, { status: 400 });
    }

    const roster = JSON.parse(access.rosterJson) as Array<{
      id: string; eligibleRaceIds?: string[]; alternate?: boolean;
    }>;
    const byId = new Map(roster.map((a) => [a.id, a]));
    const raceList = JSON.parse(session.racesJson) as DeadlineRace[];
    const raceIds = new Set(raceList.map((r) => r.id));
    const raceById = new Map(raceList.map((r) => [r.id, r]));
    const now = new Date();

    const finalizedRows = await db.select().from(declarationFinalizations)
      .where(eq(declarationFinalizations.teamAccessId, access.id));
    const finalizedRaces = new Set(finalizedRows.map((f) => f.raceId));

    // A runner already in a finalized race cannot be moved out of it, and no
    // new runner can be put into it. Checked here rather than only in the
    // browser: the lock is the school's word to the meet, and a stale tab is
    // no reason to take it back.
    const declaredNow = await db.select().from(declarationSubmissions)
      .where(eq(declarationSubmissions.teamAccessId, access.id));
    const answerOf = new Map(declaredNow.map((r) => [r.athleteId, r]));
    const currentRaceOf = new Map(
      declaredNow.filter((r) => r.status === 'declared').map((r) => [r.athleteId, r.raceId]),
    );
    // How many this school has in each race now, kept as the loop goes: the
    // desk may cap a race per school, and a batch (confirming the entered
    // runners) must stop at the cap, not past it.
    const inRace = new Map<string, number>();
    for (const r of currentRaceOf.values()) if (r) inRace.set(r, (inRace.get(r) ?? 0) + 1);

    const rejected: string[] = [];
    /** Why, for a refusal the coach can act on: a full race. */
    const reasons: Record<string, string> = {};

    for (const d of incoming) {
      const athlete = byId.get(d.athleteId);
      // A token opens one school. An athlete id from outside that roster is
      // not a mistake worth guessing at, so it is refused rather than written.
      if (!athlete) { rejected.push(d.athleteId); continue; }

      if (d.status !== 'declared' && d.status !== 'scratched') {
        rejected.push(d.athleteId);
        continue;
      }
      // Entered and alternates: an alternate comes in only by a swap, and a
      // runner in a swap leaves it only by Undo.
      if (athlete.alternate && !inSwap(answerOf.get(d.athleteId))) {
        rejected.push(d.athleteId);
        reasons[d.athleteId] = 'An alternate comes in only by a swap with a runner in the race';
        continue;
      }
      if (inSwap(answerOf.get(d.athleteId))) {
        rejected.push(d.athleteId);
        reasons[d.athleteId] = 'Undo the swap first';
        continue;
      }

      const leaving = currentRaceOf.get(d.athleteId);
      if (leaving && finalizedRaces.has(leaving)) {
        rejected.push(d.athleteId);
        continue;
      }
      if (d.status === 'declared' && d.raceId && finalizedRaces.has(d.raceId)) {
        rejected.push(d.athleteId);
        continue;
      }
      // Past a race's cutoff its start list is set: nobody in, nobody out.
      // The form greys these out; a tab left open past the cutoff is why the
      // rule is also here. The meet office can still change it at the desk.
      if (leaving && isClosed(raceById.get(leaving), now)) {
        rejected.push(d.athleteId);
        continue;
      }
      if (d.status === 'declared' && d.raceId && isClosed(raceById.get(d.raceId), now)) {
        rejected.push(d.athleteId);
        continue;
      }
      if (d.status === 'scratched' && !leaving) {
        const open = (athlete.eligibleRaceIds ?? [...raceIds]).some((id) => !isClosed(raceById.get(id), now));
        if (!open) { rejected.push(d.athleteId); continue; }
      }

      let raceId: string | null = null;
      if (d.status === 'declared') {
        raceId = d.raceId ?? null;
        if (!raceId || !raceIds.has(raceId)) { rejected.push(d.athleteId); continue; }
        // The desktop decides which races a runner may be put in; a choice
        // outside that list is refused here rather than sent home to fail.
        // An empty list means no race here is open to this runner, not "any".
        if (Array.isArray(athlete.eligibleRaceIds) && !athlete.eligibleRaceIds.includes(raceId)) {
          rejected.push(d.athleteId);
          continue;
        }
        // The school's cap for this race. Somebody already in it can be
        // answered for again; a new runner cannot go past it.
        const cap = raceById.get(raceId)?.maxPerSchool;
        if (cap && cap > 0 && leaving !== raceId && (inRace.get(raceId) ?? 0) >= cap) {
          rejected.push(d.athleteId);
          reasons[d.athleteId] = `${raceById.get(raceId)?.name ?? 'That race'} is full: ${cap} of ${cap} runners declared`;
          continue;
        }
      }

      await db.insert(declarationSubmissions).values({
        teamAccessId: access.id,
        meetSessionId: session.id,
        athleteId: d.athleteId,
        status: d.status,
        raceId,
        updatedAt: new Date(),
      }).onConflictDoUpdate({
        target: [declarationSubmissions.teamAccessId, declarationSubmissions.athleteId],
        set: { status: d.status, raceId, updatedAt: new Date() },
      });
      // Counted as it now stands, for the next one in the batch.
      if (leaving) inRace.set(leaving, Math.max(0, (inRace.get(leaving) ?? 1) - 1));
      if (raceId) inRace.set(raceId, (inRace.get(raceId) ?? 0) + 1);
      if (raceId) currentRaceOf.set(d.athleteId, raceId); else currentRaceOf.delete(d.athleteId);
    }

    return NextResponse.json({
      saved: incoming.length - rejected.length,
      rejected,
      reasons,
    });
  } catch (error) {
    console.error('Declaration save error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}

// ── A swap, or one taken back ───────────────────────────────────────────────

type Session = typeof meetDeclarationSessions.$inferSelect;
type Access = typeof teamDeclarationAccess.$inferSelect;

async function swapAnswer(
  session: Session,
  access: Access,
  body: { swap?: { alternateId: string; forAthleteId: string }; unswap?: { alternateId: string } },
) {
  const roster = JSON.parse(access.rosterJson) as SwapRosterRow[];
  const races = new Map((JSON.parse(session.racesJson) as DeadlineRace[]).map((r) => [r.id, r]));
  const answers = await db.select().from(declarationSubmissions)
    .where(eq(declarationSubmissions.teamAccessId, access.id));
  const finalized = new Set((await db.select().from(declarationFinalizations)
    .where(eq(declarationFinalizations.teamAccessId, access.id))).map((f) => f.raceId));
  const now = new Date();
  const rules = { roster, answers, finalized, closed: (raceId: string) => isClosed(races.get(raceId), now) };
  const at = new Date();

  const write = (tx: Pick<typeof db, 'insert'>, athleteId: string, status: string, raceId: string | null, swapFor: string | null) =>
    tx.insert(declarationSubmissions).values({
      teamAccessId: access.id, meetSessionId: session.id, athleteId, status, raceId, swapFor, updatedAt: at,
    }).onConflictDoUpdate({
      target: [declarationSubmissions.teamAccessId, declarationSubmissions.athleteId],
      set: { status, raceId, swapFor, updatedAt: at },
    });

  if (body.swap) {
    const { alternateId, forAthleteId } = body.swap;
    const ok = checkSwap(rules, alternateId, forAthleteId);
    if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: 409 });
    await db.transaction(async (tx) => {
      await write(tx, alternateId, 'declared', ok.raceId, forAthleteId);
      await write(tx, forAthleteId, 'swapped', ok.raceId, alternateId);
    });
    return NextResponse.json({ swapped: true, raceId: ok.raceId });
  }

  const alternateId = body.unswap!.alternateId;
  const ok = checkUnswap(rules, alternateId);
  if (!ok.ok) return NextResponse.json({ error: ok.error }, { status: 409 });
  // A runner swapped out who had gone in for somebody else: back out, for
  // the alternate still running on their bib.
  const before = answers.find((x) => x.status === 'declared' && x.swapFor === alternateId);
  await db.transaction(async (tx) => {
    // Kept, not cleared: the desk undoes a swap it has made when it sees this
    // ('swapped' too: a runner out has no swap left with them in it).
    if (before) await write(tx, alternateId, 'swapped', before.raceId, before.athleteId);
    else await write(tx, alternateId, 'unswapped', ok.raceId, ok.forAthleteId);
    // The runner is back as the meet entered them, theirs to confirm again.
    await tx.delete(declarationSubmissions).where(and(
      eq(declarationSubmissions.teamAccessId, access.id),
      eq(declarationSubmissions.athleteId, ok.forAthleteId),
    ));
  });
  return NextResponse.json({ unswapped: true });
}
