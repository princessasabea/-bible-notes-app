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
});
