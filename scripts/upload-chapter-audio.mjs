#!/usr/bin/env node

import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { applicationDefault, cert, getApps, initializeApp } from "firebase-admin/app";
import { getStorage } from "firebase-admin/storage";

const DEFAULT_IN_ROOT = "generated-audio";
const FIREBASE_AUDIO_ROOT = "bible-audio";

const usage = `
Usage:
  npm run audio:upload -- --translation amp --book John --chapter 3

Options:
  --translation amp              Translation folder/name. Default: amp
  --book John                    Bible book name. Required
  --chapter 3                    Chapter number. Required
  --in generated-audio           Generated audio root. Default: generated-audio
  --bucket bucket.appspot.com    Firebase Storage bucket. Defaults to env.
  --service-account path.json    Service account JSON file. Optional.
  --dry-run                      Print upload plan without uploading
  --skip-url-check               Skip download URL verification

Credentials:
  Use one of:
  - --service-account ./serviceAccountKey.json
  - FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json
  - GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json
  - FIREBASE_SERVICE_ACCOUNT_KEY='{"project_id":"..."}'
  - FIREBASE_SERVICE_ACCOUNT_KEY_BASE64='base64-json'
  - FIREBASE_PROJECT_ID + FIREBASE_CLIENT_EMAIL + FIREBASE_PRIVATE_KEY
`;

