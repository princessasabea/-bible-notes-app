"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";

export type BibleChapterRef = {
  translation: string;
  book: string;
  chapter: number;
};

export type BibleQueueItem = BibleChapterRef & {
  id: string;
  title: string;
};

export type BiblePlaylist = {
  id: string;
  name: string;
  items: BibleChapterRef[];
};

type PlaybackStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

type BibleAudioStore = {
  current: BibleChapterRef | null;
  queue: BibleQueueItem[];
  playlists: BiblePlaylist[];
  playbackStatus: PlaybackStatus;
  progressSeconds: number;
  playbackSpeed: number;
  activePlaylistId: string | null;
  queueOpen: boolean;
  setCurrentChapter: (chapter: BibleChapterRef) => void;
  setPlaybackStatus: (status: PlaybackStatus) => void;
  setProgressSeconds: (seconds: number) => void;
  setPlaybackSpeed: (speed: number) => void;
  setQueueOpen: (open: boolean) => void;
  addToQueue: (chapter: BibleChapterRef) => void;
  addManyToQueue: (chapters: BibleChapterRef[]) => void;
  removeFromQueue: (id: string) => void;
  moveQueueItem: (id: string, direction: -1 | 1) => void;
  clearQueue: () => void;
  consumeNextQueueItem: () => BibleQueueItem | null;
  createPlaylist: (name: string, items: BibleChapterRef[]) => void;
  removePlaylist: (id: string) => void;
  setActivePlaylistId: (id: string | null) => void;
};

const STORAGE_KEY = "bible-audio-store:v1";
const BibleAudioContext = createContext<BibleAudioStore | null>(null);

type PersistedState = {
  current: BibleChapterRef | null;
  queue: BibleQueueItem[];
  playlists: BiblePlaylist[];
  playbackSpeed: number;
  activePlaylistId: string | null;
};

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function titleForChapter(chapter: BibleChapterRef): string {
  return `${chapter.book.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ")} ${chapter.chapter}`;
}

function normalizeChapter(chapter: BibleChapterRef): BibleChapterRef {
  return {
    translation: slugify(chapter.translation || "amp"),
    book: slugify(chapter.book),
    chapter: Number(chapter.chapter)
  };
}

