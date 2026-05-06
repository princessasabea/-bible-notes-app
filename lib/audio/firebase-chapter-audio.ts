import { getDownloadURL, ref } from "firebase/storage";
import type { ChapterAudioManifest, ChapterAudioPart } from "@/lib/audio/chapter-audio";
import { FIREBASE_AUDIO_ROOT, buildChapterManifestPath, buildChapterSegmentPath, slugifyAudioPath } from "@/lib/audio/storage-paths";
import { getFirebaseStorageClient, hasFirebaseConfig } from "@/lib/firebase";

type FirebaseManifestPart = {
  part?: number;
  segment?: number;
  fileName?: string;
  storagePath?: string;
  path?: string;
  url?: string;
};

type FirebaseManifestShape = {
  translation?: string;
  book?: string;
  chapter?: number;
  model?: string;
  voice?: string;
  speed?: number;
  instructions?: string;
  generatedAt?: string;
  audioParts?: Array<string | FirebaseManifestPart>;
  segments?: Array<string | FirebaseManifestPart>;
};

export type FirebaseChapterAudioResult = {
  manifest: ChapterAudioManifest | null;
  expectedManifestPath: string;
  expectedFolderPath: string;
  errorMessage: string | null;
};

export type FirebaseAudioLibrary = {
  translation: string;
  updatedAt?: string;
  books: Record<string, number[]>;
};

