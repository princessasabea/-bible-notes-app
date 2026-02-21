import { NextResponse } from "next/server";
import { z } from "zod";
import { query } from "@/lib/db";
import { requireUserId } from "@/lib/auth-user";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

const createSchema = z.object({
  canonicalRef: z.string().min(3).max(32).transform(sanitizeText),
  translation: z.string().min(2).max(10).optional().transform((v) => (v ? sanitizeText(v) : undefined)),
  title: z.string().max(160).default("").transform(sanitizeText),
  content: z.string().min(1).max(10000)
});

type VerseNoteRow = {
  id: string;
  user_id: string;
  canonical_ref: string;
  translation: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

export async function GET(request: Request): Promise<Response> {
  try {
    const userId = await requireUserId();
    const url = new URL(request.url);
    const canonicalRef = url.searchParams.get("canonicalRef")?.trim();
    const translation = url.searchParams.get("translation")?.trim();

    const rows = canonicalRef
      ? translation
        ? await query<VerseNoteRow>(
          `SELECT id, user_id, canonical_ref, translation, title, content, created_at, updated_at
           FROM notes
           WHERE user_id = $1 AND canonical_ref = $2 AND translation = $3
           ORDER BY created_at DESC`,
          [userId, canonicalRef, translation]
        )
        : await query<VerseNoteRow>(
          `SELECT id, user_id, canonical_ref, translation, title, content, created_at, updated_at
           FROM notes
           WHERE user_id = $1 AND canonical_ref = $2
           ORDER BY created_at DESC`,
          [userId, canonicalRef]
        )
      : await query<VerseNoteRow>(
        `SELECT id, user_id, canonical_ref, translation, title, content, created_at, updated_at
         FROM notes
         WHERE user_id = $1
         ORDER BY updated_at DESC`,
        [userId]
      );

    return NextResponse.json({ notes: rows });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("notes_get_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
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

    const [inserted] = await query<VerseNoteRow>(
      `INSERT INTO notes (user_id, canonical_ref, translation, title, content)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, user_id, canonical_ref, translation, title, content, created_at, updated_at`,
      [userId, parsed.data.canonicalRef, parsed.data.translation ?? null, parsed.data.title, parsed.data.content]
    );

    return NextResponse.json({ note: inserted }, { status: 201 });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    console.error("notes_post_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
