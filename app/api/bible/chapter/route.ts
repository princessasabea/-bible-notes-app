import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

const BIBLE_IDS = {
  NKJV: "63097d2a0a2f7db3-01",
  AMP: "a81b73293d3080c9-01"
} as const;

const BOOK_TO_CODE: Record<string, string> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Joshua: "JOS",
  Judges: "JDG",
  Ruth: "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  Ezra: "EZR",
  Nehemiah: "NEH",
  Esther: "EST",
  Job: "JOB",
  Psalms: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Solomon": "SNG",
  Isaiah: "ISA",
  Jeremiah: "JER",
  Lamentations: "LAM",
  Ezekiel: "EZK",
  Daniel: "DAN",
  Hosea: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obadiah: "OBA",
  Jonah: "JON",
  Micah: "MIC",
  Nahum: "NAM",
  Habakkuk: "HAB",
  Zephaniah: "ZEP",
  Haggai: "HAG",
  Zechariah: "ZEC",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  Titus: "TIT",
  Philemon: "PHM",
  Hebrews: "HEB",
  James: "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  Jude: "JUD",
  Revelation: "REV"
};

const schema = z.object({
  book: z.string().min(1).transform(sanitizeText),
  chapter: z.number().int().min(1),
  translation: z.enum(["AMP", "NKJV"]).default("AMP")
});

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
}

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const payload = await request.json();
    const parsed = schema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json({ status: "invalid", issues: parsed.error.flatten() }, { status: 400 });
    }

    const bookCode = BOOK_TO_CODE[parsed.data.book];
    if (!bookCode) {
      return NextResponse.json({
        status: "invalid",
        issues: [`Unsupported book: ${parsed.data.book}`]
      }, { status: 400 });
    }

    const chapterId = `${bookCode}.${parsed.data.chapter}`;
    const bibleId = BIBLE_IDS[parsed.data.translation];

    const url = `https://rest.api.bible/v1/bibles/${bibleId}/chapters/${encodeURIComponent(
      chapterId
    )}?content-type=html&include-notes=false&include-titles=true&include-chapter-numbers=true`;

    console.log("apiBible.fetch", {
      endpoint: "chapter",
      translation: parsed.data.translation,
      bibleId,
      chapterId,
      url
    });

    const response = await fetch(url, {
      headers: { "api-key": process.env.BIBLE_API_KEY ?? "" },
      cache: "no-store"
    });

    if (!response.ok) {
      const raw = await response.text();
      return NextResponse.json({
        status: "unavailable",
        message: "Chapter not available from API.Bible",
        chapterId,
        translation: parsed.data.translation,
        ...(process.env.NODE_ENV === "development" && {
          providerDebug: {
            status: response.status,
            statusText: response.statusText,
            body: raw.slice(0, 500)
          }
        })
      });
    }

    const data = await response.json();
    const rawHtml = data?.data?.content ?? "";
    const text = stripHtml(rawHtml);

    return NextResponse.json({
      status: "resolved",
      chapterId,
      translation: parsed.data.translation,
      html: rawHtml,
      text
    });
  } catch (error) {
    console.error("bible_chapter_failed", { error: String(error) });
    return NextResponse.json({
      status: "error",
      message: "Internal server error",
      ...(process.env.NODE_ENV === "development" && { detail: String(error) })
    }, { status: 500 });
  }
}
