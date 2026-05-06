import fs from "node:fs/promises";
import path from "node:path";
import { slugifyAudioPath } from "@/lib/audio/storage-paths";

export type ChapterAudioPart = {
  part: number;
  fileName: string;
  path: string;
  url: string;
  storagePath?: string;
  source?: "local" | "firebase";
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
  verses?: Array<{
    number: number;
    start?: number;
    end?: number;
    estimated?: boolean;
  }>;
};

export type ChapterAudioLoadResult = {
  manifest: ChapterAudioManifest | null;
  attemptedPath: string;
  missingFiles: string[];
  translation: string;
};

const AUDIO_ROOT = path.resolve(process.cwd(), "generated-audio");

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
  const bookSlug = slugifyAudioPath(book);
  const fileName = isObject(value)
    ? String(value.fileName ?? path.basename(String(value.path ?? value.url ?? "")))
    : path.basename(String(value));

  if (!/^(part|segment)-\d+\.mp3$/i.test(fileName)) {
    return null;
  }

  const localPath = isObject(value) && typeof value.path === "string"
    ? value.path
    : fileName.startsWith("segment-")
      ? path.join("generated-audio", translation, bookSlug, String(chapter), "audio", fileName)
      : path.join("generated-audio", translation, bookSlug, String(chapter), fileName);

  const publicPath = localPath.includes(`${path.sep}audio${path.sep}`) || localPath.includes("/audio/")
    ? `/api/generated-audio/${translation}/${bookSlug}/${chapter}/audio/${fileName}`
    : `/api/generated-audio/${translation}/${bookSlug}/${chapter}/${fileName}`;

  return {
    part: isObject(value) && typeof value.part === "number" ? value.part : index + 1,
    fileName,
    path: localPath,
    source: "local",
    url: publicPath
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
  const translationSlug = slugifyAudioPath(translation);
  const bookSlug = slugifyAudioPath(book);
  const filePath = fileName.split("/").filter(Boolean);

  if (
    !translationSlug ||
    !bookSlug ||
    !/^\d+$/.test(chapter) ||
    filePath.some((part) => part === "." || part === "..") ||
    !/^(part|segment)-\d+\.mp3$/i.test(filePath.at(-1) ?? "")
  ) {
    return null;
  }

  const resolved = path.resolve(AUDIO_ROOT, translationSlug, bookSlug, chapter, ...filePath);
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
  const bookSlug = slugifyAudioPath(book);
  const chapterSlug = String(Number(chapter));
  const translations = requestedTranslation
    ? [slugifyAudioPath(requestedTranslation)]
    : ["amp", "ampc"];

  for (const translation of translations) {
    const manifestPath = path.join(AUDIO_ROOT, translation, bookSlug, chapterSlug, "manifest.json");
    try {
      const raw = await fs.readFile(manifestPath, "utf8");
      const parsed: unknown = JSON.parse(raw);
      const parsedObject = isObject(parsed) ? parsed : {};
      const parsedParts = Array.isArray(parsedObject.audioParts)
        ? parsedObject.audioParts
        : Array.isArray(parsedObject.audio)
          ? parsedObject.audio
          : [];
      const displayBook = typeof parsedObject.book === "string" ? parsedObject.book : toDisplayBook(bookSlug);
      const manifestTranslation = typeof parsedObject.translation === "string"
        ? slugifyAudioPath(parsedObject.translation)
        : translation;
      const manifestChapter = typeof parsedObject.chapter === "number"
        ? parsedObject.chapter
        : Number(chapterSlug);

      const audioParts = parsedParts
        .map((part, index) => normalizePart(part, index, manifestTranslation, displayBook, manifestChapter))
        .filter((part): part is ChapterAudioPart => Boolean(part));

      const missingFiles: string[] = [];
      for (const part of audioParts) {
        const localPartPath = part.path.replace(/^generated-audio[\\/]/, "");
        const relativeToChapter = localPartPath
          .replace(`${manifestTranslation}${path.sep}${bookSlug}${path.sep}${manifestChapter}${path.sep}`, "")
          .replace(`${manifestTranslation}/${bookSlug}/${manifestChapter}/`, "");
        const resolvedPart = resolveGeneratedAudioFile(manifestTranslation, bookSlug, String(manifestChapter), relativeToChapter);
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
          audioParts,
          verses: Array.isArray(parsedObject.verses) ? parsedObject.verses as ChapterAudioManifest["verses"] : []
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
