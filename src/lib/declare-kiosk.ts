/**
 * The meet's tablet code: what the PTT Nexus Tablet app is handed for it.
 *
 * The app scans the code once (/declare/kiosk/{token}) and keeps the links,
 * so a tablet at the coaches' table can open the live dashboard, the clerks'
 * page and any school's coach form without typing anything. The token opens
 * every coach form; the desk shows it on screen and never prints it.
 */

import { db } from '@/db/client';
import { meetDeclarationSessions, teamDeclarationAccess } from '@/db/schema';
import { eq } from 'drizzle-orm';

export interface KioskLinks {
  meet: { name: string; date: string | null };
  dashboardUrl: string | null;
  clerkUrl: string | null;
  /** The packet table, and the sign-off tablet that faces the coach. */
  pickupUrl: string | null;
  signoffUrl: string | null;
  teams: Array<{ name: string; url: string }>;
}

export async function kioskSession(token: string) {
  if (!/^[0-9a-f]{32}$/i.test(token)) return null;
  const [s] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.kioskToken, token)).limit(1);
  return s ?? null;
}

export async function kioskLinks(session: typeof meetDeclarationSessions.$inferSelect, origin: string): Promise<KioskLinks> {
  const teams = await db.select({ name: teamDeclarationAccess.teamName, token: teamDeclarationAccess.teamToken })
    .from(teamDeclarationAccess)
    .where(eq(teamDeclarationAccess.meetSessionId, session.id));
  return {
    meet: { name: session.meetName, date: session.meetDate ?? null },
    dashboardUrl: session.dashboardToken ? `${origin}/declare/dashboard/${session.dashboardToken}` : null,
    clerkUrl: session.clerkToken ? `${origin}/declare/clerk/${session.clerkToken}` : null,
    pickupUrl: session.pickupToken ? `${origin}/declare/pickup/${session.pickupToken}` : null,
    signoffUrl: session.pickupToken ? `${origin}/declare/pickup/${session.pickupToken}/sign` : null,
    teams: teams
      .map((t) => ({ name: t.name, url: `${origin}/declare/${session.meetToken}/${t.token}` }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}
