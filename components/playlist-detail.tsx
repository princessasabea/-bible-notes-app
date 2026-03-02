"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { useQueue } from "@/components/queue-context";

function estimateDurationMinutes(chapters: number): number {
  return Math.max(1, chapters * 4);
}

function chapterSubtitle(translation: string): string {
  return `${translation} • ~4 min`;
}

function titleFromItem(title: string, fallbackBook: string, fallbackChapter: number): string {
  const trimmed = title.trim();
  if (trimmed) {
    return trimmed;
  }
  return `${fallbackBook} ${fallbackChapter}`;
}

type SwipeRowProps = {
  title: string;
  subtitle: string;
  index: number;
  onPlay: () => void;
  onDelete: () => void;
};

function SwipeChapterRow({
  title,
  subtitle,
  index,
  onPlay,
  onDelete
}: SwipeRowProps): React.ReactElement {
  const [offset, setOffset] = useState(0);
  const dragRef = useRef<{ startX: number; base: number; active: boolean } | null>(null);

  const handlePointerDown = (event: React.PointerEvent<HTMLDivElement>): void => {
    dragRef.current = {
      startX: event.clientX,
      base: offset,
      active: true
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };

  const handlePointerMove = (event: React.PointerEvent<HTMLDivElement>): void => {
    if (!dragRef.current?.active) {
      return;
    }

    const delta = event.clientX - dragRef.current.startX;
    const next = Math.min(0, Math.max(-86, dragRef.current.base + delta));
    setOffset(next);
  };

  const handlePointerUp = (): void => {
    if (!dragRef.current) {
      return;
    }
    dragRef.current.active = false;
    setOffset((current) => (current < -42 ? -86 : 0));
  };

  const handlePlay = (): void => {
    if (offset !== 0) {
      setOffset(0);
      return;
    }
    onPlay();
  };

  return (
    <div className="playlist-detail-swipe-row">
      <button type="button" className="danger-button playlist-detail-delete" onClick={onDelete}>
        Delete
      </button>

      <div
        className="playlist-detail-track"
        role="button"
        tabIndex={0}
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            handlePlay();
          }
        }}
        onClick={handlePlay}
      >
        <span className="track-index">{index + 1}</span>
        <span className="track-copy">
          <strong>{title}</strong>
          <small>{subtitle}</small>
        </span>
      </div>
    </div>
  );
}

export function PlaylistDetail({ id }: { id: string }): React.ReactElement {
  const router = useRouter();
  const {
    playlists,
    refreshPlaylists,
    statusMessage,
    playPlaylist,
    primeSpeechFromUserGesture
  } = useQueue();
  const [localError, setLocalError] = useState<string | null>(null);
  const [rowBusyId, setRowBusyId] = useState<string | null>(null);

  const playlist = useMemo(() => {
    return playlists.find((entry) => entry.id === id) ?? null;
  }, [id, playlists]);

  const chapterCount = playlist?.chapters.length ?? 0;
  const durationMin = estimateDurationMinutes(chapterCount);

  const handlePlayAt = (index: number): void => {
    if (!playlist) {
      return;
    }
    primeSpeechFromUserGesture();
    void playPlaylist(playlist.id, { startIndex: index });
  };

  const handleDeletePlaylist = async (): Promise<void> => {
    if (!playlist) {
      return;
    }

    const ok = window.confirm(`Delete "${playlist.name}"? This removes all chapters in it.`);
    if (!ok) {
      return;
    }

    try {
      const response = await fetch(`/api/playlists/${playlist.id}`, { method: "DELETE" });
      if (!response.ok) {
        setLocalError("Unable to delete playlist.");
        return;
      }

      await refreshPlaylists();
      router.push("/playlists");
    } catch (error) {
      console.error("playlist_delete_from_detail_failed", error);
      setLocalError("Unable to delete playlist.");
    }
  };

  const handleRename = async (): Promise<void> => {
    if (!playlist) {
      return;
    }

    const nextName = window.prompt("Rename playlist", playlist.name);
    if (!nextName || !nextName.trim() || nextName.trim() === playlist.name) {
      return;
    }

    try {
      const response = await fetch(`/api/playlists/${playlist.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: nextName.trim() })
      });
      if (!response.ok) {
        setLocalError("Unable to rename playlist.");
        return;
      }
      await refreshPlaylists();
    } catch (error) {
      console.error("playlist_rename_from_detail_failed", error);
      setLocalError("Unable to rename playlist.");
    }
  };

  const handleDeleteChapter = async (itemId: string): Promise<void> => {
    if (!playlist || rowBusyId) {
      return;
    }

    setRowBusyId(itemId);
    setLocalError(null);

    try {
      const response = await fetch(`/api/playlists/${playlist.id}/items`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ itemId })
      });
      if (!response.ok) {
        setLocalError("Unable to remove chapter.");
        return;
      }

      await refreshPlaylists();
    } catch (error) {
      console.error("playlist_item_delete_failed", error);
      setLocalError("Unable to remove chapter.");
    } finally {
      setRowBusyId(null);
    }
  };

  if (!playlist) {
    return (
      <section className="playlists-detail-page">
        <div className="playlists-detail-head-row">
          <Link href="/playlists" className="text-link">Back to playlists</Link>
        </div>
        <p className="placeholder-text">Loading playlist...</p>
      </section>
    );
  }

  return (
    <section className="playlists-detail-page">
      <div className="playlists-detail-head-row">
        <Link href="/playlists" className="text-link">Back</Link>
        <button type="button" className="ghost-button" onClick={() => void handleRename()}>Rename</button>
      </div>

      <header className="playlist-detail-hero">
        <div className="playlist-detail-cover" aria-hidden="true" />
        <h2>{playlist.name}</h2>
        <p>{chapterCount} Chapters • {durationMin} minutes</p>
        <div className="playlist-detail-actions">
          <button
            type="button"
            onClick={() => {
              primeSpeechFromUserGesture();
              void playPlaylist(playlist.id);
            }}
            disabled={chapterCount === 0}
          >
            ▶ Play
          </button>
          <button
            type="button"
            className="ghost-button"
            onClick={() => {
              primeSpeechFromUserGesture();
              void playPlaylist(playlist.id, { shuffle: true });
            }}
            disabled={chapterCount === 0}
          >
            Shuffle
          </button>
          <button type="button" className="danger-button" onClick={() => void handleDeletePlaylist()}>
            Delete
          </button>
        </div>
      </header>

      <section className="playlist-detail-list">
        {chapterCount === 0 ? <p className="placeholder-text">No chapters in this playlist yet.</p> : null}
        {playlist.chapters.map((chapterItem, index) => (
          <SwipeChapterRow
            key={chapterItem.id}
            index={index}
            title={titleFromItem(chapterItem.title, chapterItem.book, chapterItem.chapter)}
            subtitle={chapterSubtitle(chapterItem.translation)}
            onPlay={() => handlePlayAt(index)}
            onDelete={() => void handleDeleteChapter(chapterItem.id)}
          />
        ))}
      </section>

      {rowBusyId ? <p className="status-text">Updating playlist…</p> : null}
      {localError ? <p className="status-text">{localError}</p> : null}
      {statusMessage ? <p className="status-text">{statusMessage}</p> : null}
    </section>
  );
}
