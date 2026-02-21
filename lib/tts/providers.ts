export type TtsRequest = {
  text: string;
  voiceProfile: string;
  modelVersion: string;
};

export type TtsResponse = {
  audioBuffer: Buffer;
  mimeType: string;
  provider: "openai" | "elevenlabs";
  modelVersion: string;
};

export interface TtsProvider {
  synthesize(request: TtsRequest): Promise<TtsResponse>;
}

class OpenAiTtsProvider implements TtsProvider {
  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    const response = await fetch("https://api.openai.com/v1/audio/speech", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: request.modelVersion,
        voice: request.voiceProfile,
        input: request.text,
        response_format: "mp3"
      })
    });

    if (!response.ok) {
      throw new Error(`OpenAI synthesis failed (${response.status})`);
    }

    const bytes = await response.arrayBuffer();
    return {
      audioBuffer: Buffer.from(bytes),
      mimeType: "audio/mpeg",
      provider: "openai",
      modelVersion: request.modelVersion
    };
  }
}

class ElevenLabsTtsProvider implements TtsProvider {
  async synthesize(request: TtsRequest): Promise<TtsResponse> {
    const voiceId = process.env.ELEVENLABS_VOICE_ID ?? "EXAVITQu4vr4xnSDxMaL";
    const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`, {
      method: "POST",
      headers: {
        "xi-api-key": `${process.env.ELEVENLABS_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        text: request.text,
        model_id: "eleven_multilingual_v2"
      })
    });

    if (!response.ok) {
      throw new Error(`ElevenLabs synthesis failed (${response.status})`);
    }

    const bytes = await response.arrayBuffer();
    return {
      audioBuffer: Buffer.from(bytes),
      mimeType: "audio/mpeg",
      provider: "elevenlabs",
      modelVersion: request.modelVersion
    };
  }
}

export async function synthesizeWithFallback(request: TtsRequest): Promise<TtsResponse> {
  const openAi = new OpenAiTtsProvider();
  const elevenLabs = new ElevenLabsTtsProvider();

  try {
    return await openAi.synthesize(request);
  } catch (error) {
    console.warn("openai_tts_failed", { error: String(error) });
    return elevenLabs.synthesize(request);
  }
}
