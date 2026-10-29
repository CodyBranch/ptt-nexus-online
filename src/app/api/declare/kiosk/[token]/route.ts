import { NextRequest, NextResponse } from 'next/server';
import { kioskLinks, kioskSession } from '@/lib/declare-kiosk';

// ── GET /api/declare/kiosk/[token] ──────────────────────────────────────────
//
// What the PTT Nexus Tablet app asks after scanning a meet's tablet code:
// the meet, its live dashboard, its clerks' page and every school's coach
// form. The app asks again whenever it comes back online, so schools added
// at the desk later reach the tablet. The token in the path is the only key.

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await kioskSession(token);
  if (!session) return NextResponse.json({ success: false, error: 'Not found' }, { status: 404 });
  try {
    const data = await kioskLinks(session, request.nextUrl.origin);
    return NextResponse.json({ success: true, data }, {
      headers: { 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' },
    });
  } catch (e) {
    console.error('[declare] kiosk:', e);
    return NextResponse.json({ success: false, error: 'Could not read the meet' }, { status: 500 });
  }
}
