import { del, head, put } from "@vercel/blob";

export type StoredAudio = {
  blobUrl: string;
  blobPath: string;
  signedUrl: string;
};

export async function storeAudio(hash: string, audio: Buffer, contentType: string): Promise<StoredAudio> {
  const pathname = `audio/${hash}.mp3`;
  const blob = await put(pathname, audio, {
    access: "public",
    addRandomSuffix: false,
    contentType,
    token: process.env.BLOB_READ_WRITE_TOKEN
  });

  return {
    blobUrl: blob.url,
    blobPath: pathname,
    signedUrl: blob.downloadUrl ?? blob.url
  };
}

export async function getSignedAudioUrl(blobPathOrUrl: string): Promise<string> {
  const metadata = await head(blobPathOrUrl, {
    token: process.env.BLOB_READ_WRITE_TOKEN
  });

  return metadata.downloadUrl ?? metadata.url;
}

export async function deleteAudioObjects(pathsOrUrls: string[]): Promise<void> {
  if (!pathsOrUrls.length) {
    return;
  }

  await del(pathsOrUrls, {
    token: process.env.BLOB_READ_WRITE_TOKEN
  });
}
