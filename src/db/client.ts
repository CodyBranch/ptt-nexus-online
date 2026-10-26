import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';
import * as schema from './schema';

const connectionString = process.env.DATABASE_URL!;

/**
 * One connection pool, kept across invocations.
 *
 * This used to cache the pool everywhere except production:
 *
 *     if (process.env.NODE_ENV !== 'production') globalForDb.conn = conn;
 *
 * which is the one place it was needed. Every serverless instance built its
 * own pool, postgres-js opens up to ten connections by default, and Supabase's
 * session-mode pooler allows fifteen clients in total — so a few warm
 * functions used the lot and everything after them failed to connect. It
 * surfaced as "a server-side exception has occurred" on whatever page asked
 * the database next, which on a sign-in is the sign-in.
 *
 * So: cached always, and one connection each. A serverless function serves one
 * request at a time and has no use for a pool of ten; the pool is the thing
 * that was eating the allowance.
 */
/**
 * And never a connection that may have died while the instance was frozen.
 *
 * Between requests a serverless instance is frozen, and nothing in it runs —
 * including postgres-js's idle_timeout, which is meant to close the connection
 * after twenty quiet seconds. Meanwhile the pooler closes its end. The instance
 * thaws holding a socket that looks open and is not; the next query is written
 * into it and waits for an answer that never comes, until the platform kills
 * the request. Seen as the desk's "did not answer in 15 seconds" and a red
 * error on a coach's phone — and then, on the next try, everything fine, because
 * that landed on a different instance.
 *
 * So a connection that has sat unused for longer than that is not trusted: it
 * is closed and a fresh one made before the query goes out. That costs one
 * connect after a quiet spell — a fraction of a second — and nothing while
 * requests keep coming.
 */
const STALE_AFTER_MS = 15_000;

type Db = ReturnType<typeof drizzle<typeof schema>>;
const state = globalThis as unknown as {
  __nexusDb?: { conn: ReturnType<typeof postgres>; db: Db; lastUsed: number };
};

function connect() {
  const conn = postgres(connectionString, {
    prepare: false,
    // One per instance. Concurrency comes from there being several instances,
    // not from several connections inside one.
    max: 1,
    // Hand it back rather than sitting on it between requests.
    idle_timeout: 20,
    // Fail with something readable rather than hanging when the pooler is full.
    connect_timeout: 10,
  });
  return { conn, db: drizzle(conn, { schema }), lastUsed: Date.now() };
}

function current(): Db {
  const now = Date.now();
  let s = state.__nexusDb;
  if (s && now - s.lastUsed > STALE_AFTER_MS) {
    // Not awaited: a dead socket would make ending it hang too.
    s.conn.end({ timeout: 1 }).catch(() => {});
    s = undefined;
  }
  if (!s) s = state.__nexusDb = connect();
  s.lastUsed = now;
  return s.db;
}

/**
 * The database, as before — every property looked up on a connection known to
 * be fresh. Callers do not change.
 */
export const db = new Proxy({} as Db, {
  get(_target, prop) {
    const d = current();
    const v = Reflect.get(d as object, prop);
    return typeof v === 'function' ? v.bind(d) : v;
  },
});

/** Drop the instance's connection, so the next query opens a fresh one. */
export function resetDb(): void {
  const s = state.__nexusDb;
  state.__nexusDb = undefined;
  // Not awaited, for the same reason as above: a dead socket hangs its end.
  s?.conn.end({ timeout: 1 }).catch(() => {});
}

/** What a dead or stuck connection looks like from postgres-js and the pooler. */
function looksLikeConnectionTrouble(e: unknown): boolean {
  const code = (e as { code?: string } | null)?.code ?? '';
  const msg = e instanceof Error ? e.message : String(e);
  return /CONNECTION_(CLOSED|ENDED|DESTROYED)|ECONNRESET|EPIPE|ETIMEDOUT|CONNECT_TIMEOUT/.test(code)
    || /connection (closed|terminated|ended)|socket hang up|timed out|did not answer/i.test(msg);
}

/**
 * A read that may not hang the page.
 *
 * XC Rankings sat for a minute and then showed "Connection closed.": the top
 * of the page had streamed, the list underneath was waiting on a query that
 * never answered, and the platform stopped the function at its 60 seconds.
 * A read given this is allowed `ms` to answer; if it is stuck or dies on the
 * connection, the connection is dropped and the read tried once more on a
 * fresh one, so a dead socket costs a few seconds, not the page. Reads only:
 * a write retried could be a write done twice.
 */
export async function readWithRetry<T>(label: string, read: () => Promise<T>, ms = 8000): Promise<T> {
  const attempt = () => new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`${label}: the database did not answer in ${ms / 1000} seconds`)), ms);
    read().then((v) => { clearTimeout(timer); resolve(v); }, (e) => { clearTimeout(timer); reject(e); });
  });
  try {
    return await attempt();
  } catch (e) {
    if (!looksLikeConnectionTrouble(e)) throw e;
    console.warn(`[db] ${label}: ${e instanceof Error ? e.message : String(e)} - trying again on a fresh connection`);
    resetDb();
    return attempt();
  }
}
