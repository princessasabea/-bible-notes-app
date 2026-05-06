#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { cleanBibleTextForNarration } from "./narration-cleanup.mjs";

const DEFAULT_MAX_CHARS = 4000;
const DEFAULT_MODEL = "gpt-4o-mini-tts";
const DEFAULT_VOICE = "onyx";
const DEFAULT_SPEED = 0.9;
const DEFAULT_INSTRUCTIONS =
  "Read slowly, warmly, and reverently like a calm Scripture narrator. Do not announce technical labels, chunk numbers, filenames, or metadata. Use natural pauses between verses and sentences. Keep the tone peaceful, devotional, emotionally grounded, and immersive.";

const usage = `
Usage:
  npm run audio:chapter -- --book John --chapter 3 --input local-chapters/amp/john/3.txt

Options:
  --translation amp              Translation folder/name. Default: amp
  --book John                    Bible book name. Required
  --chapter 3                    Chapter number. Required
  --input path/to/chapter.txt    Plain text chapter file. Required
  --out generated-audio          Output root. Default: generated-audio
  --model gpt-4o-mini-tts        OpenAI speech model. Default: gpt-4o-mini-tts
  --voice onyx                   Voice. Default: onyx
  --speed 0.9                    Speech speed. Default: 0.9
  --max-chars 4000               Split target, must stay <= 4096. Default: 4000
  --dry-run                      Split and print file plan without calling OpenAI
`;

function parseArgs(argv) {
  const args = {
    translation: "amp",
    out: "generated-audio",
    model: DEFAULT_MODEL,
    voice: DEFAULT_VOICE,
    speed: DEFAULT_SPEED,
    maxChars: DEFAULT_MAX_CHARS,
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];

    if (arg === "--dry-run") {
      args.dryRun = true;
      continue;
    }

    if (!arg.startsWith("--")) {
      throw new Error(`Unexpected argument: ${arg}`);
    }

    const key = arg.slice(2);
    const value = argv[i + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`Missing value for ${arg}`);
    }

    i += 1;
    args[key] = value;
  }

  if (!args.book || !args.chapter || !args.input) {
    throw new Error("Missing required --book, --chapter, or --input.");
  }

  const maxChars = Number(args.maxChars);
  if (!Number.isInteger(maxChars) || maxChars < 500 || maxChars > 4096) {
    throw new Error("--max-chars must be an integer from 500 to 4096.");
  }

  const speed = Number(args.speed);
  if (!Number.isFinite(speed) || speed < 0.25 || speed > 4) {
    throw new Error("--speed must be a number from 0.25 to 4.");
  }

  return { ...args, maxChars, speed };
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
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function splitIntoNaturalSegments(text) {
  const normalized = text.replace(/\r\n/g, "\n").trim();
  const paragraphs = normalized.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  const roughSegments = paragraphs.length > 1 ? paragraphs : normalized.split(/\n/);
  const segments = [];

  for (const roughSegment of roughSegments) {
    const cleanSegment = roughSegment.trim();
    if (!cleanSegment) {
      continue;
    }

    const verseLikeParts = cleanSegment.split(/(?=\s*\d{1,3}[\s.])/).map((part) => part.trim()).filter(Boolean);
    if (verseLikeParts.length > 1) {
      segments.push(...verseLikeParts);
      continue;
    }

    segments.push(
      ...cleanSegment
        .split(/(?<=[.!?])\s+/)
        .map((part) => part.trim())
        .filter(Boolean)
    );
  }

  return segments.length ? segments : [normalized];
}

function splitText(text, maxLength) {
  const parts = [];
  let current = "";

  for (const segment of splitIntoNaturalSegments(text)) {
    if (segment.length > maxLength) {
      throw new Error(`A single segment is ${segment.length} characters. Add a paragraph break near: ${segment.slice(0, 80)}...`);
    }

    const next = current ? `${current}\n\n${segment}` : segment;
    if (next.length > maxLength) {
      if (current) {
        parts.push(current);
      }
      current = segment;
    } else {
      current = next;
    }
  }

  if (current) {
    parts.push(current);
  }

  return parts;
}

async function generateAudio(input, outputPath, options) {
  const response = await fetch("https://api.openai.com/v1/audio/speech", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY.trim()}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      model: options.model,
      voice: options.voice,
      input,
      instructions: DEFAULT_INSTRUCTIONS,
      response_format: "mp3",
      speed: options.speed
    })
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`OpenAI speech request failed (${response.status}): ${errorText}`);
  }

  const audioBuffer = Buffer.from(await response.arrayBuffer());
  await fs.writeFile(outputPath, audioBuffer);
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadLocalEnv();

  const chapterText = await fs.readFile(options.input, "utf8");
  const narrationText = cleanBibleTextForNarration(chapterText, options.translation);
  const parts = splitText(narrationText, options.maxChars);
  const bookSlug = slugify(options.book);
  const translationSlug = slugify(options.translation);
  const chapter = String(options.chapter);
  const chapterDir = path.join(options.out, translationSlug, bookSlug, chapter);
  const outputDir = path.join(chapterDir, "audio");

  await fs.mkdir(outputDir, { recursive: true });

  const audioParts = [];
  for (let index = 0; index < parts.length; index += 1) {
    const segmentNumber = index + 1;
    const fileName = `segment-${index + 1}.mp3`;
    const outputPath = path.join(outputDir, fileName);
    const publicUrl = `/api/generated-audio/${translationSlug}/${bookSlug}/${chapter}/audio/${fileName}`;
    const storagePath = `bible-audio/${translationSlug}/${bookSlug}/${chapter}/audio/${fileName}`;
    audioParts.push({
      part: segmentNumber,
      segment: segmentNumber,
      fileName,
      path: outputPath,
      storagePath,
      url: publicUrl
    });

    if (options.dryRun) {
      console.log(`[dry-run] ${outputPath} (${parts[index].length} chars)`);
      continue;
    }

    if (!process.env.OPENAI_API_KEY?.trim()) {
      throw new Error("OPENAI_API_KEY is required. Add it to .env.local or export it in your shell.");
    }

    console.log(`Generating ${options.book} ${chapter} segment ${segmentNumber}/${parts.length} (${parts[index].length} chars)`);
    await generateAudio(parts[index], outputPath, options);
    console.log(`Finished ${options.book} ${chapter} segment ${segmentNumber}/${parts.length}`);
    console.log(`Saved ${outputPath}`);
  }

  const manifest = {
    translation: translationSlug,
    book: options.book,
    chapter: Number(options.chapter),
    model: options.model,
    voice: options.voice,
    speed: options.speed,
    instructions: DEFAULT_INSTRUCTIONS,
    generatedAt: new Date().toISOString(),
    preprocessing: {
      cleanedForNarration: true,
      sourceCharacterCount: chapterText.length,
      narrationCharacterCount: narrationText.length
    },
    audioParts
  };

  const manifestPath = path.join(chapterDir, "manifest.json");
  await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Saved ${manifestPath}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage.trim());
  process.exit(1);
});
