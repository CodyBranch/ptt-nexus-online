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
const globalForDb = globalThis as unknown as {
  conn: ReturnType<typeof postgres> | undefined;
};

const conn = globalForDb.conn ?? postgres(connectionString, {
  prepare: false,
  // One per instance. Concurrency comes from there being several instances,
  // not from several connections inside one.
  max: 1,
  // Hand it back rather than sitting on it between requests.
  idle_timeout: 20,
  // Fail with something readable rather than hanging when the pooler is full.
  connect_timeout: 10,
});

globalForDb.conn = conn;

export const db = drizzle(conn, { schema });
