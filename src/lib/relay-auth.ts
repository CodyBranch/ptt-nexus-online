/**
 * Shared auth check for all /api/relay/* and /api/organizations routes.
 *
 * Priority order:
 *  1. If RELAY_API_KEY env var is set and matches → allow (master override, useful in dev)
 *  2. Otherwise query desktopApiKeys table for an active key matching the Bearer token
 */

import { NextRequest } from 'next/server';
import { db } from '@/db/client';
import { desktopApiKeys } from '@/db/schema';
import { and, eq } from 'drizzle-orm';

/**
 * How stale `last_used_at` may get before it is worth writing.
 *
 * It answers "is this key still in use", and nothing reads it to the second.
 * Writing it on every request put a write in front of every single desktop API
 * call — on a connection pool of one per instance, which is the arrangement
 * that makes that expensive rather than merely wasteful.
 */
const LAST_USED_STALE_MS = 5 * 60 * 1000;

export async function checkRelayAuth(request: NextRequest): Promise<boolean> {
  const auth = request.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return false;

  const provided = auth.slice(7).trim();
  if (!provided) return false;

  // 1. Env var master override (allows dev without a DB key)
  const envKey = process.env.RELAY_API_KEY;
  if (envKey && provided === envKey) return true;

  // 2. DB lookup — find an active key matching the provided token
  try {
    const rows = await db
      .select({ id: desktopApiKeys.id, lastUsedAt: desktopApiKeys.lastUsedAt })
      .from(desktopApiKeys)
      .where(and(eq(desktopApiKeys.key, provided), eq(desktopApiKeys.isActive, true)))
      .limit(1);

    if (rows.length > 0) {
      await touch(rows[0].id, rows[0].lastUsedAt);
      return true;
    }
  } catch {
    // DB error — fall through to deny
  }

  return false;
}

/**
 * Record that the key was used, and do it in front of the caller.
 *
 * This used to be fire-and-forget:
 *
 *     db.update(desktopApiKeys).set({ lastUsedAt: new Date() })
 *       .where(eq(desktopApiKeys.id, id))
 *       .catch(() => {});
 *     return true;
 *
 * which is only background work on a runtime that keeps running. This one does
 * not. The pool in db/client.ts is `max: 1` and cached on globalThis across
 * invocations, so the un-awaited UPDATE took the one connection, auth returned
 * immediately, and the route's own query queued behind a statement nobody was
 * waiting for. When the container then froze between the response and that
 * statement settling, the connection was never handed back — and every later
 * request that warm instance served waited on it forever.
 *
 * It showed up as an intermittently dead Org Matching page: one instance hung,
 * another answered, requests round-robining between them. In the database it
 * was an UPDATE on this table with a transaction open for minutes, parked on
 * Client/ClientRead — the server finished, and the client never spoke again.
 *
 * So it is awaited. An awaited write cannot outlive the request that made it.
 *
 * And mostly it is not made at all: at five-minute granularity this writes
 * roughly once per key per five minutes instead of once per request, which on
 * a meet-day burst of a couple of hundred lookups is the difference between
 * one write and a couple of hundred.
 *
 * A failure here is still ignored. The key IS valid — that was settled by the
 * select above. Failing the request because a telemetry column could not be
 * updated would lock the desktop out of a meet over a statistic.
 */
async function touch(id: string, lastUsedAt: Date | null): Promise<void> {
  const age = Date.now() - (lastUsedAt?.getTime() ?? 0);
  if (age < LAST_USED_STALE_MS) return;
  try {
    await db
      .update(desktopApiKeys)
      .set({ lastUsedAt: new Date() })
      .where(eq(desktopApiKeys.id, id));
  } catch {
    // Telemetry, not auth.
  }
}
