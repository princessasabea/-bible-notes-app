import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireUserId } from "@/lib/auth-user";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import { assertSameOrigin, sanitizeText } from "@/lib/security";
import { getPlaylistColumnMap } from "@/lib/playlists/columns";

type PlaylistRow = {
  id: string;
  name: string;
  created_at: string;
};

type PlaylistItemRow = {
  id: string;
  playlist_id: string;
  translation: string | null;
  book: string | null;
  chapter: number | string | null;
  title: string | null;
  canonical_ref: string | null;
  position: number | null;
};

const createSchema = z.object({
  name: z.string().min(1).max(120).transform(sanitizeText)
});

const BOOK_NAME_BY_CODE = new Map(BIBLE_BOOKS.map((entry) => [entry.code.toUpperCase(), entry.name]));
const BOOK_NAME_BY_LOWER = new Map(BIBLE_BOOKS.map((entry) => [entry.name.toLowerCase(), entry.name]));

function normalizeBookName(value: string | null): string | null {
  if (!value) {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const fromCode = BOOK_NAME_BY_CODE.get(trimmed.toUpperCase());
  if (fromCode) {
    return fromCode;
  }

  const fromName = BOOK_NAME_BY_LOWER.get(trimmed.toLowerCase());
  if (fromName) {
    return fromName;
  }

  return trimmed;
}

function deriveFromCanonicalRef(canonicalRef: string | null): { book: string | null; chapter: number | null } {
  if (!canonicalRef) {
    return { book: null, chapter: null };
  }

  const parts = canonicalRef.split(".");
  const rawBook = parts[0] ?? "";
  const rawChapter = Number(parts[1] ?? "");
  const book = normalizeBookName(rawBook);
  const chapter = Number.isFinite(rawChapter) && rawChapter > 0 ? rawChapter : null;

  return { book, chapter };
}

export async function GET(): Promise<Response> {
  try {
    const userId = await requireUserId();
    const columns = await getPlaylistColumnMap();
    const playlistsUserColumn = `"${columns.playlistsUser}"`;
    const playlistsCreatedColumn = `"${columns.playlistsCreated}"`;

    const playlists = await query<PlaylistRow>(
      `SELECT id, name, ${playlistsCreatedColumn} AS created_at
       FROM playlists
       WHERE ${playlistsUserColumn} = $1
       ORDER BY ${playlistsCreatedColumn} DESC`,
      [userId]
    );

    if (playlists.length === 0) {
      return NextResponse.json({ playlists: [] });
    }

    const grouped = new Map<string, PlaylistItemRow[]>();

    if (columns.itemsPlaylist) {
      const ids = playlists.map((entry) => entry.id);
      const itemsPlaylistColumn = `"${columns.itemsPlaylist}"`;
      const itemsUserColumn = columns.itemsUser ? `"${columns.itemsUser}"` : null;
      const whereClauses = [`${itemsPlaylistColumn} = ANY($${itemsUserColumn ? 2 : 1}::uuid[])`];
      const params: unknown[] = [];

      if (itemsUserColumn) {
        whereClauses.unshift(`${itemsUserColumn} = $1`);
        params.push(userId);
      }

      params.push(ids);

      const selectTranslation = columns.itemsTranslation ? `"${columns.itemsTranslation}"` : "NULL";
      const selectBook = columns.itemsBook ? `"${columns.itemsBook}"` : "NULL";
      const selectChapter = columns.itemsChapter ? `"${columns.itemsChapter}"` : "NULL";
      const selectTitle = columns.itemsTitle ? `"${columns.itemsTitle}"` : "NULL";
      const selectCanonicalRef = columns.itemsCanonicalRef ? `"${columns.itemsCanonicalRef}"` : "NULL";
      const selectPosition = columns.itemsPosition ? `"${columns.itemsPosition}"` : "0";
      const orderBy = [
        columns.itemsPosition ? `"${columns.itemsPosition}" ASC` : null,
        columns.itemsCreated ? `"${columns.itemsCreated}" ASC` : null,
        "id ASC"
      ].filter(Boolean).join(", ");

      const items = await query<PlaylistItemRow>(
        `SELECT id,
                ${itemsPlaylistColumn} AS playlist_id,
                ${selectTranslation} AS translation,
                ${selectBook} AS book,
                ${selectChapter} AS chapter,
                ${selectTitle} AS title,
                ${selectCanonicalRef} AS canonical_ref,
                ${selectPosition} AS position
         FROM playlist_items
         WHERE ${whereClauses.join(" AND ")}
         ORDER BY ${orderBy}`,
        params
      );

      for (const item of items) {
        const list = grouped.get(item.playlist_id) ?? [];
        list.push(item);
        grouped.set(item.playlist_id, list);
      }
    }

    return NextResponse.json({
      playlists: playlists.map((entry) => ({
        ...entry,
        items: (grouped.get(entry.id) ?? []).map((item, index) => {
          const canonical = deriveFromCanonicalRef(item.canonical_ref);
          const book = normalizeBookName(item.book) ?? canonical.book ?? "John";
          const chapterCandidate = Number(item.chapter);
          const chapter = Number.isFinite(chapterCandidate) && chapterCandidate > 0
            ? chapterCandidate
            : (canonical.chapter ?? 1);
          const translation = (item.translation ?? "NKJV").toString();
          const title = item.title?.trim() ? item.title : `${book} ${chapter} (${translation})`;
          const positionCandidate = Number(item.position);

          return {
            id: item.id,
            playlist_id: entry.id,
            translation,
            book,
            chapter,
            title,
            position: Number.isFinite(positionCandidate) ? positionCandidate : index + 1
          };
        })
      }))
    });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("playlists_get_failed", { error: String(error) });
    return NextResponse.json(
      {
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && { debug: String(error) })
      },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const columns = await getPlaylistColumnMap();
    const playlistsUserColumn = `"${columns.playlistsUser}"`;
    const playlistsCreatedColumn = `"${columns.playlistsCreated}"`;
    const payload = await request.json();
    const parsed = createSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const [created] = await query<PlaylistRow>(
      `INSERT INTO playlists (id, ${playlistsUserColumn}, name)
       VALUES ($1, $2, $3)
       RETURNING id, name, ${playlistsCreatedColumn} AS created_at`,
      [randomUUID(), userId, parsed.data.name]
    );

    return NextResponse.json({ playlist: { ...created, items: [] } }, { status: 201 });
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
    if (pgCode === "23503") {
      return NextResponse.json(
        {
          error: "Session user is not linked to a valid account row.",
          ...(process.env.NODE_ENV === "development" && {
            debug: `fk_violation:${pgError.constraint ?? "unknown_constraint"}`
          })
        },
        { status: 400 }
      );
    }
    if (pgCode === "23502") {
      return NextResponse.json(
        {
          error: "Playlist schema requires additional fields.",
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

    console.error("playlists_post_failed", { error: String(error) });
    return NextResponse.json(
      {
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && { debug: String(error) })
      },
      { status: 500 }
    );
  }
}
