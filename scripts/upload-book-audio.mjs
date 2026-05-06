#!/usr/bin/env node

import { spawn } from "node:child_process";

const DEFAULT_TRANSLATION = "amp";
const DEFAULT_BOOK = "John";
const DEFAULT_GENERATED_ROOT = "generated-audio";

const usage = `
Usage:
  npm run audio:upload:book -- --translation amp --book John --service-account ./serviceAccountKey.json

Options:
  --translation amp              Translation folder/name. Default: amp
  --book John                    Book name. Default: John
  --in generated-audio           Generated audio root. Default: generated-audio
  --bucket bucket.appspot.com    Firebase Storage bucket. Defaults to env.
  --service-account path.json    Service account JSON file. Optional.
  --dry-run                      Print upload plan without uploading
  --skip-url-check               Skip download URL verification
`;

function parseArgs(argv) {
  const args = {
    translation: DEFAULT_TRANSLATION,
    book: DEFAULT_BOOK,
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

  return args;
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
  const command = [
    "scripts/upload-batch-chapter-audio.mjs",
    "--translation", options.translation,
    "--books", options.book,
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

  console.log(`Preparing Firebase upload for ${options.translation.toUpperCase()} ${options.book}`);
  const code = await runNodeScript(command);
  process.exit(code);
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage.trim());
  process.exit(1);
});
