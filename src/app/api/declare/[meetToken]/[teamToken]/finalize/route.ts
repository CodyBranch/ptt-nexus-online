import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationFinalizations,
} from '@/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * A school saying it is done with one race — or taking that back.
 *
 * Taking it back is allowed while the race's own deadline has not passed. A
 * coach who finalizes and then loses a runner to a sprained ankle needs a way
 * through that is not a phone call, and before the deadline nothing downstream
 * has acted on it yet. After the deadline it is the meet office's to reopen,
 * because by then the start list has been printed.
 */

interface Race { id: string; scheduledTime?: string; deadlineMinutes?: number }

function deadlineOf(race: Race): Date | null {
  if (!race.scheduledTime) return null;
  const start = new Date(race.scheduledTime);
  if (Number.isNaN(start.getTime())) return null;
  return new Date(start.getTime() - (race.deadlineMinutes ?? 30) * 60_000);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string; teamToken: string }> },
) {
  const { meetToken, teamToken } = await params;

  try {
    const [session] = await db.select().from(meetDeclarationSessions)
      .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const [access] = await db.select().from(teamDeclarationAccess)
      .where(and(
        eq(teamDeclarationAccess.teamToken, teamToken),
        eq(teamDeclarationAccess.meetSessionId, session.id),
      )).limit(1);
    if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const { raceId, finalized } = await request.json() as
      { raceId?: string; finalized?: boolean };

    const races = JSON.parse(session.racesJson) as Race[];
    const race = races.find((r) => r.id === raceId);
    if (!raceId || !race) {
      return NextResponse.json({ error: 'That race is not in this meet' }, { status: 400 });
    }

    if (finalized === false) {
      const deadline = deadlineOf(race);
      if (deadline && deadline.getTime() <= Date.now()) {
        return NextResponse.json(
          { error: 'That race has closed — the meet office can reopen it' },
          { status: 409 },
        );
      }
      await db.delete(declarationFinalizations).where(and(
        eq(declarationFinalizations.teamAccessId, access.id),
        eq(declarationFinalizations.raceId, raceId),
      ));
      return NextResponse.json({ raceId, finalized: false });
    }

    await db.insert(declarationFinalizations).values({
      teamAccessId: access.id,
      meetSessionId: session.id,
      raceId,
      finalizedAt: new Date(),
    }).onConflictDoUpdate({
      target: [declarationFinalizations.teamAccessId, declarationFinalizations.raceId],
      set: { finalizedAt: new Date() },
    });

    return NextResponse.json({ raceId, finalized: true });
  } catch (error) {
    console.error('Declaration finalize error:', error);
    return NextResponse.json({ error: 'Failed to finalize' }, { status: 500 });
  }
}
