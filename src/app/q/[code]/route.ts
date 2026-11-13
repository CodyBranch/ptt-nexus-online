import { NextRequest, NextResponse } from 'next/server';
import { eq } from 'drizzle-orm';
import { db } from '@/db/client';
import { meetDeclarationSessions, teamDeclarationAccess } from '@/db/schema';

// ── /q/[code] ────────────────────────────────────────────────────────────────
//
// The QR code on the desk's team labels and rosters: <TEAM TOKEN><side>.
// On a coach's phone it opens the school's declarations; the side on the end
// is for the packet table (label-scan.ts), which reads the same code to mark
// the packet picked up, and is ignored here.

export const dynamic = 'force-dynamic';

export async function GET(request: NextRequest, { params }: { params: Promise<{ code: string }> }) {
  const { code } = await params;
  const m = /^([0-9a-f]{32})[FMA]?$/i.exec(code.trim());
  try {
    if (m) {
      const [row] = await db.select({ meetToken: meetDeclarationSessions.meetToken, teamToken: teamDeclarationAccess.teamToken })
        .from(teamDeclarationAccess)
        .innerJoin(meetDeclarationSessions, eq(teamDeclarationAccess.meetSessionId, meetDeclarationSessions.id))
        .where(eq(teamDeclarationAccess.teamToken, m[1].toLowerCase()))
        .limit(1);
      if (row) {
        return NextResponse.redirect(new URL(`/declare/${row.meetToken}/${row.teamToken}`, request.url), {
          status: 307, headers: { 'Cache-Control': 'no-store' },
        });
      }
    }
  } catch (e) {
    console.error('[declare] /q lookup:', e);
    return new NextResponse('Nexus Online could not look this code up. Try again in a moment.\n', {
      status: 500, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  }
  return new NextResponse('This code is not for a meet on Nexus Online. Ask the meet for your school\'s link.\n', {
    status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
