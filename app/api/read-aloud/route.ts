import { NextResponse } from "next/server";
import OpenAI from "openai";
import { z } from "zod";
import { requireUserId } from "@/lib/auth-user";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

const schema = z.object({
  text: z.string().min(1).max(3000).transform(sanitizeText)
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    await requireUserId();

    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      console.error("read_aloud_missing_api_key");
      return NextResponse.json({ error: "TTS not configured" }, { status: 500 });
    }

    const payload = await request.json();
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { status: "invalid", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const openai = new OpenAI({ apiKey });

    const speech = await openai.audio.speech.create({
      model: "gpt-4o-mini-tts",
      voice: "alloy",
      input: parsed.data.text,
      response_format: "mp3"
    });

    const audioBuffer = Buffer.from(await speech.arrayBuffer());

    return new Response(audioBuffer, {
      status: 200,
      headers: {
        "Content-Type": "audio/mpeg",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    console.error("read_aloud_failed", error);
    return NextResponse.json(
      { error: "Text-to-speech failed" },
      { status: 500 }
    );
  }
}
