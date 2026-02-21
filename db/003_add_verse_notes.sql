CREATE TABLE IF NOT EXISTS verse_notes (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  canonical_ref text NOT NULL,
  translation text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verse_notes_user_ref_idx
  ON verse_notes(user_id, canonical_ref, translation, created_at DESC);

CREATE OR REPLACE FUNCTION set_updated_at_verse_notes()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger WHERE tgname = 'verse_notes_set_updated_at'
  ) THEN
    CREATE TRIGGER verse_notes_set_updated_at
      BEFORE UPDATE ON verse_notes
      FOR EACH ROW
      EXECUTE FUNCTION set_updated_at_verse_notes();
  END IF;
END
$$;
