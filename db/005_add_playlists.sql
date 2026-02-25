CREATE TABLE IF NOT EXISTS playlists (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlists_user_id_idx
  ON playlists(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS playlist_items (
  id uuid PRIMARY KEY,
  playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  translation text NOT NULL,
  book text NOT NULL,
  chapter int NOT NULL,
  title text NOT NULL DEFAULT '',
  position int NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS playlist_items_playlist_idx
  ON playlist_items(playlist_id, position, created_at);
