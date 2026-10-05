import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import {
  meetDeclarationSessions,
  teamDeclarationAccess,
  declarationSubmissions,
  declarationFinalizations,
} from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

// ── POST /api/declare/[meetToken]/reset ─────────────────────────────────────
//
// Wipe every answer and every finalized race, and keep every link.
//
// For testing the portal before a meet: a desk tries the forms with the real
// links — the ones printed on the rosters — and then wants them blank again
// for the coaches. The meet token, the team tokens and each school's roster
// are untouched; only what was answered goes - and when each form was opened,
// so the live dashboard does not show the desk's own testing as schools that
// have looked. The desk republishes straight after, which seeds its own
// decisions back in the same way publishing does.
//
// Returns: { reset: true, answers, finalized } — how many rows went.

export async function POST(
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
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const { answers, finalized } = await db.transaction(async (tx) => {
      const f = await tx.delete(declarationFinalizations)
        .where(eq(declarationFinalizations.meetSessionId, session.id))
        .returning({ id: declarationFinalizations.id });
      const a = await tx.delete(declarationSubmissions)
        .where(eq(declarationSubmissions.meetSessionId, session.id))
        .returning({ id: declarationSubmissions.id });
      await tx.update(teamDeclarationAccess)
        .set({ openedAt: null, lastOpenedAt: null })
        .where(eq(teamDeclarationAccess.meetSessionId, session.id));
      await tx.update(meetDeclarationSessions)
        .set({ updatedAt: new Date() })
        .where(eq(meetDeclarationSessions.id, session.id));
      return { answers: a.length, finalized: f.length };
    });

    return NextResponse.json({ reset: true, answers, finalized });
  } catch (error) {
    console.error('Declaration reset error:', error);
    return NextResponse.json({ error: 'Failed to reset the declaration session' }, { status: 500 });
  }
}
