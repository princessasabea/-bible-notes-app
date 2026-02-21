import { sanitizeText } from "@/lib/security";

export type CanonicalizedReference = {
  status: "resolved";
  displayRef: string;
  canonicalRef: string;
  rangeCanonicalRef?: string;
};

export type DisambiguationResult = {
  status: "needs_disambiguation";
  needsUserDisambiguation: true;
  normalizedInput: string;
  candidateBooks: string[];
};

export type InvalidResult = {
  status: "invalid";
  issues: string[];
};

const BOOK_MAP: Record<string, string> = {
  // Old Testament
  genesis: "Gen",
  gen: "Gen",
  exodus: "Exod",
  exod: "Exod",
  leviticus: "Lev",
  lev: "Lev",
  numbers: "Num",
  num: "Num",
  deuteronomy: "Deut",
  deut: "Deut",
  joshua: "Josh",
  josh: "Josh",
  judges: "Judg",
  judg: "Judg",
  ruth: "Ruth",
  "1samuel": "1Sam",
  "1sam": "1Sam",
  "2samuel": "2Sam",
  "2sam": "2Sam",
  "1kings": "1Kgs",
  "1kgs": "1Kgs",
  "2kings": "2Kgs",
  "2kgs": "2Kgs",
  "1chronicles": "1Chr",
  "1chr": "1Chr",
  "2chronicles": "2Chr",
  "2chr": "2Chr",
  ezra: "Ezra",
  nehemiah: "Neh",
  neh: "Neh",
  esther: "Esth",
  esth: "Esth",
  job: "Job",
  psalms: "Ps",
  psalm: "Ps",
  ps: "Ps",
  proverbs: "Prov",
  prov: "Prov",
  ecclesiastes: "Eccl",
  eccl: "Eccl",
  songofsolomon: "Song",
  song: "Song",
  isaiah: "Isa",
  isa: "Isa",
  jeremiah: "Jer",
  jer: "Jer",
  lamentations: "Lam",
  lam: "Lam",
  ezekiel: "Ezek",
  ezek: "Ezek",
  daniel: "Dan",
  dan: "Dan",
  hosea: "Hos",
  hos: "Hos",
  joel: "Joel",
  amos: "Amos",
  obadiah: "Obad",
  obad: "Obad",
  jonah: "Jonah",
  micah: "Mic",
  mic: "Mic",
  nahum: "Nah",
  nah: "Nah",
  habakkuk: "Hab",
  hab: "Hab",
  zephaniah: "Zeph",
  zeph: "Zeph",
  haggai: "Hag",
  hag: "Hag",
  zechariah: "Zech",
  zech: "Zech",
  malachi: "Mal",
  mal: "Mal",
  // New Testament
  matthew: "Matt",
  matt: "Matt",
  mat: "Matt",
  mark: "Mark",
  mk: "Mark",
  luke: "Luke",
  lk: "Luke",
  john: "John",
  jn: "John",
  acts: "Acts",
  romans: "Rom",
  rom: "Rom",
  "1corinthians": "1Cor",
  "1cor": "1Cor",
  "2corinthians": "2Cor",
  "2cor": "2Cor",
  galatians: "Gal",
  gal: "Gal",
  ephesians: "Eph",
  eph: "Eph",
  philippians: "Phil",
  phil: "Phil",
  colossians: "Col",
  col: "Col",
  "1thessalonians": "1Thess",
  "1thess": "1Thess",
  "2thessalonians": "2Thess",
  "2thess": "2Thess",
  "1timothy": "1Tim",
  "1tim": "1Tim",
  "2timothy": "2Tim",
  "2tim": "2Tim",
  titus: "Titus",
  philemon: "Phlm",
  phlm: "Phlm",
  hebrews: "Heb",
  heb: "Heb",
  james: "Jas",
  jas: "Jas",
  "1peter": "1Pet",
  "1pet": "1Pet",
  "2peter": "2Pet",
  "2pet": "2Pet",
  "1john": "1John",
  "2john": "2John",
  "3john": "3John",
  jude: "Jude",
  revelation: "Rev",
  rev: "Rev"
};

const AMBIGUOUS_ALIAS: Record<string, string[]> = {
  j: ["John", "James", "Jude"],
  john: ["John", "1 John", "2 John", "3 John"]
};

