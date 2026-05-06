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
  "1\\s*Pet(?:er)?",
  "2\\s*Pet(?:er)?",
  "1\\s*John",
  "2\\s*John",
  "3\\s*John",
  "Jude",
  "Rev(?:elation)?"
].join("|");

const BIBLE_REFERENCE_REGEX = new RegExp(
  `\\((?:see\\s+|cf\\.\\s*)?(?:${BIBLE_BOOK_PATTERN})\\.?\\s+\\d{1,3}:\\d{1,3}(?:[-–]\\d{1,3})?(?:\\s*[,;]\\s*(?:\\d{1,3}:)?\\d{1,3}(?:[-–]\\d{1,3})?)*\\)`,
  "gi"
);

function normalizeAmpParenthesesForSpeech(text) {
  return text.replace(/\(([^()]+)\)/g, (_match, inner) => {
    if (BIBLE_REFERENCE_REGEX.test(`(${inner})`)) {
      BIBLE_REFERENCE_REGEX.lastIndex = 0;
      return "";
    }

    BIBLE_REFERENCE_REGEX.lastIndex = 0;
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
  cleaned = cleaned.replace(BIBLE_REFERENCE_REGEX, "");
  cleaned = removeVerseNumbers(cleaned);

  if (translationSlug === "amp" || translationSlug === "ampc") {
    cleaned = normalizeAmpParenthesesForSpeech(cleaned);
  }

  return normalizeSpacing(cleaned);
}
