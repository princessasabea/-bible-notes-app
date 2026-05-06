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

## Audio architecture

The default listening architecture is pre-generated audio:

```text
OpenAI TTS generation once
-> generated MP3 segments
-> Firebase Storage upload
-> app streams prepared narration instantly
```

The app should not call OpenAI when a user presses play. Playback reads the Firebase library index at `bible-audio/{translation}/library.json`, then streams the uploaded chapter manifest and MP3 segments from Firebase Storage. Live/on-demand OpenAI generation is intentionally disabled for now at `/api/audio/generate-on-demand`.

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

Generated files are written to `generated-audio/amp/john/3/` with `manifest.json` and `audio/segment-1.mp3`, `audio/segment-2.mp3`, and any remaining segments.

Before OpenAI TTS is called, the generator cleans chapter text for narration only. The displayed scripture text is not changed. For AMP, cleanup removes verse numbers, footnote markers, section labels, and Bible-reference parentheses like `(Mark 8:9)`, while preserving explanatory AMP parentheses such as `(member of the Sanhedrin)` as natural spoken commas.

To listen locally on macOS:

- `afplay generated-audio/amp/john/3/audio/segment-1.mp3`

To use AMPC, NKJV, or another translation, change both the local path segments and `--translation amp` to the matching lowercase translation slug, such as `ampc` or `nkjv`.

## Firebase Storage chapter audio

The audio player tries Firebase Storage first and uses local `generated-audio/` files as a development fallback.

Add these values to `.env.local` for local development:

- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Add the same variables in Vercel under Project Settings -> Environment Variables. These are Firebase web config values and are okay to expose to the browser, but Firebase Storage rules should still protect access.

For uploads from your computer, the `audio:upload` script uses Firebase Admin credentials. Use one of these local-only options:

- `FIREBASE_SERVICE_ACCOUNT_PATH=./serviceAccountKey.json`
- `GOOGLE_APPLICATION_CREDENTIALS=./serviceAccountKey.json`
- `FIREBASE_SERVICE_ACCOUNT_KEY='{"project_id":"..."}'`
- `FIREBASE_SERVICE_ACCOUNT_KEY_BASE64='base64-json'`
- `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`

Do not commit service account files or keys. `.env`, `.env.local`, `serviceAccountKey.json`, `local-chapters/`, and `generated-audio/` are ignored by git.

Firebase Storage folder structure:

```text
bible-audio/
  amp/
    library.json
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

Library index shape:

```json
{
  "translation": "amp",
  "updatedAt": "2026-05-06T00:00:00.000Z",
  "books": {
    "john": [1, 2, 3, 4, 5],
    "romans": [1, 2, 3]
  }
}
```

The app uses this index to decide whether a chapter has prepared AI narration. If a chapter is not listed, the player shows "Chapter narration is not ready yet" with the exact generate and upload commands.

To upload John 3:

1. Generate local audio:
   - `npm run audio:chapter -- --translation amp --book John --chapter 3 --input local-chapters/amp/john/3.txt`
2. Upload the generated manifest and audio segments:
   - `npm run audio:upload -- --translation amp --book John --chapter 3 --service-account ./serviceAccountKey.json`
3. The script verifies that `manifest.json` and every `audio/segment-*.mp3` file exists in Firebase Storage, verifies download URLs, and updates `bible-audio/amp/library.json`.
4. Test:
   - `npm run dev`
   - `http://localhost:3000/audio/john/3?translation=amp`

To upload without making changes, preview the plan first:

- `npm run audio:upload -- --translation amp --book John --chapter 3 --dry-run`

## Batch chapter audio

The first practical batch set is:

- John
- Romans
- Ephesians
- Philippians
- James

Put local chapter text files in this structure:

```text
local-chapters/
  amp/
    john/
      1.txt
      2.txt
      3.txt
    romans/
      1.txt
```

Generate every available chapter text file for those books:

- `npm run audio:batch -- --translation amp --books John,Romans,Ephesians,Philippians,James`

The batch generator:

- skips books or chapters with missing text files
- skips chapters that already have `manifest.json` and `audio/segment-*.mp3`
- regenerates existing chapters only when you pass `--force`
- prints a summary at the end

Preview without calling OpenAI:

- `npm run audio:batch -- --translation amp --books John,Romans,Ephesians,Philippians,James --dry-run`

Upload every generated chapter for those books:

- `npm run audio:upload:batch -- --translation amp --books John,Romans,Ephesians,Philippians,James --service-account ./serviceAccountKey.json`

The batch uploader:

- uploads only generated chapters that have `manifest.json` and `audio/segment-*.mp3`
- preserves the Firebase path structure under `bible-audio/{translation}/{book}/{chapter}/`
- updates `bible-audio/{translation}/library.json` as each chapter uploads
- verifies uploaded objects and download URLs
- prints a summary at the end

Verify the library in the app:

1. Run `npm run dev`.
2. Open `http://localhost:3000/audio/john/3?translation=amp`.
3. If John 3 is listed in `bible-audio/amp/library.json`, the page shows the main chapter play button.
4. If it is not listed, the page shows the generate/upload action card.

## Full-book AMP audio from Bible API

For the Gospel of John, you can prepare the whole AMP listening library without manually creating `local-chapters/amp/john/*.txt`. The book generator fetches chapter text from API.Bible into a temporary folder, cleans it for narration, calls OpenAI TTS once per generated segment, and writes the same local audio structure the rest of the app already uses.

Required local-only secrets:

- `BIBLE_API_KEY`
- `AMP_BIBLE_ID`
- `OPENAI_API_KEY`

Put these in `.env.local` or export them in your shell. Do not use `NEXT_PUBLIC_` for Bible API or OpenAI keys.

Preview the full John generation plan without fetching Bible text or calling OpenAI:

- `npm run audio:book -- --translation amp --book John --source api --dry-run`

Generate all 21 chapters of John:

- `npm run audio:book -- --translation amp --book John --source api`

Generated output:

```text
generated-audio/
  amp/
    john/
      1/
        manifest.json
        audio/
          segment-1.mp3
      2/
        manifest.json
        audio/
          segment-1.mp3
      ...
      21/
        manifest.json
        audio/
          segment-1.mp3
```

The generator skips chapters that already have `manifest.json` and `audio/segment-*.mp3`. To regenerate everything, add `--force`:

- `npm run audio:book -- --translation amp --book John --source api --force`

Generation is sequential by default so only one chapter is being prepared at a time, and each chapter still generates one TTS segment at a time. Keep the default unless you intentionally want parallel work:

- `npm run audio:book -- --translation amp --book John --source api --concurrency 1`

Upload every generated John chapter to Firebase:

- `npm run audio:upload:book -- --translation amp --book John --service-account ./serviceAccountKey.json`

Preview the upload without changing Firebase:

- `npm run audio:upload:book -- --translation amp --book John --service-account ./serviceAccountKey.json --dry-run`

Firebase Storage should end up with:

```text
bible-audio/
  amp/
    library.json
    john/
      1/
        manifest.json
        audio/
          segment-1.mp3
      2/
        manifest.json
        audio/
          segment-1.mp3
      ...
      21/
        manifest.json
        audio/
          segment-1.mp3
```

The uploader updates `bible-audio/amp/library.json` as chapters upload. When all John chapters are ready, the index should include:

```json
{
  "translation": "amp",
  "books": {
    "john": [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21]
  }
}
```

Open the full book listening page:

- `http://localhost:3000/audio/john?translation=amp`

Open a chapter directly:

- `http://localhost:3000/audio/john/3?translation=amp`

The audio pages use a separate localStorage-backed listening store for:

- current chapter
- queue
- playlists
- playback speed
- last listening progress

This is intentionally separate from the older reader mini-player. The queue can contain repeated chapters and chapters from different books. Playlists are local for now and can later move to the database without changing the stored chapter reference shape:

```json
{
  "name": "Peace Before Sleep",
  "items": [
    { "translation": "amp", "book": "psalms", "chapter": 23 },
    { "translation": "amp", "book": "john", "chapter": 14 }
  ]
}
```

Generated manifests include a `verses` array for future exact timestamps. It is empty until the generation pipeline can produce reliable verse timing:

```json
{
  "translation": "amp",
  "book": "John",
  "chapter": 3,
  "audio": [],
  "audioParts": [],
  "verses": []
}
```

If you previously generated audio before narration cleanup was fixed, regenerate and re-upload the affected book so square-bracket cross references are removed from the spoken audio:

- `npm run audio:book -- --translation amp --book John --source api --force`
- `npm run audio:upload:book -- --translation amp --book John --service-account ./serviceAccountKey.json`

## Expanded AMP listening pack

The same full-book API workflow supports these AMP books:

- Romans
- Psalms
- Proverbs
- Philippians
- James

Generate one full book:

- `npm run audio:book -- --translation amp --book Romans --source api`
- `npm run audio:book -- --translation amp --book Psalms --source api`
- `npm run audio:book -- --translation amp --book Proverbs --source api`
- `npm run audio:book -- --translation amp --book Philippians --source api`
- `npm run audio:book -- --translation amp --book James --source api`

