"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import { buildQueueItem, useQueue } from "@/components/queue-context";

type Translation = "NKJV" | "AMP";

type ChapterResponse =
  | { status: "resolved"; chapterId: string; translation: string; html?: string; text: string }
  | { status: "unavailable"; message: string }
  | { status: "invalid"; issues?: unknown };

const TRANSLATIONS: Translation[] = ["NKJV", "AMP"];

function normalizeBookFromPath(pathValue: string): string {
  const decoded = decodeURIComponent(pathValue).replace(/-/g, " ").trim();
  const exact = BIBLE_BOOKS.find((entry) => entry.name.toLowerCase() === decoded.toLowerCase());
  return exact?.name ?? "John";
}

function extractVerseNumbersFromHtml(chapterHtml: string): number[] {
  const parser = new DOMParser();
  const doc = parser.parseFromString(chapterHtml, "text/html");
  const seen = new Set<number>();
  const verseNumbers: number[] = [];

  for (const sup of Array.from(doc.querySelectorAll("p sup"))) {
    const number = Number((sup.textContent ?? "").replace(/\D+/g, ""));
    if (!Number.isFinite(number) || number < 1 || seen.has(number)) {
      continue;
    }

    seen.add(number);
    verseNumbers.push(number);
  }

  return verseNumbers;
}

function buildQueueTitle(book: string, chapter: number, translation: string): string {
  return `${book} ${chapter} (${translation})`;
}

