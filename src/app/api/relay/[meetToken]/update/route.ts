import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetRelaySessions, teamRelayAccess, relayOnlineEntries } from '@/db/schema';
import { eq, and } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { checkRelayAuth } from '@/lib/relay-auth';

// ── Types ───────────────────────────────────────────────────────────────────

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

interface EventPayload {
  id: string;
  name: string;
  gender: string;
  distance?: number;
  legs?: number;
  scheduledTime?: string;
  deadlineMinutes?: number;
}

interface TeamPayload {
  id: string;
  name: string;
  roster: AthletePayload[];
  enteredEventIds?: string[];
  currentEntries?: Record<string, { legs: DefaultLeg[] }>;
}

// ── POST /api/relay/[meetToken]/update ──────────────────────────────────────
// Updates an existing relay session in-place — meetToken and all existing
// teamTokens are PRESERVED so coaches' QR codes keep working.
//
// What gets updated:
//   - Session: meetName, meetDate, eventsJson
//   - Existing teams: rosterJson, enteredEventsJson
//   - Non-finalized entries: legsJson refreshed from currentEntries
//   - New teams (added since initial publish): inserted with fresh teamToken
//
// Returns: { updated: true, newTeams: [{teamId, teamToken, teamName}] }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { meetToken } = await params;

    const body = await request.json() as {
      meetName: string;
      meetDate?: string;
      events: EventPayload[];
      teams: TeamPayload[];
    };

    const { meetName, meetDate, events, teams } = body;

    // Resolve existing session
    const [session] = await db
      .select()
      .from(meetRelaySessions)
      .where(eq(meetRelaySessions.meetToken, meetToken))
      .limit(1);

    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // 1. Update session metadata + events list
    await db
      .update(meetRelaySessions)
      .set({
        meetName,
        meetDate: meetDate ?? null,
        eventsJson: JSON.stringify(events),
      })
      .where(eq(meetRelaySessions.id, session.id));

    // 2. Fetch existing team access rows
    const existingAccess = await db
      .select()
      .from(teamRelayAccess)
      .where(eq(teamRelayAccess.meetSessionId, session.id));

    const existingByTeamId = new Map(existingAccess.map(a => [a.teamId, a]));

    const newTeams: Array<{ teamId: string; teamToken: string; teamName: string }> = [];

    for (const team of teams) {
      const existing = existingByTeamId.get(team.id);

      if (existing) {
        // 2a. Update existing team access (roster + entered events)
        await db
          .update(teamRelayAccess)
          .set({
            teamName: team.name,
            rosterJson: JSON.stringify(team.roster),
            enteredEventsJson: team.enteredEventIds ? JSON.stringify(team.enteredEventIds) : null,
          })
          .where(eq(teamRelayAccess.id, existing.id));

        // 2b. Refresh pre-populated entries for non-finalized events
        if (team.currentEntries) {
          for (const [eventId, entryData] of Object.entries(team.currentEntries)) {
            if (!entryData.legs || entryData.legs.length === 0) continue;

            const [existingEntry] = await db
              .select()
              .from(relayOnlineEntries)
              .where(
                and(
                  eq(relayOnlineEntries.teamAccessId, existing.id),
                  eq(relayOnlineEntries.eventId, eventId)
                )
              )
              .limit(1);

            if (existingEntry) {
              // Only update if the coach hasn't finalized
              if (!existingEntry.finalizedAt) {
                await db
                  .update(relayOnlineEntries)
                  .set({ legsJson: JSON.stringify(entryData.legs), updatedAt: new Date() })
                  .where(eq(relayOnlineEntries.id, existingEntry.id));
              }
              // If finalized, leave it alone — coach's choice is final
            } else {
              // No entry yet — insert the pre-populated one
              const ev = events.find(e => e.id === eventId);
              await db.insert(relayOnlineEntries).values({
                teamAccessId: existing.id,
                meetSessionId: session.id,
                eventId,
                eventName: ev?.name ?? eventId,
                legsJson: JSON.stringify(entryData.legs),
              });
            }
          }
        }
      } else {
        // 2c. New team — create access row with fresh token
        const [inserted] = await db
          .insert(teamRelayAccess)
          .values({
            meetSessionId: session.id,
            teamToken: randomBytes(16).toString('hex'),
            teamId: team.id,
            teamName: team.name,
            rosterJson: JSON.stringify(team.roster),
            enteredEventsJson: team.enteredEventIds ? JSON.stringify(team.enteredEventIds) : null,
          })
          .returning();

        newTeams.push({ teamId: inserted.teamId, teamToken: inserted.teamToken, teamName: inserted.teamName });

        // Insert pre-populated entries for the new team
        if (team.currentEntries) {
          const entryRows = Object.entries(team.currentEntries)
            .filter(([, d]) => d.legs && d.legs.length > 0)
            .map(([eventId, entryData]) => {
              const ev = events.find(e => e.id === eventId);
              return {
                teamAccessId: inserted.id,
                meetSessionId: session.id,
                eventId,
                eventName: ev?.name ?? eventId,
                legsJson: JSON.stringify(entryData.legs),
              };
            });
          if (entryRows.length > 0) {
            await db.insert(relayOnlineEntries).values(entryRows);
          }
        }
      }
    }

    return NextResponse.json({ updated: true, newTeams });
  } catch (error) {
    console.error('Relay update error:', error);
    return NextResponse.json(
      { error: `Failed to update relay session: ${error instanceof Error ? error.message : String(error)}` },
      { status: 500 }
    );
  }
}
