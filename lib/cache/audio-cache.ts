import { query } from "@/lib/db";
import { env } from "@/lib/env";

export type AudioCacheRow = {
  user_id: string;
  content_hash: string;
  provider: string;
  model_version: string;
  voice_profile: string;
  voice_settings_version: string;
  translation: string;
  mime_type: string;
  blob_url: string;
  blob_path: string;
  last_accessed_at: string;
  expires_at: string;
};

export async function findAudioCache(userId: string, hash: string): Promise<AudioCacheRow | null> {
  const rows = await query<AudioCacheRow>(
    `SELECT * FROM audio_cache
     WHERE user_id = $1 AND content_hash = $2 AND expires_at > now()
     LIMIT 1`,
    [userId, hash]
  );

  return rows[0] ?? null;
}

export async function upsertAudioCache(input: {
  userId: string;
  contentHash: string;
  provider: string;
  modelVersion: string;
  voiceProfile: string;
  voiceSettingsVersion: string;
  translation: string;
  mimeType: string;
  blobUrl: string;
  blobPath: string;
}): Promise<void> {
  await query(
    `INSERT INTO audio_cache (
      user_id, content_hash, provider, model_version, voice_profile,
      voice_settings_version, translation, mime_type, blob_url, blob_path, expires_at
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() + interval '30 days')
    ON CONFLICT (user_id, content_hash)
    DO UPDATE SET
      provider = EXCLUDED.provider,
      model_version = EXCLUDED.model_version,
      voice_profile = EXCLUDED.voice_profile,
      voice_settings_version = EXCLUDED.voice_settings_version,
      translation = EXCLUDED.translation,
      mime_type = EXCLUDED.mime_type,
      blob_url = EXCLUDED.blob_url,
      blob_path = EXCLUDED.blob_path,
      last_accessed_at = now(),
      expires_at = now() + interval '30 days'`,
    [
      input.userId,
      input.contentHash,
      input.provider,
      input.modelVersion,
      input.voiceProfile,
      input.voiceSettingsVersion,
      input.translation,
      input.mimeType,
      input.blobUrl,
      input.blobPath
    ]
  );
}

export async function touchAudioCache(userId: string, hash: string): Promise<void> {
  await query(
    `UPDATE audio_cache SET last_accessed_at = now(), expires_at = now() + interval '30 days'
     WHERE user_id = $1 AND content_hash = $2`,
    [userId, hash]
  );
}

export async function opportunisticAudioCleanup(): Promise<void> {
  const rows = await query<{ count: string }>("SELECT count(*)::text AS count FROM audio_cache");
  const count = Number(rows[0]?.count ?? "0");
  if (count <= env.audioCacheMaxRows) {
    return;
  }

  await query(
    `DELETE FROM audio_cache
     WHERE id IN (
       SELECT id FROM audio_cache
       ORDER BY expires_at ASC, last_accessed_at ASC
       LIMIT $1
     )`,
    [Math.max(1, Math.ceil((count - env.audioCacheMaxRows) * 0.25))]
  );
}

export async function clearUserAudioCache(userId: string): Promise<void> {
  await query("DELETE FROM audio_cache WHERE user_id = $1", [userId]);
}

export async function listUserAudioPaths(userId: string): Promise<string[]> {
  const rows = await query<{ blob_path: string; blob_url: string }>(
    "SELECT blob_path, blob_url FROM audio_cache WHERE user_id = $1",
    [userId]
  );
  return rows.map((row) => row.blob_path || row.blob_url);
}
