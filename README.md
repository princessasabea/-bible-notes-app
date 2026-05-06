# Bible Notes App (v1)

Cloud-first notes app with structured verse references and TTS playback.

## Setup

From Terminal, start in the project folder:

- `cd /Users/ama/Desktop/notes-app`

1. Install dependencies:
   - `npm install`
2. Configure local environment:
   - `cp .env.example .env.local`
3. Start the app:
   - `npm run dev`
4. Open the app:
   - `http://localhost:3000`

If you are using the database-backed notes features, apply the base SQL schema in `db/schema.sql`. If your DB already existed before schema lock, run `db/002_align_runtime_schema.sql`.

## Fix npm ENOTEMPTY

If `npm install` fails with an error like `ENOTEMPTY: directory not empty, rename ... node_modules/nanoid 2`, clean the conflicted dependency install and reinstall:

1. Remove the broken dependency folder:
   - `rm -rf node_modules`
2. Reinstall from the lockfile:
   - `npm install`

## Local chapter audio generation

For personal chapter audio, keep copied Bible text outside git under `local-chapters/`.

Example for John 3:

1. Create `local-chapters/amp/john/3.txt` and paste your John 3 AMP text.
2. Preview the split:
   - `npm run audio:chapter -- --translation amp --book John --chapter 3 --input local-chapters/amp/john/3.txt --dry-run`
3. Generate MP3 parts:
   - `npm run audio:chapter -- --translation amp --book John --chapter 3 --input local-chapters/amp/john/3.txt`
4. Start the app:
   - `npm run dev`
5. Open the player:
   - `http://localhost:3000/audio/john/3?translation=amp`

Generated files are written to `generated-audio/amp/john/3/` with `part-1.mp3`, `part-2.mp3`, and `manifest.json`.

To listen locally on macOS:

- `afplay generated-audio/amp/john/3/part-1.mp3`

To use AMPC instead, change both `amp` path segments and `--translation amp` to `ampc`.

## Security and behavior

- Postgres is source of truth.
- IndexedDB is read cache only.
- Offline mode is read-only.
- TTS endpoint requires auth + rate limit.
- Audio stored in Vercel Blob, metadata in Postgres.
