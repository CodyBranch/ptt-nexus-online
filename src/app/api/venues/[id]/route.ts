import { NextRequest, NextResponse } from 'next/server';
import { checkRelayAuth } from '@/lib/relay-auth';
import { venueDetail } from '@/lib/venue-courses';

/** A venue with its courses (current and retired), meet series and record sets. */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!await checkRelayAuth(request)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { id } = await params;
    const detail = await venueDetail(id);
    if (!detail) return NextResponse.json({ error: 'Venue not found' }, { status: 404 });
    return NextResponse.json(detail);
  } catch (error) {
    console.error('Venue get error:', error);
    return NextResponse.json({ error: 'Failed to fetch venue' }, { status: 500 });
  }
}
