import { NextResponse } from "next/server";
import { query } from "@/lib/db";
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

export async function GET(): Promise<Response> {
  try {
    const userId = await requireUserId();
    const rows = await query<NoteRow>(
      `SELECT id, title, content, content_version, updated_at, created_at
       FROM notes
       WHERE user_id = $1
       ORDER BY updated_at DESC`,
      [userId]
    );

    return NextResponse.json({ notes: rows });
  } catch {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const payload = await request.json();
    const parsed = noteMutationSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const [inserted] = await query<NoteRow>(
      `INSERT INTO notes (user_id, title, content, content_version)
       VALUES ($1, $2, $3::jsonb, $4)
       RETURNING id, title, content, content_version, updated_at, created_at`,
      [userId, parsed.data.title, JSON.stringify(parsed.data.content), parsed.data.contentVersion]
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
