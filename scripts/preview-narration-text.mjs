#!/usr/bin/env node

import fs from "node:fs/promises";
import { cleanBibleTextForNarration } from "./narration-cleanup.mjs";

const API_BIBLE_ROOT = "https://rest.api.bible/v1";

const BOOKS = {
  john: { name: "John", code: "JHN" },
  romans: { name: "Romans", code: "ROM" },
  psalms: { name: "Psalms", code: "PSA" },
  proverbs: { name: "Proverbs", code: "PRO" },
  ruth: { name: "Ruth", code: "RUT" },
  ecclesiastes: { name: "Ecclesiastes", code: "ECC" },
  esther: { name: "Esther", code: "EST" },
  ephesians: { name: "Ephesians", code: "EPH" },
  philippians: { name: "Philippians", code: "PHP" },
  colossians: { name: "Colossians", code: "COL" },
  james: { name: "James", code: "JAS" },
  "1-john": { name: "1 John", code: "1JN" },
  "1-pete": { name: "1 Peter", code: "1PE" },
  "1-peter": { name: "1 Peter", code: "1PE" }
};

const DEFAULT_BIBLE_IDS = {
  amp: "a81b73293d3080c9-01"
};

const usage = `
Usage:
  npm run audio:preview -- --translation amp --book John --chapter 3 --source api

Options:
  --translation amp          Translation folder/name. Default: amp
  --book John                Bible book name. Required
  --chapter 3                Chapter number. Required
  --source api               Source for chapter text. Default: api
  --input chapter.txt        Optional local text file instead of API
  --show-source              Also print raw source text before cleanup

This command never calls OpenAI and never writes generated audio.
`;

function parseArgs(argv) {
  const args = {
    translation: "amp",
    source: "api",
    showSource: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--show-source") {
      args.showSource = true;
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

  if (!args.book || !args.chapter) {
    throw new Error("Missing required --book or --chapter.");
  }

  const chapter = Number(args.chapter);
  if (!Number.isInteger(chapter) || chapter < 1) {
    throw new Error("--chapter must be a positive integer.");
  }

  return { ...args, chapter };
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
  const book = BOOKS[slugify(value)];
  if (!book) {
    throw new Error(`Unsupported book for preview: ${value}. Supported now: ${Object.values(BOOKS).map((item) => item.name).join(", ")}.`);
  }
  return book;
}

function getBibleId(translationSlug) {
  const envKey = `${translationSlug.toUpperCase()}_BIBLE_ID`;
  const bibleId = process.env[envKey]?.trim() ?? DEFAULT_BIBLE_IDS[translationSlug];
  if (!bibleId) {
    throw new Error(`${envKey} is required for ${translationSlug.toUpperCase()} API preview.`);
  }
  return bibleId;
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
  return htmlToReadableChapterText(json?.data?.content ?? "");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadLocalEnv();

  const translationSlug = slugify(options.translation);
  const book = getBook(options.book);
  let sourceText = "";

  if (options.input) {
    sourceText = await fs.readFile(options.input, "utf8");
  } else {
    if (options.source !== "api") {
      throw new Error(`Unsupported --source ${options.source}. Use --source api or pass --input.`);
    }

    const apiKey = process.env.BIBLE_API_KEY?.trim();
    if (!apiKey) {
      throw new Error("BIBLE_API_KEY is required for --source api. Add it to .env.local or export it in your shell.");
    }

    sourceText = await fetchChapterText({
      apiKey,
      bibleId: getBibleId(translationSlug),
      bookCode: book.code,
      chapter: options.chapter
    });
  }

  const cleaned = cleanBibleTextForNarration(sourceText, translationSlug);

  if (options.showSource) {
    console.log("----- SOURCE TEXT -----");
    console.log(sourceText);
  }
  console.log("----- CLEANED NARRATION TEXT -----");
  console.log(cleaned);
  console.log("----- PREVIEW SUMMARY -----");
  console.log(`${book.name} ${options.chapter} ${translationSlug.toUpperCase()}`);
  console.log(`Source characters: ${sourceText.length}`);
  console.log(`Cleaned characters: ${cleaned.length}`);
  console.log("OpenAI calls: 0");
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage.trim());
  process.exit(1);
});
