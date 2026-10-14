/**
 * The clerks' page: races, start boxes and every runner's status, as the
 * meet desk last sent them, with each school's Nexus Online logo.
 *
 * The desk sends the whole picture (POST /api/declare/{meetToken}/clerk) with
 * its pull each minute when it has changed; this only keeps it and serves it.
 */

import { db } from '@/db/client';
import { meetDeclarationSessions, organizations } from '@/db/schema';
import { eq, inArray } from 'drizzle-orm';

export type ClerkStatus = 'declared' | 'entered' | 'checked_in' | 'scratched' | 'dns' | 'dnf' | 'dq' | 'unentered';

export interface ClerkSnapshot {
  meetName: string;
  meetDate: string | null;
  races: Array<{ id: string; number: number; name: string; gender: string | null; date: string | null; time: string | null; status: string }>;
  teams: Array<{ id: string; name: string; abbreviation: string; organizationId: string | null; logoUrl: string | null; primaryColor: string | null }>;
  boxes: Array<{ raceId: string; teamId: string | null; label: string | null; box: number; part: number | null; runners: number | null }>;
  athletes: Array<{
    id: string; bib: number | null; firstName: string; lastName: string; year: string | null; gender: string | null;
    teamId: string | null; raceId: string | null; status: ClerkStatus; box: number | null;
  }>;
}

export interface ClerkTeam {
  id: string; name: string; abbreviation: string;
  logoUrl: string | null; logoDarkUrl: string | null; primaryColor: string | null;
}

export interface ClerkView {
  meetName: string;
  meetDate: string | null;
  /** When the desk last sent it; null before it ever has. */
  updatedAt: string | null;
  races: ClerkSnapshot['races'];
  teams: ClerkTeam[];
  boxes: ClerkSnapshot['boxes'];
  athletes: ClerkSnapshot['athletes'];
}

/** The biggest picture kept: a meet of several thousand runners is well under it. */
export const MAX_CLERK_BYTES = 8_000_000;

export async function clerkSession(token: string) {
  if (!/^[0-9a-f]{32}$/.test(token)) return null;
  const [session] = await db.select().from(meetDeclarationSessions)
    .where(eq(meetDeclarationSessions.clerkToken, token)).limit(1);
  return session ?? null;
}

/** Is this what the desk sends? Enough to render, checked loosely: the desk is trusted (it has the key). */
export function isClerkSnapshot(x: unknown): x is ClerkSnapshot {
  const s = x as ClerkSnapshot;
  return !!s && typeof s === 'object' && typeof s.meetName === 'string'
    && Array.isArray(s.races) && Array.isArray(s.teams) && Array.isArray(s.boxes) && Array.isArray(s.athletes);
}

export async function clerkView(session: NonNullable<Awaited<ReturnType<typeof clerkSession>>>): Promise<ClerkView> {
  let snap: ClerkSnapshot | null = null;
  try { snap = session.clerkJson ? JSON.parse(session.clerkJson) as ClerkSnapshot : null; } catch { snap = null; }
  if (!snap || !isClerkSnapshot(snap)) {
    return { meetName: session.meetName, meetDate: session.meetDate, updatedAt: null, races: [], teams: [], boxes: [], athletes: [] };
  }
  // Each school's logo from its Nexus Online organization, else the desk's own.
  const orgIds = [...new Set(snap.teams.map((t) => t.organizationId).filter((x): x is string => !!x && /^[0-9a-f-]{36}$/i.test(x)))];
  const orgs = orgIds.length
    ? await db.select({ id: organizations.id, logoUrl: organizations.logoUrl, logoDarkUrl: organizations.logoDarkUrl, primaryColor: organizations.primaryColor })
      .from(organizations).where(inArray(organizations.id, orgIds))
    : [];
  const orgOf = new Map(orgs.map((o) => [o.id, o]));
  return {
    meetName: snap.meetName || session.meetName,
    meetDate: snap.meetDate ?? session.meetDate,
    updatedAt: session.clerkUpdatedAt ? new Date(session.clerkUpdatedAt).toISOString() : null,
    races: snap.races,
    teams: snap.teams.map((t) => {
      const o = t.organizationId ? orgOf.get(t.organizationId) : undefined;
      return {
        id: t.id, name: t.name, abbreviation: t.abbreviation,
        logoUrl: o?.logoUrl ?? (t.logoUrl && /^https:\/\//.test(t.logoUrl) ? t.logoUrl : null),
        logoDarkUrl: o?.logoDarkUrl ?? null,
        primaryColor: o?.primaryColor ?? t.primaryColor ?? null,
      };
    }),
    boxes: snap.boxes,
    athletes: snap.athletes,
  };
}
