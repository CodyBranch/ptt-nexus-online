import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
} from '@/db/schema';
import { and, eq, inArray } from 'drizzle-orm';
import { randomBytes } from 'crypto';
import { checkRelayAuth } from '@/lib/relay-auth';
import { knownOrganizations } from '@/lib/declare-orgs';

// ── Types (the same payload /api/declare/publish takes) ──────────────────────

interface RacePayload {
  id: string;
  name: string;
  gender: string;
  distanceLabel?: string;
  scheduledTime?: string;
  deadlineMinutes?: number;
  /** When declarations close for this race (ISO), worked out by the desk; null never. */
  closesAt?: string | null;
}

interface RosterAthlete {
  id: string;
  firstName: string;
  lastName: string;
  bib?: string;
  gender?: string;
  year?: string;
  eligibleRaceIds: string[];
  status?: 'declared' | 'scratched' | 'entered';
  raceId?: string | null;
}

interface TeamPayload {
  id: string;
  name: string;
  /** The school's Nexus Online organization, when the desk has matched one. */
  organizationId?: string | null;
  roster: RosterAthlete[];
}

// ── POST /api/declare/[meetToken]/update ────────────────────────────────────
//
// Publish again without changing a single link.
//
// Each school's link is printed on its team roster and handed out in the
// packet, so it has to keep working however many times the desk republishes
// — a school added on Thursday, a runner added to a roster, a race moved.
// The meet token and every existing team token are PRESERVED; only schools
// new since the last publish get a token, and they are returned so the desk
// can print theirs.
//
// A coach's answers are never overwritten. What the desk has decided is seeded
// only for a runner the coach has not answered for, the same rule publish
// follows — otherwise a republish would quietly take back what the coach said.
//
// Returns: { updated: true, newTeams: [{ teamId, teamName, teamToken }], dashboardToken }

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string }> },
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { meetToken } = await params;
    const body = await request.json() as {
      meetName: string;
      meetDate?: string;
      genderTerms?: string;
      races: RacePayload[];
      teams: TeamPayload[];
    };
    const { meetName, meetDate, genderTerms, races, teams } = body;

    if (!meetName || !Array.isArray(races) || races.length === 0 || !Array.isArray(teams)) {
      return NextResponse.json({ error: 'meetName, races[] and teams[] are required' }, { status: 400 });
    }

    const [session] = await db.select().from(meetDeclarationSessions)
      .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
    if (!session) {
      return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    }

    // A session published before the dashboard existed gets its link now;
    // one that has one keeps it, as every link here does.
    const dashboardToken = session.dashboardToken ?? randomBytes(16).toString('hex');
    await db.update(meetDeclarationSessions).set({
      meetName,
      meetDate: meetDate ?? null,
      genderTerms: genderTerms === 'men_women' ? 'men_women' : 'boys_girls',
      racesJson: JSON.stringify(races),
      dashboardToken,
      updatedAt: new Date(),
    }).where(eq(meetDeclarationSessions.id, session.id));
    const orgs = await knownOrganizations(teams.map((t) => t.organizationId));
    const orgOf = (t: TeamPayload) => (t.organizationId && orgs.has(t.organizationId) ? t.organizationId : null);

    const existing = await db.select().from(teamDeclarationAccess)
      .where(eq(teamDeclarationAccess.meetSessionId, session.id));
    const byTeamId = new Map(existing.map((a) => [a.teamId, a]));

    const newTeams: Array<{ teamId: string; teamName: string; teamToken: string }> = [];

    for (const team of teams) {
      let access = byTeamId.get(team.id);

      if (access) {
        await db.update(teamDeclarationAccess).set({
          teamName: team.name,
          rosterJson: JSON.stringify(team.roster),
          organizationId: orgOf(team),
        }).where(eq(teamDeclarationAccess.id, access.id));
      } else {
        [access] = await db.insert(teamDeclarationAccess).values({
          meetSessionId: session.id,
          teamToken: randomBytes(16).toString('hex'),
          teamId: team.id,
          teamName: team.name,
          rosterJson: JSON.stringify(team.roster),
          organizationId: orgOf(team),
        }).returning();
        newTeams.push({ teamId: access.teamId, teamName: access.teamName, teamToken: access.teamToken });
      }

      // Seed the desk's decisions, but only for runners nobody has answered for.
      const decided = team.roster.filter((a) => a.status === 'declared' || a.status === 'scratched');
      if (decided.length === 0) continue;
      const answered = new Set((await db.select({ athleteId: declarationSubmissions.athleteId })
        .from(declarationSubmissions)
        .where(and(
          eq(declarationSubmissions.teamAccessId, access.id),
          inArray(declarationSubmissions.athleteId, decided.map((a) => a.id)),
        ))).map((r) => r.athleteId));
      const seed = decided.filter((a) => !answered.has(a.id)).map((a) => ({
        teamAccessId: access!.id,
        meetSessionId: session.id,
        athleteId: a.id,
        status: a.status as string,
        raceId: a.status === 'declared' ? (a.raceId ?? null) : null,
      }));
      if (seed.length > 0) {
        await db.insert(declarationSubmissions).values(seed).onConflictDoNothing();
      }
    }

    return NextResponse.json({ updated: true, newTeams, dashboardToken });
  } catch (error) {
    console.error('Declaration update error:', error);
    return NextResponse.json({ error: 'Failed to update the declaration session' }, { status: 500 });
  }
}
