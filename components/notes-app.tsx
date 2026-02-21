"use client";

import { useEffect, useMemo, useState } from "react";
import type { Note, NoteBlock, VerseBlock } from "@/lib/types";
import { readCachedNotes, writeCachedNotes } from "@/lib/cache/indexeddb";

type ResolvedVerseState =
  | {
    status: "resolved";
    canonicalRef: string;
    translation: string;
    text?: string;
    canPersistText?: boolean;
  }
  | {
    status: "needs_disambiguation";
    candidateBooks: string[];
    normalizedInput: string;
  }
  | {
    status: "unavailable";
    message: string;
    supportedTranslations?: string[];
    providerDebug?: {
      provider?: string;
      attempts?: Array<{
        translation?: string;
        endpoint?: string;
        bibleId?: string;
        status?: number;
        statusText?: string;
        body?: string;
        error?: string;
      }>;
    };
  }
  | {
    status: "invalid";
    issues?: unknown;
  }
  | null;

type VerseNote = {
  id: string;
  canonical_ref: string;
  translation: string | null;
  content: string;
  created_at: string;
  updated_at: string;
};

type BibleBook = {
  name: string;
  chapters: number;
};

const BOOK_TO_CANONICAL: Record<string, string> = {
  Genesis: "GEN",
  Exodus: "EXO",
  Leviticus: "LEV",
  Numbers: "NUM",
  Deuteronomy: "DEU",
  Joshua: "JOS",
  Judges: "JDG",
  Ruth: "RUT",
  "1 Samuel": "1SA",
  "2 Samuel": "2SA",
  "1 Kings": "1KI",
  "2 Kings": "2KI",
  "1 Chronicles": "1CH",
  "2 Chronicles": "2CH",
  Ezra: "EZR",
  Nehemiah: "NEH",
  Esther: "EST",
  Job: "JOB",
  Psalms: "PSA",
  Proverbs: "PRO",
  Ecclesiastes: "ECC",
  "Song of Solomon": "SNG",
  Isaiah: "ISA",
  Jeremiah: "JER",
  Lamentations: "LAM",
  Ezekiel: "EZK",
  Daniel: "DAN",
  Hosea: "HOS",
  Joel: "JOL",
  Amos: "AMO",
  Obadiah: "OBA",
  Jonah: "JON",
  Micah: "MIC",
  Nahum: "NAM",
  Habakkuk: "HAB",
  Zephaniah: "ZEP",
  Haggai: "HAG",
  Zechariah: "ZEC",
  Malachi: "MAL",
  Matthew: "MAT",
  Mark: "MRK",
  Luke: "LUK",
  John: "JHN",
  Acts: "ACT",
  Romans: "ROM",
  "1 Corinthians": "1CO",
  "2 Corinthians": "2CO",
  Galatians: "GAL",
  Ephesians: "EPH",
  Philippians: "PHP",
  Colossians: "COL",
  "1 Thessalonians": "1TH",
  "2 Thessalonians": "2TH",
  "1 Timothy": "1TI",
  "2 Timothy": "2TI",
  Titus: "TIT",
  Philemon: "PHM",
  Hebrews: "HEB",
  James: "JAS",
  "1 Peter": "1PE",
  "2 Peter": "2PE",
  "1 John": "1JN",
  "2 John": "2JN",
  "3 John": "3JN",
  Jude: "JUD",
  Revelation: "REV"
};

