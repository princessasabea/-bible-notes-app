import type {
  BibleProvider,
  BibleResolveParams,
  BibleResolveResult
} from "../provider";

const bookMap: Record<string, string> = {
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

const BIBLE_IDS = {
  NKJV: "63097d2a0a2f7db3-01",
  AMP: "a81b73293d3080c9-01"
} as const;

function stripHtml(input: string): string {
  return input.replace(/<[^>]*>?/gm, "").replace(/\s+/g, " ").trim();
}

function summarizeBody(body: string): string {
  const trimmed = body.replace(/\s+/g, " ").trim();
  return trimmed.length <= 280 ? trimmed : `${trimmed.slice(0, 280)}...`;
}

function buildVerseId(displayRef: string): string | null {
  const match = displayRef.trim().match(/^([1-3]?\s?[A-Za-z ]+)\s+(\d+):(\d+)(?:-\d+)?$/);
  if (!match) {
    return null;
  }

  const book = match[1].replace(/\s+/g, " ").trim();
  const chapter = match[2];
  const verse = match[3];
  const code = bookMap[book];
  if (!code) {
    return null;
  }

  return `${code}.${chapter}.${verse}`;
}

async function fetchVerse(
  bibleId: string,
  verseId: string,
  apiKey: string
): Promise<{ text: string | null; status?: number; body?: string }> {
  const url = `https://rest.api.bible/v1/bibles/${bibleId}/verses/${encodeURIComponent(
    verseId
  )}?content-type=text`;

  console.log("apiBible.fetch", { endpoint: "verses", bibleId, verseId, url });

  const res = await fetch(url, {
    headers: { "api-key": apiKey },
    cache: "no-store"
  });

  if (!res.ok) {
    return {
      text: null,
      status: res.status,
      body: summarizeBody(await res.text())
    };
  }

  const json = await res.json();
  const html = json?.data?.content ?? json?.data?.text ?? "";
  const text = stripHtml(html);

  return {
    text: text || null,
    status: res.status
  };
}

async function fetchPassage(
  bibleId: string,
  passage: string,
  apiKey: string
): Promise<{ text: string | null; status?: number; body?: string }> {
  const url = `https://rest.api.bible/v1/bibles/${bibleId}/passages/${encodeURIComponent(
    passage
  )}?content-type=text&include-notes=false&include-titles=false`;

  console.log("apiBible.fetch", { endpoint: "passages", bibleId, passage, url });

  const res = await fetch(url, {
    headers: { "api-key": apiKey },
    cache: "no-store"
  });

  if (!res.ok) {
    return {
      text: null,
      status: res.status,
      body: summarizeBody(await res.text())
    };
  }

  const json = await res.json();
  const html = json?.data?.content ?? "";
  const text = stripHtml(html);

  return {
    text: text || null,
    status: res.status
  };
}

async function searchPassage(
  bibleId: string,
  query: string,
  apiKey: string
): Promise<{ text: string | null; status?: number; body?: string }> {
  const url = `https://rest.api.bible/v1/bibles/${bibleId}/search?query=${encodeURIComponent(
    query
  )}&limit=1&sort=relevance`;

  console.log("apiBible.fetch", { endpoint: "search", bibleId, query, url });

  const res = await fetch(url, {
    headers: { "api-key": apiKey },
    cache: "no-store"
  });

  if (!res.ok) {
    return {
      text: null,
      status: res.status,
      body: summarizeBody(await res.text())
    };
  }

  const json = await res.json();
  const content =
    json?.data?.passages?.[0]?.content ??
    json?.data?.verses?.[0]?.content ??
    json?.data?.verses?.[0]?.text ??
    "";

  const clean = stripHtml(content);

  return {
    text: clean || null,
    status: res.status
  };
}

export class ApiBibleProvider implements BibleProvider {
  async resolveReference(
    params: BibleResolveParams
  ): Promise<BibleResolveResult> {
    const apiKey = process.env.BIBLE_API_KEY?.trim();

    const bibleIds: Record<string, string> = {
      AMP: BIBLE_IDS.AMP,
      NKJV: BIBLE_IDS.NKJV
    };

    if (!apiKey) {
      return {
        status: "unavailable",
        canonicalRef: params.canonicalRef,
        requestedTranslations: params.preferredTranslations,
        supportedTranslations: [],
        message: "BIBLE_API_KEY missing",
        providerDebug: { provider: "apiBible" }
      };
    }

    const supportedTranslations = Object.keys(bibleIds);

    if (!supportedTranslations.length) {
      return {
        status: "unavailable",
        canonicalRef: params.canonicalRef,
        requestedTranslations: params.preferredTranslations,
        supportedTranslations: [],
        message: "No Bible IDs configured",
        providerDebug: { provider: "apiBible" }
      };
    }

    const orderedTranslations = [
      ...params.preferredTranslations,
      "NKJV",
      "AMP"
    ].filter((v, i, arr) => arr.indexOf(v) === i);

    const attempts: any[] = [];

    for (const translation of orderedTranslations) {
      if (!supportedTranslations.includes(translation)) {
        attempts.push({
          translation,
          method: "skipped",
          body: "Translation not configured in supportedTranslations"
        });
        continue;
      }

      const bibleId = bibleIds[translation];
      if (!bibleId) continue;

      try {
        // 1) Try /verses/{VERSE_ID} using mapped book code
        const verseId = buildVerseId(params.displayRef);
        if (verseId) {
          const verse = await fetchVerse(bibleId, verseId, apiKey);
          if (verse.text) {
            return {
              status: "resolved",
              canonicalRef: params.canonicalRef,
              translation,
              text: verse.text
            };
          }

          attempts.push({
            translation,
            method: "verseId",
            verseId,
            status: verse.status,
            body: verse.body
          });
        } else {
          attempts.push({
            translation,
            method: "verseId",
            body: `Could not build verseId from ${params.displayRef}`
          });
        }

        // 2) Try canonical passage id
        const canonical = await fetchPassage(bibleId, params.canonicalRef, apiKey);
        if (canonical.text) {
          return {
            status: "resolved",
            canonicalRef: params.canonicalRef,
            translation,
            text: canonical.text
          };
        }

        attempts.push({
          translation,
          method: "canonical",
          status: canonical.status,
          body: canonical.body
        });

        // 3) Try display passage id
        const display = await fetchPassage(bibleId, params.displayRef, apiKey);
        if (display.text) {
          return {
            status: "resolved",
            canonicalRef: params.canonicalRef,
            translation,
            text: display.text
          };
        }

        attempts.push({
          translation,
          method: "display",
          status: display.status,
          body: display.body
        });

        // 4) Try search fallback
        const search = await searchPassage(bibleId, params.displayRef, apiKey);
        if (search.text) {
          return {
            status: "resolved",
            canonicalRef: params.canonicalRef,
            translation,
            text: search.text
          };
        }

        attempts.push({
          translation,
          method: "search",
          status: search.status,
          body: search.body
        });
      } catch (err) {
        attempts.push({
          translation,
          error: String(err)
        });
      }
    }

    return {
      status: "unavailable",
      canonicalRef: params.canonicalRef,
      requestedTranslations: params.preferredTranslations,
      supportedTranslations,
      message: "Reference not available from configured API.Bible translations",
      providerDebug: {
        provider: "apiBible",
        attempts
      }
    };
  }
}