Upload one full book:

- `npm run audio:upload:book -- --translation amp --book Romans --service-account ./serviceAccountKey.json`
- `npm run audio:upload:book -- --translation amp --book Psalms --service-account ./serviceAccountKey.json`
- `npm run audio:upload:book -- --translation amp --book Proverbs --service-account ./serviceAccountKey.json`
- `npm run audio:upload:book -- --translation amp --book Philippians --service-account ./serviceAccountKey.json`
- `npm run audio:upload:book -- --translation amp --book James --service-account ./serviceAccountKey.json`

Generate the whole pack in one command:

- `npm run audio:books -- --translation amp --books Romans,Psalms,Proverbs,Philippians,James --source api`

Upload the whole pack in one command:

- `npm run audio:upload:books -- --translation amp --books Romans,Psalms,Proverbs,Philippians,James --service-account ./serviceAccountKey.json`

Dry-run first, especially for Psalms:

- `npm run audio:books -- --translation amp --books Romans,Psalms,Proverbs,Philippians,James --source api --dry-run`
- `npm run audio:upload:books -- --translation amp --books Romans,Psalms,Proverbs,Philippians,James --service-account ./serviceAccountKey.json --dry-run`

Estimated time and cost note: this pack is much larger than John. Psalms alone has 150 chapters, so full generation can take a long time and will make many OpenAI TTS requests. Always run `--dry-run` first, then consider generating one book at a time.

Firebase paths:

```text
bible-audio/
  amp/
    library.json
    romans/{chapter}/manifest.json
    romans/{chapter}/audio/segment-1.mp3
    psalms/{chapter}/manifest.json
    psalms/{chapter}/audio/segment-1.mp3
    proverbs/{chapter}/manifest.json
    proverbs/{chapter}/audio/segment-1.mp3
    philippians/{chapter}/manifest.json
    philippians/{chapter}/audio/segment-1.mp3
    james/{chapter}/manifest.json
    james/{chapter}/audio/segment-1.mp3
```

After upload, `bible-audio/amp/library.json` should include each prepared book:

```json
{
  "translation": "amp",
  "books": {
    "john": [1, 2, 3],
    "romans": [1, 2, 3],
    "psalms": [1, 2, 3],
    "proverbs": [1, 2, 3],
    "philippians": [1, 2, 3],
    "james": [1, 2, 3]
  }
}
```

Book routes to test:

- `http://localhost:3000/audio/romans?translation=amp`
- `http://localhost:3000/audio/psalms?translation=amp`
- `http://localhost:3000/audio/proverbs?translation=amp`
- `http://localhost:3000/audio/philippians?translation=amp`
- `http://localhost:3000/audio/james?translation=amp`

Chapter routes to test:

- `http://localhost:3000/audio/romans/1?translation=amp`
- `http://localhost:3000/audio/psalms/1?translation=amp`
- `http://localhost:3000/audio/proverbs/1?translation=amp`
- `http://localhost:3000/audio/philippians/1?translation=amp`
- `http://localhost:3000/audio/james/1?translation=amp`

## In-app audio library admin

For a friendlier local workflow, open:

- `http://localhost:3000/admin/audio-library`

The admin page lets you:

- choose translation, book, and chapter
- paste user-provided chapter text
- optionally import a `.txt` file into the textarea
- save text to `local-chapters/{translation}/{book}/{chapter}.txt`
- generate OpenAI narration with the existing `audio:chapter` script
- preview the first generated segment locally before upload
- upload narration to Firebase with the existing `audio:upload` script
- update `bible-audio/{translation}/library.json`

This workflow does not scrape Bible text. You still provide the chapter text yourself. It is intended for preparing a private Firebase audio library; pressing play in the app streams prepared Firebase audio and does not call OpenAI live.

The admin workflow prepares the future "Generate entire book" flow by using the same translation/book/chapter structure as the batch scripts.

To test NKJV instead, create `local-chapters/nkjv/john/3.txt`, then run:

- `npm run audio:chapter -- --translation nkjv --book John --chapter 3 --input local-chapters/nkjv/john/3.txt`
- `npm run audio:upload -- --translation nkjv --book John --chapter 3`
- `http://localhost:3000/audio/john/3?translation=nkjv`

## Security and behavior

- Postgres is source of truth.
- IndexedDB is read cache only.
- Offline mode is read-only.
- TTS endpoint requires auth + rate limit.
- Prepared chapter narration is stored in Firebase Storage.
- OpenAI API keys, service account keys, local chapter text, and generated audio stay out of git.
