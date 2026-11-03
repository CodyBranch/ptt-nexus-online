import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { meetDeclarationSessions } from '@/db/schema';
import { checkRelayAuth } from '@/lib/relay-auth';
import { setPickupItems } from '@/lib/declare-pickup';

/**
 * The packet table's pickup items (hats, water bottles), as set on the desk:
 * saved there and sent straight away, so a station sees a change without a
 * full portal update. The list replaces the one before; hand-overs already
 * recorded stay in the log.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ meetToken: string }> },
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  try {
    const { meetToken } = await params;
    const [session] = await db.select().from(meetDeclarationSessions)
      .where(eq(meetDeclarationSessions.meetToken, meetToken)).limit(1);
    if (!session) return NextResponse.json({ error: 'Session not found' }, { status: 404 });
    const body = await request.json().catch(() => ({})) as { items?: unknown };
    if (!Array.isArray(body.items)) return NextResponse.json({ error: 'items[] is required' }, { status: 400 });
    return NextResponse.json({ items: await setPickupItems(session, body.items) });
  } catch (e) {
    console.error('[declare] pickup items:', e);
    return NextResponse.json({ error: 'The pickup items were not saved' }, { status: 500 });
  }
}
