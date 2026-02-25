import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireUserId } from "@/lib/auth-user";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

type PlaylistRow = {
  id: string;
  name: string;
  created_at: string;
};

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
  name: z.string().min(1).max(120).transform(sanitizeText)
});

export async function GET(): Promise<Response> {
  try {
    const userId = await requireUserId();

    const playlists = await query<PlaylistRow>(
      `SELECT id, name, created_at
       FROM playlists
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    if (playlists.length === 0) {
      return NextResponse.json({ playlists: [] });
    }

    const ids = playlists.map((entry) => entry.id);
    const items = await query<PlaylistItemRow>(
      `SELECT id, playlist_id, translation, book, chapter, title, position
       FROM playlist_items
       WHERE user_id = $1 AND playlist_id = ANY($2::uuid[])
       ORDER BY position ASC, created_at ASC`,
      [userId, ids]
    );

    const grouped = new Map<string, PlaylistItemRow[]>();
    for (const item of items) {
      const list = grouped.get(item.playlist_id) ?? [];
      list.push(item);
      grouped.set(item.playlist_id, list);
    }

    return NextResponse.json({
      playlists: playlists.map((entry) => ({
        ...entry,
        items: grouped.get(entry.id) ?? []
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
    const payload = await request.json();
    const parsed = createSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const [created] = await query<PlaylistRow>(
      `INSERT INTO playlists (id, user_id, name)
       VALUES ($1, $2, $3)
       RETURNING id, name, created_at`,
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
