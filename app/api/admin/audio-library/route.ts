import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

export const runtime = "nodejs";

const TRANSLATIONS = ["amp", "ampc", "nkjv", "kjv", "esv"] as const;
const AUDIO_ROOT = path.resolve(process.cwd(), "generated-audio");
const CHAPTER_ROOT = path.resolve(process.cwd(), "local-chapters");
const MAX_CHAPTER_TEXT_LENGTH = 150_000;

const payloadSchema = z.object({
  action: z.enum(["save", "generate", "upload", "status"]),
  translation: z.enum(TRANSLATIONS).default("amp"),
  book: z.string().min(1).transform(sanitizeText),
  chapter: z.number().int().min(1),
  text: z.string().max(MAX_CHAPTER_TEXT_LENGTH).optional()
});

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function chapterTextPath(translation: string, book: string, chapter: number): string {
  return path.join(CHAPTER_ROOT, translation, slugify(book), `${chapter}.txt`);
}

function chapterGeneratedDir(translation: string, book: string, chapter: number): string {
  return path.join(AUDIO_ROOT, translation, slugify(book), String(chapter));
}

function publicSegmentUrl(translation: string, book: string, chapter: number, segment: number): string {
  return `/api/generated-audio/${translation}/${slugify(book)}/${chapter}/audio/segment-${segment}.mp3`;
}

function expectedFirebaseManifestPath(translation: string, book: string, chapter: number): string {
  return `bible-audio/${translation}/${slugify(book)}/${chapter}/manifest.json`;
}

function warningForTranslation(translation: string, text: string): string | null {
  const lower = text.toLowerCase();
  const signals: Record<string, string[]> = {
    amp: ["new king james", "nkjv", "king james version", " kjv ", "english standard version", " esv "],
    nkjv: ["amplified bible", " amplified ", " esv ", "english standard version"],
    kjv: ["amplified bible", "new king james", "nkjv", "english standard version", " esv "],
    esv: ["amplified bible", "new king james", "nkjv", "king james version", " kjv "],
    ampc: ["new king james", "nkjv", "king james version", " kjv ", "english standard version", " esv "]
  };

  return signals[translation]?.some((signal) => lower.includes(signal))
    ? `This text may not match ${translation.toUpperCase()}. Double-check the source before generating narration.`
    : null;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listGeneratedSegments(chapterDir: string): Promise<string[]> {
  try {
    const entries = await fs.readdir(path.join(chapterDir, "audio"), { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^segment-\d+\.mp3$/i.test(entry.name))
      .map((entry) => entry.name)
      .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
  } catch {
    return [];
  }
}

function runNodeScript(args: string[]): Promise<{ code: number; output: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env
    });
    const chunks: string[] = [];

    child.stdout.on("data", (chunk) => chunks.push(chunk.toString()));
    child.stderr.on("data", (chunk) => chunks.push(chunk.toString()));
    child.on("close", (code) => resolve({ code: code ?? 1, output: chunks.join("") }));
  });
}

async function loadStatus(translation: string, book: string, chapter: number): Promise<Record<string, unknown>> {
  const inputPath = chapterTextPath(translation, book, chapter);
  const generatedDir = chapterGeneratedDir(translation, book, chapter);
  const manifestPath = path.join(generatedDir, "manifest.json");
  const segments = await listGeneratedSegments(generatedDir);

  return {
    inputPath: path.relative(process.cwd(), inputPath),
    manifestPath: path.relative(process.cwd(), manifestPath),
    expectedFirebasePath: expectedFirebaseManifestPath(translation, book, chapter),
    hasChapterText: await fileExists(inputPath),
    hasManifest: await fileExists(manifestPath),
    generatedSegments: segments,
    previewUrl: segments.length > 0 ? publicSegmentUrl(translation, book, chapter, 1) : null,
    canUpload: segments.length > 0 && await fileExists(manifestPath),
    hasServiceAccount: await fileExists(path.join(process.cwd(), "serviceAccountKey.json"))
  };
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const payload = await request.json();
    const parsed = payloadSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const { action, translation, book, chapter } = parsed.data;
    const bookSlug = slugify(book);
    const inputPath = chapterTextPath(translation, book, chapter);

    if (action === "status") {
      return NextResponse.json({ status: "ok", ...(await loadStatus(translation, book, chapter)) });
    }

    if (action === "save") {
      const text = parsed.data.text?.trim() ?? "";
      if (text.length < 20) {
        return NextResponse.json({ status: "invalid", message: "Paste the full chapter text before saving." }, { status: 400 });
      }

      await fs.mkdir(path.dirname(inputPath), { recursive: true });
      await fs.writeFile(inputPath, `${text}\n`);
      const estimatedSegments = Math.max(1, Math.ceil(text.length / 3800));

      return NextResponse.json({
        status: "saved",
        inputPath: path.relative(process.cwd(), inputPath),
        estimatedSegments,
        warning: warningForTranslation(translation, text),
        ...(await loadStatus(translation, book, chapter))
      });
    }

    if (!(await fileExists(inputPath))) {
      return NextResponse.json({
        status: "missing_text",
        message: `Save chapter text first at local-chapters/${translation}/${bookSlug}/${chapter}.txt.`,
        ...(await loadStatus(translation, book, chapter))
      }, { status: 400 });
    }

    if (action === "generate") {
      const result = await runNodeScript([
        "scripts/generate-chapter-audio.mjs",
        "--translation", translation,
        "--book", book,
        "--chapter", String(chapter),
        "--input", path.relative(process.cwd(), inputPath)
      ]);

      if (result.code !== 0) {
        return NextResponse.json({ status: "generation_failed", log: result.output }, { status: 500 });
      }

      return NextResponse.json({ status: "generated", log: result.output, ...(await loadStatus(translation, book, chapter)) });
    }

    const status = await loadStatus(translation, book, chapter);
    if (!status.canUpload) {
      return NextResponse.json({
        status: "missing_audio",
        message: "Generate narration before uploading.",
        ...status
      }, { status: 400 });
    }

    const uploadArgs = [
      "scripts/upload-chapter-audio.mjs",
      "--translation", translation,
      "--book", book,
      "--chapter", String(chapter)
    ];
    if (await fileExists(path.join(process.cwd(), "serviceAccountKey.json"))) {
      uploadArgs.push("--service-account", "./serviceAccountKey.json");
    }
    const result = await runNodeScript(uploadArgs);

    if (result.code !== 0) {
      return NextResponse.json({ status: "upload_failed", log: result.output }, { status: 500 });
    }

    return NextResponse.json({ status: "uploaded", log: result.output, ...(await loadStatus(translation, book, chapter)) });
  } catch (error) {
    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ status: "forbidden", message: "Origin mismatch" }, { status: 403 });
    }

    console.error("audio_library_admin_failed", { error: String(error) });
    return NextResponse.json({ status: "error", message: "Audio library action failed." }, { status: 500 });
  }
}
