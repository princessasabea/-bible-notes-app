import { NextResponse } from "next/server";
import { z } from "zod";
import { execute, query } from "@/lib/db";
import { requireUserId } from "@/lib/auth-user";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

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

const patchSchema = z.object({
  title: z.string().max(160).default("").transform(sanitizeText),
  content: z.string().min(1).max(10000)
});

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    const userId = await requireUserId();
    const { id } = await context.params;

    const [row] = await query<VerseNoteRow>(
      `SELECT id, user_id, canonical_ref, translation, title, content, created_at, updated_at
       FROM notes
       WHERE id = $1 AND user_id = $2
       LIMIT 1`,
      [id, userId]
    );

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ note: row });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("notes_get_by_id_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const { id } = await context.params;
    const payload = await request.json();
    const parsed = patchSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const [row] = await query<VerseNoteRow>(
      `UPDATE notes
       SET title = $1,
           content = $2,
           updated_at = now()
       WHERE id = $3 AND user_id = $4
       RETURNING id, user_id, canonical_ref, translation, title, content, created_at, updated_at`,
      [parsed.data.title, parsed.data.content, id, userId]
    );

    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ note: row });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    console.error("notes_patch_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const { id } = await context.params;

    const deleted = await execute(
      `DELETE FROM notes
       WHERE id = $1 AND user_id = $2`,
      [id, userId]
    );

    if (deleted.rowCount === 0) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    console.error("notes_delete_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
