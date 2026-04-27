import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess, relayOnlineEntries } from '@/db/schema';
import { eq, and } from 'drizzle-orm';

interface LegPayload {
  leg: number;
  athleteId: string;
  firstName?: string;
  lastName?: string;
}

// ── POST /api/relay/[meetToken]/[teamToken]/entries ─────────────────────────
// Coach submits (or updates) their relay legs for one event.
// Upserts: if a row exists for (teamAccessId, eventId), update it; else insert.

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string; teamToken: string }> }
) {
  try {
    const { meetToken, teamToken } = await params;
    const body = await request.json() as {
      eventId: string;
      eventName?: string;
      legs: LegPayload[];
      finalized?: boolean;
    };

    const { eventId, eventName, legs, finalized } = body;

    if (!eventId || !Array.isArray(legs)) {
      return NextResponse.json({ error: 'eventId and legs[] are required' }, { status: 400 });
    }

    // Resolve session
    const [session] = await db
      .select()
      .from(meetRelaySessions)
      .where(eq(meetRelaySessions.meetToken, meetToken))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: 'Meet not found' }, { status: 404 });
    }

    // Resolve team access
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

    // Validate that athlete IDs are in the roster
    const roster = JSON.parse(teamAccess.rosterJson) as { id: string }[];
    const rosterIds = new Set(roster.map((a) => a.id));
    const invalidLegs = legs.filter((l) => l.athleteId && !rosterIds.has(l.athleteId));
    if (invalidLegs.length > 0) {
      return NextResponse.json(
        { error: `Athlete IDs not in roster: ${invalidLegs.map((l) => l.athleteId).join(', ')}` },
        { status: 400 }
      );
    }

    // Determine event name from session events if not provided
    const events = JSON.parse(session.eventsJson) as { id: string; name: string }[];
    const resolvedEventName = eventName ?? events.find((e) => e.id === eventId)?.name ?? eventId;

    // Check for existing entry to decide insert vs. update
    const [existing] = await db
      .select()
      .from(relayOnlineEntries)
      .where(
        and(
          eq(relayOnlineEntries.teamAccessId, teamAccess.id),
          eq(relayOnlineEntries.eventId, eventId)
        )
      )
      .limit(1);

    const now = new Date();
    const finalizedAt = finalized ? now : undefined;

    if (existing) {
      await db
        .update(relayOnlineEntries)
        .set({
          legsJson: JSON.stringify(legs),
          updatedAt: now,
          seededByDesktop: false, // coach has taken ownership — protect from future TD overwrites
          ...(finalizedAt !== undefined ? { finalizedAt } : {}),
        })
        .where(eq(relayOnlineEntries.id, existing.id));
    } else {
      await db.insert(relayOnlineEntries).values({
        teamAccessId: teamAccess.id,
        meetSessionId: session.id,
        eventId,
        eventName: resolvedEventName,
        legsJson: JSON.stringify(legs),
        seededByDesktop: false, // created fresh by the coach
        ...(finalizedAt !== undefined ? { finalizedAt } : {}),
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error('Relay entries submit error:', error);
    return NextResponse.json({ error: 'Failed to submit relay entries' }, { status: 500 });
  }
}
