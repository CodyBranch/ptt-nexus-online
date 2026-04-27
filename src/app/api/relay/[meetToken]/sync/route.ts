import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess, relayOnlineEntries } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

function checkApiKey(request: NextRequest): boolean {
  const relay_api_key = process.env.RELAY_API_KEY;
  if (!relay_api_key) return true;
  const auth = request.headers.get('authorization') ?? '';
  return auth === `Bearer ${relay_api_key}`;
}

// ── GET /api/relay/[meetToken]/sync?eventId=... ─────────────────────────────
// Desktop pulls all coach-submitted relay entries for a meet (optionally filtered
// to one event). Returns data needed to apply legs to local relay_team_members.

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string }> }
) {
  if (!checkApiKey(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { meetToken } = await params;
    const { searchParams } = new URL(request.url);
    const eventIdFilter = searchParams.get('eventId');

    // Resolve session
    const [session] = await db
      .select()
      .from(meetRelaySessions)
      .where(eq(meetRelaySessions.meetToken, meetToken))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: 'Meet session not found' }, { status: 404 });
    }

    // Fetch all team access rows for this session
    const teams = await db
      .select()
      .from(teamRelayAccess)
      .where(eq(teamRelayAccess.meetSessionId, session.id));

    const teamMap = new Map(teams.map((t) => [t.id, t]));

    // Fetch entries — optionally filtered by eventId
    const conditions = [eq(relayOnlineEntries.meetSessionId, session.id)];
    if (eventIdFilter) {
      conditions.push(eq(relayOnlineEntries.eventId, eventIdFilter));
    }

    const entries = await db
      .select()
      .from(relayOnlineEntries)
      .where(and(...conditions));

    // Group by eventId → teams
    const eventMap = new Map<string, { eventId: string; eventName: string; teams: object[] }>();

    for (const entry of entries) {
      const team = teamMap.get(entry.teamAccessId);
      const key = entry.eventId;
      if (!eventMap.has(key)) {
        eventMap.set(key, { eventId: entry.eventId, eventName: entry.eventName, teams: [] });
      }
      eventMap.get(key)!.teams.push({
        teamId: team?.teamId ?? null,
        teamName: team?.teamName ?? 'Unknown',
        legs: JSON.parse(entry.legsJson),
        updatedAt: entry.updatedAt,
      });
    }

    return NextResponse.json({
      meetToken,
      meetName: session.meetName,
      events: Array.from(eventMap.values()),
    });
  } catch (error) {
    console.error('Relay sync error:', error);
    return NextResponse.json({ error: 'Failed to sync relay entries' }, { status: 500 });
  }
}
