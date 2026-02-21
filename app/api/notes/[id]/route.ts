import { NextResponse } from "next/server";
import { execute, query } from "@/lib/db";
import { noteMutationSchema } from "@/lib/validation/note";
import { requireUserId } from "@/lib/auth-user";
import { assertSameOrigin } from "@/lib/security";

type NoteRow = {
  id: string;
  title: string;
  content: unknown;
  content_version: number;
  updated_at: string;
  created_at: string;
};

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const { id } = await context.params;
    const payload = await request.json();
    const parsed = noteMutationSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const [updated] = await query<NoteRow>(
      `UPDATE notes
       SET title = $1,
           content = $2::jsonb,
           content_version = $3,
           updated_at = now()
       WHERE id = $4 AND user_id = $5
       RETURNING id, title, content, content_version, updated_at, created_at`,
      [parsed.data.title, JSON.stringify(parsed.data.content), parsed.data.contentVersion, id, userId]
    );

    if (!updated) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    return NextResponse.json({ note: updated });
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
