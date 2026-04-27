/**
 * One-time Supabase setup for Realtime relay subscriptions.
 *
 * Run once after initial deploy (or whenever the relay tables are recreated):
 *   npx tsx scripts/setup-realtime.ts
 *
 * What this does:
 *  1. Adds relay_online_entries to the supabase_realtime publication so that
 *     Postgres WAL changes are streamed to Supabase Realtime clients.
 *  2. Grants SELECT on the relay tables to the anon role so that
 *     Nexus Manager's main process (using the anon/publishable key) can
 *     subscribe to postgres_changes events.
 */

import 'dotenv/config';
import postgres from 'postgres';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error('❌  DATABASE_URL not set — check .env.local');
  process.exit(1);
}

const sql = postgres(DATABASE_URL, { max: 1 });

async function run() {
  console.log('Setting up Supabase Realtime for relay tables…\n');

  // ── 1. Add relay_online_entries to the realtime publication ──
  // Idempotent: checks pg_publication_tables before altering.
  await sql`
    DO $$
    BEGIN
      IF NOT EXISTS (
        SELECT 1 FROM pg_publication_tables
        WHERE pubname = 'supabase_realtime'
          AND schemaname = 'public'
          AND tablename  = 'relay_online_entries'
      ) THEN
        ALTER PUBLICATION supabase_realtime ADD TABLE relay_online_entries;
        RAISE NOTICE 'relay_online_entries added to supabase_realtime publication';
      ELSE
        RAISE NOTICE 'relay_online_entries already in supabase_realtime — skipped';
      END IF;
    END $$;
  `;
  console.log('✓  supabase_realtime publication updated');

  // ── 2. Grant SELECT to anon + authenticated roles ──
  // GRANT is idempotent — safe to run repeatedly.
  await sql`GRANT SELECT ON relay_online_entries TO anon`;
  await sql`GRANT SELECT ON relay_online_entries TO authenticated`;
  console.log('✓  SELECT granted to anon and authenticated roles');

  // ── 3. Also grant SELECT on the parent tables (needed for join resolution) ──
  await sql`GRANT SELECT ON meet_relay_sessions TO anon`;
  await sql`GRANT SELECT ON team_relay_access   TO anon`;
  await sql`GRANT SELECT ON meet_relay_sessions TO authenticated`;
  await sql`GRANT SELECT ON team_relay_access   TO authenticated`;
  console.log('✓  SELECT granted on meet_relay_sessions and team_relay_access');

  console.log('\n✅  Setup complete — Realtime subscriptions should now work.');
  await sql.end();
}

run().catch((err) => {
  console.error('❌  Setup failed:', err);
  process.exit(1);
});
