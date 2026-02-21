import { describe, expect, it } from "vitest";
import { canonicalizeReference } from "@/lib/bible/parser";

describe("canonicalizeReference", () => {
  it("normalizes standard format", () => {
    const result = canonicalizeReference("John 3:16");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.canonicalRef).toBe("JHN.3.16");
    }
  });

  it("normalizes whitespace separator format", () => {
    const result = canonicalizeReference("John 3 16");
    expect(result.status).toBe("resolved");
  });

  it("supports abbreviations", () => {
    const result = canonicalizeReference("Jn 3:16");
    expect(result.status).toBe("resolved");
  });

  it("supports ranges", () => {
    const result = canonicalizeReference("John 3:16-18");
    expect(result.status).toBe("resolved");
    if (result.status === "resolved") {
      expect(result.rangeCanonicalRef).toBe("JHN.3.16-JHN.3.18");
    }
  });

  it("returns disambiguation for ambiguous alias", () => {
    const result = canonicalizeReference("J 3:16");
    expect(result.status).toBe("needs_disambiguation");
    if (result.status === "needs_disambiguation") {
      expect(result.candidateBooks.length).toBeGreaterThan(0);
    }
  });
});
