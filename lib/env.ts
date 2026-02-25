export const env = {
  allowVerseSnippetStorage: process.env.ALLOW_VERSE_SNIPPET_STORAGE === "true",
  bibleProvider: process.env.BIBLE_PROVIDER ?? "mock",
  ttsMaxChars: Number(process.env.TTS_MAX_CHARS ?? "2000"),
  ttsUserBurstLimit: Number(process.env.TTS_USER_BURST_LIMIT ?? "120"),
  ttsUserBurstWindowMs: Number(process.env.TTS_USER_BURST_WINDOW_MS ?? "60000"),
  ttsUserSustainedLimit: Number(process.env.TTS_USER_SUSTAINED_LIMIT ?? "1500"),
  ttsUserSustainedWindowMs: Number(process.env.TTS_USER_SUSTAINED_WINDOW_MS ?? "3600000"),
  ttsIpBurstLimit: Number(process.env.TTS_IP_BURST_LIMIT ?? "240"),
  ttsIpBurstWindowMs: Number(process.env.TTS_IP_BURST_WINDOW_MS ?? "60000"),
  audioCacheMaxRows: Number(process.env.AUDIO_CACHE_MAX_ROWS ?? "2000"),
  authUrl:
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
};
