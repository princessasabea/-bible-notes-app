import { NextResponse } from "next/server";
import { requireUserId } from "@/lib/auth-user";
import { findAudioCache, touchAudioCache } from "@/lib/cache/audio-cache";
import { getSignedAudioUrl } from "@/lib/storage/audio-storage";

export async function GET(_request: Request, context: { params: Promise<{ hash: string }> }): Promise<Response> {
  try {
    const userId = await requireUserId();
    const { hash } = await context.params;

    const cached = await findAudioCache(userId, hash);
    if (!cached) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }

    await touchAudioCache(userId, hash);
    const signedUrl = await getSignedAudioUrl(cached.blob_path || cached.blob_url);

    return NextResponse.redirect(signedUrl, { status: 302 });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    console.error("audio_fetch_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
