import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess, relayOnlineEntries } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

// ── GET /api/relay/[meetToken]/status ───────────────────────────────────────
// Lightweight polling endpoint — returns ONLY finalization metadata (no legs).
// Used by the desktop app to check for newly finalized entries without
// transferring the full relay leg data on every poll cycle.
//
// Response shape:
//   { events: [{ eventId, eventName, teams: [{ teamId, teamName, teamLetter, submittedAt, finalizedAt }] }] }

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { meetToken } = await params;

    const [session] = await db
      .select()
      .from(meetRelaySessions)
      .where(eq(meetRelaySessions.meetToken, meetToken))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: 'Meet session not found' }, { status: 404 });
    }

    // Fetch all team access rows (we need teamId + teamName)
    const teams = await db
      .select()
      .from(teamRelayAccess)
      .where(eq(teamRelayAccess.meetSessionId, session.id));

    const teamMap = new Map(teams.map(t => [t.id, t]));

    // Fetch all entries — select only the metadata columns we need (no legsJson)
    const entries = await db
      .select({
        teamAccessId: relayOnlineEntries.teamAccessId,
        eventId: relayOnlineEntries.eventId,
        eventName: relayOnlineEntries.eventName,
        teamLetter: relayOnlineEntries.teamLetter,
        submittedAt: relayOnlineEntries.submittedAt,
        updatedAt: relayOnlineEntries.updatedAt,
        finalizedAt: relayOnlineEntries.finalizedAt,
      })
      .from(relayOnlineEntries)
      .where(eq(relayOnlineEntries.meetSessionId, session.id));

    // Group by eventId
    const eventMap = new Map<string, {
      eventId: string;
      eventName: string;
      teams: Array<{
        teamId: string | null;
        teamName: string;
        teamLetter: string;
        submittedAt: string | null;
        finalizedAt: string | null;
      }>;
    }>();

    for (const entry of entries) {
      const team = teamMap.get(entry.teamAccessId);
      if (!eventMap.has(entry.eventId)) {
        eventMap.set(entry.eventId, {
          eventId: entry.eventId,
          eventName: entry.eventName,
          teams: [],
        });
      }
      eventMap.get(entry.eventId)!.teams.push({
        teamId: team?.teamId ?? null,
        teamName: team?.teamName ?? 'Unknown',
        teamLetter: entry.teamLetter,
        submittedAt: entry.updatedAt?.toISOString() ?? entry.submittedAt?.toISOString() ?? null,
        finalizedAt: entry.finalizedAt?.toISOString() ?? null,
      });
    }

    return NextResponse.json({
      meetToken,
      events: Array.from(eventMap.values()),
    });
  } catch (error) {
    console.error('Relay status error:', error);
    return NextResponse.json({ error: 'Failed to fetch relay status' }, { status: 500 });
  }
}
