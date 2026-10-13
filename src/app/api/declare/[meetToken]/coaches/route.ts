import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetDeclarationSessions, teamDeclarationAccess, declarationCoachContacts } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';

/**
 * The coaches who signed up for the meet's texts, for the desk to pull into
 * its own list of each school's coaches. The whole list every time, like the
 * declarations' sync: the desk applies what is new or changed.
 *
 * GET -> { contacts: [{ id, teamId, name, role, email, phone, optedInAt, updatedAt, confirmStatus }] }
 * teamId is the desk's own team id.
 */
export async function GET(request: NextRequest, { params }: { params: Promise<{ meetToken: string }> }) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const { meetToken } = await params;
  try {
    const [session] = await db.select().from(meetDeclarationSessions)
      .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });

    const rows = await db.select({ c: declarationCoachContacts, teamId: teamDeclarationAccess.teamId })
      .from(declarationCoachContacts)
      .innerJoin(teamDeclarationAccess, eq(teamDeclarationAccess.id, declarationCoachContacts.teamAccessId))
      .where(eq(declarationCoachContacts.meetSessionId, session.id));

    return NextResponse.json({
      contacts: rows.map(({ c, teamId }) => ({
        id: c.id,
        teamId,
        name: c.name,
        role: c.role,
        email: c.email,
        phone: c.phone,
        optedInAt: c.optedInAt ? new Date(c.optedInAt).toISOString() : null,
        updatedAt: new Date(c.updatedAt ?? c.createdAt ?? Date.now()).toISOString(),
        confirmStatus: c.confirmStatus,
      })),
    });
  } catch (error) {
    console.error('Coach contacts pull error:', error);
    return NextResponse.json({ error: 'Failed to read sign-ups' }, { status: 500 });
  }
}
