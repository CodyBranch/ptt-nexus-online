import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess, relayOnlineEntries } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

// ── GET /api/relay/[meetToken]/[teamToken] ──────────────────────────────────
// Coach page fetches session info, their team's roster, the relay events, and
// any previously submitted entries. Token possession = auth (no login required).

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ meetToken: string; teamToken: string }> }
) {
  try {
    const { meetToken, teamToken } = await params;

    // Resolve session
    const [session] = await db
      .select()
      .from(meetRelaySessions)
      .where(eq(meetRelaySessions.meetToken, meetToken))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: 'Meet not found' }, { status: 404 });
    }

    // Resolve team access via teamToken
    const [teamAccess] = await db
      .select()
      .from(teamRelayAccess)
      .where(
        and(
          eq(teamRelayAccess.meetSessionId, session.id),
          eq(teamRelayAccess.teamToken, teamToken)
        )
      )
      .limit(1);

    if (!teamAccess) {
      return NextResponse.json({ error: 'Team access not found' }, { status: 404 });
    }

    // Fetch all existing entries for this team
    const entries = await db
      .select()
      .from(relayOnlineEntries)
      .where(eq(relayOnlineEntries.teamAccessId, teamAccess.id));

    // Nested: existingEntries[eventId][teamLetter] = { legs, finalizedAt }
    const existingEntries: Record<string, Record<string, {
      legs: Array<{ leg: number; athleteId: string; firstName: string; lastName: string }>;
      finalizedAt: string | null;
    }>> = {};

    for (const e of entries) {
      if (!existingEntries[e.eventId]) existingEntries[e.eventId] = {};
      existingEntries[e.eventId][e.teamLetter] = {
        legs: JSON.parse(e.legsJson) as Array<{ leg: number; athleteId: string; firstName: string; lastName: string }>,
        finalizedAt: e.finalizedAt?.toISOString() ?? null,
      };
    }

    // Filter events using enteredTeamsJson (preferred) or enteredEventsJson (legacy)
    const allEvents = JSON.parse(session.eventsJson) as Array<{ id: string }>;

    let events: typeof allEvents;
    if (teamAccess.enteredTeamsJson) {
      // New shape: [{eventId, teamLetter}] — extract unique event IDs
      const enteredTeams = JSON.parse(teamAccess.enteredTeamsJson) as Array<{ eventId: string; teamLetter: string }>;
      const enteredEventIds = new Set(enteredTeams.map(et => et.eventId));
      events = allEvents.filter(e => enteredEventIds.has(e.id));
    } else if (teamAccess.enteredEventsJson) {
      // Legacy shape: string[] of event IDs
      const enteredIds = JSON.parse(teamAccess.enteredEventsJson) as string[];
      events = allEvents.filter(e => enteredIds.includes(e.id));
    } else {
      events = allEvents;
    }

    // Parse enteredTeams for the coach page to know which letters to show per event
    const enteredTeams: Array<{ eventId: string; teamLetter: string }> | null =
      teamAccess.enteredTeamsJson
        ? (JSON.parse(teamAccess.enteredTeamsJson) as Array<{ eventId: string; teamLetter: string }>)
        : null;

    return NextResponse.json({
      meetName: session.meetName,
      meetDate: session.meetDate,
      teamName: teamAccess.teamName,
      events,
      enteredTeams,
      roster: JSON.parse(teamAccess.rosterJson),
      existingEntries,
    });
  } catch (error) {
    console.error('Relay team fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch relay data' }, { status: 500 });
  }
}
