#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TRANSLATION = "amp";
const DEFAULT_SOURCE_ROOT = "local-chapters";
const DEFAULT_OUTPUT_ROOT = "generated-audio";
const DEFAULT_BOOKS = ["John", "Romans", "Ephesians", "Philippians", "James"];

const usage = `
Usage:
  npm run audio:batch -- --translation amp --books John,Romans,Ephesians,Philippians,James

Options:
  --translation amp       Translation folder/name. Default: amp
  --books John,Romans     Comma-separated books. Default: John,Romans,Ephesians,Philippians,James
  --source local-chapters Source text root. Default: local-chapters
  --out generated-audio   Output audio root. Default: generated-audio
  --force                 Regenerate chapters that already have manifest.json and audio segments
  --dry-run               Print the generation plan without calling OpenAI
`;

function parseArgs(argv) {
  const args = {
    translation: DEFAULT_TRANSLATION,
    books: DEFAULT_BOOKS.join(","),
    source: DEFAULT_SOURCE_ROOT,
    out: DEFAULT_OUTPUT_ROOT,
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

  return {
    ...args,
    books: args.books.split(",").map((book) => book.trim()).filter(Boolean)
  };
}

function slugify(value) {
  return String(value)
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function listChapterTextFiles(bookSourceDir) {
  try {
    const entries = await fs.readdir(bookSourceDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isFile() && /^\d+\.txt$/.test(entry.name))
      .map((entry) => Number(entry.name.replace(/\.txt$/, "")))
      .sort((a, b) => a - b);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
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
  const translationSlug = slugify(options.translation);
  const summary = {
    generated: 0,
    skippedExisting: 0,
    skippedMissingText: 0,
    failed: 0
  };

  console.log(`Preparing ${translationSlug.toUpperCase()} chapter audio`);
  console.log(`Books: ${options.books.join(", ")}`);

  for (const book of options.books) {
    const bookSlug = slugify(book);
    const bookSourceDir = path.join(options.source, translationSlug, bookSlug);
    const chapters = await listChapterTextFiles(bookSourceDir);

    if (chapters.length === 0) {
      summary.skippedMissingText += 1;
      console.log(`Skipping ${book}: no chapter text files in ${bookSourceDir}`);
      continue;
    }

    for (const chapter of chapters) {
      const inputPath = path.join(bookSourceDir, `${chapter}.txt`);
      const outputDir = path.join(options.out, translationSlug, bookSlug, String(chapter));

      if (!options.force && await hasGeneratedChapter(outputDir)) {
        summary.skippedExisting += 1;
        console.log(`Skipping ${book} ${chapter}: already generated`);
        continue;
      }

      if (options.dryRun) {
        console.log(`[dry-run] ${inputPath} -> ${outputDir}`);
        summary.generated += 1;
        continue;
      }

      const command = [
        "scripts/generate-chapter-audio.mjs",
        "--translation", translationSlug,
        "--book", book,
        "--chapter", String(chapter),
        "--input", inputPath,
        "--out", options.out
      ];

      console.log(`Generating ${book} ${chapter}`);
      const code = await runNodeScript(command);
      if (code === 0) {
        summary.generated += 1;
      } else {
        summary.failed += 1;
        console.log(`Failed ${book} ${chapter}`);
      }
    }
  }

  console.log("Batch generation summary");
  console.log(`${options.dryRun ? "Planned" : "Generated"}: ${summary.generated}`);
  console.log(`Skipped existing: ${summary.skippedExisting}`);
  console.log(`Skipped missing text: ${summary.skippedMissingText}`);
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
