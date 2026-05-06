import { describe, expect, it } from "vitest";
import { cleanBibleTextForNarration } from "../scripts/narration-cleanup.mjs";

describe("cleanBibleTextForNarration", () => {
  it("removes AMP verse numbers and Bible-reference parentheses while keeping explanatory parentheses for speech", () => {
    const input = "1 Now there was a certain man among the Pharisees named Nicodemus, a ruler (member of the Sanhedrin) among the Jews. (Mark 8:9)";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "Now there was a certain man among the Pharisees named Nicodemus, a ruler, member of the Sanhedrin, among the Jews."
    );
  });

  it("removes inline verse numbers and common cross references", () => {
    const input = "1 Jesus answered him. 2 This man came to Jesus at night. (John 2:23) 3 Jesus replied, (that is, spiritually reborn) you must be born again. (Matt. 7:21)";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "Jesus answered him. This man came to Jesus at night. Jesus replied, that is, spiritually reborn, you must be born again."
    );
  });

  it("keeps meaningful AMP explanations in parentheses", () => {
    const input = "3 Jesus answered him, Unless a person is born again (that is, spiritually reborn), he cannot see the kingdom of God.";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "Jesus answered him, Unless a person is born again, that is, spiritually reborn, he cannot see the kingdom of God."
    );
  });

  it("removes square-bracket Bible references while keeping explanatory notes", () => {
    const input = "1 In the beginning [Gen 1:3] was the Word. Nicodemus, a ruler (member of the Sanhedrin).";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "In the beginning was the Word. Nicodemus, a ruler, member of the Sanhedrin."
    );
  });

  it("keeps explanatory AMP brackets as spoken commas", () => {
    const input = "28 We know [in accordance with His purpose] that God works all things together. [Rom 8:28]";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "We know, in accordance with His purpose, that God works all things together."
    );
  });

  it("removes Bible references in brackets and parentheses without removing AMP explanations", () => {
    const input = "1 In the beginning [Gen 1:3] was the Word, and Nicodemus was a ruler (member of the Sanhedrin) among the Jews. (Mark 8:9)";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "In the beginning was the Word, and Nicodemus was a ruler, member of the Sanhedrin, among the Jews."
    );
  });

  it("removes ranges and multi-book bracket cross references", () => {
    const input = "3 Jesus answered [John 3:3-5], and God works all things [Rom 8:28; Eph 1:11] according to His purpose [reborn from above].";

    expect(cleanBibleTextForNarration(input, "amp")).toBe(
      "Jesus answered, and God works all things according to His purpose, reborn from above."
    );
  });
});
