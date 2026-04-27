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
      .select({ id: desktopApiKeys.id })
      .from(desktopApiKeys)
      .where(and(eq(desktopApiKeys.key, provided), eq(desktopApiKeys.isActive, true)))
      .limit(1);

    if (rows.length > 0) {
      // Fire-and-forget: update lastUsedAt
      db.update(desktopApiKeys)
        .set({ lastUsedAt: new Date() })
        .where(eq(desktopApiKeys.id, rows[0].id))
        .catch(() => { /* ignore */ });
      return true;
    }
  } catch {
    // DB error — fall through to deny
  }

  return false;
}