function createQueueItem(chapter: BibleChapterRef): BibleQueueItem {
  const normalized = normalizeChapter(chapter);
  return {
    ...normalized,
    id: `${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
    title: titleForChapter(normalized)
  };
}

function readPersistedState(): PersistedState {
  if (typeof window === "undefined") {
    return {
      current: null,
      queue: [],
      playlists: [],
      playbackSpeed: 1,
      activePlaylistId: null
    };
  }

  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      throw new Error("No persisted Bible audio state.");
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      current: parsed.current ?? null,
      queue: Array.isArray(parsed.queue) ? parsed.queue : [],
      playlists: Array.isArray(parsed.playlists) ? parsed.playlists : [],
      playbackSpeed: typeof parsed.playbackSpeed === "number" ? parsed.playbackSpeed : 1,
      activePlaylistId: parsed.activePlaylistId ?? null
    };
  } catch {
    return {
      current: null,
      queue: [],
      playlists: [],
      playbackSpeed: 1,
      activePlaylistId: null
    };
  }
}

export function BibleAudioProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const [hasLoaded, setHasLoaded] = useState(false);
  const [current, setCurrent] = useState<BibleChapterRef | null>(null);
  const [queue, setQueue] = useState<BibleQueueItem[]>([]);
  const [playlists, setPlaylists] = useState<BiblePlaylist[]>([]);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>("idle");
  const [progressSeconds, setProgressSeconds] = useState(0);
  const [playbackSpeed, setPlaybackSpeedState] = useState(1);
  const [activePlaylistId, setActivePlaylistId] = useState<string | null>(null);
  const [queueOpen, setQueueOpen] = useState(false);

  useEffect(() => {
    const persisted = readPersistedState();
    setCurrent(persisted.current);
    setQueue(persisted.queue);
    setPlaylists(persisted.playlists);
    setPlaybackSpeedState(persisted.playbackSpeed);
    setActivePlaylistId(persisted.activePlaylistId);
    setHasLoaded(true);
  }, []);

  useEffect(() => {
    if (!hasLoaded) {
      return;
    }

    const payload: PersistedState = {
      current,
      queue,
      playlists,
      playbackSpeed,
      activePlaylistId
    };
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  }, [activePlaylistId, current, hasLoaded, playbackSpeed, playlists, queue]);

  const setCurrentChapter = useCallback((chapter: BibleChapterRef) => {
    setCurrent(normalizeChapter(chapter));
  }, []);

  const setPlaybackSpeed = useCallback((speed: number) => {
    setPlaybackSpeedState(Math.max(0.5, Math.min(speed, 2)));
  }, []);

  const addToQueue = useCallback((chapter: BibleChapterRef) => {
    setQueue((currentQueue) => [...currentQueue, createQueueItem(chapter)]);
    setQueueOpen(true);
  }, []);

  const addManyToQueue = useCallback((chapters: BibleChapterRef[]) => {
    setQueue((currentQueue) => [...currentQueue, ...chapters.map(createQueueItem)]);
    setQueueOpen(true);
  }, []);

  const removeFromQueue = useCallback((id: string) => {
    setQueue((currentQueue) => currentQueue.filter((item) => item.id !== id));
  }, []);

  const moveQueueItem = useCallback((id: string, direction: -1 | 1) => {
    setQueue((currentQueue) => {
      const index = currentQueue.findIndex((item) => item.id === id);
      const nextIndex = index + direction;
      if (index < 0 || nextIndex < 0 || nextIndex >= currentQueue.length) {
        return currentQueue;
      }

      const next = [...currentQueue];
      const [item] = next.splice(index, 1);
      next.splice(nextIndex, 0, item);
      return next;
    });
  }, []);

  const clearQueue = useCallback(() => setQueue([]), []);

  const consumeNextQueueItem = useCallback((): BibleQueueItem | null => {
    let nextItem: BibleQueueItem | null = null;
    setQueue((currentQueue) => {
      if (currentQueue.length === 0) {
        return currentQueue;
      }
      nextItem = currentQueue[0];
      return currentQueue.slice(1);
    });
    return nextItem;
  }, []);

  const createPlaylist = useCallback((name: string, items: BibleChapterRef[]) => {
    const cleanName = name.trim();
    if (!cleanName || items.length === 0) {
      return;
    }

    setPlaylists((currentPlaylists) => [
      ...currentPlaylists,
      {
        id: `${Date.now()}-${globalThis.crypto?.randomUUID?.() ?? Math.random().toString(36).slice(2)}`,
        name: cleanName,
        items: items.map(normalizeChapter)
      }
    ]);
  }, []);

  const removePlaylist = useCallback((id: string) => {
    setPlaylists((currentPlaylists) => currentPlaylists.filter((playlist) => playlist.id !== id));
  }, []);

  const value = useMemo<BibleAudioStore>(() => ({
    current,
    queue,
    playlists,
    playbackStatus,
    progressSeconds,
    playbackSpeed,
    activePlaylistId,
    queueOpen,
    setCurrentChapter,
    setPlaybackStatus,
    setProgressSeconds,
    setPlaybackSpeed,
    setQueueOpen,
    addToQueue,
    addManyToQueue,
    removeFromQueue,
    moveQueueItem,
    clearQueue,
    consumeNextQueueItem,
    createPlaylist,
    removePlaylist,
    setActivePlaylistId
  }), [
    activePlaylistId,
    addManyToQueue,
    addToQueue,
    clearQueue,
    consumeNextQueueItem,
    createPlaylist,
    current,
    moveQueueItem,
    playbackSpeed,
    playbackStatus,
    playlists,
    progressSeconds,
    queue,
    queueOpen,
    removeFromQueue,
    removePlaylist,
    setCurrentChapter,
    setPlaybackSpeed
  ]);

  return (
    <BibleAudioContext.Provider value={value}>
      {children}
    </BibleAudioContext.Provider>
  );
}

export function useBibleAudio(): BibleAudioStore {
  const context = useContext(BibleAudioContext);
  if (!context) {
    throw new Error("useBibleAudio must be used inside BibleAudioProvider.");
  }
  return context;
}
