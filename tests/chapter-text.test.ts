import { describe, expect, it } from "vitest";
import { htmlToReadableChapterText, splitChapterTextIntoVerses } from "@/lib/bible/chapter-text";

describe("chapter text formatting", () => {
  it("adds spacing when verse numbers are glued to HTML text", () => {
    const html = `<p><span class="v">1</span>Now there was a man.</p><p><span class="v">2</span>This man came to Jesus.</p>`;

    expect(htmlToReadableChapterText(html)).toBe("1 Now there was a man.\n2 This man came to Jesus.");
  });

  it("splits glued verse markers into readable verse blocks", () => {
    const verses = splitChapterTextIntoVerses("1Now there was a man. 2This man came to Jesus at night. 3 Jesus answered him.");

    expect(verses).toEqual([
      { number: "1", text: "Now there was a man." },
      { number: "2", text: "This man came to Jesus at night." },
      { number: "3", text: "Jesus answered him." }
    ]);
  });

  it("keeps the full text as a fallback if no verse markers exist", () => {
    expect(splitChapterTextIntoVerses("Now there was a man.").at(0)).toEqual({
      number: "1",
      text: "Now there was a man."
    });
  });
});
