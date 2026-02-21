"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { BIBLE_BOOKS, buildCanonicalReference, buildDisplayReference } from "@/lib/bible/books";

type Translation = "NKJV" | "AMP";

type ResolveResponse =
  | {
    status: "resolved";
    canonicalRef: string;
    translation: string;
    text?: string;
  }
  | {
    status: "needs_disambiguation";
    normalizedInput: string;
    candidateBooks: string[];
  }
  | {
    status: "unavailable";
    message: string;
    supportedTranslations?: string[];
  }
  | {
    status: "invalid";
    issues?: unknown;
  };

type ChapterResponse =
  | {
    status: "resolved";
    chapterId: string;
    translation: string;
    text: string;
  }
  | {
    status: "unavailable";
    message: string;
  }
  | {
    status: "invalid";
    issues?: unknown;
  };

type VerseNote = {
  id: string;
  canonical_ref: string;
  translation: string | null;
  title: string;
  content: string;
  created_at: string;
};

const TRANSLATIONS: Translation[] = ["NKJV", "AMP"];
const MAX_VERSE = 176;

function formatDate(dateValue: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(dateValue));
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  const tag = target.tagName;
  return target.isContentEditable || tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

async function resolveByTranslation(reference: string, translation: Translation): Promise<{ text: string | null; error: string | null }> {
  const response = await fetch("/api/bible/resolve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ reference, preferredTranslations: [translation] })
  });
  const payload = (await response.json()) as ResolveResponse;

  if (payload.status === "resolved") {
    return { text: payload.text ?? null, error: null };
  }

  if (payload.status === "unavailable") {
    const supported = payload.supportedTranslations?.length ? ` Supported: ${payload.supportedTranslations.join(", ")}` : "";
    return { text: null, error: `${payload.message}${supported}` };
  }

  if (payload.status === "needs_disambiguation") {
    return { text: null, error: `Select a specific book: ${payload.candidateBooks.join(", ")}` };
  }

  return { text: null, error: "Reference is invalid." };
}