const API_BOOK_CODE_MAP: Record<string, string> = {
  Gen: "GEN",
  Exod: "EXO",
  Lev: "LEV",
  Num: "NUM",
  Deut: "DEU",
  Josh: "JOS",
  Judg: "JDG",
  Ruth: "RUT",
  "1Sam": "1SA",
  "2Sam": "2SA",
  "1Kgs": "1KI",
  "2Kgs": "2KI",
  "1Chr": "1CH",
  "2Chr": "2CH",
  Ezra: "EZR",
  Neh: "NEH",
  Esth: "EST",
  Job: "JOB",
  Ps: "PSA",
  Prov: "PRO",
  Eccl: "ECC",
  Song: "SNG",
  Isa: "ISA",
  Jer: "JER",
  Lam: "LAM",
  Ezek: "EZK",
  Dan: "DAN",
  Hos: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obad: "OBA",
  Jonah: "JON",
  Mic: "MIC",
  Nah: "NAM",
  Hab: "HAB",
  Zeph: "ZEP",
  Hag: "HAG",
  Zech: "ZEC",
  Mal: "MAL",
  Matt: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Rom: "ROM",
  "1Cor": "1CO",
  "2Cor": "2CO",
  Gal: "GAL",
  Eph: "EPH",
  Phil: "PHP",
  Col: "COL",
  "1Thess": "1TH",
  "2Thess": "2TH",
  "1Tim": "1TI",
  "2Tim": "2TI",
  Titus: "TIT",
  Phlm: "PHM",
  Heb: "HEB",
  Jas: "JAS",
  "1Pet": "1PE",
  "2Pet": "2PE",
  "1John": "1JN",
  "2John": "2JN",
  "3John": "3JN",
  Jude: "JUD",
  Rev: "REV"
};

function normalizeOsis(book: string, chapter: string, startVerse: string): string {
  const apiCode = API_BOOK_CODE_MAP[book] ?? book;
  return `${apiCode}.${chapter}.${startVerse}`;
}

export function canonicalizeReference(input: string): CanonicalizedReference | DisambiguationResult | InvalidResult {
  const sanitized = sanitizeText(input).replace(/\s+/g, " ").trim();
  if (!sanitized) {
    return { status: "invalid", issues: ["Reference is required"] };
  }

  const simple = /^([1-3]?\s?[A-Za-z]+)\s+(\d+)(?::|\s)(\d+)(?:-(\d+))?$/;
  const match = sanitized.match(simple);
  if (!match) {
    return { status: "invalid", issues: ["Unsupported reference format"] };
  }

  const rawBook = match[1].toLowerCase().replace(/\s+/g, "");
  if (AMBIGUOUS_ALIAS[rawBook]) {
    const candidates = AMBIGUOUS_ALIAS[rawBook];
    if (rawBook === "john" && sanitized.toLowerCase().startsWith("john ")) {
      // "John 3:16" is explicit enough for v1 and should resolve directly.
    } else {
      return {
        status: "needs_disambiguation",
        needsUserDisambiguation: true,
        normalizedInput: sanitized,
        candidateBooks: candidates
      };
    }
  }

  if (rawBook === "1john" || rawBook === "2john" || rawBook === "3john") {
    const mappedOrdinal = BOOK_MAP[rawBook];
    if (mappedOrdinal) {
      const chapter = match[2];
      const verseStart = match[3];
      const verseEnd = match[4];
      const canonicalRef = normalizeOsis(mappedOrdinal, chapter, verseStart);
      const result: CanonicalizedReference = {
        status: "resolved",
        displayRef: `${rawBook[0]} John ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ""}`,
        canonicalRef
      };
      if (verseEnd) {
        result.rangeCanonicalRef = `${canonicalRef}-${normalizeOsis(mappedOrdinal, chapter, verseEnd)}`;
      }
      return result;
    }
  }

  const mapped = BOOK_MAP[rawBook];
  if (!mapped) {
    return {
      status: "needs_disambiguation",
      needsUserDisambiguation: true,
      normalizedInput: sanitized,
      candidateBooks: []
    };
  }

  const chapter = match[2];
  const verseStart = match[3];
  const verseEnd = match[4];

  const canonicalRef = normalizeOsis(mapped, chapter, verseStart);
  const result: CanonicalizedReference = {
    status: "resolved",
    displayRef: `${mapped} ${chapter}:${verseStart}${verseEnd ? `-${verseEnd}` : ""}`,
    canonicalRef
  };

  if (verseEnd) {
    result.rangeCanonicalRef = `${canonicalRef}-${normalizeOsis(mapped, chapter, verseEnd)}`;
  }

  return result;
}
