#!/usr/bin/env node

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TRANSLATION = "amp";
const DEFAULT_OUTPUT_ROOT = "generated-audio";
const DEFAULT_SOURCE = "api";
const API_BIBLE_ROOT = "https://rest.api.bible/v1";

const BOOKS = {
  john: { name: "John", code: "JHN", chapters: 21 },
  romans: { name: "Romans", code: "ROM", chapters: 16 },
  psalms: { name: "Psalms", code: "PSA", chapters: 150 },
  proverbs: { name: "Proverbs", code: "PRO", chapters: 31 },
  ruth: { name: "Ruth", code: "RUT", chapters: 4 },
  ecclesiastes: { name: "Ecclesiastes", code: "ECC", chapters: 12 },
  esther: { name: "Esther", code: "EST", chapters: 10 },
  ephesians: { name: "Ephesians", code: "EPH", chapters: 6 },
  philippians: { name: "Philippians", code: "PHP", chapters: 4 },
  colossians: { name: "Colossians", code: "COL", chapters: 4 },
  james: { name: "James", code: "JAS", chapters: 5 },
  "1-john": { name: "1 John", code: "1JN", chapters: 5 },
  "1-pete": { name: "1 Peter", code: "1PE", chapters: 5 },
  "1-peter": { name: "1 Peter", code: "1PE", chapters: 5 }
};

const DEFAULT_BIBLE_IDS = {
  amp: "a81b73293d3080c9-01"
};

const usage = `
Usage:
  npm run audio:book -- --translation amp --book John --source api

Options:
  --translation amp       Translation folder/name. Default: amp
  --book John             Bible book name. Required
  --source api            Source for chapter text. Default: api
  --out generated-audio   Output audio root. Default: generated-audio
  --concurrency 1         Chapters to generate at once. Default: 1
  --force                 Regenerate chapters that already have manifest.json and audio segments
  --dry-run               Print the generation plan without fetching text or calling OpenAI

Required for --source api:
  BIBLE_API_KEY
  AMP_BIBLE_ID            Optional; defaults to the AMP Bible ID already used by the app
`;

function parseArgs(argv) {
  const args = {
    translation: DEFAULT_TRANSLATION,
    source: DEFAULT_SOURCE,
    out: DEFAULT_OUTPUT_ROOT,
    concurrency: 1,
    force: false,
    dryRun: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--force") {
      args.force = true;
      continue;
    }

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    index += 1;
    args[key] = value;
  }

  if (!args.book) {
    throw new Error("Missing required --book.");
  }

  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8.");
  }

  return { ...args, concurrency };
}

async function loadLocalEnv() {
  for (const filename of [".env.local", ".env"]) {
    try {
      const file = await fs.readFile(filename, "utf8");
      for (const line of file.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
          continue;
        }

        const [rawKey, ...rawValueParts] = trimmed.split("=");
        const key = rawKey.trim();
        const value = rawValueParts.join("=").trim().replace(/^["']|["']$/g, "");
        if (key && process.env[key] === undefined) {
          process.env[key] = value;
        }
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        throw error;
      }
    }
  }
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function decodeHtmlEntities(value) {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }

    return {
      amp: "&",
      gt: ">",
      lt: "<",
      nbsp: " ",
      quot: "\"",
      apos: "'"
    }[key] ?? match;
  });
}

