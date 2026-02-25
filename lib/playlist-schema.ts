import { execute, query } from "@/lib/db";

let ensurePlaylistSchemaPromise: Promise<void> | null = null;

function isUndefinedTableError(error: unknown): boolean {
  if (typeof error === "object" && error !== null && "code" in error) {
    return (error as { code?: string }).code === "42P01";
  }
  return String(error).toLowerCase().includes("does not exist");
}

export async function ensurePlaylistSchema(): Promise<void> {
  if (!ensurePlaylistSchemaPromise) {
    ensurePlaylistSchemaPromise = (async () => {
      try {
        await query<{ has_table: number }>("SELECT 1 AS has_table FROM playlists LIMIT 1");
        await query<{ has_table: number }>("SELECT 1 AS has_table FROM playlist_items LIMIT 1");
        return;
      } catch (error) {
        if (!isUndefinedTableError(error)) {
          throw error;
        }
      }

      await execute(
        `CREATE TABLE IF NOT EXISTS playlists (
          id uuid PRIMARY KEY,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          name text NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now(),
          updated_at timestamptz NOT NULL DEFAULT now()
        )`
      );

      await execute(
        `CREATE INDEX IF NOT EXISTS playlists_user_id_idx
         ON playlists(user_id, created_at DESC)`
      );

      await execute(
        `CREATE TABLE IF NOT EXISTS playlist_items (
          id uuid PRIMARY KEY,
          playlist_id uuid NOT NULL REFERENCES playlists(id) ON DELETE CASCADE,
          user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
          translation text NOT NULL,
          book text NOT NULL,
          chapter int NOT NULL,
          title text NOT NULL DEFAULT '',
          position int NOT NULL,
          created_at timestamptz NOT NULL DEFAULT now()
        )`
      );

      await execute(
        `CREATE INDEX IF NOT EXISTS playlist_items_playlist_idx
         ON playlist_items(playlist_id, position, created_at)`
      );
    })().catch((error) => {
      ensurePlaylistSchemaPromise = null;
      throw error;
    });
  }

  await ensurePlaylistSchemaPromise;
}
