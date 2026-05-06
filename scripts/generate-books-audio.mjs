#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_TRANSLATION = "amp";
const DEFAULT_BOOKS = ["Philippians", "James", "1 John", "Colossians", "Ephesians"];
const DEFAULT_SOURCE = "api";
const DEFAULT_OUTPUT_ROOT = "generated-audio";

const usage = `
Usage:
  npm run audio:books -- --translation amp --books Philippians,James,"1 John",Colossians,Ephesians --source api

Options:
  --translation amp       Translation folder/name. Default: amp
  --books Romans,James    Comma-separated books. Default: Philippians,James,1 John,Colossians,Ephesians
  --source api            Source for chapter text. Default: api
  --out generated-audio   Output audio root. Default: generated-audio
  --concurrency 1         Chapters to generate at once inside each book. Default: 1
  --force                 Regenerate chapters that already have manifest.json and audio segments
  --dry-run               Print the generation plan without fetching text or calling OpenAI
`;

function parseArgs(argv) {
  const args = {
    translation: DEFAULT_TRANSLATION,
    books: DEFAULT_BOOKS.join(","),
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

  const concurrency = Number(args.concurrency);
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) {
    throw new Error("--concurrency must be an integer from 1 to 8.");
  }

  return {
    ...args,
    concurrency,
    books: args.books.split(",").map((book) => book.trim()).filter(Boolean)
  };
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
  const summary = {
    books: options.books.length,
    completed: 0,
    failed: 0
  };

  console.log(`Preparing ${options.translation.toUpperCase()} audio for ${options.books.join(", ")}`);

  for (const book of options.books) {
    const command = [
      "scripts/generate-book-audio.mjs",
      "--translation", options.translation,
      "--book", book,
      "--source", options.source,
      "--out", options.out,
      "--concurrency", String(options.concurrency)
    ];

    if (options.force) {
      command.push("--force");
    }
    if (options.dryRun) {
      command.push("--dry-run");
    }

    console.log(`Starting ${book}`);
    const code = await runNodeScript(command);
    if (code === 0) {
      summary.completed += 1;
    } else {
      summary.failed += 1;
      console.log(`Failed ${book}`);
    }
  }

  console.log("Multi-book generation summary");
  console.log(`Books requested: ${summary.books}`);
  console.log(`${options.dryRun ? "Planned" : "Completed"}: ${summary.completed}`);
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