function htmlToReadableChapterText(html) {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:p|div|section|article|header|footer|h[1-6]|br)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|h[1-6])>/gi, "\n")
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, " $1 ")
    .replace(/<span\b[^>]*class=["'][^"']*(?:verse|v|label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function getBook(value) {
  const slug = slugify(value);
  const book = BOOKS[slug];
  if (!book) {
    throw new Error(`Unsupported book for API generation: ${value}. Supported now: ${Object.values(BOOKS).map((item) => item.name).join(", ")}.`);
  }
  return book;
}

function getBibleId(translationSlug) {
  const envKey = `${translationSlug.toUpperCase()}_BIBLE_ID`;
  const bibleId = process.env[envKey]?.trim() ?? DEFAULT_BIBLE_IDS[translationSlug];
  if (!bibleId) {
    throw new Error(`${envKey} is required for ${translationSlug.toUpperCase()} API import.`);
  }
  return bibleId;
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function hasGeneratedChapter(chapterDir) {
  const manifestPath = path.join(chapterDir, "manifest.json");
  const audioDir = path.join(chapterDir, "audio");
  if (!(await fileExists(manifestPath))) {
    return false;
  }

  try {
    const entries = await fs.readdir(audioDir, { withFileTypes: true });
    return entries.some((entry) => entry.isFile() && /^segment-\d+\.mp3$/i.test(entry.name));
  } catch {
    return false;
  }
}

async function fetchChapterText({ apiKey, bibleId, bookCode, chapter }) {
  const chapterId = `${bookCode}.${chapter}`;
  const url = `${API_BIBLE_ROOT}/bibles/${encodeURIComponent(bibleId)}/chapters/${encodeURIComponent(chapterId)}?content-type=html&include-notes=false&include-titles=true&include-chapter-numbers=true`;
  const response = await fetch(url, {
    headers: { "api-key": apiKey },
    cache: "no-store"
  });

  if (!response.ok) {
    const body = (await response.text()).replace(/\s+/g, " ").trim();
    throw new Error(`API.Bible chapter fetch failed for ${chapterId} (${response.status}): ${body.slice(0, 260)}`);
  }

  const json = await response.json();
  const html = json?.data?.content ?? "";
  const text = htmlToReadableChapterText(html);
  if (!text) {
    throw new Error(`API.Bible returned no chapter text for ${chapterId}.`);
  }

  return text;
}

function runNodeScript(args) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: process.cwd(),
      env: process.env,
      stdio: "inherit"
    });

    child.on("close", (code) => resolve(code ?? 1));
  });
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadLocalEnv();

  const translationSlug = slugify(options.translation);
  const book = getBook(options.book);
  const bookSlug = slugify(book.name);
  const summary = {
    generated: 0,
    planned: 0,
    skippedExisting: 0,
    failed: 0
  };

  if (options.source !== "api") {
    throw new Error(`Unsupported --source ${options.source}. Use --source api.`);
  }

  console.log(`Preparing ${translationSlug.toUpperCase()} ${book.name} audio from API.Bible`);
  console.log(`Chapters: 1-${book.chapters}`);
  console.log(`Generation concurrency: ${options.concurrency}`);

  if (options.dryRun) {
    for (let chapter = 1; chapter <= book.chapters; chapter += 1) {
      const outputDir = path.join(options.out, translationSlug, bookSlug, String(chapter));
      console.log(`[dry-run] API ${book.code}.${chapter} -> ${outputDir}`);
      summary.planned += 1;
    }
    console.log("Book generation summary");
    console.log(`Planned: ${summary.planned}`);
    console.log("Fetched text: 0");
    console.log("OpenAI calls: 0");
    return;
  }

  const apiKey = process.env.BIBLE_API_KEY?.trim();
  if (!apiKey) {
    throw new Error("BIBLE_API_KEY is required for --source api. Add it to .env.local or export it in your shell.");
  }

  const bibleId = getBibleId(translationSlug);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), `bible-audio-${translationSlug}-${bookSlug}-`));
  const chapters = Array.from({ length: book.chapters }, (_value, index) => index + 1);
  let nextChapterIndex = 0;

  async function processChapter(chapter) {
    const outputDir = path.join(options.out, translationSlug, bookSlug, String(chapter));
    if (!options.force && await hasGeneratedChapter(outputDir)) {
      summary.skippedExisting += 1;
      console.log(`Skipping ${book.name} ${chapter}: already generated`);
      return;
    }

    try {
      console.log(`Fetching ${book.name} ${chapter}`);
      const text = await fetchChapterText({
        apiKey,
        bibleId,
        bookCode: book.code,
        chapter
      });
      const tempInputPath = path.join(tempDir, `${chapter}.txt`);
      await fs.writeFile(tempInputPath, `${text}\n`);

      console.log(`Generating ${book.name} ${chapter}`);
      const code = await runNodeScript([
        "scripts/generate-chapter-audio.mjs",
        "--translation", translationSlug,
        "--book", book.name,
        "--chapter", String(chapter),
        "--input", tempInputPath,
        "--out", options.out
      ]);

      if (code === 0) {
        summary.generated += 1;
      } else {
        summary.failed += 1;
      }
    } catch (error) {
      summary.failed += 1;
      console.error(error instanceof Error ? error.message : String(error));
    }
  }

  async function worker() {
    while (nextChapterIndex < chapters.length) {
      const chapter = chapters[nextChapterIndex];
      nextChapterIndex += 1;
      await processChapter(chapter);
    }
  }

  const workerCount = Math.min(options.concurrency, chapters.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  await fs.rm(tempDir, { recursive: true, force: true });

  console.log("Book generation summary");
  console.log(`Generated: ${summary.generated}`);
  console.log(`Skipped existing: ${summary.skippedExisting}`);
  console.log(`Failed: ${summary.failed}`);

  if (summary.failed > 0) {
    process.exit(1);
  }
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage.trim());
  process.exit(1);
});
