"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";

type VerseNote = {
  id: string;
  canonical_ref: string;
  translation: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

function formatDate(dateValue: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(dateValue));
}

function toJournalDate(value: string): string {
  return new Date(value).toISOString().slice(0, 10);
}

export function NoteEditor({ id }: { id: string }): React.ReactElement {
  const [note, setNote] = useState<VerseNote | null>(null);
  const [recent, setRecent] = useState<VerseNote[]>([]);
  const [title, setTitle] = useState("");
  const [content, setContent] = useState("");
  const [mood, setMood] = useState("");
  const [loading, setLoading] = useState(true);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [status, setStatus] = useState<string | null>(null);
  const lastSavedSnapshot = useRef("");
  const initialized = useRef(false);

  const wordCount = useMemo(() => {
    const trimmed = content.trim();
    return trimmed.length ? trimmed.split(/\s+/).length : 0;
  }, [content]);

  const journalDate = useMemo(() => (note ? toJournalDate(note.created_at) : ""), [note]);
  const saveIndicator = useMemo(() => {
    if (saveState === "saving") return "Saving...";
    if (saveState === "saved") return "Saved";
    if (saveState === "dirty") return "Unsaved changes";
    if (saveState === "error") return "Autosave failed";
    return "";
  }, [saveState]);

  useEffect(() => {
    const load = async (): Promise<void> => {
      setLoading(true);
      setStatus(null);
      try {
        const response = await fetch(`/api/verse-notes/${id}`, { cache: "no-store" });
        if (!response.ok) {
          setStatus(response.status === 404 ? "Note not found." : "Unable to load note.");
          setLoading(false);
          return;
        }

        const payload = await response.json();
        const loaded = payload.note as VerseNote;
        setNote(loaded);
        setTitle(loaded.title ?? "");
        setContent((loaded.content ?? "").trimStart());
        const storedMood = localStorage.getItem(`journal.mood.${loaded.id}`);
        setMood(storedMood ?? "");
        lastSavedSnapshot.current = JSON.stringify({
          title: loaded.title ?? "",
          content: (loaded.content ?? "").trimStart(),
          mood: storedMood ?? ""
        });
        initialized.current = true;
        setSaveState("idle");

        const params = new URLSearchParams({
          canonicalRef: loaded.canonical_ref,
          ...(loaded.translation ? { translation: loaded.translation } : {})
        });
        const recentResponse = await fetch(`/api/verse-notes?${params.toString()}`, { cache: "no-store" });
        if (recentResponse.ok) {
          const recentPayload = await recentResponse.json();
          const recentNotes = (recentPayload.notes ?? []) as VerseNote[];
          setRecent(recentNotes.filter((entry) => entry.id !== loaded.id).slice(0, 5));
        }
      } catch (error) {
        setStatus("Unable to load note.");
        console.error("note_editor_load_failed", error);
      } finally {
        setLoading(false);
      }
    };

    load().catch((error) => {
      console.error("note_editor_bootstrap_failed", error);
      setLoading(false);
      setStatus("Unable to load note.");
    });
  }, [id]);

  async function saveNote(): Promise<void> {
    if (!note) {
      return;
    }

    setSaveState("saving");
    setStatus(null);
    try {
      localStorage.setItem(`journal.mood.${note.id}`, mood);
      const response = await fetch(`/api/verse-notes/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, content })
      });

      if (!response.ok) {
        setSaveState("error");
        return;
      }

      const payload = await response.json();
      const saved = payload.note as VerseNote;
      setNote(saved);
      lastSavedSnapshot.current = JSON.stringify({
        title,
        content,
        mood
      });
      setSaveState("saved");
      setStatus(null);
    } catch (error) {
      setSaveState("error");
      console.error("note_editor_save_failed", error);
    }
  }

  async function deleteNote(): Promise<void> {
    if (!window.confirm("Delete this note permanently?")) {
      return;
    }

    try {
      const response = await fetch(`/api/verse-notes/${id}`, { method: "DELETE" });
      if (!response.ok) {
        setStatus("Unable to delete note.");
        return;
      }
      localStorage.removeItem(`journal.mood.${id}`);
      window.location.href = "/notes";
    } catch (error) {
      setStatus("Unable to delete note.");
      console.error("note_editor_delete_failed", error);
    }
  }

  if (loading) {
    return <section className="panel"><p className="placeholder-text">Loading note...</p></section>;
  }

  if (!note) {
    return (
      <section className="panel">
        <p className="status-text">{status ?? "Note not found."}</p>
        <Link href="/notes" className="text-link">Back to notes</Link>
      </section>
    );
  }

  useEffect(() => {
    if (!initialized.current) {
      return;
    }

    const nextSnapshot = JSON.stringify({ title, content, mood });
    if (nextSnapshot !== lastSavedSnapshot.current) {
      setSaveState((current) => (current === "saving" ? current : "dirty"));
    }
  }, [title, content, mood]);

  useEffect(() => {
    if (!initialized.current) {
      return;
    }

    if (saveState !== "dirty") {
      return;
    }

    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible") {
        return;
      }

      void saveNote();
    }, 3000);

    return () => window.clearInterval(timer);
  }, [saveState, title, content, mood]);

  return (
    <div className="journal-page">
      <section className="journal-container">
        <div className="journal-header">
          <div>
            <p className="eyebrow">Journal</p>
            <h2>{formatDate(note.created_at)}</h2>
            <p className="note-meta">📖 {note.canonical_ref} ({note.translation ?? "N/A"})</p>
          </div>
          <div className="journal-head-right">
            <span className="note-meta">Date {journalDate}</span>
            {saveIndicator ? <span className={`journal-save-indicator ${saveState}`}>{saveIndicator}</span> : null}
          </div>
        </div>

        <input
          className="journal-title-input"
          value={title}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Untitled entry"
        />

        <div className="journal-meta-row">
          <label className="journal-mood-field">
            Mood
            <input
              value={mood}
              onChange={(event) => setMood(event.target.value)}
              placeholder="peaceful, grateful, expectant..."
            />
          </label>
          <span className="note-meta">{wordCount} words</span>
          <span className="note-meta">Updated {formatDate(note.updated_at)}</span>
        </div>

        <textarea
          className="journal-editor"
          value={content}
          onChange={(event) => setContent(event.target.value)}
          rows={22}
          placeholder="Write freely..."
        />

        <div className="editor-footer">
          <span className="note-meta">Created {formatDate(note.created_at)}</span>
        </div>

        <div className="action-row">
          <Link href="/" className="text-link">Scripture</Link>
          <Link href="/notes" className="text-link">Journal Home</Link>
          <button type="button" className="danger-button" onClick={deleteNote}>Delete</button>
        </div>

        {status ? <p className="status-text">{status}</p> : null}
      </section>

      <section className="panel journal-recent-panel">
        <h3>Recent Notes</h3>
        {recent.length === 0 ? <p className="placeholder-text">No additional notes for this reference.</p> : null}
        {recent.map((entry) => (
          <Link key={entry.id} href={`/notes/${entry.id}`} className="note-row-link">
            <strong>{entry.title || "Untitled reflection"}</strong>
            <span>{formatDate(entry.created_at)}</span>
          </Link>
        ))}
      </section>
    </div>
  );
}
