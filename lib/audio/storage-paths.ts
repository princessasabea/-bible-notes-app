export const FIREBASE_AUDIO_ROOT = "bible-audio";

export function slugifyAudioPath(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function buildChapterAudioFolder(translation: string, book: string, chapter: string | number): string {
  return `${FIREBASE_AUDIO_ROOT}/${slugifyAudioPath(translation)}/${slugifyAudioPath(book)}/${chapter}`;
}

export function buildChapterManifestPath(translation: string, book: string, chapter: string | number): string {
  return `${buildChapterAudioFolder(translation, book, chapter)}/manifest.json`;
}

export function buildChapterSegmentPath(
  translation: string,
  book: string,
  chapter: string | number,
  segment: string | number
): string {
  const segmentNumber = typeof segment === "number"
    ? segment
    : Number(String(segment).replace(/\D/g, ""));

  return `${buildChapterAudioFolder(translation, book, chapter)}/audio/segment-${segmentNumber}.mp3`;
}
