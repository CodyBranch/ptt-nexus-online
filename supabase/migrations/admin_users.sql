-- Who may sign in to the dashboard.
--
-- Hand-written and additive, like the others here. Nothing existing is
-- touched.
--
-- A shared password got the door shut quickly, but it cannot be taken off one
-- person: removing somebody means changing it for everybody and telling the
-- rest. So each person gets their own row, and revoking is switching one off.
--
-- Passwords are stored as scrypt with a salt of their own — never the
-- password, and never a bare hash, which two people choosing the same
-- password would otherwise share.
--
-- No row is created here. The first way in is the ADMIN_PASSWORD environment
-- variable, which stays as the way in when no account can be used: the first
-- deploy, and the day the last account is switched off by mistake. Sign in
-- with it, add yourself on the People page, and use the account after that.

CREATE TABLE IF NOT EXISTS "admin_users" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,

  "email" text NOT NULL,
  "name" text,
  -- scrypt, as salt:hash, both hex.
  "password_hash" text NOT NULL,

  -- 'admin' may manage people; 'editor' may change data but not people.
  "role" text DEFAULT 'editor' NOT NULL,

  -- Off rather than deleted, so who did what still reads back.
  "is_active" boolean DEFAULT true NOT NULL,

  "last_sign_in_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now(),
  "created_by" uuid
);

CREATE UNIQUE INDEX IF NOT EXISTS "idx_admin_users_email" ON "admin_users" ("email");
CREATE INDEX IF NOT EXISTS "idx_admin_users_active" ON "admin_users" ("is_active");

-- This table holds password hashes, so it is closed to the public API before
-- anything is ever written to it. The same as everything else in this schema
-- after lock_down_public_tables.sql, done here too so it is never briefly
-- readable between one migration and the next.
ALTER TABLE "admin_users" ENABLE ROW LEVEL SECURITY;
REVOKE ALL PRIVILEGES ON "admin_users" FROM anon;
REVOKE ALL PRIVILEGES ON "admin_users" FROM authenticated;