export function ScriptureViewer(): React.ReactElement {
  const [book, setBook] = useState("John");
  const [chapter, setChapter] = useState(3);
  const [verse, setVerse] = useState(16);
  const [translation, setTranslation] = useState<Translation>("NKJV");
  const [compareMode, setCompareMode] = useState(false);
  const [chapterText, setChapterText] = useState<string | null>(null);
  const [verseTextByTranslation, setVerseTextByTranslation] = useState<Record<Translation, string | null>>({ NKJV: null, AMP: null });
  const [message, setMessage] = useState<string | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [loadingVerse, setLoadingVerse] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteBody, setNoteBody] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [verseNotes, setVerseNotes] = useState<VerseNote[]>([]);
  const [readerAnimationKey, setReaderAnimationKey] = useState(0);

  const selectedBook = useMemo(() => {
    return BIBLE_BOOKS.find((candidate) => candidate.name === book) ?? BIBLE_BOOKS.find((candidate) => candidate.name === "John")!;
  }, [book]);

  const displayRef = useMemo(() => buildDisplayReference(book, chapter, verse), [book, chapter, verse]);
  const canonicalRef = useMemo(() => buildCanonicalReference(book, chapter, verse), [book, chapter, verse]);

  useEffect(() => {
    if (chapter > selectedBook.chapters) {
      setChapter(1);
    }
  }, [chapter, selectedBook.chapters]);

  useEffect(() => {
    setChapterText(null);
    setMessage(null);
    setVerseTextByTranslation({ NKJV: null, AMP: null });
  }, [book, chapter, verse]);

  useEffect(() => {
    setReaderAnimationKey((current) => current + 1);
  }, [compareMode, translation, verseTextByTranslation.NKJV, verseTextByTranslation.AMP]);

  useEffect(() => {
    const loadVerseNotes = async (): Promise<void> => {
      const params = new URLSearchParams({ canonicalRef, translation });
      const response = await fetch(`/api/verse-notes?${params.toString()}`);
      if (!response.ok) {
        return;
      }
      const payload = await response.json();
      setVerseNotes(payload.notes ?? []);
    };

    loadVerseNotes().catch((error) => {
      console.error("verse_notes_load_failed", error);
    });
  }, [canonicalRef, translation]);

  async function loadChapter(): Promise<void> {
    setLoadingChapter(true);
    setMessage(null);
    try {
      const response = await fetch("/api/bible/chapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ book, chapter, translation })
      });
      const payload = (await response.json()) as ChapterResponse;
      if (payload.status === "resolved") {
        setChapterText(payload.text);
        return;
      }

      setChapterText(null);
      setMessage(payload.status === "unavailable" ? payload.message : "Unable to load chapter.");
    } catch (error) {
      setChapterText(null);
      setMessage("Unable to load chapter.");
      console.error("chapter_load_failed", error);
    } finally {
      setLoadingChapter(false);
    }
  }

  async function resolveVerseSingle(): Promise<void> {
    setLoadingVerse(true);
    setCompareMode(false);
    setMessage(null);
    try {
      const result = await resolveByTranslation(displayRef, translation);
      setVerseTextByTranslation((current) => ({ ...current, [translation]: result.text }));
      setMessage(result.error);
    } catch (error) {
      setMessage("Unable to resolve verse.");
      console.error("verse_resolve_failed", error);
    } finally {
      setLoadingVerse(false);
    }
  }

  async function resolveVerseCompare(): Promise<void> {
    setLoadingVerse(true);
    setCompareMode(true);
    setMessage(null);

    try {
      const [nkjv, amp] = await Promise.all([
        resolveByTranslation(displayRef, "NKJV"),
        resolveByTranslation(displayRef, "AMP")
      ]);

      setVerseTextByTranslation({ NKJV: nkjv.text, AMP: amp.text });
      const errors = [nkjv.error, amp.error].filter((entry): entry is string => Boolean(entry));
      setMessage(errors.length ? errors.join(" | ") : null);
    } catch (error) {
      setMessage("Unable to compare translations.");
      console.error("verse_compare_failed", error);
    } finally {
      setLoadingVerse(false);
    }
  }

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (modalOpen || loadingVerse || isEditableTarget(event.target)) {
        return;
      }

      if (event.key === "[") {
        event.preventDefault();
        if (event.shiftKey) {
          setChapter((current) => Math.max(1, current - 1));
        } else {
          setVerse((current) => Math.max(1, current - 1));
        }
        return;
      }

      if (event.key === "]") {
        event.preventDefault();
        if (event.shiftKey) {
          setChapter((current) => Math.min(selectedBook.chapters, current + 1));
        } else {
          setVerse((current) => Math.min(MAX_VERSE, current + 1));
        }
        return;
      }

      if (event.key.toLowerCase() === "r") {
        event.preventDefault();
        void resolveVerseSingle();
        return;
      }

      if (event.key.toLowerCase() === "c") {
        event.preventDefault();
        void resolveVerseCompare();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [loadingVerse, modalOpen, selectedBook.chapters, translation, displayRef]);

  async function saveVerseNote(): Promise<void> {
    setSavingNote(true);
    setMessage(null);

    try {
      const response = await fetch("/api/verse-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalRef,
          translation,
          title: noteTitle,
          content: noteBody
        })
      });

      if (!response.ok) {
        setMessage("Unable to save note.");
        return;
      }

      const payload = await response.json();
      const created = payload.note as VerseNote;
      setVerseNotes((current) => [created, ...current]);
      setModalOpen(false);
      setNoteTitle("");
      setNoteBody("");
    } catch (error) {
      setMessage("Unable to save note.");
      console.error("verse_note_save_failed", error);
    } finally {
      setSavingNote(false);
    }
  }

  return (
    <div className="page-shell">
      <section className="panel viewer-panel">
        <div className="section-header">
          <div>
            <p className="eyebrow">Bible Tab</p>
            <h2>Scripture Reader</h2>
          </div>
          <button type="button" className="ghost-button" onClick={() => setModalOpen(true)}>
            📝 Add Note
          </button>
        </div>

        <div className="translation-switch" role="tablist" aria-label="Translation switch">
          {TRANSLATIONS.map((entry) => (
            <button
              key={entry}
              type="button"
              className={`translation-chip ${entry === translation ? "is-active" : ""}`}
              onClick={() => setTranslation(entry)}
            >
              {entry}
            </button>
          ))}
        </div>

        <div className="controls-grid picker-grid">
          <label>
            Book
            <select value={book} onChange={(event) => setBook(event.target.value)}>
              {BIBLE_BOOKS.map((entry) => (
                <option key={entry.code} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          <label>
            Chapter
            <select value={chapter} onChange={(event) => setChapter(Number(event.target.value))}>
              {Array.from({ length: selectedBook.chapters }, (_, idx) => idx + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>

          <label>
            Verse
            <select value={verse} onChange={(event) => setVerse(Number(event.target.value))}>
              {Array.from({ length: MAX_VERSE }, (_, idx) => idx + 1).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="action-row reader-actions">
          <button type="button" onClick={resolveVerseSingle} disabled={loadingVerse}>
            {loadingVerse && !compareMode ? "Reading..." : `Read ${translation}`}
          </button>
          <button type="button" className="ghost-button" onClick={resolveVerseCompare} disabled={loadingVerse}>
            {loadingVerse && compareMode ? "Comparing..." : "Compare AMP + NKJV"}
          </button>
          <button type="button" className="ghost-button" onClick={loadChapter} disabled={loadingChapter}>
            {loadingChapter ? "Loading chapter..." : "Open Full Chapter"}
          </button>
        </div>

        <p className="shortcut-hint">Shortcuts: <kbd>[</kbd>/<kbd>]</kbd> verse, <kbd>Shift+[</kbd>/<kbd>Shift+]</kbd> chapter, <kbd>R</kbd> read, <kbd>C</kbd> compare</p>

        <div className="tabs-row" role="tablist" aria-label="Sections">
          <Link href="/" className="tab-link is-active">Scripture</Link>
          <Link href="/notes" className="tab-link">Notes</Link>
        </div>

        <article className="scripture-surface premium-reader" key={`reader-${readerAnimationKey}`}>
          <h3>{displayRef}</h3>
          {!compareMode ? (
            <>
              <p className="reader-translation-label">{translation}</p>
              {verseTextByTranslation[translation] ? (
                <p className="reader-fade">{verseTextByTranslation[translation]}</p>
              ) : (
                <p className="placeholder-text reader-fade">Choose Book, Chapter, Verse and read scripture here.</p>
              )}
            </>
          ) : (
            <div className="compare-grid reader-fade">
              {TRANSLATIONS.map((entry) => (
                <article key={entry} className="compare-card">
                  <h4>{entry}</h4>
                  {verseTextByTranslation[entry] ? (
                    <p>{verseTextByTranslation[entry]}</p>
                  ) : (
                    <p className="placeholder-text">No verse text available.</p>
                  )}
                </article>
              ))}
            </div>
          )}
        </article>

        {chapterText ? (
          <article className="chapter-surface chapter-fade">
            <h4>{book} {chapter} ({translation})</h4>
            <p>{chapterText}</p>
          </article>
        ) : null}

        {message ? <p className="status-text">{message}</p> : null}
      </section>

      <section className="panel">
        <div className="section-header">
          <h3>Recent Notes</h3>
          <Link href="/notes" className="text-link">Open all notes</Link>
        </div>
        {verseNotes.length === 0 ? <p className="placeholder-text">No notes for this verse yet.</p> : null}
        {verseNotes.map((note) => (
          <Link href={`/notes/${note.id}`} key={note.id} className="note-row-link">
            <strong>{note.title || "Untitled reflection"}</strong>
            <span>{formatDate(note.created_at)}</span>
          </Link>
        ))}
      </section>

      {modalOpen ? (
        <div className="modal-backdrop" role="presentation" onClick={() => setModalOpen(false)}>
          <div className="modal-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <h3>📖 {displayRef} ({translation})</h3>
            <label>
              Title
              <input value={noteTitle} onChange={(event) => setNoteTitle(event.target.value)} placeholder="My Reflection" />
            </label>
            <label>
              Journal
              <textarea
                value={noteBody}
                onChange={(event) => setNoteBody(event.target.value)}
                placeholder="Write your reflection..."
                rows={10}
              />
            </label>
            <div className="action-row">
              <button type="button" onClick={saveVerseNote} disabled={savingNote || noteBody.trim().length === 0}>
                {savingNote ? "Saving..." : "Save"}
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  setNoteTitle("");
                  setNoteBody("");
                }}
              >
                Clear
              </button>
              <button type="button" className="ghost-button" onClick={() => setModalOpen(false)}>
                Close
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
