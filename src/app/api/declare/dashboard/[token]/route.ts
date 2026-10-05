import { NextRequest, NextResponse } from 'next/server';
import { dashboardSession, dashboardVersion, loadDashboard } from '@/lib/declare-dashboard';

// ── GET /api/declare/dashboard/[token]?v=<version> ──────────────────────────
//
// What the live dashboard polls. With the version it last had, and nothing
// changed since, the answer is `{ unchanged: true }` - one small query - so a
// screen left open all morning costs next to nothing. Otherwise the whole
// dashboard, as the page first drew it.
//
// The token in the path is the only key, as on the page itself.

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const session = await dashboardSession(token);
  if (!session) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  try {
    const have = request.nextUrl.searchParams.get('v');
    if (have) {
      const version = await dashboardVersion(session.id);
      if (version === have) {
        return NextResponse.json({ unchanged: true, version }, { headers: { 'Cache-Control': 'no-store' } });
      }
    }
    const data = await loadDashboard(session);
    return NextResponse.json(data, { headers: { 'Cache-Control': 'no-store' } });
  } catch (e) {
    console.error('[declare] dashboard:', e);
    return NextResponse.json({ error: 'Could not read the declarations' }, { status: 500 });
  }
}
