import { describe, expect, it } from "vitest";
import { buildAudioHash } from "@/lib/tts/hash";

describe("buildAudioHash", () => {
  const base = {
    text: "For God so loved the world",
    translation: "AMP",
    voiceProfile: "cedar",
    voiceSettingsVersion: "v1",
    provider: "openai-elevenlabs",
    modelVersion: "gpt-4o-mini-tts-2025-12-15"
  };

  it("is stable for identical input", () => {
    expect(buildAudioHash(base)).toBe(buildAudioHash(base));
  });

  it("changes when voice settings change", () => {
    const original = buildAudioHash(base);
    const updated = buildAudioHash({ ...base, voiceSettingsVersion: "v2" });
    expect(original).not.toBe(updated);
  });
});
