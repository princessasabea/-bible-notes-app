import { NextResponse } from "next/server";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireUserId } from "@/lib/auth-user";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

type PlaylistOwnerRow = { id: string };

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

export async function POST(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const { id: playlistId } = await context.params;

    const [owner] = await query<PlaylistOwnerRow>(
      `SELECT id FROM playlists WHERE id = $1 AND user_id = $2 LIMIT 1`,
      [playlistId, userId]
    );

    if (!owner) {
      return NextResponse.json({ error: "Playlist not found" }, { status: 404 });
    }

    const payload = await request.json();
    const parsed = createSchema.safeParse(payload);
    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const [nextPosition] = await query<{ position: number }>(
      `SELECT COALESCE(MAX(position), 0) + 1 AS position
       FROM playlist_items
       WHERE playlist_id = $1`,
      [playlistId]
    );

    const [created] = await query<PlaylistItemRow>(
      `INSERT INTO playlist_items (id, playlist_id, user_id, translation, book, chapter, title, position)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, playlist_id, translation, book, chapter, title, position`,
      [
        randomUUID(),
        playlistId,
        userId,
        parsed.data.translation,
        parsed.data.book,
        parsed.data.chapter,
        parsed.data.title,
        nextPosition.position
      ]
    );

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
