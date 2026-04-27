import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess } from '@/db/schema';
import { randomBytes } from 'crypto';
import { checkRelayAuth } from '@/lib/relay-auth';

// ── Types ───────────────────────────────────────────────────────────────────

interface EventPayload {
  id: string;
  name: string;
  gender: string;
  distance?: number;
  legs?: number;
}

interface AthletePayload {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
}

interface TeamPayload {
  id: string;
  name: string;
  roster: AthletePayload[];
}

// ── POST /api/relay/publish ─────────────────────────────────────────────────
// Desktop publishes a relay meet and receives tokens per team.

export async function POST(request: NextRequest) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const body = await request.json() as {
      meetName: string;
      meetDate?: string;
      events: EventPayload[];
      teams: TeamPayload[];
    };

    const { meetName, meetDate, events, teams } = body;

    if (!meetName || !Array.isArray(events) || events.length === 0 || !Array.isArray(teams) || teams.length === 0) {
      return NextResponse.json(
        { error: 'meetName, events[], and teams[] are required' },
        { status: 400 }
      );
    }

    // Generate a unique 32-char hex meet token
    const meetToken = randomBytes(16).toString('hex');

    // Insert meet session
    const [session] = await db.insert(meetRelaySessions).values({
      meetToken,
      meetName,
      meetDate: meetDate ?? null,
      eventsJson: JSON.stringify(events),
    }).returning();

    // Insert one teamRelayAccess row per team (each gets its own token)
    const teamRows = teams.map((team) => ({
      meetSessionId: session.id,
      teamToken: randomBytes(16).toString('hex'),
      teamId: team.id,
      teamName: team.name,
      rosterJson: JSON.stringify(team.roster),
    }));

    const insertedTeams = await db.insert(teamRelayAccess).values(teamRows).returning();

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
    console.error('Relay publish error:', error);
    return NextResponse.json({ error: 'Failed to publish relay meet' }, { status: 500 });
  }
}
