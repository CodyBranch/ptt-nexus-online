-- Close the public REST API on every table.
--
-- Supabase puts a PostgREST API in front of the public schema and hands the
-- anon key to the browser — it is NEXT_PUBLIC_SUPABASE_ANON_KEY, so it is in
-- the page source of the deployed site. Any table in this schema without row
-- level security is therefore readable by anyone who views source, and
-- writable too where the grants allow it.
--
-- Checked against this project before writing this:
--
--   organizations         readable AND writable through the anon key
--   desktop_api_keys      readable — the bearer keys the desktop app
--                         authenticates with, which is what makes this
--                         urgent rather than untidy. Reading them defeats
--                         the key check on /api/organizations entirely.
--   record_sets, records, record_history, event_definitions, sync_logs,
--   organization_images, relay_online_entries, team_relay_access,
--   meet_relay_sessions   all readable
--
-- The tables created with row level security on — org_tags,
-- organization_tags, organization_submissions and the declaration tables —
-- already behaved: reads came back empty and writes were refused.
--
-- Nothing in the application reads through that API. The Supabase browser
-- client exists in src/lib/supabase but nothing imports it; every query goes
-- through DATABASE_URL with drizzle, server side, as a role that row level
-- security does not apply to. So this closes a door nothing walks through.
--
-- No policies are added on purpose. A table with row level security enabled
-- and no policy is closed to everyone except the roles that bypass it, which
-- is exactly what is wanted: the app keeps working, the API stops answering.
-- If something ever should be public, it gets a policy saying so, one table
-- at a time, deliberately.

BEGIN;

-- ── Row level security on everything in public ─────────────────────────────
-- Written as a loop rather than a list so a table added next month is covered
-- by re-running this, instead of being missed by a list nobody updated.
DO $$
DECLARE
  t record;
BEGIN
  FOR t IN
    SELECT c.relname
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relkind = 'r'
      AND NOT c.relrowsecurity
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.relname);
    RAISE NOTICE 'row level security enabled on %', t.relname;
  END LOOP;
END
$$;

-- ── And take the grants away as well ───────────────────────────────────────
-- Belt and braces. Row level security alone would do it, but these two roles
-- are the API's roles and the application never uses either, so there is no
-- reason for them to hold any privilege at all. A table that later loses its
-- row level security by accident is then still not readable.
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM anon;
REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM authenticated;
REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM authenticated;

-- The same for whatever is created from here on.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON SEQUENCES FROM authenticated;

COMMIT;

-- Afterwards, the anon key should get an empty array or a 401 from every
-- table. The site itself is unaffected: it never asks that API anything.
--
-- Worth doing at the same time, in the Supabase dashboard rather than here:
-- rotate the desktop API keys in desktop_api_keys. They have been readable
-- by anyone who looked, and closing the door does not un-read them.
