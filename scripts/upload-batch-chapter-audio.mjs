#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";

const DEFAULT_TRANSLATION = "amp";
const DEFAULT_GENERATED_ROOT = "generated-audio";
const DEFAULT_BOOKS = ["John", "Romans", "Ephesians", "Philippians", "James"];

const usage = `
Usage:
  npm run audio:upload:batch -- --translation amp --books John,Romans,Ephesians,Philippians,James --service-account ./serviceAccountKey.json

Options:
  --translation amp              Translation folder/name. Default: amp
  --books John,Romans            Comma-separated books. Default: John,Romans,Ephesians,Philippians,James
  --in generated-audio           Generated audio root. Default: generated-audio
  --bucket bucket.appspot.com    Firebase Storage bucket. Defaults to env.
  --service-account path.json    Service account JSON file. Optional.
  --dry-run                      Print upload plan without uploading
  --skip-url-check               Skip download URL verification
`;

function parseArgs(argv) {
  const args = {
    translation: DEFAULT_TRANSLATION,
    books: DEFAULT_BOOKS.join(","),
    in: DEFAULT_GENERATED_ROOT,
    dryRun: false,
    skipUrlCheck: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (arg === "--skip-url-check") {
      args.skipUrlCheck = true;
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

async function listGeneratedChapters(bookGeneratedDir) {
  try {
    const entries = await fs.readdir(bookGeneratedDir, { withFileTypes: true });
    return entries
      .filter((entry) => entry.isDirectory() && /^\d+$/.test(entry.name))
      .map((entry) => Number(entry.name))
      .sort((a, b) => a - b);
  } catch (error) {
    if (error.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function hasUploadableChapter(chapterDir) {
  try {
    const manifest = await fs.stat(path.join(chapterDir, "manifest.json"));
    const audioEntries = await fs.readdir(path.join(chapterDir, "audio"), { withFileTypes: true });
    return manifest.isFile() && audioEntries.some((entry) => entry.isFile() && /^segment-\d+\.mp3$/i.test(entry.name));
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
    uploaded: 0,
    skippedMissingGenerated: 0,
    failed: 0
  };

  console.log(`Uploading ${translationSlug.toUpperCase()} generated audio`);
  console.log(`Books: ${options.books.join(", ")}`);

  for (const book of options.books) {
    const bookSlug = slugify(book);
    const bookGeneratedDir = path.join(options.in, translationSlug, bookSlug);
    const chapters = await listGeneratedChapters(bookGeneratedDir);

    if (chapters.length === 0) {
      summary.skippedMissingGenerated += 1;
      console.log(`Skipping ${book}: no generated chapters in ${bookGeneratedDir}`);
      continue;
    }

    for (const chapter of chapters) {
      const chapterDir = path.join(bookGeneratedDir, String(chapter));
      if (!(await hasUploadableChapter(chapterDir))) {
        summary.skippedMissingGenerated += 1;
        console.log(`Skipping ${book} ${chapter}: manifest or audio segments missing`);
        continue;
      }

      const command = [
        "scripts/upload-chapter-audio.mjs",
        "--translation", translationSlug,
        "--book", book,
        "--chapter", String(chapter),
        "--in", options.in
      ];

      if (options.bucket) {
        command.push("--bucket", options.bucket);
      }
      if (options["service-account"]) {
        command.push("--service-account", options["service-account"]);
      }
      if (options.dryRun) {
        command.push("--dry-run");
      }
      if (options.skipUrlCheck) {
        command.push("--skip-url-check");
      }

      console.log(`Uploading ${book} ${chapter}`);
      const code = await runNodeScript(command);
      if (code === 0) {
        summary.uploaded += 1;
      } else {
        summary.failed += 1;
        console.log(`Failed upload for ${book} ${chapter}`);
      }
    }
  }

  console.log("Batch upload summary");
  console.log(`${options.dryRun ? "Planned" : "Uploaded"}: ${summary.uploaded}`);
  console.log(`Skipped missing generated audio: ${summary.skippedMissingGenerated}`);
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
