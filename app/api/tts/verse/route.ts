import { NextResponse } from "next/server";
import { z } from "zod";
import { env } from "@/lib/env";
import { assertSameOrigin, sanitizeText } from "@/lib/security";
import { requireUserId } from "@/lib/auth-user";
import { consumeRateLimit, getClientIp } from "@/lib/rate-limit";
import { buildAudioHash } from "@/lib/tts/hash";
import { findAudioCache, opportunisticAudioCleanup, upsertAudioCache } from "@/lib/cache/audio-cache";
import { getSignedAudioUrl, storeAudio } from "@/lib/storage/audio-storage";
import { synthesizeWithFallback } from "@/lib/tts/providers";

const ttsSchema = z.object({
  text: z.string().min(1).max(env.ttsMaxChars).transform(sanitizeText),
  translation: z.string().min(2).max(10).transform(sanitizeText),
  voiceProfile: z.string().min(2).max(40).default("cedar"),
  voiceSettingsVersion: z.string().default("v1"),
  modelVersion: z.string().default("gpt-4o-mini-tts-2025-12-15")
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);

    const userId = await requireUserId();
    const ip = getClientIp(request);

    const burstUser = consumeRateLimit(`tts:user:${userId}:burst`, 5, 60_000);
    const sustainedUser = consumeRateLimit(`tts:user:${userId}:sustained`, 30, 60 * 60_000);
    const burstIp = consumeRateLimit(`tts:ip:${ip}:burst`, 10, 60_000);

    if (!burstUser || !sustainedUser || !burstIp) {
      return NextResponse.json({ error: "Rate limit exceeded" }, { status: 429 });
    }

    const payload = await request.json();
    const parsed = ttsSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const hash = buildAudioHash({
      text: parsed.data.text,
      translation: parsed.data.translation,
      voiceProfile: parsed.data.voiceProfile,
      voiceSettingsVersion: parsed.data.voiceSettingsVersion,
      provider: "openai-elevenlabs",
      modelVersion: parsed.data.modelVersion
    });

    const cached = await findAudioCache(userId, hash);
    if (cached) {
      const signedUrl = await getSignedAudioUrl(cached.blob_path || cached.blob_url);
      return NextResponse.json({
        status: "cached",
        hash,
        redirectUrl: signedUrl
      });
    }

    const audio = await synthesizeWithFallback({
      text: parsed.data.text,
      voiceProfile: parsed.data.voiceProfile,
      modelVersion: parsed.data.modelVersion
    });

    const stored = await storeAudio(hash, audio.audioBuffer, audio.mimeType);

    await upsertAudioCache({
      userId,
      contentHash: hash,
      provider: audio.provider,
      modelVersion: audio.modelVersion,
      voiceProfile: parsed.data.voiceProfile,
      voiceSettingsVersion: parsed.data.voiceSettingsVersion,
      translation: parsed.data.translation,
      mimeType: audio.mimeType,
      blobUrl: stored.blobUrl,
      blobPath: stored.blobPath
    });

    await opportunisticAudioCleanup();

    return NextResponse.json({
      status: "generated",
      hash,
      redirectUrl: stored.signedUrl
    });
  } catch (error) {
    if (String(error).includes("Unauthorized")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    console.error("tts_generation_failed", { error: String(error) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
