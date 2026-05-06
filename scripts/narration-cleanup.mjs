const BIBLE_BOOK_PATTERN = [
  "Gen(?:esis)?",
  "Ex(?:od(?:us)?)?",
  "Lev(?:iticus)?",
  "Num(?:bers)?",
  "Deut(?:eronomy)?",
  "Josh(?:ua)?",
  "Judg(?:es)?",
  "Ruth",
  "1\\s*Sam(?:uel)?",
  "2\\s*Sam(?:uel)?",
  "1\\s*Kgs?",
  "2\\s*Kgs?",
  "1\\s*Chron(?:icles)?",
  "2\\s*Chron(?:icles)?",
  "Ezra",
  "Neh(?:emiah)?",
  "Esth(?:er)?",
  "Job",
  "Ps(?:alm|alms)?",
  "Prov(?:erbs)?",
  "Eccl(?:esiastes)?",
  "Song(?:\\s+of\\s+Solomon)?",
  "Isa(?:iah)?",
  "Jer(?:emiah)?",
  "Lam(?:entations)?",
  "Ezek(?:iel)?",
  "Dan(?:iel)?",
  "Hos(?:ea)?",
  "Joel",
  "Amos",
  "Obad(?:iah)?",
  "Jonah",
  "Mic(?:ah)?",
  "Nah(?:um)?",
  "Hab(?:akkuk)?",
  "Zeph(?:aniah)?",
  "Hag(?:gai)?",
  "Zech(?:ariah)?",
  "Mal(?:achi)?",
  "Matt?(?:hew)?",
  "Mark",
  "Luke",
  "John",
  "Acts?",
  "Rom(?:ans)?",
  "1\\s*Cor(?:inthians)?",
  "2\\s*Cor(?:inthians)?",
  "Gal(?:atians)?",
  "Eph(?:esians)?",
  "Phil(?:ippians)?",
  "Col(?:ossians)?",
  "1\\s*Thess(?:alonians)?",
  "2\\s*Thess(?:alonians)?",
  "1\\s*Tim(?:othy)?",
  "2\\s*Tim(?:othy)?",
  "Titus",
  "Philem(?:on)?",
  "Heb(?:rews)?",
  "James",
  "1\\s*Pet(?:e|er)?",
  "2\\s*Pet(?:e|er)?",
  "1\\s*John",
  "2\\s*John",
  "3\\s*John",
  "Jude",
  "Rev(?:elation)?"
].join("|");

const SINGLE_BIBLE_REFERENCE_PATTERN =
  `(?:${BIBLE_BOOK_PATTERN})\\.?\\s+\\d{1,3}:\\d{1,3}(?:[-–]\\d{1,3})?`;

const SHORTHAND_BIBLE_REFERENCE_PATTERN =
  `(?:\\d{1,3}:)?\\d{1,3}(?:[-–]\\d{1,3})?`;

const BIBLE_REFERENCE_CONTENT_PATTERN =
  `(?:see\\s+|cf\\.\\s*)?${SINGLE_BIBLE_REFERENCE_PATTERN}(?:\\s*[,;]\\s*(?:${SINGLE_BIBLE_REFERENCE_PATTERN}|${SHORTHAND_BIBLE_REFERENCE_PATTERN}))*`;

const BIBLE_REFERENCE_CONTENT_REGEX = new RegExp(`^\\s*${BIBLE_REFERENCE_CONTENT_PATTERN}\\s*$`, "i");
const BIBLE_REFERENCE_PARENTHESES_REGEX = new RegExp(`\\(\\s*${BIBLE_REFERENCE_CONTENT_PATTERN}\\s*\\)`, "gi");
const BIBLE_REFERENCE_BRACKETS_REGEX = new RegExp(`\\[\\s*${BIBLE_REFERENCE_CONTENT_PATTERN}\\s*\\]`, "gi");

function normalizeAmpParenthesesForSpeech(text) {
  return text.replace(/\(([^()]+)\)/g, (_match, inner) => {
    if (BIBLE_REFERENCE_CONTENT_REGEX.test(inner)) {
      return "";
    }

    return `, ${inner.trim()},`;
  });
}

function normalizeAmpBracketsForSpeech(text) {
  return text.replace(/\[([^\[\]]+)\]/g, (_match, inner) => {
    if (BIBLE_REFERENCE_CONTENT_REGEX.test(inner)) {
      return "";
    }

    return `, ${inner.trim()},`;
  });
}

function removeFootnoteMarkers(text) {
  return text
    .replace(/\[[a-z]{1,3}\]/gi, "")
    .replace(/\[\d+\]/g, "")
    .replace(/\s+[a-z](?=[,.;:])/gi, "")
    .replace(/[†‡*]+/g, "");
}

function removeVerseNumbers(text) {
  return text
    .replace(/(^|[\n\r])\s*\d{1,3}[\s.]+(?=\S)/g, "$1")
    .replace(/([.!?;:])\s+\d{1,3}\s+(?=[A-Z"“'(\[])/g, "$1 ");
}

function removeSectionLabels(text) {
  return text
    .split(/\r?\n/)
    .filter((line) => {
      const trimmed = line.trim();
      if (!trimmed) {
        return true;
      }

      const words = trimmed.split(/\s+/);
      return !(words.length <= 8 && /^[A-Z0-9 ,;:'"()–-]+$/.test(trimmed) && !/[.!?]$/.test(trimmed));
    })
    .join("\n");
}

function normalizeSpacing(text) {
  return text
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/,\s*,+/g, ",")
    .replace(/,\s*([.!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .replace(/\s*\n\s*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function cleanBibleTextForNarration(text, translation = "amp") {
  const translationSlug = String(translation).toLowerCase();
  let cleaned = text.replace(/\r\n/g, "\n");

  cleaned = removeSectionLabels(cleaned);
  cleaned = removeFootnoteMarkers(cleaned);
  cleaned = cleaned.replace(BIBLE_REFERENCE_PARENTHESES_REGEX, "");
  cleaned = cleaned.replace(BIBLE_REFERENCE_BRACKETS_REGEX, "");
  cleaned = removeVerseNumbers(cleaned);

  if (translationSlug === "amp" || translationSlug === "ampc") {
    cleaned = normalizeAmpParenthesesForSpeech(cleaned);
    cleaned = normalizeAmpBracketsForSpeech(cleaned);
  }

  return normalizeSpacing(cleaned);
}
