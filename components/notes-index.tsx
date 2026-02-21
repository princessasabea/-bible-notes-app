"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

type VerseNote = {
  id: string;
  canonical_ref: string;
  translation: string | null;
  title: string;
  content: string;
  created_at: string;
  updated_at: string;
};

type JournalEntry = {
  id: string;
  date: string;
  title?: string;
  content: string;
  mood?: string;
  canonical_ref: string;
  translation: string | null;
  created_at: string;
  updated_at: string;
};

function formatDate(dateValue: string): string {
  return new Intl.DateTimeFormat("en-US", { month: "short", day: "2-digit", year: "numeric" }).format(new Date(dateValue));
}

export function NotesIndex(): React.ReactElement {
  const router = useRouter();
  const [notes, setNotes] = useState<VerseNote[]>([]);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    const loadNotes = async (): Promise<void> => {
      setLoading(true);
      try {
        const response = await fetch("/api/verse-notes", { cache: "no-store" });
        if (!response.ok) {
          setError(response.status === 401 ? "Sign in to view your notes." : "Unable to load notes.");
          setNotes([]);
          return;
        }

        const payload = await response.json();
        setNotes(payload.notes ?? []);
      } catch (requestError) {
        setNotes([]);
        setError("Unable to load notes.");
        console.error("notes_index_failed", requestError);
      } finally {
        setLoading(false);
      }
    };

    loadNotes().catch((requestError) => {
      console.error("notes_index_bootstrap_failed", requestError);
      setLoading(false);
      setError("Unable to load notes.");
    });
  }, []);

  const entries = useMemo<JournalEntry[]>(() => {
    return notes.map((note) => ({
      id: note.id,
      date: note.created_at.slice(0, 10),
      title: note.title || undefined,
      content: note.content,
      mood: undefined,
      canonical_ref: note.canonical_ref,
      translation: note.translation,
      created_at: note.created_at,
      updated_at: note.updated_at
    }));
  }, [notes]);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return entries;
    }

    return entries.filter((entry) => {
      const haystack = `${entry.title ?? ""} ${entry.content} ${entry.canonical_ref} ${entry.translation ?? ""} ${entry.date}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [entries, query]);

  async function createTodayEntry(): Promise<void> {
    setCreating(true);
    setError(null);
    const isoDate = new Date().toISOString().slice(0, 10);

    try {
      const response = await fetch("/api/verse-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          canonicalRef: `JOURNAL.${isoDate}`,
          title: "",
          content: " "
        })
      });

      if (!response.ok) {
        const payload = await response.json().catch(() => ({ error: "Unable to create journal entry." }));
        setError(payload.error ?? "Unable to create journal entry.");
        return;
      }

      const payload = await response.json();
      const created = payload.note as VerseNote;
      router.push(`/notes/${created.id}`);
    } catch (createError) {
      console.error("journal_create_failed", createError);
      setError("Unable to create journal entry.");
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="journal-home">
      <div className="journal-home-head">
        <div>
          <p className="eyebrow">Journal Mode</p>
          <h2>Daily Diary</h2>
          <p className="notes-layer-copy">A calm place to pour your heart out and revisit your journey by date.</p>
        </div>
        <div className="action-row">
          <button type="button" onClick={() => void createTodayEntry()} disabled={creating}>
            {creating ? "Creating..." : "New Today Entry"}
          </button>
          <Link href="/" className="text-link">Back to Scripture</Link>
        </div>
      </div>

      <label className="journal-search">
        Search notes
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search by title, verse, or a phrase"
        />
      </label>

      {loading ? <p className="placeholder-text">Loading notes...</p> : null}
      {error ? <p className="status-text">{error}</p> : null}
      {!loading && !error && filtered.length === 0 ? <p className="placeholder-text">No notes match yet. Open Scripture and add one.</p> : null}

      {filtered.map((entry) => (
        <Link key={entry.id} href={`/notes/${entry.id}`} className="note-card-link journal-card">
          <div className="journal-card-head">
            <h3>{entry.title || "Untitled reflection"}</h3>
            <span className="note-meta">{formatDate(entry.updated_at)}</span>
          </div>
          <p className="note-meta">🗓 {entry.date}</p>
          <p className="note-meta">📖 {entry.canonical_ref} ({entry.translation ?? "N/A"})</p>
          <p className="note-preview">{entry.content.trim().slice(0, 190)}</p>
        </Link>
      ))}
    </section>
  );
}
