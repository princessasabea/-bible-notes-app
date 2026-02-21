import { env } from "@/lib/env";
import { ApiBibleProvider } from "./providers/apiBible";
import { BibleApiComProvider } from "./providers/bibleApiCom";

export type BibleResolveParams = {
  canonicalRef: string;
  displayRef: string;
  preferredTranslations: string[];
};

export type BibleResolved = {
  status: "resolved";
  canonicalRef: string;
  translation: string;
  text?: string;
};

export type BibleUnavailable = {
  status: "unavailable";
  canonicalRef: string;
  requestedTranslations: string[];
  supportedTranslations: string[];
  message: string;
  providerDebug?: {
    provider: string;
    attempts?: Array<{
      translation: string;
      bibleId?: string;
      status?: number;
      statusText?: string;
      body?: string;
      error?: string;
    }>;
  };
};

export type BibleResolveResult = BibleResolved | BibleUnavailable;

export interface BibleProvider {
  resolveReference(params: BibleResolveParams): Promise<BibleResolveResult>;
}

class MockBibleProvider implements BibleProvider {
  private verses: Record<string, Record<string, string>> = {
    "JHN.3.16": {
      AMP: "For God so loved the world...",
      NKJV: "For God so loved the world that He gave His only begotten Son..."
    }
  };

  async resolveReference(params: BibleResolveParams): Promise<BibleResolveResult> {
    const verse = this.verses[params.canonicalRef];
    if (!verse) {
      return {
        status: "unavailable",
        canonicalRef: params.canonicalRef,
        requestedTranslations: params.preferredTranslations,
        supportedTranslations: ["AMP", "NKJV"],
        message: "Reference not available from provider (mock mode)",
        providerDebug: { provider: "mock" }
      };
    }

    for (const translation of params.preferredTranslations) {
      if (verse[translation]) {
        return {
          status: "resolved",
          canonicalRef: params.canonicalRef,
          translation,
          text: verse[translation]
        };
      }
    }

    return {
      status: "unavailable",
      canonicalRef: params.canonicalRef,
      requestedTranslations: params.preferredTranslations,
      supportedTranslations: Object.keys(verse),
      message: "Preferred translation unavailable",
      providerDebug: { provider: "mock" }
    };
  }
}

/**
 * Wraps a primary provider with a fallback to bible-api.com.
 * If the primary returns "unavailable", the fallback is tried automatically.
 */
class FallbackBibleProvider implements BibleProvider {
  constructor(
    private primary: BibleProvider,
    private fallback: BibleProvider
  ) { }

  async resolveReference(params: BibleResolveParams): Promise<BibleResolveResult> {
    const result = await this.primary.resolveReference(params);
    if (result.status === "resolved") {
      return result;
    }

    console.log("Primary provider unavailable, trying fallback (bible-api.com)...");
    return this.fallback.resolveReference(params);
  }
}

export function getBibleProvider(): BibleProvider {
  const fallback = new BibleApiComProvider();

  if (env.bibleProvider === "apiBible" || process.env.BIBLE_API_KEY) {
    return new FallbackBibleProvider(new ApiBibleProvider(), fallback);
  }

  return new FallbackBibleProvider(new MockBibleProvider(), fallback);
}
