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
  voices: SpeechSynthesisVoice[];
  selectedVoiceName: string;
  showAllVoices: boolean;
  voiceFilter: VoiceFilter;
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
  setShowAllVoices: (show: boolean) => void;
  setVoiceFilter: (filter: VoiceFilter) => void;
  setSpeechRate: (rate: number) => void;
  setCrossfadeDurationMs: (ms: number) => void;
  setNowViewingItem: (item: QueueItem | null) => void;
  playFromCurrent: () => Promise<void>;
  playFromIndex: (index: number) => Promise<void>;
  playNowViewing: () => Promise<void>;
  togglePause: () => void;
  stop: () => void;
  saveCurrentQueueAsPlaylist: (name: string) => void;
  loadPlaylistIntoQueue: (playlistId: string) => void;
  deletePlaylist: (playlistId: string) => void;
};

const QUEUE_STORAGE_KEY = "fellowship.queue.v1";
const QUEUE_INDEX_STORAGE_KEY = "fellowship.queue.index.v1";
const PLAYLIST_STORAGE_KEY = "fellowship.playlists.v1";
const VOICE_STORAGE_KEY = "fellowship.voice.name.v1";
const VOICE_FILTER_STORAGE_KEY = "fellowship.voice.filter.v1";
const VOICE_SHOW_ALL_STORAGE_KEY = "fellowship.voice.showall.v1";
const RATE_STORAGE_KEY = "fellowship.voice.rate.v1";
const CROSSFADE_STORAGE_KEY = "fellowship.crossfade.ms.v1";

const QueueContext = createContext<QueueContextValue | null>(null);

