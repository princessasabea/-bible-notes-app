import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth-user";
import { clearUserAudioCache, listUserAudioPaths } from "@/lib/cache/audio-cache";
import { assertSameOrigin } from "@/lib/security";
import { deleteAudioObjects } from "@/lib/storage/audio-storage";

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const userId = await requireUserId();
    const paths = await listUserAudioPaths(userId);
    await deleteAudioObjects(paths);
    await clearUserAudioCache(userId);
    return NextResponse.json({ ok: true });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    console.error("audio_clear_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
