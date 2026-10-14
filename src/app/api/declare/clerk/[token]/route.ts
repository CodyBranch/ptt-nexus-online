import { NextRequest, NextResponse } from 'next/server';
import { clerkSession, clerkView } from '@/lib/declare-clerk';

/** The clerks' page, for its own polling. No login: the link's token is the key. */
export async function GET(_request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const session = await clerkSession((await params).token);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json(await clerkView(session), { headers: { 'Cache-Control': 'no-store' } });
}
