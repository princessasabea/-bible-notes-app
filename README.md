# Bible Notes App (v1)

Cloud-first notes app with structured verse references and TTS playback.

## Setup

1. Install deps:
   - `npm install`
2. Configure env:
   - `cp .env.example .env.local`
3. Apply base SQL schema in `db/schema.sql`.
4. If your DB already existed before schema lock, run `db/002_align_runtime_schema.sql`.
5. Run:
   - `npm run dev`

## Security and behavior

- Postgres is source of truth.
- IndexedDB is read cache only.
- Offline mode is read-only.
- TTS endpoint requires auth + rate limit.
- Audio stored in Vercel Blob, metadata in Postgres.
