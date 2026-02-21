export const env = {
  allowVerseSnippetStorage: process.env.ALLOW_VERSE_SNIPPET_STORAGE === "true",
  bibleProvider: process.env.BIBLE_PROVIDER ?? "mock",
  ttsMaxChars: Number(process.env.TTS_MAX_CHARS ?? "2000"),
  audioCacheMaxRows: Number(process.env.AUDIO_CACHE_MAX_ROWS ?? "2000"),
  authUrl:
    process.env.NEXTAUTH_URL ??
    process.env.AUTH_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000")
};
