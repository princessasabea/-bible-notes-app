"use client";

import { useRouter } from "next/navigation";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState
} from "react";

export type QueueItem = {
  id: string;
  translation: string;
  book: string;
  chapter: number;
  title: string;
};

type Playlist = {
  id: string;
  name: string;
  createdAt: number;
  chapters: QueueItem[];
};

type VoiceFilter = "enhanced" | "premium";
type TtsEngine = "browser" | "openai";
type RepeatMode = "off" | "chapter" | "playlist";

type VerseLine = {
  number: number;
  displayHtml: string;
};

type ChapterResponse =
  | { status: "resolved"; chapterId: string; translation: string; html?: string; text: string }
  | { status: "unavailable"; message: string }
  | { status: "invalid"; issues?: unknown };

type QueueContextValue = {
  queue: QueueItem[];
  currentIndex: number;
  isPlaying: boolean;
  isPaused: boolean;
  currentVerse: number | null;
  currentChapterTitle: string | null;
  nowViewingItem: QueueItem | null;
  speechRate: number;
  crossfadeDurationMs: number;
  repeatMode: RepeatMode;
  voices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  aiVoiceId: string;
  showAllVoices: boolean;
  voiceFilter: VoiceFilter;
  ttsEngine: TtsEngine;
  playlists: Playlist[];
  drawerOpen: boolean;
  playlistModalOpen: boolean;
  statusMessage: string | null;
  addToQueue: (item: QueueItem) => void;
  removeFromQueue: (id: string) => void;
  clearQueue: () => void;
  moveItem: (oldIndex: number, newIndex: number) => void;
  playNext: () => void;
  playPrevious: () => void;
  setCurrentIndex: (index: number) => void;
  setDrawerOpen: (open: boolean) => void;
  setPlaylistModalOpen: (open: boolean) => void;
  setSelectedVoiceName: (voiceName: string) => void;
  setAiVoiceId: (voiceId: string) => void;
  setShowAllVoices: (show: boolean) => void;
  setVoiceFilter: (filter: VoiceFilter) => void;
  setTtsEngine: (engine: TtsEngine) => void;
  setSpeechRate: (rate: number) => void;
  setCrossfadeDurationMs: (ms: number) => void;
  setRepeatMode: (mode: RepeatMode) => void;
  setNowViewingItem: (item: QueueItem | null) => void;
  primeSpeechFromUserGesture: () => void;
  playFromCurrent: () => Promise<void>;
  playFromIndex: (index: number) => Promise<void>;
  playChapterNow: (item: QueueItem) => Promise<void>;
  playPlaylist: (playlistId: string, options?: { shuffle?: boolean; startIndex?: number }) => Promise<void>;
  playNowViewing: () => Promise<void>;
  togglePause: () => void;
  stop: () => void;
  saveCurrentQueueAsPlaylist: (name: string) => void;
  createPlaylist: (name: string) => Promise<string | null>;
  addChapterToPlaylist: (playlistId: string, item: QueueItem) => Promise<boolean>;
  refreshPlaylists: () => Promise<void>;
  loadPlaylistIntoQueue: (playlistId: string) => void;
  deletePlaylist: (playlistId: string) => void;
};

const VOICE_STORAGE_KEY = "fellowship.voice.name.v1";
const AI_VOICE_STORAGE_KEY = "fellowship.ai.voice.v1";
const VOICE_FILTER_STORAGE_KEY = "fellowship.voice.filter.v1";
const VOICE_SHOW_ALL_STORAGE_KEY = "fellowship.voice.showall.v1";
const RATE_STORAGE_KEY = "fellowship.voice.rate.v1";
const CROSSFADE_STORAGE_KEY = "fellowship.crossfade.ms.v1";
const TTS_ENGINE_STORAGE_KEY = "fellowship.tts.engine.v1";
const REPEAT_MODE_STORAGE_KEY = "fellowship.repeat.mode.v1";

const QueueContext = createContext<QueueContextValue | null>(null);

type PlaylistApiItem = {
  id: string;
  translation: string;
  book: string;
  chapter: number;
  title: string;
  position: number;
};

type PlaylistApi = {
  id: string;
  name: string;
  created_at: string;
  items: PlaylistApiItem[];
};

function parseVersesFromHtml(chapterHtml: string): VerseLine[] {
  if (typeof DOMParser === "undefined") {
    return parseVersesFromPlainText(chapterHtml.replace(/<[^>]+>/g, " "));
  }

  const parser = new DOMParser();
  const documentNode = parser.parseFromString(chapterHtml, "text/html");
  const paragraphs = Array.from(documentNode.querySelectorAll("p"));
  const verses: VerseLine[] = [];
  let fallbackVerseNumber = 0;

  for (const paragraph of paragraphs) {
    const paragraphClass = paragraph.className.toLowerCase();
    if (
      paragraphClass.includes("s1") ||
      paragraphClass.includes("s2") ||
      paragraphClass.includes("ms") ||
      paragraphClass.includes("mt")
    ) {
      continue;
    }

    let currentVerseNumber: number | null = null;
    let displayHtml = "";

    const flush = (): void => {
      if (!displayHtml.trim()) {
        displayHtml = "";
        return;
      }

      let verseNumber = currentVerseNumber;
      if (verseNumber === null || !Number.isFinite(verseNumber)) {
        fallbackVerseNumber += 1;
        verseNumber = fallbackVerseNumber;
      } else if (verseNumber > fallbackVerseNumber) {
        fallbackVerseNumber = verseNumber;
      }

      verses.push({ number: verseNumber, displayHtml });
      displayHtml = "";
    };

    for (const node of Array.from(paragraph.childNodes)) {
      if (node.nodeType === Node.ELEMENT_NODE) {
        const elementNode = node as HTMLElement;
        const tagName = elementNode.tagName.toLowerCase();
        if (tagName === "sup") {
          const numeric = Number((elementNode.textContent ?? "").replace(/\D+/g, ""));
          if (Number.isFinite(numeric) && numeric > 0) {
            if (displayHtml.trim()) {
              flush();
            }
            currentVerseNumber = numeric;
            continue;
          }
        }
      }

      if (node.nodeType === Node.ELEMENT_NODE) {
        displayHtml += (node as HTMLElement).outerHTML;
      } else {
        displayHtml += node.textContent ?? "";
      }
    }

    if (displayHtml.trim()) {
      flush();
    }
  }

  return verses;
}

