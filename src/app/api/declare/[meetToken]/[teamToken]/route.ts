import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
  declarationFinalizations,
} from '@/db/schema';
import { and, eq } from 'drizzle-orm';

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
      roster: JSON.parse(access.rosterJson),
      // Only athletes the coach (or the desktop) has answered for appear here.
      // Anything absent is undecided, which the form shows as such.
      declarations: submissions.map((s) => ({
        athleteId: s.athleteId,
        status: s.status,
        raceId: s.raceId,
        updatedAt: s.updatedAt,
      })),
      finalized: finalized.map((f) => ({
        raceId: f.raceId,
        finalizedAt: f.finalizedAt,
      })),
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
    const body = await request.json() as { declarations?: SubmissionInput[] };
    const incoming = body.declarations ?? [];

    if (!Array.isArray(incoming)) {
      return NextResponse.json({ error: 'declarations[] is required' }, { status: 400 });
    }

    const roster = JSON.parse(access.rosterJson) as Array<{
      id: string; eligibleRaceIds?: string[];
    }>;
    const byId = new Map(roster.map((a) => [a.id, a]));
    const raceIds = new Set(
      (JSON.parse(session.racesJson) as Array<{ id: string }>).map((r) => r.id),
    );

    const finalizedRows = await db.select().from(declarationFinalizations)
      .where(eq(declarationFinalizations.teamAccessId, access.id));
    const finalizedRaces = new Set(finalizedRows.map((f) => f.raceId));

    // A runner already in a finalized race cannot be moved out of it, and no
    // new runner can be put into it. Checked here rather than only in the
    // browser: the lock is the school's word to the meet, and a stale tab is
    // no reason to take it back.
    const declaredNow = await db.select().from(declarationSubmissions)
      .where(eq(declarationSubmissions.teamAccessId, access.id));
    const currentRaceOf = new Map(
      declaredNow.filter((r) => r.status === 'declared').map((r) => [r.athleteId, r.raceId]),
    );

    const rejected: string[] = [];

    for (const d of incoming) {
      const athlete = byId.get(d.athleteId);
      // A token opens one school. An athlete id from outside that roster is
      // not a mistake worth guessing at, so it is refused rather than written.
      if (!athlete) { rejected.push(d.athleteId); continue; }

      if (d.status !== 'declared' && d.status !== 'scratched') {
        rejected.push(d.athleteId);
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

      let raceId: string | null = null;
      if (d.status === 'declared') {
        raceId = d.raceId ?? null;
        if (!raceId || !raceIds.has(raceId)) { rejected.push(d.athleteId); continue; }
        // The desktop decides which races a runner may be put in; a choice
        // outside that list is refused here rather than sent home to fail.
        const eligible = athlete.eligibleRaceIds ?? [];
        if (eligible.length > 0 && !eligible.includes(raceId)) {
          rejected.push(d.athleteId);
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
    }

    return NextResponse.json({
      saved: incoming.length - rejected.length,
      rejected,
    });
  } catch (error) {
    console.error('Declaration save error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
