export type ScriptureVerse = {
  number: string;
  text: string;
};

const ENTITY_MAP: Record<string, string> = {
  amp: "&",
  gt: ">",
  lt: "<",
  nbsp: " ",
  quot: "\"",
  apos: "'"
};

export function decodeHtmlEntities(value: string): string {
  return value.replace(/&(#x?[0-9a-f]+|[a-z]+);/gi, (match, entity: string) => {
    const key = entity.toLowerCase();
    if (key.startsWith("#x")) {
      return String.fromCodePoint(Number.parseInt(key.slice(2), 16));
    }
    if (key.startsWith("#")) {
      return String.fromCodePoint(Number.parseInt(key.slice(1), 10));
    }
    return ENTITY_MAP[key] ?? match;
  });
}

export function htmlToReadableChapterText(html: string): string {
  return decodeHtmlEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<(?:p|div|section|article|header|footer|h[1-6]|br)\b[^>]*>/gi, "\n")
    .replace(/<\/(?:p|div|section|article|header|footer|h[1-6])>/gi, "\n")
    .replace(/<sup\b[^>]*>([\s\S]*?)<\/sup>/gi, " $1 ")
    .replace(/<span\b[^>]*class=["'][^"']*(?:verse|v|label)[^"']*["'][^>]*>([\s\S]*?)<\/span>/gi, " $1 ")
    .replace(/<[^>]*>/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .replace(/\n\s+/g, "\n")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function normalizeVerseMarkers(text: string): string {
  return text
    .replace(/(^|[\n\r]\s*)(\d{1,3})(?=[A-Z“"'([])/g, "$1$2 ")
    .replace(/([.!?;:])\s*(\d{1,3})(?=[A-Z“"'([])/g, "$1 $2 ")
    .replace(/(^|[\n\r]\s*)(\d{1,3})[.)]\s+/g, "$1$2 ")
    .replace(/([.!?;:])\s+(\d{1,3})[.)]\s+/g, "$1 $2 ");
}

export function splitChapterTextIntoVerses(text: string): ScriptureVerse[] {
  const normalized = normalizeVerseMarkers(text).replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const matches = [...normalized.matchAll(/(?:^|\s)(\d{1,3})\s+([\s\S]*?)(?=\s+\d{1,3}\s+(?=[A-Z“"'([])|$)/g)];
  if (matches.length === 0) {
    return [{ number: "1", text: normalized }];
  }

  return matches
    .map((match, index) => ({
      number: match[1] || String(index + 1),
      text: match[2].trim()
    }))
    .filter((verse) => verse.text.length > 0);
}
