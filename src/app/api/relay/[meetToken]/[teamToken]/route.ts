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

    // Fetch existing entries for this team
    const entries = await db
      .select()
      .from(relayOnlineEntries)
      .where(eq(relayOnlineEntries.teamAccessId, teamAccess.id));

    const existingEntries = Object.fromEntries(
      entries.map((e) => [e.eventId, JSON.parse(e.legsJson)])
    );

    return NextResponse.json({
      meetName: session.meetName,
      meetDate: session.meetDate,
      teamName: teamAccess.teamName,
      events: JSON.parse(session.eventsJson),
      roster: JSON.parse(teamAccess.rosterJson),
      existingEntries,
    });
  } catch (error) {
    console.error('Relay team fetch error:', error);
    return NextResponse.json({ error: 'Failed to fetch relay data' }, { status: 500 });
  }
}