function parseArgs(argv) {
  const args = {
    translation: "amp",
    in: DEFAULT_IN_ROOT,
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

function normalizePrivateKey(value) {
  return value?.replace(/\\n/g, "\n");
}

async function readJsonFile(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function getServiceAccount(options) {
  const serviceAccountPath = options["service-account"] ?? process.env.FIREBASE_SERVICE_ACCOUNT_PATH ?? process.env.GOOGLE_APPLICATION_CREDENTIALS;

  if (serviceAccountPath) {
    return cert(await readJsonFile(serviceAccountPath));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64) {
    const decoded = Buffer.from(process.env.FIREBASE_SERVICE_ACCOUNT_KEY_BASE64, "base64").toString("utf8");
    return cert(JSON.parse(decoded));
  }

  if (process.env.FIREBASE_SERVICE_ACCOUNT_KEY) {
    return cert(JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_KEY));
  }

  if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
    return cert({
      projectId: process.env.FIREBASE_PROJECT_ID,
      clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
      privateKey: normalizePrivateKey(process.env.FIREBASE_PRIVATE_KEY)
    });
  }

  return applicationDefault();
}

function getBucketName(options) {
  const bucketName = options.bucket
    ?? process.env.FIREBASE_STORAGE_BUCKET
    ?? process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    ?? process.env.GCLOUD_STORAGE_BUCKET;

  if (!bucketName?.trim()) {
    throw new Error("Firebase Storage bucket is required. Set NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET or pass --bucket.");
  }

  return bucketName.trim();
}

async function initializeFirebaseAdmin(options) {
  const bucketName = getBucketName(options);
  if (getApps().length === 0) {
    initializeApp({
      credential: await getServiceAccount(options),
      storageBucket: bucketName
    });
  }

  return getStorage().bucket(bucketName);
}

async function listSegmentFiles(audioDir) {
  const entries = await fs.readdir(audioDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && /^segment-\d+\.mp3$/i.test(entry.name))
    .map((entry) => entry.name)
    .sort((a, b) => Number(a.match(/\d+/)?.[0] ?? 0) - Number(b.match(/\d+/)?.[0] ?? 0));
}

function firebaseDownloadUrl(bucketName, storagePath, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${encodeURIComponent(storagePath)}?alt=media&token=${token}`;
}

async function uploadBuffer(bucket, buffer, destination, options = {}) {
  const token = randomUUID();
  const file = bucket.file(destination);

  await file.save(buffer, {
    resumable: false,
    metadata: {
      contentType: options.contentType,
      cacheControl: options.cacheControl ?? "public, max-age=31536000, immutable",
      metadata: {
        firebaseStorageDownloadTokens: token
      }
    }
  });

  return {
    storagePath: destination,
    url: firebaseDownloadUrl(bucket.name, destination, token)
  };
}

async function uploadFile(bucket, localPath, destination, options = {}) {
  return uploadBuffer(bucket, await fs.readFile(localPath), destination, options);
}

async function verifyFirebaseObject(bucket, storagePath) {
  const [exists] = await bucket.file(storagePath).exists();
  if (!exists) {
    throw new Error(`Upload verification failed: ${storagePath} does not exist.`);
  }
}

async function verifyDownloadUrl(url, label, rangeCheck = false) {
  const response = await fetch(url, rangeCheck ? { headers: { Range: "bytes=0-0" } } : undefined);
  if (!response.ok && response.status !== 206) {
    throw new Error(`${label} download URL failed (${response.status}).`);
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  await loadLocalEnv();

  const translationSlug = slugify(options.translation);
  const bookSlug = slugify(options.book);
  const chapter = String(options.chapter);
  const chapterDir = path.join(options.in, translationSlug, bookSlug, chapter);
  const audioDir = path.join(chapterDir, "audio");
  const localManifestPath = path.join(chapterDir, "manifest.json");
  const firebaseChapterFolder = `${FIREBASE_AUDIO_ROOT}/${translationSlug}/${bookSlug}/${chapter}`;
  const firebaseManifestPath = `${firebaseChapterFolder}/manifest.json`;

  const localManifest = await readJsonFile(localManifestPath);
  const segmentFiles = await listSegmentFiles(audioDir);
  if (segmentFiles.length === 0) {
    throw new Error(`No segment MP3 files found in ${audioDir}. Generate audio first with npm run audio:chapter.`);
  }

  console.log(`Uploading ${translationSlug.toUpperCase()} ${options.book} ${chapter}`);
  console.log(`Local folder: ${chapterDir}`);
  console.log(`Firebase folder: ${firebaseChapterFolder}`);

  if (options.dryRun) {
    console.log(`[dry-run] ${localManifestPath} -> ${firebaseManifestPath}`);
    for (const fileName of segmentFiles) {
      console.log(`[dry-run] ${path.join(audioDir, fileName)} -> ${firebaseChapterFolder}/audio/${fileName}`);
    }
    return;
  }

  const bucket = await initializeFirebaseAdmin(options);
  const audioParts = [];

  for (let index = 0; index < segmentFiles.length; index += 1) {
    const fileName = segmentFiles[index];
    const segmentNumber = Number(fileName.match(/\d+/)?.[0] ?? index + 1);
    const localPath = path.join(audioDir, fileName);
    const destination = `${firebaseChapterFolder}/audio/${fileName}`;
    const uploaded = await uploadFile(bucket, localPath, destination, {
      contentType: "audio/mpeg"
    });

    audioParts.push({
      part: segmentNumber,
      segment: segmentNumber,
      fileName,
      path: uploaded.storagePath,
      storagePath: uploaded.storagePath,
      url: uploaded.url
    });
    console.log(`Uploaded ${destination}`);
  }

  const firebaseManifest = {
    ...localManifest,
    translation: translationSlug,
    book: localManifest.book ?? options.book,
    chapter: Number(localManifest.chapter ?? options.chapter),
    uploadedAt: new Date().toISOString(),
    audioParts
  };
  const manifestUpload = await uploadBuffer(
    bucket,
    Buffer.from(`${JSON.stringify(firebaseManifest, null, 2)}\n`, "utf8"),
    firebaseManifestPath,
    {
      contentType: "application/json",
      cacheControl: "no-cache"
    }
  );

  await verifyFirebaseObject(bucket, firebaseManifestPath);
  for (const part of audioParts) {
    await verifyFirebaseObject(bucket, part.storagePath);
  }

  if (!options.skipUrlCheck) {
    await verifyDownloadUrl(manifestUpload.url, "manifest.json");
    for (const part of audioParts) {
      await verifyDownloadUrl(part.url, part.fileName, true);
    }
  }

  console.log(`Uploaded ${firebaseManifestPath}`);
  console.log("Verified Firebase files and download URLs.");
  console.log(`Test route: /audio/${bookSlug}/${chapter}?translation=${translationSlug}`);
}

main().catch((error) => {
  console.error(error.message);
  console.error(usage.trim());
  process.exit(1);
});
