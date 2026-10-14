import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/db/client';
import { meetDeclarationSessions } from '@/db/schema';
import { eq } from 'drizzle-orm';
import { checkRelayAuth } from '@/lib/relay-auth';
import { isClerkSnapshot, MAX_CLERK_BYTES } from '@/lib/declare-clerk';

/**
 * The desk sends the clerks' page: { snapshot } - races, boxes and every
 * runner's status - kept whole, replacing the last. Desk key.
 */
export async function POST(request: NextRequest, { params }: { params: Promise<{ meetToken: string }> }) {
  if (!await checkRelayAuth(request)) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  const { meetToken } = await params;
  const text = await request.text();
  if (text.length > MAX_CLERK_BYTES) return NextResponse.json({ error: 'Too big' }, { status: 413 });
  let body: { snapshot?: unknown };
  try { body = JSON.parse(text) as { snapshot?: unknown }; } catch { return NextResponse.json({ error: 'Not JSON' }, { status: 400 }); }
  if (!isClerkSnapshot(body.snapshot)) return NextResponse.json({ error: 'Not a clerks’ page' }, { status: 400 });
  try {
    const [session] = await db.select({ id: meetDeclarationSessions.id }).from(meetDeclarationSessions)
      .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    await db.update(meetDeclarationSessions)
      .set({ clerkJson: JSON.stringify(body.snapshot), clerkUpdatedAt: new Date() })
      .where(eq(meetDeclarationSessions.id, session.id));
    return NextResponse.json({ saved: true });
  } catch (error) {
    console.error('Clerk snapshot error:', error);
    return NextResponse.json({ error: 'Failed to save' }, { status: 500 });
  }
}