function parseVersesFromPlainText(content: string): VerseLine[] {
  const normalized = content.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const matches = normalized.match(/\d+\s+[\s\S]*?(?=(?:\s+\d+\s+)|$)/g);
  if (!matches) {
    return [];
  }

  const verses: VerseLine[] = [];
  for (const chunk of matches) {
    const matched = chunk.trim().match(/^(\d+)\s+([\s\S]+)$/);
    if (!matched) {
      continue;
    }

    const number = Number(matched[1]);
    if (!Number.isFinite(number) || number < 1) {
      continue;
    }

    const displayHtml = matched[2];
    if (!displayHtml.trim()) {
      continue;
    }

    verses.push({ number, displayHtml });
  }

  return verses;
}

function cleanForSpeech(html: string, verseNumber?: number): string {
  let cleaned = html
    // Remove verse numbers in <sup> tags
    .replace(/<sup[^>]*>\s*\d+\s*<\/sup>/gi, "")
    // Remove cross references like [Dan 12:1; Rev 3:5]
    .replace(/\[[^\]]*\d+:\d+[^\]]*\]/g, "")
    // Remove bracket verse numbers like [4] and [10]
    .replace(/\[\s*\d+\s*\]/g, "")
    // Remove all HTML tags
    .replace(/<[^>]+>/g, "")
    // Remove unicode superscript digits that survive HTML stripping
    .replace(/[⁰¹²³⁴⁵⁶⁷⁸⁹]+/g, "")
    // Remove verse numbers attached to words like 2who / 3you / 4Rejoice
    .replace(/\b\d+(?=[A-Za-z])/g, "")
    // Remove verse markers glued to words like "1Are" / "12Then"
    .replace(/(^|[\s.!?;:([“"'—-])\d{1,3}(?=[A-Z])/g, "$1")
    // Remove leading verse numbers like "4 Rejoice"
    .replace(/^\d+\s+/gm, "")
    // Remove leading verse numbers like "4 Rejoice..." at line/string start
    .replace(/(^|\n)\s*\d{1,3}[)\].-]?\s+(?=[A-Za-z“"'(])/g, "$1")
    // Remove inline verse markers after sentence boundaries like ". 4 Rejoice..."
    .replace(/([.!?]\s+)\d{1,3}[)\].-]?\s+(?=[A-Za-z“"'(])/g, "$1")
    // Remove inline verse markers after commas/colons/semicolons
    .replace(/([,;:]\s+)\d{1,3}[)\].-]?\s+(?=[A-Za-z“"'(])/g, "$1")
    // Remove verse markers immediately after opening quote/paren
    .replace(/([“"'(])\d{1,3}[)\].-]?\s+(?=[A-Za-z])/g, "$1")
    // Remove markers like "4) Rejoice" or "4. Rejoice"
    .replace(/(^|\s)\d{1,3}[)\].-]\s+(?=[A-Za-z])/g, "$1")
    // Remove leftover brackets while keeping bracketed words
    .replace(/[\[\]]/g, "")
    // Normalize whitespace
    .replace(/\s+/g, " ")
    .trim();

  // Explicitly strip this verse's own numeric marker if it still leaked through.
  if (typeof verseNumber === "number" && Number.isFinite(verseNumber)) {
    const marker = String(verseNumber).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    cleaned = cleaned
      .replace(new RegExp(`(^|\\n)\\s*${marker}[)\\].-]?\\s+`, "g"), "$1")
      .replace(new RegExp(`([.!?;:,]\\s+)${marker}[)\\].-]?\\s+`, "g"), "$1")
      .replace(new RegExp(`([“\"'(])${marker}[)\\].-]?\\s+`, "g"), "$1");
  }

  return cleaned.replace(/\s+/g, " ").trim();
}

function makeReaderPath(item: QueueItem): string {
  return `/read/${encodeURIComponent(item.translation)}/${encodeURIComponent(item.book)}/${item.chapter}`;
}

function makePlaylistId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.round(Math.random() * 1_000_000)}`;
}

function makeQueueId(item: Omit<QueueItem, "id">): string {
  return `${item.translation}:${item.book}:${item.chapter}:${Date.now()}:${Math.round(Math.random() * 1_000_000)}`;
}

export function buildQueueItem(input: {
  translation: string;
  book: string;
  chapter: number;
  title?: string;
}): QueueItem {
  return {
    id: makeQueueId({
      translation: input.translation,
      book: input.book,
      chapter: input.chapter,
      title: input.title ?? `${input.book} ${input.chapter}`
    }),
    translation: input.translation,
    book: input.book,
    chapter: input.chapter,
    title: input.title ?? `${input.book} ${input.chapter} (${input.translation})`
  };
}

export function QueueProvider({ children }: { children: React.ReactNode }): React.ReactElement {
  const router = useRouter();

  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [currentIndex, setCurrentIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const [currentVerse, setCurrentVerse] = useState<number | null>(null);
  const [currentChapterTitle, setCurrentChapterTitle] = useState<string | null>(null);
  const [nowViewingItem, setNowViewingItem] = useState<QueueItem | null>(null);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceName, setSelectedVoiceNameState] = useState("");
  const [aiVoiceId, setAiVoiceIdState] = useState("alloy");
  const [showAllVoices, setShowAllVoicesState] = useState(false);
  const [voiceFilter, setVoiceFilterState] = useState<VoiceFilter>("enhanced");
  const [ttsEngine, setTtsEngineState] = useState<TtsEngine>("browser");
  const [speechRate, setSpeechRateState] = useState(0.95);
  const [crossfadeDurationMs, setCrossfadeDurationMsState] = useState(400);
  const [repeatMode, setRepeatModeState] = useState<RepeatMode>("off");
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const queueRef = useRef<QueueItem[]>([]);
  const currentIndexRef = useRef(0);
  const currentVerseRef = useRef<number | null>(null);
  const isPlayingRef = useRef(false);
  const speechRateRef = useRef(0.95);
  const crossfadeMsRef = useRef(400);
  const repeatModeRef = useRef<RepeatMode>("off");
  const selectedVoiceRef = useRef("");
  const aiVoiceIdRef = useRef("alloy");
  const ttsEngineRef = useRef<TtsEngine>("browser");
  const activeAudioRef = useRef<HTMLAudioElement | null>(null);
  const fetchAbortRef = useRef<AbortController | null>(null);
  const sessionRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    currentVerseRef.current = currentVerse;
  }, [currentVerse]);

  useEffect(() => {
    isPlayingRef.current = isPlaying;
  }, [isPlaying]);

  useEffect(() => {
    speechRateRef.current = speechRate;
  }, [speechRate]);

  useEffect(() => {
    crossfadeMsRef.current = crossfadeDurationMs;
  }, [crossfadeDurationMs]);

  useEffect(() => {
    repeatModeRef.current = repeatMode;
  }, [repeatMode]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoiceName;
  }, [selectedVoiceName]);

  useEffect(() => {
    aiVoiceIdRef.current = aiVoiceId;
  }, [aiVoiceId]);

  useEffect(() => {
    ttsEngineRef.current = ttsEngine;
  }, [ttsEngine]);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stopActiveAudio = useCallback((): void => {
    if (fetchAbortRef.current) {
      fetchAbortRef.current.abort();
      fetchAbortRef.current = null;
    }

    if (activeAudioRef.current) {
      activeAudioRef.current.pause();
      activeAudioRef.current.src = "";
      activeAudioRef.current = null;
    }
  }, []);

  const stopBrowserSpeech = useCallback((): void => {
    speechSynthesis.cancel();
  }, []);

  const stop = useCallback((): void => {
    sessionRef.current += 1;
    clearTimer();
    stopActiveAudio();
    stopBrowserSpeech();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentVerse(null);
  }, [clearTimer, stopActiveAudio, stopBrowserSpeech]);

  useEffect(() => {
    const loadStored = (): void => {
      try {
        const savedVoice = localStorage.getItem(VOICE_STORAGE_KEY);
        if (savedVoice) {
          setSelectedVoiceNameState(savedVoice);
        }

        const savedAiVoice = localStorage.getItem(AI_VOICE_STORAGE_KEY);
        if (savedAiVoice) {
          setAiVoiceIdState(savedAiVoice);
        }

        const savedFilter = localStorage.getItem(VOICE_FILTER_STORAGE_KEY);
        if (savedFilter === "enhanced" || savedFilter === "premium") {
          setVoiceFilterState(savedFilter);
        }

        const savedShowAll = localStorage.getItem(VOICE_SHOW_ALL_STORAGE_KEY);
        if (savedShowAll === "1") {
          setShowAllVoicesState(true);
        }

        const savedEngine = localStorage.getItem(TTS_ENGINE_STORAGE_KEY);
        if (savedEngine === "browser" || savedEngine === "openai") {
          setTtsEngineState(savedEngine);
        }

        const savedRate = localStorage.getItem(RATE_STORAGE_KEY);
        if (savedRate) {
          const parsed = Number(savedRate);
          if (Number.isFinite(parsed) && parsed >= 0.8 && parsed <= 1.2) {
            setSpeechRateState(parsed);
          }
        }

        const savedCrossfade = localStorage.getItem(CROSSFADE_STORAGE_KEY);
        if (savedCrossfade) {
          const parsed = Number(savedCrossfade);
          if (Number.isFinite(parsed) && parsed >= 100 && parsed <= 1500) {
            setCrossfadeDurationMsState(parsed);
          }
        }

        const savedRepeatMode = localStorage.getItem(REPEAT_MODE_STORAGE_KEY);
        if (savedRepeatMode === "off" || savedRepeatMode === "chapter" || savedRepeatMode === "playlist") {
          setRepeatModeState(savedRepeatMode);
        }
      } catch (error) {
        console.error("queue_storage_load_failed", error);
      }
    };

    loadStored();
  }, []);

  useEffect(() => {
    localStorage.setItem(VOICE_STORAGE_KEY, selectedVoiceName);
  }, [selectedVoiceName]);

  useEffect(() => {
    localStorage.setItem(AI_VOICE_STORAGE_KEY, aiVoiceId);
  }, [aiVoiceId]);

  useEffect(() => {
    localStorage.setItem(VOICE_FILTER_STORAGE_KEY, voiceFilter);
  }, [voiceFilter]);

  useEffect(() => {
    localStorage.setItem(VOICE_SHOW_ALL_STORAGE_KEY, showAllVoices ? "1" : "0");
  }, [showAllVoices]);

  useEffect(() => {
    localStorage.setItem(TTS_ENGINE_STORAGE_KEY, ttsEngine);
  }, [ttsEngine]);

  useEffect(() => {
    localStorage.setItem(RATE_STORAGE_KEY, String(speechRate));
  }, [speechRate]);

  useEffect(() => {
    localStorage.setItem(CROSSFADE_STORAGE_KEY, String(crossfadeDurationMs));
  }, [crossfadeDurationMs]);

  useEffect(() => {
    localStorage.setItem(REPEAT_MODE_STORAGE_KEY, repeatMode);
  }, [repeatMode]);

  useEffect(() => {
    const loadVoices = (): void => {
      setVoices(speechSynthesis.getVoices());
    };

    loadVoices();
    speechSynthesis.onvoiceschanged = loadVoices;

    return () => {
      speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      clearTimer();
      stopActiveAudio();
      stopBrowserSpeech();
    };
  }, [clearTimer, stopActiveAudio, stopBrowserSpeech]);

  const resolveVoice = useCallback((): SpeechSynthesisVoice | null => {
    const availableVoices = speechSynthesis.getVoices();

    if (selectedVoiceRef.current) {
      const selected = availableVoices.find((entry) => entry.name === selectedVoiceRef.current);
      if (selected) {
        return selected;
      }
    }

    return availableVoices.find((entry) => entry.lang.toLowerCase().startsWith("en-us")) ?? availableVoices[0] ?? null;
  }, []);

  const primeSpeechFromUserGesture = useCallback((): void => {
    if (ttsEngineRef.current !== "browser") {
      return;
    }

    try {
      const voices = speechSynthesis.getVoices();
      const iosVoice = voices.find((voice) => /samantha|daniel|siri/i.test(voice.name));

      const utterance = new SpeechSynthesisUtterance(" ");
      if (iosVoice) {
        utterance.voice = iosVoice;
      }
      utterance.rate = 1;
      utterance.pitch = 1;
      utterance.volume = 0;

      speechSynthesis.cancel();
      speechSynthesis.resume();
      speechSynthesis.speak(utterance);
      speechSynthesis.cancel();
    } catch (error) {
      console.error("speech_prime_failed", error);
    }
  }, []);

  const refreshPlaylists = useCallback(async (): Promise<void> => {
    try {
      const response = await fetch("/api/playlists", { cache: "no-store" });
      if (!response.ok) {
        if (response.status === 401) {
          setPlaylists([]);
          return;
        }
        let details = `playlists_fetch_failed_${response.status}`;
        try {
          const payload = (await response.json()) as { error?: string; debug?: string };
          if (process.env.NODE_ENV === "development" && payload.debug) {
            details = payload.debug;
          } else if (payload.error) {
            details = payload.error;
          }
        } catch {
          // keep default details
        }
        throw new Error(details);
      }

      const payload = (await response.json()) as { playlists?: PlaylistApi[] };
      const normalized: Playlist[] = (payload.playlists ?? []).map((entry) => ({
        id: entry.id,
        name: entry.name,
        createdAt: Date.parse(entry.created_at),
        chapters: (entry.items ?? [])
          .sort((a, b) => a.position - b.position)
          .map((item) => ({
            id: item.id,
            translation: item.translation,
            book: item.book,
            chapter: item.chapter,
            title: item.title
          }))
      }));
      setPlaylists(normalized);
    } catch (error) {
      console.error("playlists_refresh_failed", error);
      setStatusMessage(error instanceof Error ? error.message : "Unable to load playlists.");
    }
  }, []);

  const createPlaylist = useCallback(async (name: string): Promise<string | null> => {
    const trimmed = name.trim();
    if (!trimmed) {
      setStatusMessage("Playlist name is required.");
      return null;
    }

    try {
      const response = await fetch("/api/playlists", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: trimmed })
      });

      if (!response.ok) {
        let errorMessage = "Unable to create playlist.";
        try {
          const payload = (await response.json()) as { error?: string; issues?: unknown; debug?: string };
          if (response.status === 401) {
            errorMessage = "Please sign in again.";
          } else if (process.env.NODE_ENV === "development" && payload.debug) {
            errorMessage = payload.debug;
          } else if (payload.error) {
            errorMessage = payload.error;
          } else if (payload.issues) {
            errorMessage = "Invalid playlist name.";
          }
        } catch {
          // no-op: fall back to generic message
        }
        setStatusMessage(errorMessage);
        return null;
      }

      const payload = (await response.json()) as { playlist?: { id: string } };
      await refreshPlaylists();
      setStatusMessage(`Created playlist "${trimmed}".`);
      return payload.playlist?.id ?? null;
    } catch (error) {
      console.error("playlist_create_failed", error);
      setStatusMessage("Unable to create playlist.");
      return null;
    }
  }, [refreshPlaylists]);

  const addChapterToPlaylist = useCallback(async (playlistId: string, item: QueueItem): Promise<boolean> => {
    try {
      const response = await fetch(`/api/playlists/${playlistId}/items`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          translation: item.translation,
          book: item.book,
          chapter: item.chapter,
          title: item.title
        })
      });

      if (!response.ok) {
        let errorMessage = "Unable to add chapter to playlist.";
        try {
          const payload = (await response.json()) as { error?: string; issues?: unknown; debug?: string };
          if (response.status === 401) {
            errorMessage = "Please sign in again.";
          } else if (process.env.NODE_ENV === "development" && payload.debug) {
            errorMessage = payload.debug;
          } else if (payload.error) {
            errorMessage = payload.error;
          } else if (payload.issues) {
            errorMessage = "Invalid chapter payload.";
          }
        } catch {
          // no-op
        }
        setStatusMessage(errorMessage);
        return false;
      }

      await refreshPlaylists();
      setStatusMessage("Saved to playlist.");
      return true;
    } catch (error) {
      console.error("playlist_add_item_failed", error);
      setStatusMessage("Unable to add chapter to playlist.");
      return false;
    }
  }, [refreshPlaylists]);

  useEffect(() => {
    void refreshPlaylists();
  }, [refreshPlaylists]);

  const fetchChapterVerses = useCallback(async (item: QueueItem): Promise<VerseLine[]> => {
    const response = await fetch("/api/bible/chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        translation: item.translation,
        book: item.book,
        chapter: item.chapter
      })
    });

    const payload = (await response.json()) as ChapterResponse;
    if (payload.status !== "resolved") {
      const message = payload.status === "unavailable" ? payload.message : "Unable to load chapter for playback.";
      throw new Error(message);
    }

    if (payload.html) {
      return parseVersesFromHtml(payload.html);
    }

    return parseVersesFromPlainText(payload.text);
  }, []);

  const playFromIndex = useCallback(async (index: number, startAtVerse?: number): Promise<void> => {
    const activeQueue = queueRef.current;
    if (activeQueue.length === 0 || index < 0 || index >= activeQueue.length) {
      setStatusMessage("Queue is empty.");
      return;
    }

    sessionRef.current += 1;
    const playSession = sessionRef.current;
    clearTimer();
    stopActiveAudio();
    stopBrowserSpeech();
    if (ttsEngineRef.current === "browser") {
      speechSynthesis.resume();
    }

    const item = activeQueue[index];
    setCurrentIndex(index);
    setCurrentChapterTitle(item.title);
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentVerse(null);
    setStatusMessage(null);

    router.push(makeReaderPath(item) as never);

    let verses: VerseLine[] = [];
    try {
      verses = await fetchChapterVerses(item);
    } catch (error) {
      if (playSession !== sessionRef.current) {
        return;
      }

      console.error("queue_chapter_load_failed", error);
      setStatusMessage(error instanceof Error ? error.message : "Unable to load chapter.");
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }

    if (playSession !== sessionRef.current) {
      return;
    }

    if (verses.length === 0) {
      const nextIndex = (() => {
        if (repeatModeRef.current === "chapter") {
          return index;
        }
        const sequential = index + 1;
        if (sequential < activeQueue.length) {
          return sequential;
        }
        if (repeatModeRef.current === "playlist" && activeQueue.length > 0) {
          return 0;
        }
        return null;
      })();

      if (typeof nextIndex === "number") {
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          void playFromIndex(nextIndex);
        }, Math.max(100, crossfadeMsRef.current));
      } else {
        setIsPlaying(false);
        setIsPaused(false);
      }
      return;
    }

    let verseIndex = 0;
    if (typeof startAtVerse === "number" && Number.isFinite(startAtVerse)) {
      const matchedIndex = verses.findIndex((entry) => entry.number === startAtVerse);
      if (matchedIndex >= 0) {
        verseIndex = matchedIndex;
      }
    }

    const continueQueue = (): void => {
      if (playSession !== sessionRef.current) {
        return;
      }

      verseIndex += 1;
      const delay = verseIndex >= verses.length
        ? Math.max(100, crossfadeMsRef.current)
        : 100;

      timerRef.current = window.setTimeout(() => {
        timerRef.current = null;
        speakNext();
      }, delay);
    };

    const speakNext = (): void => {
      if (playSession !== sessionRef.current) {
        return;
      }

      if (verseIndex >= verses.length) {
        const nextIndex = (() => {
          if (repeatModeRef.current === "chapter") {
            return index;
          }
          const sequential = index + 1;
          if (sequential < queueRef.current.length) {
            return sequential;
          }
          if (repeatModeRef.current === "playlist" && queueRef.current.length > 0) {
            return 0;
          }
          return null;
        })();

        if (typeof nextIndex === "number") {
          timerRef.current = window.setTimeout(() => {
            timerRef.current = null;
            void playFromIndex(nextIndex);
          }, Math.max(100, crossfadeMsRef.current));
        } else {
          setCurrentVerse(null);
          setIsPlaying(false);
          setIsPaused(false);
        }
        return;
      }

      const verse = verses[verseIndex];
      const speechText = cleanForSpeech(verse.displayHtml, verse.number);
      console.log("TTS TEXT:", speechText);
      if (!speechText) {
        continueQueue();
        return;
      }

      if (ttsEngineRef.current === "openai") {
        setCurrentVerse(verse.number);
        setIsPaused(false);

        void (async () => {
          try {
            const controller = new AbortController();
            fetchAbortRef.current = controller;

            const response = await fetch("/api/tts/verse", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              signal: controller.signal,
              body: JSON.stringify({
                text: speechText,
                translation: item.translation,
                voiceProfile: aiVoiceIdRef.current,
                voiceSettingsVersion: "v1",
                modelVersion: "gpt-4o-mini-tts"
              })
            });

            if (playSession !== sessionRef.current) {
              return;
            }

            if (!response.ok) {
              let errorMessage = `openai_tts_failed_${response.status}`;
              try {
                const payload = (await response.json()) as { error?: string; debug?: string };
                if (process.env.NODE_ENV === "development" && payload.debug) {
                  errorMessage = payload.debug;
                } else if (payload.error) {
                  errorMessage = payload.error;
                }
              } catch {
                // no-op
              }
              setStatusMessage(errorMessage);
              fetchAbortRef.current = null;
              setIsPlaying(false);
              setIsPaused(false);
              return;
            }

            const payload = (await response.json()) as { redirectUrl?: string };
            if (!payload.redirectUrl) {
              setStatusMessage("Missing audio URL from AI voice.");
              fetchAbortRef.current = null;
              setIsPlaying(false);
              setIsPaused(false);
              return;
            }

            const audio = new Audio(payload.redirectUrl);
            activeAudioRef.current = audio;
            fetchAbortRef.current = null;
            audio.playbackRate = speechRateRef.current;
            audio.preload = "auto";

            audio.onplay = () => {
              if (playSession !== sessionRef.current) {
                return;
              }
              setIsPaused(false);
            };
            audio.onpause = () => {
              if (playSession !== sessionRef.current) {
                return;
              }
              if (!audio.ended) {
                setIsPaused(true);
              }
            };
            audio.onended = () => {
              if (playSession !== sessionRef.current) {
                return;
              }
              activeAudioRef.current = null;
              continueQueue();
            };
            audio.onerror = () => {
              if (playSession !== sessionRef.current) {
                return;
              }
              activeAudioRef.current = null;
              continueQueue();
            };

            await audio.play();
          } catch (error) {
            if (playSession !== sessionRef.current) {
              return;
            }

            if (error instanceof DOMException && error.name === "AbortError") {
              return;
            }
            console.error("openai_tts_playback_failed", error);
            activeAudioRef.current = null;
            fetchAbortRef.current = null;
            setStatusMessage(error instanceof Error ? error.message : "AI voice playback failed.");
            setIsPlaying(false);
            setIsPaused(false);
          }
        })();
        return;
      }

      const selectedVoice = resolveVoice();
      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.rate = verseIndex === verses.length - 1
        ? Math.max(0.8, speechRateRef.current - 0.05)
        : speechRateRef.current;
      utterance.pitch = 1;
      utterance.lang = selectedVoice?.lang ?? "en-US";
      if (selectedVoice) {
        utterance.voice = selectedVoice;
      }

      utterance.onstart = () => {
        if (playSession !== sessionRef.current) {
          return;
        }
        setCurrentVerse(verse.number);
      };
      utterance.onend = continueQueue;
      utterance.onerror = continueQueue;
      utterance.onpause = () => {
        if (playSession !== sessionRef.current) {
          return;
        }
        setIsPaused(true);
      };
      utterance.onresume = () => {
        if (playSession !== sessionRef.current) {
          return;
        }
        setIsPaused(false);
      };

      stopBrowserSpeech();
      speechSynthesis.resume();
      speechSynthesis.speak(utterance);
    };

    speakNext();
  }, [clearTimer, fetchChapterVerses, resolveVoice, router, stopActiveAudio, stopBrowserSpeech]);

  const playFromCurrent = useCallback(async (): Promise<void> => {
    await playFromIndex(currentIndexRef.current);
  }, [playFromIndex]);

  const playChapterNow = useCallback(async (item: QueueItem): Promise<void> => {
    queueRef.current = [item];
    currentIndexRef.current = 0;
    setQueue([item]);
    setCurrentIndex(0);
    await playFromIndex(0);
  }, [playFromIndex]);

  const playPlaylist = useCallback(async (
    playlistId: string,
    options?: { shuffle?: boolean; startIndex?: number }
  ): Promise<void> => {
    const selected = playlists.find((entry) => entry.id === playlistId);
    if (!selected) {
      return;
    }

    const base = [...selected.chapters];
    if (base.length === 0) {
      queueRef.current = [];
      currentIndexRef.current = 0;
      setQueue([]);
      setCurrentIndex(0);
      setStatusMessage(`Playlist "${selected.name}" is empty.`);
      stop();
      return;
    }

    const queueItems = options?.shuffle ? [...base].sort(() => Math.random() - 0.5) : base;
    const maxIndex = queueItems.length - 1;
    const startIndex = Number.isFinite(options?.startIndex)
      ? Math.min(maxIndex, Math.max(0, options?.startIndex ?? 0))
      : 0;

    queueRef.current = queueItems;
    currentIndexRef.current = startIndex;
    setQueue(queueItems);
    setCurrentIndex(startIndex);
    await playFromIndex(startIndex);
  }, [playFromIndex, playlists, stop]);

  const playNowViewing = useCallback(async (): Promise<void> => {
    if (!nowViewingItem) {
      setStatusMessage("Open a chapter first.");
      return;
    }

    await playChapterNow(nowViewingItem);
  }, [nowViewingItem, playChapterNow]);

  const playNext = useCallback((): void => {
    const nextIndex = currentIndexRef.current + 1;
    if (nextIndex >= queueRef.current.length) {
      return;
    }

    void playFromIndex(nextIndex);
  }, [playFromIndex]);

  const playPrevious = useCallback((): void => {
    const previousIndex = currentIndexRef.current - 1;
    if (previousIndex < 0) {
      return;
    }

    void playFromIndex(previousIndex);
  }, [playFromIndex]);

  const togglePause = useCallback((): void => {
    if (!isPlaying) {
      return;
    }

    if (ttsEngineRef.current === "openai") {
      const activeAudio = activeAudioRef.current;
      if (!activeAudio) {
        return;
      }

      if (isPaused) {
        void activeAudio.play();
        setIsPaused(false);
        return;
      }

      activeAudio.pause();
      setIsPaused(true);
      return;
    }

    if (isPaused) {
      speechSynthesis.resume();
      setIsPaused(false);
      return;
    }

    if (speechSynthesis.speaking) {
      speechSynthesis.pause();
      setIsPaused(true);
    }
  }, [isPaused, isPlaying]);

  const addToQueue = useCallback((item: QueueItem): void => {
    setQueue((current) => [...current, item]);
    setStatusMessage(`Added ${item.title} to queue.`);
  }, []);

  const removeFromQueue = useCallback((id: string): void => {
    setQueue((current) => {
      const removedIndex = current.findIndex((entry) => entry.id === id);
      if (removedIndex < 0) {
        return current;
      }

      const nextQueue = current.filter((entry) => entry.id !== id);
      if (nextQueue.length === 0) {
        setCurrentIndex(0);
        stop();
        return nextQueue;
      }

      if (removedIndex < currentIndexRef.current) {
        setCurrentIndex(currentIndexRef.current - 1);
      } else if (removedIndex === currentIndexRef.current) {
        const nextIndex = Math.min(currentIndexRef.current, nextQueue.length - 1);
        setCurrentIndex(nextIndex);
        if (isPlaying || isPaused) {
          stop();
          setStatusMessage("Current chapter removed from active playback.");
        }
      }

      return nextQueue;
    });
  }, [isPaused, isPlaying, stop]);

  const clearQueue = useCallback((): void => {
    setQueue([]);
    setCurrentIndex(0);
    stop();
  }, [stop]);

  const moveItem = useCallback((oldIndex: number, newIndex: number): void => {
    setQueue((current) => {
      if (
        oldIndex < 0 ||
        oldIndex >= current.length ||
        newIndex < 0 ||
        newIndex >= current.length ||
        oldIndex === newIndex
      ) {
        return current;
      }

      const cloned = [...current];
      const [moved] = cloned.splice(oldIndex, 1);
      cloned.splice(newIndex, 0, moved);

      if (currentIndexRef.current === oldIndex) {
        setCurrentIndex(newIndex);
      } else if (oldIndex < currentIndexRef.current && newIndex >= currentIndexRef.current) {
        setCurrentIndex(currentIndexRef.current - 1);
      } else if (oldIndex > currentIndexRef.current && newIndex <= currentIndexRef.current) {
        setCurrentIndex(currentIndexRef.current + 1);
      }

      return cloned;
    });
  }, []);

  const setSelectedVoiceName = useCallback((voiceName: string): void => {
    setSelectedVoiceNameState(voiceName);
  }, []);

  const setAiVoiceId = useCallback((voiceId: string): void => {
    setAiVoiceIdState(voiceId);
  }, []);

  const setShowAllVoices = useCallback((show: boolean): void => {
    setShowAllVoicesState(show);
  }, []);

  const setVoiceFilter = useCallback((filter: VoiceFilter): void => {
    setVoiceFilterState(filter);
  }, []);

  const setTtsEngine = useCallback((engine: TtsEngine): void => {
    if (engine === ttsEngineRef.current) {
      return;
    }

    clearTimer();
    stopActiveAudio();
    stopBrowserSpeech();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentVerse(null);
    setTtsEngineState(engine);
    setStatusMessage(engine === "openai" ? "AI Voice selected." : "Device Voice selected.");
  }, [clearTimer, stopActiveAudio, stopBrowserSpeech]);

  const setSpeechRate = useCallback((rate: number): void => {
    const clamped = Math.min(1.2, Math.max(0.8, rate));
    const rounded = Number(clamped.toFixed(2));
    if (rounded === speechRateRef.current) {
      return;
    }

    setSpeechRateState(rounded);

    if (!isPlayingRef.current) {
      return;
    }

    const activeIndex = currentIndexRef.current;
    if (activeIndex < 0 || activeIndex >= queueRef.current.length) {
      return;
    }

    const activeVerse = currentVerseRef.current;
    clearTimer();
    stopActiveAudio();
    stopBrowserSpeech();
    if (ttsEngineRef.current === "browser") {
      speechSynthesis.resume();
    }
    void playFromIndex(activeIndex, typeof activeVerse === "number" ? activeVerse : undefined);
  }, [clearTimer, playFromIndex, stopActiveAudio, stopBrowserSpeech]);

  const setCrossfadeDurationMs = useCallback((ms: number): void => {
    const clamped = Math.min(1500, Math.max(100, Math.round(ms)));
    setCrossfadeDurationMsState(clamped);
  }, []);

  const setRepeatMode = useCallback((mode: RepeatMode): void => {
    setRepeatModeState(mode);
  }, []);

  const saveCurrentQueueAsPlaylist = useCallback((name: string): void => {
    void (async () => {
      const playlistId = await createPlaylist(name);
      if (!playlistId) {
        return;
      }

      for (const chapter of queueRef.current) {
        await addChapterToPlaylist(playlistId, chapter);
      }
    })();
  }, [addChapterToPlaylist, createPlaylist]);

  const loadPlaylistIntoQueue = useCallback((playlistId: string): void => {
    const selected = playlists.find((entry) => entry.id === playlistId);
    if (!selected) {
      return;
    }

    stop();
    setQueue(selected.chapters);
    setCurrentIndex(0);
    setStatusMessage(`Loaded playlist: ${selected.name}`);
  }, [playlists, stop]);

  const deletePlaylist = useCallback((playlistId: string): void => {
    void (async () => {
      try {
        const response = await fetch(`/api/playlists/${playlistId}`, { method: "DELETE" });
        if (!response.ok) {
          setStatusMessage("Unable to delete playlist.");
          return;
        }
        setStatusMessage("Playlist deleted.");
      } catch (error) {
        console.error("playlist_delete_failed", error);
        setStatusMessage("Unable to delete playlist.");
      } finally {
        await refreshPlaylists();
      }
    })();
  }, [refreshPlaylists]);

  const contextValue = useMemo<QueueContextValue>(() => {
    return {
      queue,
      currentIndex,
      isPlaying,
      isPaused,
      currentVerse,
      currentChapterTitle,
      nowViewingItem,
      speechRate,
      crossfadeDurationMs,
      repeatMode,
      voices,
      selectedVoiceName,
      aiVoiceId,
      showAllVoices,
      voiceFilter,
      ttsEngine,
      playlists,
      drawerOpen,
      playlistModalOpen,
      statusMessage,
      addToQueue,
      removeFromQueue,
      clearQueue,
      moveItem,
      playNext,
      playPrevious,
      setCurrentIndex,
      setDrawerOpen,
      setPlaylistModalOpen,
      setSelectedVoiceName,
      setAiVoiceId,
      setShowAllVoices,
      setVoiceFilter,
      setTtsEngine,
      setSpeechRate,
      setCrossfadeDurationMs,
      setRepeatMode,
      setNowViewingItem,
      primeSpeechFromUserGesture,
      playFromCurrent,
      playFromIndex,
      playChapterNow,
      playPlaylist,
      playNowViewing,
      togglePause,
      stop,
      saveCurrentQueueAsPlaylist,
      createPlaylist,
      addChapterToPlaylist,
      refreshPlaylists,
      loadPlaylistIntoQueue,
      deletePlaylist
    };
  }, [
    queue,
    currentIndex,
    isPlaying,
    isPaused,
    currentVerse,
    currentChapterTitle,
    nowViewingItem,
    speechRate,
    crossfadeDurationMs,
    repeatMode,
    voices,
    selectedVoiceName,
    aiVoiceId,
    showAllVoices,
    voiceFilter,
    ttsEngine,
    playlists,
    drawerOpen,
    playlistModalOpen,
    statusMessage,
    addToQueue,
    removeFromQueue,
    clearQueue,
    moveItem,
    playNext,
    playPrevious,
    setCurrentIndex,
    playFromCurrent,
    playFromIndex,
    playChapterNow,
    playPlaylist,
    playNowViewing,
    togglePause,
    stop,
    saveCurrentQueueAsPlaylist,
    createPlaylist,
    addChapterToPlaylist,
    refreshPlaylists,
    loadPlaylistIntoQueue,
    deletePlaylist,
    setSelectedVoiceName,
    setAiVoiceId,
    setShowAllVoices,
    setVoiceFilter,
    setTtsEngine,
    setSpeechRate,
    setCrossfadeDurationMs,
    setRepeatMode,
    setNowViewingItem,
    primeSpeechFromUserGesture
  ]);

  return <QueueContext.Provider value={contextValue}>{children}</QueueContext.Provider>;
}

export function useQueue(): QueueContextValue {
  const context = useContext(QueueContext);
  if (!context) {
    throw new Error("useQueue must be used inside QueueProvider");
  }

  return context;
}

export function useFilteredVoices(): SpeechSynthesisVoice[] {
  const { voices, showAllVoices, voiceFilter } = useQueue();

  return useMemo(() => {
    if (showAllVoices) {
      return voices;
    }

    const keyword = voiceFilter === "enhanced" ? "enhanced" : "premium";
    const filtered = voices.filter((voice) => voice.name.toLowerCase().includes(keyword));
    return filtered.length > 0 ? filtered : voices;
  }, [voices, showAllVoices, voiceFilter]);
}
