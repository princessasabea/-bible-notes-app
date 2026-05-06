"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useBibleAudio } from "@/components/bible-audio-store";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import { loadFirebaseAudioLibrary, type FirebaseAudioLibrary } from "@/lib/audio/firebase-chapter-audio";

type Props = {
  initialBook: string;
  requestedTranslation: string;
};

type LibraryStatus = "loading" | "ready" | "missing" | "error";

const TRANSLATIONS = ["AMP", "AMPC", "NKJV", "KJV", "ESV"] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayBookFromSlug(value: string): string {
  const found = BIBLE_BOOKS.find((book) => slugify(book.name) === slugify(value));
  return found?.name ?? value.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

export function BookAudioLibrary({ initialBook, requestedTranslation }: Props): React.ReactElement {
  const router = useRouter();
  const bibleAudio = useBibleAudio();
  const [translation, setTranslation] = useState(requestedTranslation.toUpperCase());
  const [library, setLibrary] = useState<FirebaseAudioLibrary | null>(null);
  const [status, setStatus] = useState<LibraryStatus>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [continueNext, setContinueNext] = useState(false);
  const [refreshCount, setRefreshCount] = useState(0);

  const bookName = displayBookFromSlug(initialBook);
  const bookSlug = slugify(bookName);
  const translationSlug = translation.toLowerCase();
  const bookMeta = useMemo(
    () => BIBLE_BOOKS.find((book) => slugify(book.name) === bookSlug) ?? BIBLE_BOOKS.find((book) => book.name === "John") ?? BIBLE_BOOKS[0],
    [bookSlug]
  );
  const readyChapters = library?.books[bookSlug] ?? [];
  const readySet = useMemo(() => new Set(readyChapters), [readyChapters]);
  const chapterCount = bookMeta.chapters;
  const chapters = useMemo(() => Array.from({ length: chapterCount }, (_, index) => index + 1), [chapterCount]);
  const readyCount = readyChapters.length;
  const bookQueueItems = useMemo(
    () => chapters.map((chapter) => ({
      translation: translationSlug,
      book: bookSlug,
      chapter
    })),
    [bookSlug, chapters, translationSlug]
  );

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    setErrorMessage(null);

    loadFirebaseAudioLibrary(translationSlug, bookName)
      .then((result) => {
        if (cancelled) {
          return;
        }

        if (result.library) {
          setLibrary(result.library);
          setStatus((result.library.books[bookSlug]?.length ?? 0) > 0 ? "ready" : "missing");
          return;
        }

        setLibrary(null);
        setStatus("error");
        setErrorMessage(result.errorMessage ?? "The Firebase audio library could not be loaded.");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setLibrary(null);
        setStatus("error");
        setErrorMessage(error instanceof Error ? error.message : "The Firebase audio library could not be loaded.");
      });

    return () => {
      cancelled = true;
    };
  }, [bookName, bookSlug, refreshCount, translationSlug]);

  const handleTranslationChange = (value: string): void => {
    setTranslation(value);
    router.push(`/audio/${bookSlug}?translation=${value.toLowerCase()}`);
  };

  const subtitle = status === "loading"
    ? "Checking prepared narration"
    : readyCount > 0
      ? `${readyCount} of ${chapterCount} chapters ready`
      : "Narration not prepared yet";

  const addBookToQueue = (): void => {
    bibleAudio.addManyToQueue(bookQueueItems);
  };

  const createBookPlaylist = (): void => {
    const name = window.prompt("Playlist name", `${bookName} Study`);
    if (!name) {
      return;
    }
    bibleAudio.createPlaylist(name, bookQueueItems);
  };

  return (
    <main className="book-audio-page">
      <section className="book-audio-hero" aria-label={`${bookName} listening library`}>
        <nav className="book-audio-nav" aria-label="Audio navigation">
          <Link href="/">Home</Link>
          <Link href={`/audio/${bookSlug}/1?translation=${translationSlug}`}>Start chapter 1</Link>
        </nav>

        <div className="book-audio-hero-grid">
          <div className="book-cover-art" aria-hidden="true">
            <span>{translation}</span>
            <strong>{bookName}</strong>
          </div>

          <div className="book-audio-copy">
            <span className="chapter-translation-badge">{translation}</span>
            <h1>{bookName}</h1>
            <p>Choose a prepared chapter and listen to OpenAI narration from Firebase Storage.</p>

            <div className="book-audio-stats" aria-label="Library status">
              <div>
                <strong>{chapterCount}</strong>
                <span>chapters</span>
              </div>
              <div>
                <strong>{readyCount}</strong>
                <span>ready</span>
              </div>
              <div>
                <strong>{translation}</strong>
                <span>translation</span>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="book-audio-controls" aria-label="Book controls">
        <label>
          Translation
          <select value={translation} onChange={(event) => handleTranslationChange(event.target.value)}>
            {TRANSLATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
          </select>
        </label>

        <label className="continue-next-toggle">
          <input
            type="checkbox"
            checked={continueNext}
            onChange={(event) => setContinueNext(event.target.checked)}
          />
          <span>Continue to next chapter</span>
        </label>

        <button type="button" onClick={() => setRefreshCount((count) => count + 1)}>
          Check library
        </button>
        <button type="button" onClick={addBookToQueue}>
          Add whole book to queue
        </button>
        <button type="button" onClick={createBookPlaylist}>
          Create playlist from book
        </button>
        <button type="button" onClick={() => bibleAudio.setQueueOpen(!bibleAudio.queueOpen)}>
          Queue ({bibleAudio.queue.length})
        </button>
      </section>

      <section className="book-now-playing" aria-live="polite">
        <div>
          <span>Now listening</span>
          <h2>{bookName}</h2>
        </div>
        <p>{subtitle}</p>
      </section>

      {status === "error" ? (
        <section className="book-audio-empty" role="status">
          <h2>Library unavailable</h2>
          <p>{errorMessage}</p>
          <button type="button" onClick={() => setRefreshCount((count) => count + 1)}>
            Check again
          </button>
        </section>
      ) : null}

      {status === "missing" ? (
        <section className="book-audio-empty" role="status">
          <h2>Narration not prepared yet</h2>
          <p>Generate and upload {translation} {bookName}, then this page will show playable chapters.</p>
          <pre>{`npm run audio:book -- --translation ${translationSlug} --book ${bookName} --source api\nnpm run audio:upload:book -- --translation ${translationSlug} --book ${bookName} --service-account ./serviceAccountKey.json`}</pre>
        </section>
      ) : null}

      <section className="chapter-grid-section" aria-label={`${bookName} chapters`}>
        <div className="chapter-grid-heading">
          <div>
            <span>{translation}</span>
            <h2>Chapters</h2>
          </div>
          {library?.updatedAt ? <p>Library updated {new Date(library.updatedAt).toLocaleDateString()}</p> : null}
        </div>

        <div className="book-chapter-grid">
          {chapters.map((chapter) => {
            const isReady = readySet.has(chapter);
            return (
              <article key={chapter} className={`book-chapter-card ${isReady ? "is-ready" : "is-missing"}`}>
                <div>
                  <span>Chapter</span>
                  <strong>{chapter}</strong>
                </div>
                <p>{isReady ? "Narration ready" : status === "loading" ? "Checking..." : "Not ready yet"}</p>
                <div className="book-chapter-actions">
                  {isReady ? (
                    <Link href={`/audio/${bookSlug}/${chapter}?translation=${translationSlug}`}>Play</Link>
                  ) : (
                    <button type="button" disabled>Not ready</button>
                  )}
                  <button
                    type="button"
                    onClick={() => bibleAudio.addToQueue({ translation: translationSlug, book: bookSlug, chapter })}
                  >
                    Queue
                  </button>
                </div>
              </article>
            );
          })}
        </div>
      </section>

      {bibleAudio.queueOpen ? (
        <aside className="audio-queue-drawer" aria-label="Listening queue">
          <div className="audio-queue-header">
            <div>
              <span>Up next</span>
              <h2>Queue</h2>
            </div>
            <button type="button" onClick={() => bibleAudio.setQueueOpen(false)}>Close</button>
          </div>
          {bibleAudio.queue.length === 0 ? (
            <p className="audio-queue-empty">Your queue is empty. Add chapters from this book or any chapter page.</p>
          ) : (
            <div className="audio-queue-list">
              {bibleAudio.queue.map((item, index) => (
                <article key={item.id} className="audio-queue-item">
                  <div>
                    <strong>{item.title}</strong>
                    <span>{item.translation.toUpperCase()} · #{index + 1}</span>
                  </div>
                  <div className="audio-queue-actions">
                    <button type="button" onClick={() => bibleAudio.moveQueueItem(item.id, -1)} disabled={index === 0}>Up</button>
                    <button type="button" onClick={() => bibleAudio.moveQueueItem(item.id, 1)} disabled={index === bibleAudio.queue.length - 1}>Down</button>
                    <button type="button" onClick={() => bibleAudio.removeFromQueue(item.id)}>Remove</button>
                  </div>
                </article>
              ))}
            </div>
          )}
          {bibleAudio.queue.length > 0 ? <button type="button" className="audio-queue-clear" onClick={bibleAudio.clearQueue}>Clear queue</button> : null}
          {bibleAudio.playlists.length > 0 ? (
            <div className="audio-playlist-list">
              <span>Playlists</span>
              {bibleAudio.playlists.map((playlist) => (
                <article key={playlist.id}>
                  <strong>{playlist.name}</strong>
                  <p>{playlist.items.length} chapters</p>
                  <button type="button" onClick={() => bibleAudio.addManyToQueue(playlist.items)}>Add to queue</button>
                </article>
              ))}
            </div>
          ) : null}
        </aside>
      ) : null}
    </main>
  );
}
