import { createHash } from "node:crypto";

export type AudioHashInput = {
  text: string;
  translation: string;
  voiceProfile: string;
  voiceSettingsVersion: string;
  provider: string;
  modelVersion: string;
};

export function buildAudioHash(input: AudioHashInput): string {
  const payload = [
    input.text,
    input.translation,
    input.voiceProfile,
    input.voiceSettingsVersion,
    input.provider,
    input.modelVersion
  ].join("|");

  return createHash("sha256").update(payload).digest("hex");
}