export type FirebaseAudioLibraryResult = {
  library: FirebaseAudioLibrary | null;
  expectedLibraryPath: string;
  hasChapter: boolean;
  errorMessage: string | null;
};

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function displayBookFromSlug(value: string): string {
  return value
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function getPartNumber(value: string | FirebaseManifestPart, index: number): number {
  if (typeof value === "object") {
    return value.segment ?? value.part ?? index + 1;
  }

  const match = value.match(/(?:segment|part|chunk)-(\d+)\.mp3$/i);
  return match ? Number(match[1]) : index + 1;
}

async function normalizeFirebasePart(
  value: string | FirebaseManifestPart,
  index: number,
  translation: string,
  book: string,
  chapter: number,
  chapterFolderPath: string
): Promise<ChapterAudioPart> {
  const part = getPartNumber(value, index);
  const rawPath = typeof value === "string"
    ? value
    : value.storagePath ?? value.path ?? buildChapterSegmentPath(translation, book, chapter, part);
  const storagePath = rawPath.startsWith("bible-audio/")
    ? rawPath
    : `${chapterFolderPath}/${rawPath.replace(/^\/+/, "")}`;
  const fileName = typeof value === "string"
    ? storagePath.split("/").at(-1) ?? `segment-${part}.mp3`
    : value.fileName ?? storagePath.split("/").at(-1) ?? `segment-${part}.mp3`;

  return {
    part,
    fileName,
    path: storagePath,
    storagePath,
    source: "firebase",
    url: typeof value === "object" && value.url
      ? value.url
      : await getDownloadURL(ref(getFirebaseStorageClientOrThrow(), storagePath))
  };
}

function getFirebaseStorageClientOrThrow() {
  const storage = getFirebaseStorageClient();
  if (!storage) {
    throw new Error("Firebase config is missing.");
  }
  return storage;
}

export function buildFirebaseLibraryPath(translation: string): string {
  return `${FIREBASE_AUDIO_ROOT}/${slugifyAudioPath(translation)}/library.json`;
}

export async function loadFirebaseAudioLibrary(
  translation: string,
  book?: string,
  chapter?: number
): Promise<FirebaseAudioLibraryResult> {
  const translationSlug = slugifyAudioPath(translation);
  const expectedLibraryPath = buildFirebaseLibraryPath(translationSlug);

  if (!hasFirebaseConfig()) {
    return {
      library: null,
      expectedLibraryPath,
      hasChapter: false,
      errorMessage: "Firebase config is missing from NEXT_PUBLIC_FIREBASE_* environment variables."
    };
  }

  try {
    const storage = getFirebaseStorageClientOrThrow();
    const libraryUrl = await getDownloadURL(ref(storage, expectedLibraryPath));
    const response = await fetch(libraryUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Library request failed (${response.status}).`);
    }

    const parsed: unknown = await response.json();
    const object = isObject(parsed) ? parsed : {};
    const books = isObject(object.books) ? object.books : {};
    const normalizedBooks = Object.fromEntries(
      Object.entries(books).map(([bookSlug, chapters]) => [
        slugifyAudioPath(bookSlug),
        Array.isArray(chapters)
          ? chapters.map((value) => Number(value)).filter((value) => Number.isInteger(value) && value > 0).sort((a, b) => a - b)
          : []
      ])
    );
    const bookSlug = book ? slugifyAudioPath(book) : "";

    return {
      library: {
        translation: typeof object.translation === "string" ? slugifyAudioPath(object.translation) : translationSlug,
        updatedAt: typeof object.updatedAt === "string" ? object.updatedAt : undefined,
        books: normalizedBooks
      },
      expectedLibraryPath,
      hasChapter: Boolean(bookSlug && chapter && normalizedBooks[bookSlug]?.includes(chapter)),
      errorMessage: null
    };
  } catch (error) {
    return {
      library: null,
      expectedLibraryPath,
      hasChapter: false,
      errorMessage: error instanceof Error ? error.message : "Firebase audio library could not be loaded."
    };
  }
}

export async function loadFirebaseChapterAudioManifest(
  book: string,
  chapter: number,
  translation: string
): Promise<FirebaseChapterAudioResult> {
  const translationSlug = slugifyAudioPath(translation);
  const bookSlug = slugifyAudioPath(book);
  const expectedManifestPath = buildChapterManifestPath(translationSlug, bookSlug, chapter);
  const expectedFolderPath = expectedManifestPath.replace(/\/manifest\.json$/, "");

  if (!hasFirebaseConfig()) {
    return {
      manifest: null,
      expectedManifestPath,
      expectedFolderPath,
      errorMessage: "Firebase config is missing from NEXT_PUBLIC_FIREBASE_* environment variables."
    };
  }

  try {
    const storage = getFirebaseStorageClientOrThrow();
    const manifestUrl = await getDownloadURL(ref(storage, expectedManifestPath));
    const response = await fetch(manifestUrl, { cache: "no-store" });
    if (!response.ok) {
      throw new Error(`Manifest request failed (${response.status}).`);
    }

    const parsed: unknown = await response.json();
    const manifestObject = isObject(parsed) ? parsed as FirebaseManifestShape : {};
    const parts = manifestObject.audioParts ?? manifestObject.segments ?? [];
    const manifestTranslation = slugifyAudioPath(manifestObject.translation ?? translationSlug);
    const manifestBook = manifestObject.book ?? displayBookFromSlug(bookSlug);
    const manifestChapter = manifestObject.chapter ?? chapter;

    const audioParts = await Promise.all(
      parts.map((part, index) => normalizeFirebasePart(
        part,
        index,
        manifestTranslation,
        manifestBook,
        manifestChapter,
        expectedFolderPath
      ))
    );

    if (audioParts.length === 0) {
      throw new Error("Manifest did not include audioParts or segments.");
    }

    return {
      manifest: {
        translation: manifestTranslation,
        book: manifestBook,
        chapter: manifestChapter,
        model: manifestObject.model,
        voice: manifestObject.voice,
        speed: manifestObject.speed,
        instructions: manifestObject.instructions,
        generatedAt: manifestObject.generatedAt,
        audioParts
      },
      expectedManifestPath,
      expectedFolderPath,
      errorMessage: null
    };
  } catch (error) {
    return {
      manifest: null,
      expectedManifestPath,
      expectedFolderPath,
      errorMessage: error instanceof Error ? error.message : "Firebase chapter audio could not be loaded."
    };
  }
}
