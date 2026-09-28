import { NextRequest, NextResponse } from 'next/server';
import { relayAuthKey } from '@/lib/relay-auth';
import { setCourseRatings } from '@/lib/venue-courses';

/**
 * A desk's new difficulty ratings for a course, on their own: sent whenever
 * they change on a course kept here. Every set is logged, and any earlier
 * one can be restored from the dashboard.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await relayAuthKey(request);
  if (!auth) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const body = await request.json() as { difficulty?: unknown; meetName?: string };
    if (!Array.isArray(body.difficulty)) {
      return NextResponse.json({ error: 'difficulty is required (an empty list clears the ratings)' }, { status: 400 });
    }
    const meetName = body.meetName?.trim() || null;
    const r = await setCourseRatings(id, body.difficulty, {
      meetName, changedBy: meetName ? `desk: ${meetName}` : 'desk', keyId: auth.keyId,
    });
    if (r.status === 'error') return NextResponse.json({ error: r.message }, { status: r.httpStatus });
    return NextResponse.json(r);
  } catch (error) {
    console.error('Course ratings error:', error);
    return NextResponse.json({ error: 'Failed to save the ratings' }, { status: 500 });
  }
}
