import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

/**
 * Everything the coaches have said, for the desktop to pull down.
 *
 * The whole picture every time rather than a delta since a timestamp. A meet
 * is a few hundred rows, and a delta that misses one because two clocks
 * disagree is a runner who is scratched on one screen and running on the
 * other — which is discovered at the finish, if at all.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string }> },
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const { meetToken } = await params;

  try {
    const [session] = await db.select().from(meetDeclarationSessions)
      .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
    if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });

    const teams = await db.select().from(teamDeclarationAccess)
      .where(eq(teamDeclarationAccess.meetSessionId, session.id));

    const rows = await db.select().from(declarationSubmissions)
      .where(eq(declarationSubmissions.meetSessionId, session.id));

    const byTeam = new Map<string, typeof rows>();
    for (const r of rows) {
      if (!byTeam.has(r.teamAccessId)) byTeam.set(r.teamAccessId, []);
      byTeam.get(r.teamAccessId)!.push(r);
    }

    return NextResponse.json({
      meetName: session.meetName,
      races: JSON.parse(session.racesJson),
      teams: teams.map((t) => ({
        teamId: t.teamId,
        teamName: t.teamName,
        declarations: (byTeam.get(t.id) ?? []).map((r) => ({
          athleteId: r.athleteId,
          status: r.status,
          raceId: r.raceId,
          updatedAt: r.updatedAt,
        })),
      })),
    });
  } catch (error) {
    console.error('Declaration sync error:', error);
    return NextResponse.json({ error: 'Failed to sync' }, { status: 500 });
  }
}
