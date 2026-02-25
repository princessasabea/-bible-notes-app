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
    playlists,
    currentIndex,
    currentVerse,
    isPlaying,
    isPaused,
    playFromIndex,
    playFromCurrent,
    togglePause,
    stop,
    setDrawerOpen,
    setPlaylistModalOpen,
    setNowViewingItem,
    playNowViewing,
    primeSpeechFromUserGesture,
    createPlaylist,
    addChapterToPlaylist
  } = useQueue();

  const [translation, setTranslation] = useState<Translation>(initialTranslation === "AMP" ? "AMP" : "NKJV");
  const [book, setBook] = useState<string>(normalizeBookFromPath(initialBook));
  const [chapter, setChapter] = useState<number>(Number.isFinite(initialChapter) && initialChapter > 0 ? initialChapter : 3);
  const [chapterHtml, setChapterHtml] = useState("");
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [headerCompact, setHeaderCompact] = useState(false);
  const [saveSheetOpen, setSaveSheetOpen] = useState(false);
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [saveToast, setSaveToast] = useState<string | null>(null);

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

  const currentChapterItem = useMemo(() => {
    return buildQueueItem({
      book,
      chapter,
      translation,
      title: buildQueueTitle(book, chapter, translation)
    });
  }, [book, chapter, translation]);

  const showSavedToast = (label: string): void => {
    setSaveToast(label);
    window.setTimeout(() => setSaveToast(null), 2200);
  };

  const saveToExistingPlaylist = async (playlistId: string, playlistName: string): Promise<void> => {
    const ok = await addChapterToPlaylist(playlistId, currentChapterItem);
    if (!ok) {
      setMessage("Unable to save to playlist.");
      return;
    }

    setSaveSheetOpen(false);
    showSavedToast(`Saved to ${playlistName}`);
  };

  const createAndSavePlaylist = async (): Promise<void> => {
    const createdId = await createPlaylist(newPlaylistName);
    if (!createdId) {
      setMessage("Unable to create playlist.");
      return;
    }

    const ok = await addChapterToPlaylist(createdId, currentChapterItem);
    if (!ok) {
      setMessage("Playlist created, but chapter was not saved.");
      return;
    }

    const label = newPlaylistName.trim();
    setNewPlaylistName("");
    setSaveSheetOpen(false);
    showSavedToast(`Saved to ${label}`);
  };

  const handleReadNow = (): void => {
    if (!chapterHtml || loading || isPlaying) {
      return;
    }
    primeSpeechFromUserGesture();
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

          <button type="button" className="ghost-button" onClick={() => setSaveSheetOpen(true)}>
            ⭐ Save to Playlist
          </button>

          <button type="button" className="ghost-button" onClick={() => setPlaylistModalOpen(true)}>
            🎵 Playlists
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
        <button type="button" className="ghost-button" onClick={() => setPlaylistModalOpen(true)}>
          Open Playlists
        </button>
      </div>

      {message ? <p className="status-text reader-message">{message}</p> : null}
      {saveToast ? <div className="playlist-save-toast">{saveToast}</div> : null}

      {saveSheetOpen ? (
        <div className="save-sheet-overlay" role="dialog" aria-modal="true" aria-label="Save to playlist">
          <div className="save-sheet">
            <div className="save-sheet-head">
              <h3>Save to…</h3>
              <button type="button" className="ghost-button" onClick={() => setSaveSheetOpen(false)}>Close</button>
            </div>

            <div className="save-sheet-new">
              <label>
                ➕ New Playlist
                <input
                  value={newPlaylistName}
                  onChange={(event) => setNewPlaylistName(event.target.value)}
                  placeholder="Morning, Study, Sleep..."
                />
              </label>
              <button type="button" onClick={() => void createAndSavePlaylist()} disabled={!newPlaylistName.trim()}>
                Create
              </button>
            </div>

            <div className="save-sheet-list">
              {playlists.length === 0 ? <p className="placeholder-text">No playlists yet.</p> : null}
              {playlists.map((playlist) => (
                <button
                  key={playlist.id}
                  type="button"
                  className="save-sheet-option"
                  onClick={() => void saveToExistingPlaylist(playlist.id, playlist.name)}
                >
                  {playlist.name}
                </button>
              ))}
            </div>
          </div>
        </div>
      ) : null}

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

        .save-sheet-overlay {
          position: fixed;
          inset: 0;
          z-index: 120;
          background: rgba(23, 16, 10, 0.35);
          display: grid;
          align-items: end;
          padding: 0.8rem;
        }

        .save-sheet {
          border-radius: 18px 18px 0 0;
          background: #fff7ec;
          border: 1px solid #e3d1b8;
          box-shadow: 0 -12px 30px rgba(0, 0, 0, 0.2);
          padding: 0.9rem;
          max-height: 72vh;
          overflow: auto;
          display: grid;
          gap: 0.8rem;
        }

        .save-sheet-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
        }

        .save-sheet-head h3 {
          margin: 0;
          font-family: Georgia, "Times New Roman", serif;
        }

        .save-sheet-new {
          display: flex;
          gap: 0.5rem;
          align-items: end;
        }

        .save-sheet-list {
          display: grid;
          gap: 0.45rem;
        }

        .save-sheet-option {
          text-align: left;
          border-radius: 12px;
          background: #fffdf8;
          border: 1px solid #e6d6bf;
          color: #2f251c;
          padding: 0.72rem 0.75rem;
        }

        .playlist-save-toast {
          position: fixed;
          bottom: 7.2rem;
          left: 50%;
          transform: translateX(-50%);
          z-index: 121;
          background: rgba(255, 248, 235, 0.95);
          border: 1px solid #e8d7c0;
          border-radius: 999px;
          padding: 0.42rem 0.88rem;
          color: #4e3b2a;
          box-shadow: 0 6px 16px rgba(0, 0, 0, 0.12);
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