function parseVersesFromHtml(chapterHtml: string): VerseLine[] {
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
  const [showAllVoices, setShowAllVoicesState] = useState(false);
  const [voiceFilter, setVoiceFilterState] = useState<VoiceFilter>("enhanced");
  const [speechRate, setSpeechRateState] = useState(0.95);
  const [crossfadeDurationMs, setCrossfadeDurationMsState] = useState(400);
  const [playlists, setPlaylists] = useState<Playlist[]>([]);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [playlistModalOpen, setPlaylistModalOpen] = useState(false);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  const queueRef = useRef<QueueItem[]>([]);
  const currentIndexRef = useRef(0);
  const speechRateRef = useRef(0.95);
  const crossfadeMsRef = useRef(400);
  const selectedVoiceRef = useRef("");
  const sessionRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    queueRef.current = queue;
  }, [queue]);

  useEffect(() => {
    currentIndexRef.current = currentIndex;
  }, [currentIndex]);

  useEffect(() => {
    speechRateRef.current = speechRate;
  }, [speechRate]);

  useEffect(() => {
    crossfadeMsRef.current = crossfadeDurationMs;
  }, [crossfadeDurationMs]);

  useEffect(() => {
    selectedVoiceRef.current = selectedVoiceName;
  }, [selectedVoiceName]);

  const clearTimer = useCallback((): void => {
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const stop = useCallback((): void => {
    sessionRef.current += 1;
    clearTimer();
    speechSynthesis.cancel();
    setIsPlaying(false);
    setIsPaused(false);
    setCurrentVerse(null);
  }, [clearTimer]);

  useEffect(() => {
    const loadStored = (): void => {
      try {
        const storedQueue = localStorage.getItem(QUEUE_STORAGE_KEY);
        if (storedQueue) {
          const parsed = JSON.parse(storedQueue) as QueueItem[];
          if (Array.isArray(parsed)) {
            setQueue(parsed);
          }
        }

        const storedIndex = localStorage.getItem(QUEUE_INDEX_STORAGE_KEY);
        if (storedIndex) {
          const parsed = Number(storedIndex);
          if (Number.isFinite(parsed) && parsed >= 0) {
            setCurrentIndex(parsed);
          }
        }

        const storedPlaylists = localStorage.getItem(PLAYLIST_STORAGE_KEY);
        if (storedPlaylists) {
          const parsed = JSON.parse(storedPlaylists) as Playlist[];
          if (Array.isArray(parsed)) {
            setPlaylists(parsed);
          }
        }

        const savedVoice = localStorage.getItem(VOICE_STORAGE_KEY);
        if (savedVoice) {
          setSelectedVoiceNameState(savedVoice);
        }

        const savedFilter = localStorage.getItem(VOICE_FILTER_STORAGE_KEY);
        if (savedFilter === "enhanced" || savedFilter === "premium") {
          setVoiceFilterState(savedFilter);
        }

        const savedShowAll = localStorage.getItem(VOICE_SHOW_ALL_STORAGE_KEY);
        if (savedShowAll === "1") {
          setShowAllVoicesState(true);
        }

        const savedRate = localStorage.getItem(RATE_STORAGE_KEY);
        if (savedRate) {
          const parsed = Number(savedRate);
          if (Number.isFinite(parsed) && parsed >= 0.85 && parsed <= 1.2) {
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
      } catch (error) {
        console.error("queue_storage_load_failed", error);
      }
    };

    loadStored();
  }, []);

  useEffect(() => {
    localStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(queue));
  }, [queue]);

  useEffect(() => {
    localStorage.setItem(QUEUE_INDEX_STORAGE_KEY, String(currentIndex));
  }, [currentIndex]);

  useEffect(() => {
    localStorage.setItem(PLAYLIST_STORAGE_KEY, JSON.stringify(playlists));
  }, [playlists]);

  useEffect(() => {
    localStorage.setItem(VOICE_STORAGE_KEY, selectedVoiceName);
  }, [selectedVoiceName]);

  useEffect(() => {
    localStorage.setItem(VOICE_FILTER_STORAGE_KEY, voiceFilter);
  }, [voiceFilter]);

  useEffect(() => {
    localStorage.setItem(VOICE_SHOW_ALL_STORAGE_KEY, showAllVoices ? "1" : "0");
  }, [showAllVoices]);

  useEffect(() => {
    localStorage.setItem(RATE_STORAGE_KEY, String(speechRate));
  }, [speechRate]);

  useEffect(() => {
    localStorage.setItem(CROSSFADE_STORAGE_KEY, String(crossfadeDurationMs));
  }, [crossfadeDurationMs]);

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
      speechSynthesis.cancel();
    };
  }, [clearTimer]);

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

  const playFromIndex = useCallback(async (index: number): Promise<void> => {
    const activeQueue = queueRef.current;
    if (activeQueue.length === 0 || index < 0 || index >= activeQueue.length) {
      setStatusMessage("Queue is empty.");
      return;
    }

    sessionRef.current += 1;
    const playSession = sessionRef.current;
    clearTimer();
    speechSynthesis.cancel();

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
      const nextIndex = index + 1;
      if (nextIndex < activeQueue.length) {
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

    const selectedVoice = resolveVoice();
    let verseIndex = 0;

    const speakNext = (): void => {
      if (playSession !== sessionRef.current) {
        return;
      }

      if (verseIndex >= verses.length) {
        const nextIndex = index + 1;
        if (nextIndex < queueRef.current.length) {
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
        verseIndex += 1;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          speakNext();
        }, 100);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.rate = verseIndex === verses.length - 1
        ? Math.max(0.85, speechRateRef.current - 0.05)
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

      const queueContinuation = (): void => {
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

      utterance.onend = queueContinuation;
      utterance.onerror = () => {
        queueContinuation();
      };
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

      speechSynthesis.speak(utterance);
    };

    speakNext();
  }, [clearTimer, fetchChapterVerses, resolveVoice, router]);

  const playNowViewing = useCallback(async (): Promise<void> => {
    if (!nowViewingItem) {
      setStatusMessage("Open a chapter first.");
      return;
    }

    sessionRef.current += 1;
    const playSession = sessionRef.current;
    clearTimer();
    speechSynthesis.cancel();

    setCurrentChapterTitle(nowViewingItem.title);
    setIsPlaying(true);
    setIsPaused(false);
    setCurrentVerse(null);
    setStatusMessage(null);
    router.push(makeReaderPath(nowViewingItem) as never);

    let verses: VerseLine[] = [];
    try {
      verses = await fetchChapterVerses(nowViewingItem);
    } catch (error) {
      if (playSession !== sessionRef.current) {
        return;
      }

      console.error("standalone_chapter_load_failed", error);
      setStatusMessage(error instanceof Error ? error.message : "Unable to load chapter.");
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }

    if (playSession !== sessionRef.current) {
      return;
    }

    if (verses.length === 0) {
      setIsPlaying(false);
      setIsPaused(false);
      return;
    }

    const selectedVoice = resolveVoice();
    let verseIndex = 0;

    const speakNext = (): void => {
      if (playSession !== sessionRef.current) {
        return;
      }

      if (verseIndex >= verses.length) {
        setCurrentVerse(null);
        setIsPlaying(false);
        setIsPaused(false);
        return;
      }

      const verse = verses[verseIndex];
      const speechText = cleanForSpeech(verse.displayHtml, verse.number);
      console.log("TTS TEXT:", speechText);
      if (!speechText) {
        verseIndex += 1;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          speakNext();
        }, 100);
        return;
      }
      const utterance = new SpeechSynthesisUtterance(speechText);
      utterance.rate = verseIndex === verses.length - 1
        ? Math.max(0.85, speechRateRef.current - 0.05)
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

      const queueContinuation = (): void => {
        if (playSession !== sessionRef.current) {
          return;
        }

        verseIndex += 1;
        timerRef.current = window.setTimeout(() => {
          timerRef.current = null;
          speakNext();
        }, 100);
      };

      utterance.onend = queueContinuation;
      utterance.onerror = () => {
        queueContinuation();
      };
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

      speechSynthesis.speak(utterance);
    };

    speakNext();
  }, [clearTimer, fetchChapterVerses, nowViewingItem, resolveVoice, router]);

  const playFromCurrent = useCallback(async (): Promise<void> => {
    await playFromIndex(currentIndexRef.current);
  }, [playFromIndex]);

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

  const setShowAllVoices = useCallback((show: boolean): void => {
    setShowAllVoicesState(show);
  }, []);

  const setVoiceFilter = useCallback((filter: VoiceFilter): void => {
    setVoiceFilterState(filter);
  }, []);

  const setSpeechRate = useCallback((rate: number): void => {
    const clamped = Math.min(1.2, Math.max(0.85, rate));
    setSpeechRateState(Number(clamped.toFixed(2)));
  }, []);

  const setCrossfadeDurationMs = useCallback((ms: number): void => {
    const clamped = Math.min(1500, Math.max(100, Math.round(ms)));
    setCrossfadeDurationMsState(clamped);
  }, []);

  const saveCurrentQueueAsPlaylist = useCallback((name: string): void => {
    const trimmed = name.trim();
    if (!trimmed || queueRef.current.length === 0) {
      return;
    }

    setPlaylists((current) => [
      {
        id: makePlaylistId(),
        name: trimmed,
        createdAt: Date.now(),
        chapters: [...queueRef.current]
      },
      ...current
    ]);
  }, []);

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
    setPlaylists((current) => current.filter((entry) => entry.id !== playlistId));
  }, []);

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
      voices,
      selectedVoiceName,
      showAllVoices,
      voiceFilter,
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
      setShowAllVoices,
      setVoiceFilter,
      setSpeechRate,
      setCrossfadeDurationMs,
      setNowViewingItem,
      playFromCurrent,
      playFromIndex,
      playNowViewing,
      togglePause,
      stop,
      saveCurrentQueueAsPlaylist,
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
    voices,
    selectedVoiceName,
    showAllVoices,
    voiceFilter,
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
    playNowViewing,
    togglePause,
    stop,
    saveCurrentQueueAsPlaylist,
    loadPlaylistIntoQueue,
    deletePlaylist,
    setSelectedVoiceName,
    setShowAllVoices,
    setVoiceFilter,
    setSpeechRate,
    setCrossfadeDurationMs,
    setNowViewingItem
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
