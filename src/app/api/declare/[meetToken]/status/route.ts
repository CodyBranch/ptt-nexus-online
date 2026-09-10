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
 * Who has answered and who has not — the meet desk's view.
 *
 * Counts rather than the declarations themselves, so the desktop can show
 * which schools still need chasing without pulling every runner in the meet.
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

    return NextResponse.json({
      meetName: session.meetName,
      teams: teams.map((t) => {
        const mine = rows.filter((r) => r.teamAccessId === t.id);
        const roster = JSON.parse(t.rosterJson) as unknown[];
        const answered = mine.length;
        const latest = mine.reduce<Date | null>((newest, r) => {
          const at = r.updatedAt ? new Date(r.updatedAt) : null;
          return at && (!newest || at > newest) ? at : newest;
        }, null);
        return {
          teamId: t.teamId,
          teamName: t.teamName,
          rosterSize: roster.length,
          answered,
          declared: mine.filter((r) => r.status === 'declared').length,
          scratched: mine.filter((r) => r.status === 'scratched').length,
          // Nobody answered for is a school that has not opened the form at
          // all, which is a different problem from one part way through.
          started: answered > 0,
          complete: roster.length > 0 && answered >= roster.length,
          lastUpdatedAt: latest ? latest.toISOString() : null,
        };
      }),
    });
  } catch (error) {
    console.error('Declaration status error:', error);
    return NextResponse.json({ error: 'Failed to read status' }, { status: 500 });
  }
}
