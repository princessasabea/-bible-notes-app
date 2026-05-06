import fs from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { resolveGeneratedAudioFile } from "@/lib/audio/chapter-audio";

export const runtime = "nodejs";

function parseRange(rangeHeader: string | null, size: number): { start: number; end: number } | null {
  if (!rangeHeader) {
    return null;
  }

  const match = rangeHeader.match(/^bytes=(\d*)-(\d*)$/);
  if (!match) {
    return null;
  }

  const start = match[1] ? Number(match[1]) : 0;
  const end = match[2] ? Number(match[2]) : size - 1;

  if (!Number.isInteger(start) || !Number.isInteger(end) || start < 0 || end < start || start >= size) {
    return null;
  }

  return { start, end: Math.min(end, size - 1) };
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ translation: string; book: string; chapter: string; file: string[] }> }
): Promise<Response> {
  const resolved = await params;
  const audioPath = resolveGeneratedAudioFile(
    resolved.translation,
    resolved.book,
    resolved.chapter,
    resolved.file.join("/")
  );

  if (!audioPath) {
    return new Response("Invalid audio path", { status: 400 });
  }

  try {
    const metadata = await stat(audioPath);
    const range = parseRange(request.headers.get("range"), metadata.size);
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=3600",
      "Content-Type": "audio/mpeg"
    });

    if (range) {
      headers.set("Content-Length", String(range.end - range.start + 1));
      headers.set("Content-Range", `bytes ${range.start}-${range.end}/${metadata.size}`);
      const stream = fs.createReadStream(audioPath, { start: range.start, end: range.end });
      return new Response(Readable.toWeb(stream) as ReadableStream, { status: 206, headers });
    }

    headers.set("Content-Length", String(metadata.size));
    const stream = fs.createReadStream(audioPath);
    return new Response(Readable.toWeb(stream) as ReadableStream, { headers });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") {
      return new Response("Audio file not found", { status: 404 });
    }

    throw error;
  }
}
