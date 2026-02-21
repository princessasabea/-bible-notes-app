import { NextResponse } from "next/server";
import { z } from "zod";
import { canonicalizeReference } from "@/lib/bible/parser";
import { getBibleProvider } from "@/lib/bible/provider";
import { env } from "@/lib/env";
import { assertSameOrigin, sanitizeText } from "@/lib/security";

const requestSchema = z.object({
  reference: z.string().min(1).max(80).transform(sanitizeText),
  preferredTranslations: z.array(z.string().min(2).max(10)).default(["AMP", "NKJV"])
});

export async function POST(request: Request): Promise<Response> {
  try {
    assertSameOrigin(request);
    const payload = await request.json();
    const parsed = requestSchema.safeParse(payload);

    if (!parsed.success) {
      return NextResponse.json(
        { status: "invalid", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }

    const canonicalized = canonicalizeReference(parsed.data.reference);
    if (canonicalized.status === "invalid") {
      return NextResponse.json(
        { status: "invalid", issues: canonicalized.issues },
        { status: 400 }
      );
    }

    if (canonicalized.status === "needs_disambiguation") {
      return NextResponse.json({
        status: "needs_disambiguation",
        needsUserDisambiguation: true,
        normalizedInput: canonicalized.normalizedInput,
        candidateBooks: canonicalized.candidateBooks
      });
    }

    const provider = getBibleProvider();
    const result = await provider.resolveReference({
      canonicalRef: canonicalized.canonicalRef,
      displayRef: canonicalized.displayRef,
      preferredTranslations: parsed.data.preferredTranslations
    });

    if (result.status === "unavailable") {
      console.error("Bible resolve unavailable", result);

      return NextResponse.json({
        status: "unavailable",
        canonicalRef: result.canonicalRef,
        requestedTranslations: result.requestedTranslations,
        supportedTranslations: result.supportedTranslations,
        message: result.message,
        ...(process.env.NODE_ENV === "development" && {
          providerDebug: result.providerDebug
        })
      });
    }

    return NextResponse.json({
      status: "resolved",
      canonicalRef: result.canonicalRef,
      translation: result.translation,
      text: result.text,
      canPersistText: env.allowVerseSnippetStorage
    });
  } catch (error) {
    if (String(error).includes("Origin mismatch")) {
      return NextResponse.json({ error: "Origin mismatch" }, { status: 403 });
    }

    console.error("bible_resolve_failed", { error: String(error) });
    return NextResponse.json(
      {
        error: "Internal server error",
        ...(process.env.NODE_ENV === "development" && { detail: String(error) })
      },
      { status: 500 }
    );
  }
}