const BOOKS: BibleBook[] = [
  { name: "Genesis", chapters: 50 },
  { name: "Exodus", chapters: 40 },
  { name: "Leviticus", chapters: 27 },
  { name: "Numbers", chapters: 36 },
  { name: "Deuteronomy", chapters: 34 },
  { name: "Joshua", chapters: 24 },
  { name: "Judges", chapters: 21 },
  { name: "Ruth", chapters: 4 },
  { name: "1 Samuel", chapters: 31 },
  { name: "2 Samuel", chapters: 24 },
  { name: "1 Kings", chapters: 22 },
  { name: "2 Kings", chapters: 25 },
  { name: "1 Chronicles", chapters: 29 },
  { name: "2 Chronicles", chapters: 36 },
  { name: "Ezra", chapters: 10 },
  { name: "Nehemiah", chapters: 13 },
  { name: "Esther", chapters: 10 },
  { name: "Job", chapters: 42 },
  { name: "Psalms", chapters: 150 },
  { name: "Proverbs", chapters: 31 },
  { name: "Ecclesiastes", chapters: 12 },
  { name: "Song of Solomon", chapters: 8 },
  { name: "Isaiah", chapters: 66 },
  { name: "Jeremiah", chapters: 52 },
  { name: "Lamentations", chapters: 5 },
  { name: "Ezekiel", chapters: 48 },
  { name: "Daniel", chapters: 12 },
  { name: "Hosea", chapters: 14 },
  { name: "Joel", chapters: 3 },
  { name: "Amos", chapters: 9 },
  { name: "Obadiah", chapters: 1 },
  { name: "Jonah", chapters: 4 },
  { name: "Micah", chapters: 7 },
  { name: "Nahum", chapters: 3 },
  { name: "Habakkuk", chapters: 3 },
  { name: "Zephaniah", chapters: 3 },
  { name: "Haggai", chapters: 2 },
  { name: "Zechariah", chapters: 14 },
  { name: "Malachi", chapters: 4 },
  { name: "Matthew", chapters: 28 },
  { name: "Mark", chapters: 16 },
  { name: "Luke", chapters: 24 },
  { name: "John", chapters: 21 },
  { name: "Acts", chapters: 28 },
  { name: "Romans", chapters: 16 },
  { name: "1 Corinthians", chapters: 16 },
  { name: "2 Corinthians", chapters: 13 },
  { name: "Galatians", chapters: 6 },
  { name: "Ephesians", chapters: 6 },
  { name: "Philippians", chapters: 4 },
  { name: "Colossians", chapters: 4 },
  { name: "1 Thessalonians", chapters: 5 },
  { name: "2 Thessalonians", chapters: 3 },
  { name: "1 Timothy", chapters: 6 },
  { name: "2 Timothy", chapters: 4 },
  { name: "Titus", chapters: 3 },
  { name: "Philemon", chapters: 1 },
  { name: "Hebrews", chapters: 13 },
  { name: "James", chapters: 5 },
  { name: "1 Peter", chapters: 5 },
  { name: "2 Peter", chapters: 3 },
  { name: "1 John", chapters: 5 },
  { name: "2 John", chapters: 1 },
  { name: "3 John", chapters: 1 },
  { name: "Jude", chapters: 1 },
  { name: "Revelation", chapters: 22 }
];

const defaultNoteContent = { contentVersion: 1, blocks: [] as NoteBlock[] };

function buildReference(book: string, chapter: number, verseStart: number, verseEnd: number | null): string {
  if (verseEnd && verseEnd > verseStart) {
    return `${book} ${chapter}:${verseStart}-${verseEnd}`;
  }
  return `${book} ${chapter}:${verseStart}`;
}

function buildCanonicalReference(book: string, chapter: number, verseStart: number, verseEnd: number | null): string {
  const code = BOOK_TO_CANONICAL[book] ?? book;
  if (verseEnd && verseEnd > verseStart) {
    return `${code}.${chapter}.${verseStart}-${code}.${chapter}.${verseEnd}`;
  }
  return `${code}.${chapter}.${verseStart}`;
}

function buildPreferredTranslations(primary: string): string[] {
  return [primary, "AMP", "NKJV"].filter((value, index, arr) => arr.indexOf(value) === index);
}

function formatDate(value: string): string {
  const date = new Date(value);
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "2-digit",
    year: "numeric"
  }).format(date);
}