export function ReaderMode({
  initialTranslation,
  initialBook,
  initialChapter
}: {
  initialTranslation: string;
  initialBook: string;
  initialChapter: number;
}): React.ReactElement {
  const router = useRouter();
  const {
    addToQueue,
    queue,
    currentIndex,
    currentVerse,
    isPlaying,
    isPaused,
    playFromIndex,
    playFromCurrent,
    togglePause,
    stop,
    setDrawerOpen,
    setNowViewingItem,
    playNowViewing
  } = useQueue();

  const [translation, setTranslation] = useState<Translation>(initialTranslation === "AMP" ? "AMP" : "NKJV");
  const [book, setBook] = useState<string>(normalizeBookFromPath(initialBook));
  const [chapter, setChapter] = useState<number>(Number.isFinite(initialChapter) && initialChapter > 0 ? initialChapter : 3);
  const [chapterHtml, setChapterHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [headerCompact, setHeaderCompact] = useState(false);

  const selectedBook = useMemo(() => {
    return BIBLE_BOOKS.find((entry) => entry.name === book) ?? BIBLE_BOOKS.find((entry) => entry.name === "John")!;
  }, [book]);

  const verseNumbers = useMemo(() => extractVerseNumbersFromHtml(chapterHtml), [chapterHtml]);

  const currentQueueItem = queue[currentIndex] ?? null;
  const isCurrentPlaybackChapter = Boolean(
    currentQueueItem &&
      currentQueueItem.book === book &&
      currentQueueItem.chapter === chapter &&
      currentQueueItem.translation === translation
  );

  useEffect(() => {
    if (chapter > selectedBook.chapters) {
      setChapter(1);
    }
  }, [chapter, selectedBook.chapters]);

  useEffect(() => {
    const handleScroll = (): void => {
      setHeaderCompact(window.scrollY > 28);
    };

    handleScroll();
    window.addEventListener("scroll", handleScroll, { passive: true });
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  useEffect(() => {
    const nextPath = `/read/${translation}/${encodeURIComponent(book)}/${chapter}`;
    router.replace(nextPath as never);
  }, [translation, book, chapter, router]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setMessage(null);

      try {
        const response = await fetch("/api/bible/chapter", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ book, chapter, translation })
        });

        const payload = (await response.json()) as ChapterResponse;
        if (payload.status !== "resolved") {
          setChapterHtml("");
          setMessage(payload.status === "unavailable" ? payload.message : "Unable to load chapter.");
          return;
        }

        setChapterHtml(payload.html ?? "");
      } catch (error) {
        setChapterHtml("");
        setMessage("Unable to load chapter.");
        console.error("reader_chapter_failed", error);
      } finally {
        setLoading(false);
      }
    };

    void load();
  }, [book, chapter, translation]);

  useEffect(() => {
    if (!isCurrentPlaybackChapter || currentVerse === null) {
      return;
    }

    const root = document.querySelector(".bible-content");
    if (!(root instanceof HTMLElement)) {
      return;
    }

    for (const sup of Array.from(root.querySelectorAll("sup"))) {
      sup.classList.remove("active-verse-marker");
    }

    const matchingSup = Array.from(root.querySelectorAll("p sup")).find((sup) => {
      const numeric = Number((sup.textContent ?? "").replace(/\D+/g, ""));
      return Number.isFinite(numeric) && numeric === currentVerse;
    });

    if (matchingSup instanceof HTMLElement) {
      matchingSup.classList.add("active-verse-marker");
      matchingSup.scrollIntoView({ behavior: "smooth", block: "center" });
    }
  }, [currentVerse, isCurrentPlaybackChapter]);

  const ensureCurrentChapterInQueue = (): number => {
    const queueIndex = queue.findIndex((item) => {
      return (
        item.book === book &&
        item.chapter === chapter &&
        item.translation === translation
      );
    });

    if (queueIndex >= 0) {
      return queueIndex;
    }

    const queueItem = buildQueueItem({
      book,
      chapter,
      translation,
      title: buildQueueTitle(book, chapter, translation)
    });

    addToQueue(queueItem);
    return queue.length;
  };

  const handleAddToQueue = (): void => {
    ensureCurrentChapterInQueue();
    setDrawerOpen(true);
  };

  const handleReadNow = (): void => {
    if (!chapterHtml || loading || isPlaying) {
      return;
    }
    void playNowViewing();
  };

  useEffect(() => {
    setNowViewingItem(
      buildQueueItem({
        book,
        chapter,
        translation,
        title: buildQueueTitle(book, chapter, translation)
      })
    );

    return () => {
      setNowViewingItem(null);
    };
  }, [book, chapter, setNowViewingItem, translation]);

  return (
    <div className="reader-page">
      <header className={`reader-header ${headerCompact ? "is-compact" : ""}`}>
        <Link href="/" className="reader-back">Back</Link>
        <div className="reader-title">{book} {chapter}</div>
        <label className="reader-translation-select">
          <span className="sr-only">Translation</span>
          <select value={translation} onChange={(event) => setTranslation(event.target.value as Translation)}>
            {TRANSLATIONS.map((entry) => (
              <option key={entry} value={entry}>{entry}</option>
            ))}
          </select>
        </label>
      </header>

      <main className="reader-main">
        <section className="reader-controls card">
          <label>
            Book
            <select value={book} onChange={(event) => setBook(event.target.value)}>
              {BIBLE_BOOKS.map((entry) => (
                <option key={entry.code} value={entry.name}>{entry.name}</option>
              ))}
            </select>
          </label>

          <label>
            Chapter
            <select value={chapter} onChange={(event) => setChapter(Number(event.target.value))}>
              {Array.from({ length: selectedBook.chapters }, (_, idx) => idx + 1).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </label>

          <button type="button" className="ghost-button" onClick={handleAddToQueue}>
            + Add to Queue
          </button>

          <button type="button" onClick={handleReadNow} disabled={!chapterHtml || loading || isPlaying}>
            🎧 Read Chapter
          </button>
        </section>

        <section className="scripture-card card">
          <h2>{book} {chapter} ({translation})</h2>
          {loading ? <p className="placeholder-text">Loading chapter...</p> : null}
          {!loading && !chapterHtml ? <p className="placeholder-text">No verses available.</p> : null}
          {chapterHtml ? (
            <div className="bible-content" dangerouslySetInnerHTML={{ __html: chapterHtml }} />
          ) : null}
        </section>
      </main>

      <div className="reader-toolbar">
        {!isPlaying ? (
          <button type="button" onClick={() => void playFromCurrent()} disabled={queue.length === 0}>
            ▶ Play Queue
          </button>
        ) : (
          <button type="button" onClick={togglePause}>
            {isPaused ? "▶ Resume" : "⏸ Pause"}
          </button>
        )}
        <button type="button" className="ghost-button" onClick={stop} disabled={!isPlaying && !isPaused}>
          ⏹ Stop
        </button>
        <button type="button" className="ghost-button" onClick={() => setDrawerOpen(true)}>
          Open Queue
        </button>
      </div>

      {message ? <p className="status-text reader-message">{message}</p> : null}

      <style jsx>{`
        .reader-page {
          min-height: 100vh;
          background: #f7f5f1;
          padding: 1rem 1rem 7.75rem;
        }

        .reader-header {
          position: sticky;
          top: 0;
          z-index: 20;
          display: grid;
          grid-template-columns: auto 1fr auto;
          gap: 0.8rem;
          align-items: center;
          padding: 0.8rem 1rem;
          border-radius: 14px;
          border: 1px solid #d9d2c8;
          background: rgba(250, 247, 241, 0.94);
          backdrop-filter: blur(8px);
          margin-bottom: 0.8rem;
          transition: padding 180ms ease;
        }

        .reader-header.is-compact {
          padding: 0.45rem 0.75rem;
        }

        .reader-back {
          color: #7a5532;
          font-weight: 600;
        }

        .reader-title {
          text-align: center;
          font-family: Georgia, "Times New Roman", serif;
        }

        .reader-main {
          display: grid;
          gap: 0.9rem;
        }

        .card {
          border: 1px solid #d9d2c8;
          border-radius: 16px;
          background: #fffaf2;
          box-shadow: 0 10px 24px rgba(90, 66, 40, 0.08);
          padding: 1rem;
        }

        .reader-controls {
          display: grid;
          gap: 0.75rem;
          grid-template-columns: repeat(4, minmax(0, 1fr));
        }

        .scripture-card {
          max-width: 680px;
          margin: 0 auto;
          width: 100%;
        }

        .scripture-card h2 {
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(1.35rem, 2.2vw, 1.75rem);
          text-align: center;
          margin-bottom: 1rem;
        }

        .bible-content {
          max-width: 680px;
          margin: 0 auto;
          font-size: 1.05rem;
          line-height: 1.8;
          letter-spacing: 0.01em;
        }

        .bible-content :global(h3),
        .bible-content :global(h4),
        .bible-content :global(.s1),
        .bible-content :global(.ms),
        .bible-content :global(.mt) {
          font-size: 1.3rem;
          margin-top: 2rem;
          margin-bottom: 1rem;
          font-weight: 600;
        }

        .bible-content :global(p) {
          margin-bottom: 1.2rem;
          font-family: Georgia, "Times New Roman", serif;
          font-size: clamp(1.08rem, 2vw, 1.25rem);
        }

        .bible-content :global(sup) {
          font-size: 0.65rem;
          vertical-align: super;
          color: #888;
          margin-right: 4px;
          transition: background-color 180ms ease;
          border-radius: 6px;
          padding: 0 0.18rem;
        }

        .bible-content :global(sup.active-verse-marker) {
          background: #f8edb4;
        }

        .reader-toolbar {
          position: fixed;
          right: 1rem;
          bottom: 7rem;
          z-index: 18;
          display: flex;
          gap: 0.55rem;
          flex-wrap: wrap;
          justify-content: flex-end;
          max-width: min(95vw, 620px);
        }

        .placeholder-text,
        .reader-message {
          text-align: center;
          color: #7b6957;
        }

        @media (max-width: 900px) {
          .reader-controls {
            grid-template-columns: repeat(2, minmax(0, 1fr));
          }

          .reader-toolbar {
            left: 1rem;
            right: 1rem;
            justify-content: stretch;
          }

          .reader-toolbar :global(button) {
            flex: 1;
          }
        }
      `}</style>
    </div>
  );
}
