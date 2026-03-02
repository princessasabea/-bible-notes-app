"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useQueue } from "@/components/queue-context";

type PlaylistRowMenu = "closed" | "open";

function estimateDurationMinutes(chapters: number): number {
  return Math.max(1, chapters * 4);
}

export function PlaylistsHome(): React.ReactElement {
  const router = useRouter();
  const {
    playlists,
    statusMessage,
    refreshPlaylists,
    createPlaylist
  } = useQueue();

  const [query, setQuery] = useState("");
  const [menuById, setMenuById] = useState<Record<string, PlaylistRowMenu>>({});
  const [newPlaylistName, setNewPlaylistName] = useState("");
  const [creating, setCreating] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) {
      return playlists;
    }

    return playlists.filter((playlist) => {
      const haystack = `${playlist.name} ${playlist.chapters.map((chapter) => chapter.title).join(" ")}`.toLowerCase();
      return haystack.includes(normalized);
    });
  }, [playlists, query]);

  const closeMenu = (playlistId: string): void => {
    setMenuById((current) => ({ ...current, [playlistId]: "closed" }));
  };

  const toggleMenu = (playlistId: string): void => {
    setMenuById((current) => ({ ...current, [playlistId]: current[playlistId] === "open" ? "closed" : "open" }));
  };

  const handleRename = async (playlistId: string, currentName: string): Promise<void> => {
    const nextName = window.prompt("Rename playlist", currentName);
    if (!nextName || !nextName.trim() || nextName.trim() === currentName) {
      closeMenu(playlistId);
      return;
    }

    try {
      const response = await fetch(`/api/playlists/${playlistId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName.trim() })
      });

      if (!response.ok) {
        setLocalError("Unable to rename playlist.");
        closeMenu(playlistId);
        return;
      }

      await refreshPlaylists();
      closeMenu(playlistId);
    } catch (error) {
      console.error("playlist_rename_failed", error);
      setLocalError("Unable to rename playlist.");
      closeMenu(playlistId);
    }
  };

  const handleDelete = async (playlistId: string, name: string): Promise<void> => {
    const ok = window.confirm(`Delete "${name}"? This removes all chapters in it.`);
    if (!ok) {
      closeMenu(playlistId);
      return;
    }

    try {
      const response = await fetch(`/api/playlists/${playlistId}`, { method: "DELETE" });
      if (!response.ok) {
        setLocalError("Unable to delete playlist.");
        closeMenu(playlistId);
        return;
      }

      await refreshPlaylists();
      closeMenu(playlistId);
    } catch (error) {
      console.error("playlist_delete_failed", error);
      setLocalError("Unable to delete playlist.");
      closeMenu(playlistId);
    }
  };

  const handleCreate = async (): Promise<void> => {
    const trimmed = newPlaylistName.trim();
    if (!trimmed || creating) {
      return;
    }

    setCreating(true);
    setLocalError(null);
    try {
      const createdId = await createPlaylist(trimmed);
      if (!createdId) {
        setLocalError("Unable to create playlist.");
        return;
      }

      setNewPlaylistName("");
      setShowCreate(false);
      router.push(`/playlists/${createdId}`);
    } catch (error) {
      console.error("playlist_create_from_screen_failed", error);
      setLocalError("Unable to create playlist.");
    } finally {
      setCreating(false);
    }
  };

  return (
    <section className="playlists-home-page">
      <div className="playlists-home-head">
        <div>
          <p className="eyebrow">Study Playlists</p>
          <h2>My Playlists</h2>
        </div>
        <div className="action-row">
          <button type="button" onClick={() => setShowCreate(true)}>New Playlist</button>
          <Link href="/" className="text-link">Back to Scripture</Link>
        </div>
      </div>

      <label className="playlists-search">
        Search
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Find a playlist"
        />
      </label>

      <div className="playlists-section">
        <p className="eyebrow">My Playlists</p>
        {filtered.length === 0 ? (
          <p className="placeholder-text">No playlists yet. Create one and add chapters from Scripture.</p>
        ) : null}

        {filtered.map((playlist) => {
          const subtitle = `${playlist.chapters.length} items • ${estimateDurationMinutes(playlist.chapters.length)} min`;
          const rowMenuOpen = menuById[playlist.id] === "open";

          return (
            <article key={playlist.id} className="playlist-library-row">
              <button
                type="button"
                className="playlist-library-main"
                onClick={() => router.push(`/playlists/${playlist.id}`)}
              >
                <strong>{playlist.name}</strong>
                <span>{subtitle}</span>
              </button>

              <div className="playlist-library-actions">
                <button
                  type="button"
                  className="ghost-button playlist-menu-trigger"
                  aria-haspopup="menu"
                  aria-expanded={rowMenuOpen}
                  onClick={() => toggleMenu(playlist.id)}
                >
                  …
                </button>

                {rowMenuOpen ? (
                  <div className="playlist-row-menu" role="menu" aria-label={`${playlist.name} actions`}>
                    <button type="button" role="menuitem" onClick={() => void handleRename(playlist.id, playlist.name)}>
                      Rename
                    </button>
                    <button type="button" role="menuitem" onClick={() => router.push(`/playlists/${playlist.id}`)}>
                      Edit
                    </button>
                    <button type="button" role="menuitem" className="danger" onClick={() => void handleDelete(playlist.id, playlist.name)}>
                      Delete
                    </button>
                  </div>
                ) : null}
              </div>
            </article>
          );
        })}
      </div>

      {showCreate ? (
        <div className="playlist-modal-overlay" role="dialog" aria-modal="true" aria-label="Create playlist" onClick={() => setShowCreate(false)}>
          <div className="playlist-modal-card" onClick={(event) => event.stopPropagation()}>
            <h3>Create Playlist</h3>
            <label>
              Name
              <input
                value={newPlaylistName}
                onChange={(event) => setNewPlaylistName(event.target.value)}
                placeholder="Morning Devotion"
              />
            </label>
            <div className="action-row">
              <button type="button" className="ghost-button" onClick={() => setShowCreate(false)}>Cancel</button>
              <button type="button" onClick={() => void handleCreate()} disabled={!newPlaylistName.trim() || creating}>
                {creating ? "Creating..." : "Create"}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {localError ? <p className="status-text">{localError}</p> : null}
      {statusMessage ? <p className="status-text">{statusMessage}</p> : null}
    </section>
  );
}
