-- Align existing DB with current API + @auth/pg-adapter expectations.
-- Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ----
-- Auth table compatibility (camelCase columns expected by @auth/pg-adapter)
-- ----

CREATE TABLE IF NOT EXISTS users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text,
  email text UNIQUE,
  "emailVerified" timestamptz,
  image text
);

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "emailVerified" timestamptz;

CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL,
  provider text NOT NULL,
  "providerAccountId" text NOT NULL,
  refresh_token text,
  access_token text,
  expires_at bigint,
  token_type text,
  scope text,
  id_token text,
  session_state text,
  oauth_token_secret text,
  oauth_token text
);

CREATE UNIQUE INDEX IF NOT EXISTS accounts_provider_provider_account_id_idx
  ON accounts(provider, "providerAccountId");

CREATE TABLE IF NOT EXISTS sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "sessionToken" text NOT NULL UNIQUE,
  "userId" uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires timestamptz NOT NULL
);

CREATE TABLE IF NOT EXISTS verification_token (
  identifier text NOT NULL,
  token text NOT NULL,
  expires timestamptz NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- ----
-- App schema compatibility
-- ----

CREATE TABLE IF NOT EXISTS notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT '',
  content jsonb NOT NULL DEFAULT '{"contentVersion":1,"blocks":[]}'::jsonb,
  content_version int NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS title text NOT NULL DEFAULT '';

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS content jsonb NOT NULL DEFAULT '{"contentVersion":1,"blocks":[]}'::jsonb;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS content_version int NOT NULL DEFAULT 1;

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS created_at timestamptz NOT NULL DEFAULT now();

ALTER TABLE notes
  ADD COLUMN IF NOT EXISTS updated_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS notes_user_id_idx ON notes(user_id);

CREATE OR REPLACE FUNCTION set_updated_at_notes()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'notes_set_updated_at'
  ) THEN
    CREATE TRIGGER notes_set_updated_at
      BEFORE UPDATE ON notes
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at_notes();
  END IF;
END
$$;
