import fs from "node:fs/promises";
import path from "node:path";

export type ChapterAudioPart = {
  part: number;
  fileName: string;
  path: string;
  url: string;
};

export type ChapterAudioManifest = {
  translation: string;
  book: string;
  chapter: number;
  model?: string;
  voice?: string;
  speed?: number;
  instructions?: string;
  generatedAt?: string;
  audioParts: ChapterAudioPart[];
};

export type ChapterAudioLoadResult = {
  manifest: ChapterAudioManifest | null;
  attemptedPath: string;
  missingFiles: string[];
  translation: string;
};

const AUDIO_ROOT = path.resolve(process.cwd(), "generated-audio");

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function toDisplayBook(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function normalizePart(value: unknown, index: number, translation: string, book: string, chapter: number): ChapterAudioPart | null {
  const bookSlug = slugify(book);
  const fileName = isObject(value)
    ? String(value.fileName ?? path.basename(String(value.path ?? value.url ?? "")))
    : path.basename(String(value));

  if (!/^part-\d+\.mp3$/i.test(fileName)) {
    return null;
  }

  const localPath = isObject(value) && typeof value.path === "string"
    ? value.path
    : path.join("generated-audio", translation, bookSlug, String(chapter), fileName);

  return {
    part: isObject(value) && typeof value.part === "number" ? value.part : index + 1,
    fileName,
    path: localPath,
    url: `/api/generated-audio/${translation}/${bookSlug}/${chapter}/${fileName}`
  };
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

export function resolveGeneratedAudioFile(translation: string, book: string, chapter: string, fileName: string): string | null {
  const translationSlug = slugify(translation);
  const bookSlug = slugify(book);

  if (!translationSlug || !bookSlug || !/^\d+$/.test(chapter) || !/^part-\d+\.mp3$/i.test(fileName)) {
    return null;
  }

  const resolved = path.resolve(AUDIO_ROOT, translationSlug, bookSlug, chapter, fileName);
  if (!resolved.startsWith(`${AUDIO_ROOT}${path.sep}`)) {
    return null;
  }

  return resolved;
}

export async function loadChapterAudioManifest(
  book: string,
  chapter: string,
  requestedTranslation?: string
): Promise<ChapterAudioLoadResult> {
  const bookSlug = slugify(book);
  const chapterSlug = String(Number(chapter));
  const translations = requestedTranslation
    ? [slugify(requestedTranslation)]
    : ["amp", "ampc"];

  for (const translation of translations) {
    const manifestPath = path.join(AUDIO_ROOT, translation, bookSlug, chapterSlug, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const parsedObject = isObject(parsed) ? parsed : {};
      const parsedParts = Array.isArray(parsedObject.audioParts) ? parsedObject.audioParts : [];
      const displayBook = typeof parsedObject.book === "string" ? parsedObject.book : toDisplayBook(bookSlug);
      const manifestTranslation = typeof parsedObject.translation === "string"
        ? slugify(parsedObject.translation)
        : translation;
      const manifestChapter = typeof parsedObject.chapter === "number"
        ? parsedObject.chapter
        : Number(chapterSlug);

      const audioParts = parsedParts
        .map((part, index) => normalizePart(part, index, manifestTranslation, displayBook, manifestChapter))
        .filter((part): part is ChapterAudioPart => Boolean(part));

      const missingFiles: string[] = [];
      for (const part of audioParts) {
        const resolvedPart = resolveGeneratedAudioFile(manifestTranslation, bookSlug, String(manifestChapter), part.fileName);
        if (!resolvedPart || !(await fileExists(resolvedPart))) {
          missingFiles.push(part.fileName);
        }
      }

      return {
        manifest: {
          translation: manifestTranslation,
          book: displayBook,
          chapter: manifestChapter,
          model: typeof parsedObject.model === "string" ? parsedObject.model : undefined,
          voice: typeof parsedObject.voice === "string" ? parsedObject.voice : undefined,
          speed: typeof parsedObject.speed === "number" ? parsedObject.speed : undefined,
          instructions: typeof parsedObject.instructions === "string" ? parsedObject.instructions : undefined,
          generatedAt: typeof parsedObject.generatedAt === "string" ? parsedObject.generatedAt : undefined,
          audioParts
        },
        attemptedPath: manifestPath,
        missingFiles,
        translation: manifestTranslation
      };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
  }

  const fallbackTranslation = translations[0] ?? "amp";
  return {
    manifest: null,
    attemptedPath: path.join(AUDIO_ROOT, fallbackTranslation, bookSlug, chapterSlug, "manifest.json"),
    missingFiles: [],
    translation: fallbackTranslation
  };
}
