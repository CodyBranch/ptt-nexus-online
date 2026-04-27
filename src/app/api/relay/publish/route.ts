import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess, relayOnlineEntries } from '@/db/schema';
import { randomBytes } from 'crypto';
import { checkRelayAuth } from '@/lib/relay-auth';

// ── Types ───────────────────────────────────────────────────────────────────

interface EventPayload {
  id: string;
  name: string;
  gender: string;
  distance?: number;
  legs?: number;
  scheduledTime?: string;
  deadlineMinutes?: number;
}

interface AthletePayload {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
  gender?: string;
}

interface DefaultLeg {
  leg: number;
  athleteId: string;
  firstName: string;
  lastName: string;
}

interface TeamPayload {
  id: string;
  name: string;
  roster: AthletePayload[];
  /** Event IDs this team is actually entered in (filters what the coach sees). */
  enteredEventIds?: string[];
  /** Current leg assignments from Nexus Manager — inserted as initial cloud entries. */
  currentEntries?: Record<string, { legs: DefaultLeg[] }>;
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
      enteredEventsJson: team.enteredEventIds ? JSON.stringify(team.enteredEventIds) : null,
    }));

    const insertedTeams = await db.insert(teamRelayAccess).values(teamRows).returning();

    // Insert initial relay entries pre-populated from Nexus Manager's current assignments
    const entryRows: Array<{
      teamAccessId: string;
      meetSessionId: string;
      eventId: string;
      eventName: string;
      legsJson: string;
    }> = [];

    for (const team of teams) {
      if (!team.currentEntries) continue;
      const access = insertedTeams.find((t) => t.teamId === team.id);
      if (!access) continue;

      for (const [eventId, entryData] of Object.entries(team.currentEntries)) {
        if (!entryData.legs || entryData.legs.length === 0) continue;
        const ev = events.find((e) => e.id === eventId);
        entryRows.push({
          teamAccessId: access.id,
          meetSessionId: session.id,
          eventId,
          eventName: ev?.name ?? eventId,
          legsJson: JSON.stringify(entryData.legs),
        });
      }
    }

    if (entryRows.length > 0) {
      await db.insert(relayOnlineEntries).values(entryRows);
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
    console.error('Relay publish error:', error);
    return NextResponse.json({ error: 'Failed to publish relay meet' }, { status: 500 });
  }
}
