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

## Firebase Storage chapter audio

The audio player tries Firebase Storage first and uses local `generated-audio/` files as a development fallback.

Add these values to `.env.local` for local development:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Add the same variables in Vercel under Project Settings -> Environment Variables. These are Firebase web config values and are okay to expose to the browser, but Firebase Storage rules should still protect access.

Firebase Storage folder structure:

```text
bible-audio/
  amp/
    john/
      3/
        manifest.json
        audio/
          segment-1.mp3
          segment-2.mp3
```

Manifest shape:

```json
{
  "translation": "amp",
  "book": "John",
  "chapter": 3,
  "audioParts": [
    {
      "part": 1,
      "segment": 1,
      "fileName": "segment-1.mp3",
      "storagePath": "bible-audio/amp/john/3/audio/segment-1.mp3"
    }
  ]
}
```

To upload John 3:

1. Generate local audio:
   - `npm run audio:chapter -- --translation amp --book John --chapter 3 --input local-chapters/amp/john/3.txt`
2. In Firebase Console -> Storage, create `bible-audio/amp/john/3/`.
3. Upload `generated-audio/amp/john/3/manifest.json`.
4. Create `bible-audio/amp/john/3/audio/`.
5. Upload `generated-audio/amp/john/3/audio/segment-1.mp3`, `segment-2.mp3`, and any remaining segments.
6. Test:
   - `npm run dev`
   - `http://localhost:3000/audio/john/3?translation=amp`

To test AMPC instead, use `bible-audio/ampc/john/3/` and open:

- `http://localhost:3000/audio/john/3?translation=ampc`

## Security and behavior

- Postgres is source of truth.
- IndexedDB is read cache only.
- Offline mode is read-only.
- TTS endpoint requires auth + rate limit.
- Audio stored in Vercel Blob, metadata in Postgres.