export function NotesApp(): React.ReactElement {
  const [notes, setNotes] = useState<Note[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [title, setTitle] = useState("");
  const [textBlock, setTextBlock] = useState("");
  const [textType, setTextType] = useState<"paragraph" | "heading">("paragraph");
  const [selectedBook, setSelectedBook] = useState("John");
  const [selectedChapter, setSelectedChapter] = useState(3);
  const [selectedVerseStart, setSelectedVerseStart] = useState(16);
  const [selectedVerseEnd, setSelectedVerseEnd] = useState<number | null>(null);
  const [translation, setTranslation] = useState("AMP");
  const [resolvedVerse, setResolvedVerse] = useState<ResolvedVerseState>(null);
  const [resolvingVerse, setResolvingVerse] = useState(false);
  const [chapterText, setChapterText] = useState<string | null>(null);
  const [chapterMeta, setChapterMeta] = useState<{ chapterId: string; translation: string } | null>(null);
  const [loadingChapter, setLoadingChapter] = useState(false);
  const [verseNoteInput, setVerseNoteInput] = useState("");
  const [verseNotes, setVerseNotes] = useState<VerseNote[]>([]);
  const [loadingVerseNotes, setLoadingVerseNotes] = useState(false);
  const [savingVerseNote, setSavingVerseNote] = useState(false);
  const [offline, setOffline] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const selected = useMemo(
    () => notes.find((note) => note.id === selectedId) ?? null,
    [notes, selectedId]
  );

  const selectedBookMeta = useMemo(
    () => BOOKS.find((book) => book.name === selectedBook) ?? BOOKS.find((book) => book.name === "John")!,
    [selectedBook]
  );

  const currentReference = useMemo(
    () => buildReference(selectedBook, selectedChapter, selectedVerseStart, selectedVerseEnd),
    [selectedBook, selectedChapter, selectedVerseStart, selectedVerseEnd]
  );

  const currentCanonicalRef = useMemo(
    () => buildCanonicalReference(selectedBook, selectedChapter, selectedVerseStart, selectedVerseEnd),
    [selectedBook, selectedChapter, selectedVerseStart, selectedVerseEnd]
  );

  useEffect(() => {
    const initialize = async (): Promise<void> => {
      const cached = (await readCachedNotes()) as Note[];
      if (cached.length) {
        setNotes(cached);
        setSelectedId(cached[0].id);
      }

      await refreshNotes();
    };

    initialize().catch((error) => {
      console.error("notes_init_failed", error);
      setMessage("Failed to load notes.");
    });
  }, []);

  useEffect(() => {
    const updateOnlineStatus = (): void => {
      setOffline(!navigator.onLine);
    };

    updateOnlineStatus();
    window.addEventListener("online", updateOnlineStatus);
    window.addEventListener("offline", updateOnlineStatus);

    return () => {
      window.removeEventListener("online", updateOnlineStatus);
      window.removeEventListener("offline", updateOnlineStatus);
    };
  }, []);

  useEffect(() => {
    if (selectedChapter > selectedBookMeta.chapters) {
      setSelectedChapter(1);
    }
  }, [selectedBookMeta.chapters, selectedChapter]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      if (!navigator.onLine) {
        return;
      }
      setLoadingVerseNotes(true);
      try {
        const params = new URLSearchParams({
          canonicalRef: currentCanonicalRef,
          translation
        });

        const response = await fetch(`/api/verse-notes?${params.toString()}`);
        if (!response.ok) {
          return;
        }

        const payload = (await response.json()) as { notes: VerseNote[] };
        setVerseNotes(payload.notes ?? []);
      } finally {
        setLoadingVerseNotes(false);
      }
    };

    load().catch((error) => {
      console.error("verse_notes_load_failed", error);
    });
  }, [currentCanonicalRef, translation]);

  async function refreshNotes(): Promise<void> {
    if (!navigator.onLine) {
      return;
    }

    const response = await fetch("/api/notes", { method: "GET" });
    if (!response.ok) {
      return;
    }

    const data = (await response.json()) as { notes: Note[] };
    setNotes(data.notes);
    if (data.notes.length && !selectedId) {
      setSelectedId(data.notes[0].id);
    }

    await writeCachedNotes(data.notes);
  }

  async function createNote(): Promise<void> {
    if (offline) {
      setMessage("Offline mode is read-only.");
      return;
    }

    const payload = {
      title: title || "Untitled",
      contentVersion: 1,
      content: defaultNoteContent
    };

    const response = await fetch("/api/notes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      setMessage(errorPayload.error ?? "Could not create note. Check auth/session and DB schema.");
      return;
    }

    const data = (await response.json()) as { note: Note };
    const next = [data.note, ...notes];
    setNotes(next);
    setSelectedId(data.note.id);
    await writeCachedNotes(next);
    setMessage("Note created.");
  }

  async function saveNote(nextBlocks: NoteBlock[]): Promise<void> {
    if (!selected || offline) {
      setMessage("Offline mode is read-only.");
      return;
    }

    const payload = {
      title: selected.title,
      contentVersion: 1,
      content: {
        contentVersion: 1,
        blocks: nextBlocks
      }
    };

    const response = await fetch(`/api/notes/${selected.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const errorPayload = await response.json().catch(() => ({}));
      setMessage(errorPayload.error ?? "Could not save note.");
      return;
    }

    const data = (await response.json()) as { note: Note };
    const next = notes.map((note) => (note.id === selected.id ? data.note : note));
    setNotes(next);
    await writeCachedNotes(next);
    setMessage("Saved.");
  }

  async function addTextBlock(): Promise<void> {
    if (!selected || !textBlock.trim()) {
      return;
    }

    const block: NoteBlock = { type: textType, text: textBlock };
    const nextBlocks = [...selected.content.blocks, block];
    await saveNote(nextBlocks);
    setTextBlock("");
  }

  async function resolveVerse(): Promise<void> {
    setResolvingVerse(true);
    try {
      const response = await fetch("/api/bible/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: currentReference,
          preferredTranslations: buildPreferredTranslations(translation)
        })
      });

      const raw = await response.text();
      let payload: Record<string, unknown> = {};
      try {
        payload = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
      } catch {
        payload = { status: "invalid", issues: raw || "Non-JSON response from server" };
      }

      if (!response.ok && payload.status === "invalid") {
        setResolvedVerse({ status: "invalid", issues: payload.issues });
        return;
      }

      if (payload.status === "needs_disambiguation") {
        const candidateBooks = Array.isArray(payload.candidateBooks)
          ? payload.candidateBooks.map((value) => String(value))
          : [];
        setResolvedVerse({
          status: "needs_disambiguation",
          candidateBooks,
          normalizedInput: String(payload.normalizedInput ?? currentReference)
        });
        return;
      }

      if (payload.status === "unavailable") {
        const supportedTranslations = Array.isArray(payload.supportedTranslations)
          ? payload.supportedTranslations.map((value) => String(value))
          : undefined;
        const providerDebug =
          payload.providerDebug && typeof payload.providerDebug === "object"
            ? (payload.providerDebug as ResolvedVerseState extends { status: "unavailable"; providerDebug?: infer T } ? T : never)
            : undefined;
        setResolvedVerse({
          status: "unavailable",
          message: String(payload.message ?? "Verse unavailable."),
          supportedTranslations,
          providerDebug
        });
        return;
      }

      if (payload.status === "resolved") {
        setResolvedVerse({
          status: "resolved",
          canonicalRef: String(payload.canonicalRef ?? ""),
          translation: String(payload.translation ?? ""),
          text: typeof payload.text === "string" ? payload.text : undefined,
          canPersistText: Boolean(payload.canPersistText)
        });
        return;
      }

      setResolvedVerse({ status: "invalid", issues: payload?.issues ?? "Unexpected response" });
    } catch (error) {
      setResolvedVerse({ status: "invalid", issues: String(error) });
    } finally {
      setResolvingVerse(false);
    }
  }

  async function loadFullChapter(): Promise<void> {
    setLoadingChapter(true);
    setChapterText(null);
    setChapterMeta(null);
    try {
      const response = await fetch("/api/bible/chapter", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          book: selectedBook,
          chapter: selectedChapter,
          translation
        })
      });

      const payload = await response.json();
      if (payload.status !== "resolved" || !payload.text) {
        const debugSuffix =
          payload.providerDebug && process.env.NODE_ENV === "development"
            ? ` Debug: ${JSON.stringify(payload.providerDebug)}`
            : "";
        setMessage(`${payload.message ?? "Could not load chapter."}${debugSuffix}`);
        if (payload.providerDebug) {
          console.log("chapter_provider_debug", payload.providerDebug);
        }
        return;
      }

      setChapterText(String(payload.text));
      setChapterMeta({
        chapterId: String(payload.chapterId),
        translation: String(payload.translation)
      });
    } catch (error) {
      setMessage(`Could not load chapter: ${String(error)}`);
    } finally {
      setLoadingChapter(false);
    }
  }

  async function saveVerseNote(): Promise<void> {
    if (!verseNoteInput.trim()) {
      setMessage("Write something before saving.");
      return;
    }

    if (offline) {
      setMessage("Offline mode is read-only.");
      return;
    }

    setSavingVerseNote(true);
    try {
      const response = await fetch("/api/verse-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalRef: currentCanonicalRef,
          translation,
          content: verseNoteInput
        })
      });

      const payload = await response.json();
      if (!response.ok) {
        setMessage(payload.error ?? "Could not save verse note.");
        return;
      }

      const note = payload.note as VerseNote;
      setVerseNotes((prev) => [note, ...prev]);
      setVerseNoteInput("");
      setMessage("Verse note saved.");
    } catch (error) {
      setMessage(`Could not save verse note: ${String(error)}`);
    } finally {
      setSavingVerseNote(false);
    }
  }

  async function addVerseBlock(): Promise<void> {
    if (!selected) {
      setMessage("Select a note first to insert verse blocks.");
      return;
    }

    if (!resolvedVerse || resolvedVerse.status !== "resolved") {
      await resolveVerse();
      return;
    }

    const block: VerseBlock = {
      type: "verse",
      ref: currentReference,
      canonicalRef: resolvedVerse.canonicalRef,
      canonicalizationVersion: 1,
      translation: resolvedVerse.translation,
      resolvedText: resolvedVerse.canPersistText ? (resolvedVerse.text ?? null) : null,
      resolvedAt: resolvedVerse.canPersistText && resolvedVerse.text ? new Date().toISOString() : null
    };

    const nextBlocks = [...selected.content.blocks, block];
    await saveNote(nextBlocks);
    setMessage("Verse inserted.");
  }

  async function playVerse(block: VerseBlock): Promise<void> {
    let text = block.resolvedText ?? "";
    if (!text) {
      const verseResponse = await fetch("/api/bible/resolve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reference: block.ref,
          preferredTranslations: buildPreferredTranslations(block.translation)
        })
      });
      const versePayload = await verseResponse.json();
      if (versePayload.status !== "resolved" || !versePayload.text) {
        setMessage("Verse text unavailable for read aloud under current policy/provider.");
        return;
      }
      text = versePayload.text;
    }

    const response = await fetch("/api/tts/verse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        text,
        translation: block.translation,
        voiceProfile: "cedar",
        voiceSettingsVersion: "v1",
        modelVersion: "gpt-4o-mini-tts-2025-12-15"
      })
    });

    const payload = await response.json();
    if (!response.ok) {
      setMessage(payload.error || "Could not generate audio.");
      return;
    }

    const audio = new Audio(payload.redirectUrl);
    await audio.play();
  }

  async function clearAudioCache(): Promise<void> {
    const response = await fetch("/api/audio/clear", { method: "POST" });
    if (response.ok) {
      setMessage("Audio cache cleared.");
    }
  }

  return (
    <>
      {offline ? <div className="banner">Offline mode: read-only until connection returns.</div> : null}
      {message ? <div className="card">{message}</div> : null}

      <div className="card">
        <label>New note title</label>
        <input value={title} onChange={(event) => setTitle(event.target.value)} disabled={offline} />
        <button onClick={createNote} disabled={offline}>Create note</button>
        <button onClick={clearAudioCache} style={{ marginLeft: 8 }}>Delete all audio cache</button>
      </div>

      <div className="card">
        <h2>Verse Selector</h2>

        <label>Book</label>
        <select value={selectedBook} onChange={(event) => setSelectedBook(event.target.value)} disabled={offline}>
          {BOOKS.map((book) => (
            <option key={book.name} value={book.name}>{book.name}</option>
          ))}
        </select>

        <label>Chapter</label>
        <select
          value={selectedChapter}
          onChange={(event) => setSelectedChapter(Number(event.target.value))}
          disabled={offline}
        >
          {Array.from({ length: selectedBookMeta.chapters }, (_, index) => index + 1).map((chapter) => (
            <option key={chapter} value={chapter}>{chapter}</option>
          ))}
        </select>

        <label>Verse Start</label>
        <input
          type="number"
          min={1}
          max={176}
          value={selectedVerseStart}
          onChange={(event) => setSelectedVerseStart(Math.max(1, Number(event.target.value || 1)))}
          disabled={offline}
        />

        <label>Verse End (optional range)</label>
        <input
          type="number"
          min={selectedVerseStart}
          max={176}
          value={selectedVerseEnd ?? ""}
          placeholder="Leave empty for single verse"
          onChange={(event) => {
            const raw = event.target.value;
            if (!raw) {
              setSelectedVerseEnd(null);
              return;
            }
            const value = Number(raw);
            setSelectedVerseEnd(Number.isNaN(value) ? null : Math.max(selectedVerseStart, value));
          }}
          disabled={offline}
        />

        <label>Preferred translation</label>
        <select value={translation} onChange={(event) => setTranslation(event.target.value)} disabled={offline}>
          <option value="AMP">AMP</option>
          <option value="NKJV">NKJV</option>
        </select>

        <div style={{ marginBottom: 8 }}>
          <strong>Reference:</strong> {currentReference}
        </div>

        <button onClick={resolveVerse} disabled={offline || resolvingVerse}>
          {resolvingVerse ? "Resolving..." : "Resolve Verse"}
        </button>
        <button onClick={loadFullChapter} disabled={offline || loadingChapter} style={{ marginLeft: 8 }}>
          {loadingChapter ? "Loading Chapter..." : "Load Full Chapter"}
        </button>
        <button onClick={addVerseBlock} disabled={offline} style={{ marginLeft: 8 }}>
          Insert Verse into Selected Note
        </button>

        {resolvedVerse?.status === "resolved" ? (
          <div style={{ marginTop: 16, padding: 12, background: "#f4f0ea", borderRadius: 8 }}>
            <strong>
              {resolvedVerse.canonicalRef} ({resolvedVerse.translation})
            </strong>
            <p style={{ marginBottom: 0 }}>
              {resolvedVerse.text ?? "No verse text returned by provider for this reference."}
            </p>
          </div>
        ) : null}

        {resolvedVerse?.status === "needs_disambiguation" ? (
          <div style={{ marginTop: 16, padding: 12, background: "#fff3cd", borderRadius: 8 }}>
            <strong>Disambiguation needed</strong>
            <p style={{ marginBottom: 0 }}>
              Input: {resolvedVerse.normalizedInput}. Candidates: {resolvedVerse.candidateBooks.join(", ") || "none"}.
            </p>
          </div>
        ) : null}

        {resolvedVerse?.status === "unavailable" ? (
          <div style={{ marginTop: 16, padding: 12, background: "#f8d7da", borderRadius: 8 }}>
            <strong>Unavailable</strong>
            <p style={{ marginBottom: 8 }}>
              {resolvedVerse.message}
              {resolvedVerse.supportedTranslations?.length
                ? ` Supported: ${resolvedVerse.supportedTranslations.join(", ")}`
                : ""}
            </p>
            {resolvedVerse.providerDebug?.attempts?.length ? (
              <details>
                <summary>Provider debug (dev only)</summary>
                <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
                  {JSON.stringify(resolvedVerse.providerDebug, null, 2)}
                </pre>
              </details>
            ) : null}
          </div>
        ) : null}

        {resolvedVerse?.status === "invalid" ? (
          <div style={{ marginTop: 16, padding: 12, background: "#fdecef", borderRadius: 8 }}>
            <strong>Resolve error</strong>
            <pre style={{ whiteSpace: "pre-wrap", marginTop: 8, fontSize: 12 }}>
              {typeof resolvedVerse.issues === "string"
                ? resolvedVerse.issues
                : JSON.stringify(resolvedVerse.issues, null, 2)}
            </pre>
          </div>
        ) : null}

        {chapterText && chapterMeta ? (
          <div style={{ marginTop: 16, padding: 12, background: "#eef5ff", borderRadius: 8 }}>
            <strong>
              Full Chapter: {chapterMeta.chapterId} ({chapterMeta.translation})
            </strong>
            <div style={{ maxHeight: 320, overflowY: "auto", marginTop: 8, lineHeight: 1.6 }}>
              {chapterText}
            </div>
          </div>
        ) : null}
      </div>

      <div className="card">
        <pre style={{ margin: 0, fontFamily: "inherit" }}>
{`---------------------------------
Notes for ${currentReference} (${translation})
---------------------------------`}
        </pre>

        <textarea
          style={{ marginTop: 12, minHeight: 140 }}
          placeholder="Write your reflection here..."
          value={verseNoteInput}
          onChange={(event) => setVerseNoteInput(event.target.value)}
          disabled={offline}
        />

        <pre style={{ margin: "8px 0", fontFamily: "inherit" }}>
{`---------------------------------`}
        </pre>

        <button onClick={saveVerseNote} disabled={offline || savingVerseNote}>
          {savingVerseNote ? "Saving..." : "Save Note"}
        </button>
        <button onClick={() => setVerseNoteInput("")} style={{ marginLeft: 8 }}>
          Clear
        </button>

        <pre style={{ margin: "8px 0", fontFamily: "inherit" }}>
{`---------------------------------
Your Notes:`}
        </pre>

        {loadingVerseNotes ? <p>Loading notes...</p> : null}
        {!loadingVerseNotes && verseNotes.length === 0 ? <p>No notes yet for this verse.</p> : null}

        {verseNotes.map((note) => (
          <div key={note.id} style={{ marginBottom: 12 }}>
            <div>🗓 {formatDate(note.created_at)}</div>
            <div>"{note.content}"</div>
          </div>
        ))}

        <pre style={{ margin: "8px 0", fontFamily: "inherit" }}>
{`---------------------------------`}
        </pre>
      </div>

      <div className="card">
        <h2>Notes</h2>
        {notes.length === 0 ? <p>No notes yet.</p> : null}
        {notes.map((note) => (
          <div key={note.id} className="note-item">
            <button onClick={() => setSelectedId(note.id)}>{note.title || "Untitled"}</button>
          </div>
        ))}
      </div>

      {selected ? (
        <div className="card">
          <h2>Editor</h2>
          <label>Block type</label>
          <select
            value={textType}
            onChange={(event) => setTextType(event.target.value as "paragraph" | "heading")}
            disabled={offline}
          >
            <option value="paragraph">Paragraph</option>
            <option value="heading">Heading</option>
          </select>

          <label>Text block</label>
          <textarea value={textBlock} onChange={(event) => setTextBlock(event.target.value)} disabled={offline} />
          <button onClick={addTextBlock} disabled={offline}>Add text block</button>

          <h3>Blocks</h3>
          {selected.content.blocks.map((block, index) => {
            if (block.type === "verse") {
              return (
                <div key={`${block.canonicalRef}-${index}`} className="card">
                  <strong>{block.ref}</strong> ({block.translation})
                  {block.resolvedText ? <p>{block.resolvedText}</p> : null}
                  <div>
                    <button onClick={() => playVerse(block)}>Read aloud</button>
                  </div>
                </div>
              );
            }

            if (block.type === "heading") {
              return <h3 key={`h-${index}`}>{block.text}</h3>;
            }

            return <p key={`p-${index}`}>{block.text}</p>;
          })}
        </div>
      ) : null}
    </>
  );
}
