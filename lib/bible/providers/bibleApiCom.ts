import type {
    BibleProvider,
    BibleResolveParams,
    BibleResolveResult
} from "../provider";

/**
 * Free Bible provider using bible-api.com (no API key required).
 * Supports public-domain translations: KJV, WEB, and others.
 *
 * The API expects references in the format "Book+Chapter:Verse" or "Book+Chapter:Start-End".
 * Example: https://bible-api.com/john+3:16?translation=kjv
 */

const TRANSLATION_MAP: Record<string, string> = {
    KJV: "kjv",
    WEB: "web"
};

const OSIS_TO_NAME: Record<string, string> = {
    Gen: "genesis",
    Exod: "exodus",
    Lev: "leviticus",
    Num: "numbers",
    Deut: "deuteronomy",
    Josh: "joshua",
    Judg: "judges",
    Ruth: "ruth",
    "1Sam": "1 samuel",
    "2Sam": "2 samuel",
    "1Kgs": "1 kings",
    "2Kgs": "2 kings",
    "1Chr": "1 chronicles",
    "2Chr": "2 chronicles",
    Ezra: "ezra",
    Neh: "nehemiah",
    Esth: "esther",
    Job: "job",
    Ps: "psalms",
    Prov: "proverbs",
    Eccl: "ecclesiastes",
    Song: "song of solomon",
    Isa: "isaiah",
    Jer: "jeremiah",
    Lam: "lamentations",
    Ezek: "ezekiel",
    Dan: "daniel",
    Hos: "hosea",
    Joel: "joel",
    Amos: "amos",
    Obad: "obadiah",
    Jonah: "jonah",
    Mic: "micah",
    Nah: "nahum",
    Hab: "habakkuk",
    Zeph: "zephaniah",
    Hag: "haggai",
    Zech: "zechariah",
    Mal: "malachi",
    Matt: "matthew",
    Mark: "mark",
    Luke: "luke",
    John: "john",
    Acts: "acts",
    Rom: "romans",
    "1Cor": "1 corinthians",
    "2Cor": "2 corinthians",
    Gal: "galatians",
    Eph: "ephesians",
    Phil: "philippians",
    Col: "colossians",
    "1Thess": "1 thessalonians",
    "2Thess": "2 thessalonians",
    "1Tim": "1 timothy",
    "2Tim": "2 timothy",
    Titus: "titus",
    Phlm: "philemon",
    Heb: "hebrews",
    Jas: "james",
    "1Pet": "1 peter",
    "2Pet": "2 peter",
    "1John": "1 john",
    "2John": "2 john",
    "3John": "3 john",
    Jude: "jude",
    Rev: "revelation"
};

function osisToReadable(canonicalRef: string): string | null {
    // canonicalRef format: "Book.Chapter.Verse" e.g. "John.3.16"
    const parts = canonicalRef.split(".");
    if (parts.length < 3) return null;

    const book = OSIS_TO_NAME[parts[0]];
    if (!book) return null;

    const chapter = parts[1];
    const verse = parts[2];

    // Handle range refs like "John.3.16-John.3.18" 
    return `${book}+${chapter}:${verse}`;
}

export class BibleApiComProvider implements BibleProvider {
    async resolveReference(
        params: BibleResolveParams
    ): Promise<BibleResolveResult> {
        const readable = osisToReadable(params.canonicalRef);
        if (!readable) {
            return {
                status: "unavailable",
                canonicalRef: params.canonicalRef,
                requestedTranslations: params.preferredTranslations,
                supportedTranslations: Object.keys(TRANSLATION_MAP),
                message: "Could not convert reference for bible-api.com",
                providerDebug: { provider: "bibleApiCom" }
            };
        }

        // Try each preferred translation, then fallback to KJV
        const translationsToTry = [
            ...params.preferredTranslations,
            "KJV",
            "WEB"
        ].filter((v, i, arr) => arr.indexOf(v) === i);

        const attempts: Array<{
            translation: string;
            status?: number;
            body?: string;
            error?: string;
        }> = [];

        for (const translation of translationsToTry) {
            const apiTranslation = TRANSLATION_MAP[translation];
            if (!apiTranslation) {
                attempts.push({
                    translation,
                    body: `Translation "${translation}" not available on bible-api.com (only KJV, WEB)`
                });
                continue;
            }

            try {
                const url = `https://bible-api.com/${readable}?translation=${apiTranslation}`;
                console.log("bibleApiCom.fetch", { url, translation });

                const res = await fetch(url, { cache: "no-store" });
                if (!res.ok) {
                    attempts.push({
                        translation,
                        status: res.status,
                        body: (await res.text()).slice(0, 280)
                    });
                    continue;
                }

                const json = await res.json();
                const text = (json?.text ?? "").trim();

                if (text) {
                    return {
                        status: "resolved",
                        canonicalRef: params.canonicalRef,
                        translation,
                        text
                    };
                }

                attempts.push({
                    translation,
                    status: res.status,
                    body: "Empty text in response"
                });
            } catch (err) {
                attempts.push({
                    translation,
                    error: String(err)
                });
            }
        }

        return {
            status: "unavailable",
            canonicalRef: params.canonicalRef,
            requestedTranslations: params.preferredTranslations,
            supportedTranslations: Object.keys(TRANSLATION_MAP),
            message: "Reference not available from bible-api.com",
            providerDebug: {
                provider: "bibleApiCom",
                attempts
            }
        };
    }
}
