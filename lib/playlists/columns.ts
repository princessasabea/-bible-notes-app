import { query } from "@/lib/db";

type PlaylistColumnMap = {
  playlistsUser: string;
  playlistsCreated: string;
  playlistsUpdated: string | null;
  itemsPlaylist: string | null;
  itemsUser: string | null;
  itemsCreated: string | null;
  itemsPosition: string | null;
  itemsTranslation: string | null;
  itemsBook: string | null;
  itemsChapter: string | null;
  itemsTitle: string | null;
  itemsCanonicalRef: string | null;
  itemsVerseStart: string | null;
  itemsVerseEnd: string | null;
};

type ColumnRow = { column_name: string };

let cachedColumnMap: Promise<PlaylistColumnMap> | null = null;

async function resolveColumn(table: string, candidates: string[]): Promise<string | null> {
  const rows = await query<ColumnRow>(
    `SELECT column_name
     FROM information_schema.columns
     WHERE table_schema = 'public'
       AND table_name = $1
       AND column_name = ANY($2::text[])`,
    [table, candidates]
  );

  const found = new Set(rows.map((row) => row.column_name));
  for (const candidate of candidates) {
    if (found.has(candidate)) {
      return candidate;
    }
  }

  return null;
}

export async function getPlaylistColumnMap(): Promise<PlaylistColumnMap> {
  if (!cachedColumnMap) {
    cachedColumnMap = (async () => {
      const playlistsUser = await resolveColumn("playlists", ["user_id", "userId", "userid"]);
      const playlistsCreated = await resolveColumn("playlists", ["created_at", "createdAt", "createdat"]);
      const playlistsUpdated = await resolveColumn("playlists", ["updated_at", "updatedAt", "updatedat"]);

      const itemsPlaylist = await resolveColumn("playlist_items", ["playlist_id", "playlistId", "playlistid"]);
      const itemsUser = await resolveColumn("playlist_items", ["user_id", "userId", "userid"]);
      const itemsCreated = await resolveColumn("playlist_items", ["created_at", "createdAt", "createdat"]);
      const itemsPosition = await resolveColumn("playlist_items", ["position", "sort_order", "order_index"]);
      const itemsTranslation = await resolveColumn("playlist_items", ["translation"]);
      const itemsBook = await resolveColumn("playlist_items", ["book", "book_name"]);
      const itemsChapter = await resolveColumn("playlist_items", ["chapter", "chapter_number"]);
      const itemsTitle = await resolveColumn("playlist_items", ["title", "name", "label"]);
      const itemsCanonicalRef = await resolveColumn("playlist_items", ["canonical_ref", "canonicalRef"]);
      const itemsVerseStart = await resolveColumn("playlist_items", ["verse_start", "verseStart"]);
      const itemsVerseEnd = await resolveColumn("playlist_items", ["verse_end", "verseEnd"]);

      if (!playlistsUser || !playlistsCreated) {
        throw new Error("Playlist schema mismatch.");
      }

      return {
        playlistsUser,
        playlistsCreated,
        playlistsUpdated,
        itemsPlaylist,
        itemsUser,
        itemsCreated,
        itemsPosition,
        itemsTranslation,
        itemsBook,
        itemsChapter,
        itemsTitle,
        itemsCanonicalRef,
        itemsVerseStart,
        itemsVerseEnd
      };
    })().catch((error) => {
      cachedColumnMap = null;
      throw error;
    });
  }

  return cachedColumnMap;
}
