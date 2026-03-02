-- Fixes Auth.js + @auth/pg-adapter compatibility for legacy schemas.
-- Safe to run multiple times.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Adapter inserts into users/accounts/sessions without explicit id values.
-- Legacy schemas with text PKs need defaults.
ALTER TABLE IF EXISTS users
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE IF EXISTS accounts
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

ALTER TABLE IF EXISTS sessions
  ALTER COLUMN id SET DEFAULT gen_random_uuid()::text;

-- Adapter writes OAuth expires_at as unix epoch seconds (bigint).
DO $$
DECLARE
  dtype text;
BEGIN
  SELECT data_type
  INTO dtype
  FROM information_schema.columns
  WHERE table_schema = 'public'
    AND table_name = 'accounts'
    AND column_name = 'expires_at';

  IF dtype = 'timestamp without time zone' OR dtype = 'timestamp with time zone' THEN
    ALTER TABLE accounts
      ALTER COLUMN expires_at TYPE bigint
      USING CASE
        WHEN expires_at IS NULL THEN NULL
        ELSE EXTRACT(EPOCH FROM expires_at)::bigint
      END;
  END IF;
END
$$;
