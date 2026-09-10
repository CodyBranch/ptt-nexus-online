import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
} from '@/db/schema';
import { randomBytes } from 'crypto';
import { checkRelayAuth } from '@/lib/relay-auth';

// ── Types ───────────────────────────────────────────────────────────────────

interface RacePayload {
  id: string;
  name: string;
  gender: string;
  distanceLabel?: string;
  /** ISO datetime the race goes off. */
  scheduledTime?: string;
  /** Minutes before that start when declarations close. */
  deadlineMinutes?: number;
}

interface RosterAthlete {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
  gender?: string;
  year?: string;
  /**
   * Races this runner may be put in. Decided on the desktop, where the rules
   * that govern it live — gender, division, entry caps.
   */
  eligibleRaceIds: string[];
  /** Where the desktop currently has them, so the form opens showing the truth. */
  status?: 'declared' | 'scratched' | 'entered';
  raceId?: string | null;
}

interface TeamPayload {
  id: string;
  name: string;
  roster: RosterAthlete[];
}

// ── POST /api/declare/publish ───────────────────────────────────────────────
// The desktop publishes a cross country meet and gets a token per school back.

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      meetName: string;
      meetDate?: string;
      races: RacePayload[];
      teams: TeamPayload[];
    };

    const { meetName, meetDate, races, teams } = body;

    if (!meetName || !Array.isArray(races) || races.length === 0
        || !Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        { error: 'meetName, races[], and teams[] are required' },
        { status: 400 },
      );
    }

    const meetToken = randomBytes(16).toString('hex');

    const [session] = await db.insert(meetDeclarationSessions).values({
      meetToken,
      meetName,
      meetDate: meetDate ?? null,
      racesJson: JSON.stringify(races),
    }).returning();

    const insertedTeams = await db.insert(teamDeclarationAccess).values(
      teams.map((team) => ({
        meetSessionId: session.id,
        teamToken: randomBytes(16).toString('hex'),
        teamId: team.id,
        teamName: team.name,
        rosterJson: JSON.stringify(team.roster),
      })),
    ).returning();

    // Seed what the desktop already knows, so a coach opening the form sees
    // the squad as it stands rather than a blank sheet they might "confirm"
    // into scratching everybody.
    const seeded: Array<{
      teamAccessId: string; meetSessionId: string;
      athleteId: string; status: string; raceId: string | null;
    }> = [];

    for (const team of teams) {
      const access = insertedTeams.find((t) => t.teamId === team.id);
      if (!access) continue;

      for (const a of team.roster) {
        // Only a decision is seeded. An athlete the desktop has as merely
        // entered has not been answered for, and must stay unanswered here or
        // the coach's "everyone is sorted" would be the desktop's own guess
        // handed back to it.
        if (a.status !== 'declared' && a.status !== 'scratched') continue;
        seeded.push({
          teamAccessId: access.id,
          meetSessionId: session.id,
          athleteId: a.id,
          status: a.status,
          raceId: a.status === 'declared' ? (a.raceId ?? null) : null,
        });
      }
    }

    if (seeded.length > 0) {
      await db.insert(declarationSubmissions).values(seeded);
    }

    return NextResponse.json({
      meetToken,
      sessionId: session.id,
      teams: insertedTeams.map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        teamToken: t.teamToken,
      })),
    }, { status: 201 });
  } catch (error) {
    console.error('Declaration publish error:', error);
    return NextResponse.json({ error: 'Failed to publish meet' }, { status: 500 });
  }
}
