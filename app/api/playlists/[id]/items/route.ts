import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireUserId } from "@/lib/auth-user";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import { assertSameOrigin, sanitizeText } from "@/lib/security";
import { getPlaylistColumnMap } from "@/lib/playlists/columns";

type PlaylistLookupRow = { id: string; user_id: string };

type PlaylistItemRow = {
  id: string;
  playlist_id: string;
  translation: string;
  book: string;
  chapter: number;
  title: string;
  position: number;
};

const createSchema = z.object({
  translation: z.string().min(2).max(16).transform(sanitizeText),
  book: z.string().min(1).max(60).transform(sanitizeText),
  chapter: z.number().int().min(1),
  title: z.string().min(1).max(180).transform(sanitizeText)
});

const BOOK_CODE_BY_NAME = new Map(BIBLE_BOOKS.map((entry) => [entry.name.toLowerCase(), entry.code]));

function toCanonicalRef(book: string, chapter: number): string {
  const code = BOOK_CODE_BY_NAME.get(book.trim().toLowerCase());
  if (!code) {
    return `${book}.${chapter}`;
  }
  return `${code}.${chapter}`;
}

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const columns = await getPlaylistColumnMap();
    const playlistsUserColumn = `"${columns.playlistsUser}"`;
    const { id: playlistId } = await context.params;

    if (!columns.itemsPlaylist) {
      return NextResponse.json(
        {
          error: "Playlist schema mismatch.",
          ...(process.env.NODE_ENV === "development" && {
            debug: "missing_playlist_items_playlist_id_column"
          })
        },
        { status: 500 }
      );
    }

    const itemsPlaylistColumn = `"${columns.itemsPlaylist}"`;

    const [playlist] = await query<PlaylistLookupRow>(
      `SELECT id, ${playlistsUserColumn} AS user_id
       FROM playlists
       WHERE id = $1
       LIMIT 1`,
      [playlistId]
    );

    if (!playlist) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    if (playlist.user_id !== userId) {
      return NextResponse.json(
        {
          error: "Playlist belongs to another account.",
          ...(process.env.NODE_ENV === "development" && {
            debug: { sessionUserId: userId, playlistUserId: playlist.user_id }
          })
        },
        { status: 403 }
      );
    }

    const payload = await request.json();
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    let nextPosition = 1;
    if (columns.itemsPosition) {
      const [positionRow] = await query<{ position: number }>(
        `SELECT COALESCE(MAX("${columns.itemsPosition}"), 0) + 1 AS position
         FROM playlist_items
         WHERE ${itemsPlaylistColumn} = $1`,
        [playlistId]
      );
      nextPosition = positionRow?.position ?? 1;
    }

    const itemId = randomUUID();
    const canonicalRef = toCanonicalRef(parsed.data.book, parsed.data.chapter);

    const insertColumns: string[] = ["id", columns.itemsPlaylist];
    const insertValues: unknown[] = [itemId, playlistId];

    if (columns.itemsUser) {
      insertColumns.push(columns.itemsUser);
      insertValues.push(userId);
    }
    if (columns.itemsTranslation) {
      insertColumns.push(columns.itemsTranslation);
      insertValues.push(parsed.data.translation);
    }
    if (columns.itemsBook) {
      insertColumns.push(columns.itemsBook);
      insertValues.push(parsed.data.book);
    }
    if (columns.itemsChapter) {
      insertColumns.push(columns.itemsChapter);
      insertValues.push(parsed.data.chapter);
    }
    if (columns.itemsTitle) {
      insertColumns.push(columns.itemsTitle);
      insertValues.push(parsed.data.title);
    }
    if (columns.itemsCanonicalRef) {
      insertColumns.push(columns.itemsCanonicalRef);
      insertValues.push(canonicalRef);
    }
    if (columns.itemsVerseStart) {
      insertColumns.push(columns.itemsVerseStart);
      insertValues.push(1);
    }
    if (columns.itemsVerseEnd) {
      insertColumns.push(columns.itemsVerseEnd);
      insertValues.push(999);
    }
    if (columns.itemsPosition) {
      insertColumns.push(columns.itemsPosition);
      insertValues.push(nextPosition);
    }

    const insertSqlColumns = insertColumns.map((column) => `"${column}"`).join(", ");
    const insertSqlValues = insertValues.map((_, index) => `$${index + 1}`).join(", ");
    await query(
      `INSERT INTO playlist_items (${insertSqlColumns})
       VALUES (${insertSqlValues})`,
      insertValues
    );

    const created: PlaylistItemRow = {
      id: itemId,
      playlist_id: playlistId,
      translation: parsed.data.translation,
      book: parsed.data.book,
      chapter: parsed.data.chapter,
      title: parsed.data.title,
      position: nextPosition
    };

    return NextResponse.json({ item: created }, { status: 201 });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    const pgError = (typeof error === "object" && error !== null ? error : {}) as {
      code?: string;
      column?: string;
      constraint?: string;
    };
    const pgCode = String(pgError.code ?? "");
    if (pgCode === "22P02") {
      return NextResponse.json({ error: "Invalid playlist id." }, { status: 400 });
    }
    if (pgCode === "23503") {
      return NextResponse.json(
        {
          error: "Playlist not found.",
          ...(process.env.NODE_ENV === "development" && {
            debug: `fk_violation:${pgError.constraint ?? "unknown_constraint"}`
          })
        },
        { status: 404 }
      );
    }
    if (pgCode === "23502") {
      return NextResponse.json(
        {
          error: "Playlist item payload is incomplete.",
          ...(process.env.NODE_ENV === "development" && {
            debug: `not_null_violation:${pgError.column ?? "unknown_column"}`
          })
        },
        { status: 400 }
      );
    }
    if (pgCode === "42703") {
      return NextResponse.json(
        {
          error: "Playlist schema mismatch.",
          ...(process.env.NODE_ENV === "development" && {
            debug: `undefined_column:${pgError.column ?? "unknown_column"}`
          })
        },
        { status: 500 }
      );
    }

    console.error("playlist_item_post_failed", { error: String(error) });
    return NextResponse.json(
      {
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && { debug: String(error) })
      },
      { status: 500 }
    );
  }
}
