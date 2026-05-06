"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import type { ChapterAudioManifest } from "@/lib/audio/chapter-audio";
import { loadFirebaseChapterAudioManifest } from "@/lib/audio/firebase-chapter-audio";
import { buildChapterAudioFolder, buildChapterManifestPath } from "@/lib/audio/storage-paths";

type Props = {
  initialBook: string;
  initialChapter: number;
  manifest: ChapterAudioManifest | null;
  missingFiles: string[];
  attemptedPath: string;
  requestedTranslation: string;
};

type AudioMode = "ai" | "device";
type PlayerStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";
type ScriptureStatus = "idle" | "loading" | "ready" | "error";

type ScriptureVerse = {
  number: string;
  text: string;
};

type FirebaseDebugState = {
  expectedManifestPath: string;
  manifestFound: boolean;
  segmentCount: number;
  audioUrls: string[];
  localFallbackStatus: string;
  errorMessage: string | null;
};

const TRANSLATIONS = ["AMP", "AMPC", "NKJV", "ESV", "KJV"] as const;
const AI_SPEEDS = [0.85, 0.9, 1, 1.1, 1.2] as const;
const DEVICE_RATES = [0.75, 0.85, 0.95, 1, 1.1] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayBookFromSlug(value: string): string {
  const found = BIBLE_BOOKS.find((book) => slugify(book.name) === slugify(value));
  return found?.name ?? value.split("-").map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }
  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function sumDurations(durations: number[], endIndex: number): number {
  return durations.slice(0, endIndex).reduce((total, duration) => total + (Number.isFinite(duration) ? duration : 0), 0);
}

function splitSpeechText(text: string): string[] {
  return text
    .replace(/\s+/g, " ")
    .split(/(?<=[.!?])\s+(?=\S)/)
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);
}

function splitScriptureVerses(text: string): ScriptureVerse[] {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) {
    return [];
  }

  const matches = [...normalized.matchAll(/\b(\d{1,3})\s+([\s\S]*?)(?=\s+\d{1,3}\s+|$)/g)];
  if (matches.length === 0) {
    return [{ number: "1", text: normalized }];
  }

  return matches.map((match, index) => ({
    number: match[1] || String(index + 1),
    text: match[2].trim()
  })).filter((verse) => verse.text.length > 0);
}

function isAppleVoice(voice: SpeechSynthesisVoice): boolean {
  const value = `${voice.name} ${voice.voiceURI}`.toLowerCase();
  return value.includes("apple") || value.includes("samantha") || value.includes("ava") || value.includes("allison") || value.includes("susan");
}

export function ChapterAudioPlayer({
  initialBook,
  initialChapter,
  manifest: localManifest,
  missingFiles: localMissingFiles,
  attemptedPath,
  requestedTranslation
}: Props): React.ReactElement {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayRef = useRef(false);
  const deviceUtteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const deviceTextRef = useRef<string[]>([]);
  const deviceIndexRef = useRef(0);

  const initialFirebaseManifestPath = buildChapterManifestPath(requestedTranslation, initialBook, initialChapter);
  const initialFirebaseFolderPath = buildChapterAudioFolder(requestedTranslation, initialBook, initialChapter);

  const [manifest, setManifest] = useState<ChapterAudioManifest | null>(localManifest);
  const [missingFiles, setMissingFiles] = useState<string[]>(localMissingFiles);
  const [audioSource, setAudioSource] = useState<"firebase" | "local" | "none">(localManifest ? "local" : "none");
  const [activeMode, setActiveMode] = useState<AudioMode>("ai");
  const [firebaseErrorMessage, setFirebaseErrorMessage] = useState<string | null>(null);
  const [expectedFirebaseManifestPath, setExpectedFirebaseManifestPath] = useState(initialFirebaseManifestPath);
  const [expectedFirebaseFolderPath, setExpectedFirebaseFolderPath] = useState(initialFirebaseFolderPath);
  const [isResolvingAudioSource, setIsResolvingAudioSource] = useState(true);
  const [selectedBook, setSelectedBook] = useState(displayBookFromSlug(initialBook));
  const [selectedChapter, setSelectedChapter] = useState(String(initialChapter));
  const [translation, setTranslation] = useState((localManifest?.translation ?? requestedTranslation).toUpperCase());
  const [partIndex, setPartIndex] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>(localManifest ? "loading" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [currentTime, setCurrentTime] = useState(0);
  const [durations, setDurations] = useState<number[]>(() => localManifest?.audioParts.map(() => Number.NaN) ?? []);
  const [aiRate, setAiRate] = useState(1);
  const [voices, setVoices] = useState<SpeechSynthesisVoice[]>([]);
  const [selectedVoiceURI, setSelectedVoiceURI] = useState("");
  const [deviceRate, setDeviceRate] = useState(0.95);
  const [devicePitch, setDevicePitch] = useState(1);
  const [deviceText, setDeviceText] = useState("");
  const [deviceStatus, setDeviceStatus] = useState<PlayerStatus>("idle");
  const [deviceError, setDeviceError] = useState<string | null>(null);
  const [deviceProgress, setDeviceProgress] = useState(0);
  const [deviceTotal, setDeviceTotal] = useState(0);
  const [audioRetryCount, setAudioRetryCount] = useState(0);
  const [scriptureText, setScriptureText] = useState("");
  const [scriptureStatus, setScriptureStatus] = useState<ScriptureStatus>("idle");
  const [scriptureError, setScriptureError] = useState<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);
  const [firebaseDebug, setFirebaseDebug] = useState<FirebaseDebugState>({
    expectedManifestPath: initialFirebaseManifestPath,
    manifestFound: Boolean(localManifest),
    segmentCount: localManifest?.audioParts.length ?? 0,
    audioUrls: localManifest?.audioParts.map((part) => part.url) ?? [],
    localFallbackStatus: localManifest ? (localMissingFiles.length === 0 ? "available" : `missing ${localMissingFiles.join(", ")}`) : "not found",
    errorMessage: null
  });

  const activeBook = manifest?.book ?? displayBookFromSlug(initialBook);
  const activeChapter = manifest?.chapter ?? initialChapter;
  const audioParts = manifest?.audioParts ?? [];
  const activePart = audioParts[partIndex] ?? null;
  const aiReady = Boolean(manifest && audioParts.length > 0 && missingFiles.length === 0 && !errorMessage);
  const knownDuration = durations.length > 0 && durations.every((duration) => Number.isFinite(duration));
  const chapterDuration = knownDuration ? sumDurations(durations, durations.length) : Number.NaN;
  const chapterElapsed = sumDurations(durations, partIndex) + currentTime;
  const chapterRemaining = knownDuration ? Math.max(0, chapterDuration - chapterElapsed) : Number.NaN;
  const aiProgressPercent = knownDuration && chapterDuration > 0
    ? Math.min(100, Math.max(0, (chapterElapsed / chapterDuration) * 100))
    : activePart && audioRef.current?.duration
      ? Math.min(100, Math.max(0, (currentTime / audioRef.current.duration) * 100))
      : 0;
  const deviceProgressPercent = deviceTotal > 0 ? Math.min(100, (deviceProgress / deviceTotal) * 100) : 0;
  const progressPercent = activeMode === "ai" ? aiProgressPercent : deviceProgressPercent;

  const selectedBookMeta = useMemo(
    () => BIBLE_BOOKS.find((book) => book.name === selectedBook) ?? BIBLE_BOOKS.find((book) => book.name === activeBook) ?? BIBLE_BOOKS[0],
    [activeBook, selectedBook]
  );
  const selectedVoice = useMemo(
    () => voices.find((voice) => voice.voiceURI === selectedVoiceURI) ?? voices.find(isAppleVoice) ?? voices[0] ?? null,
    [selectedVoiceURI, voices]
  );
  const sourceLabel = audioSource === "firebase" ? "Cloud narration" : audioSource === "local" ? "Local narration" : "Narration unavailable";
  const chapterLabel = `${activeBook} ${activeChapter}`;
  const expectedFirebasePath = expectedFirebaseManifestPath;
  const missingAiMessage = `AI narration is not uploaded yet for ${translation} ${activeBook} ${activeChapter}.`;
  const generationCommand = `npm run audio:chapter -- --translation ${requestedTranslation} --book "${activeBook}" --chapter ${activeChapter} --input local-chapters/${requestedTranslation}/${slugify(activeBook)}/${activeChapter}.txt`;
  const uploadCommand = `npm run audio:upload -- --translation ${requestedTranslation} --book "${activeBook}" --chapter ${activeChapter} --service-account ./serviceAccountKey.json`;
  const progressKey = `chapter-audio:${requestedTranslation}:${slugify(activeBook)}:${activeChapter}`;
  const scriptureVerses = useMemo(() => splitScriptureVerses(scriptureText), [scriptureText]);
  const isDev = process.env.NODE_ENV === "development";

  const loadPart = useCallback((index: number, shouldPlay: boolean): void => {
    const audio = audioRef.current;
    const nextPart = audioParts[index];
    if (!audio || !nextPart) {
      return;
    }

    autoPlayRef.current = shouldPlay;
    setPartIndex(index);
    setCurrentTime(0);
    setStatus("loading");
    audio.src = nextPart.url;
    audio.playbackRate = aiRate;
    audio.load();
  }, [aiRate, audioParts]);

  useEffect(() => {
    const updateVoices = (): void => {
      const available = window.speechSynthesis?.getVoices?.() ?? [];
      setVoices(available);
      if (!selectedVoiceURI && available.length > 0) {
        setSelectedVoiceURI((available.find(isAppleVoice) ?? available[0]).voiceURI);
      }
    };

    updateVoices();
    window.speechSynthesis?.addEventListener("voiceschanged", updateVoices);
    return () => window.speechSynthesis?.removeEventListener("voiceschanged", updateVoices);
  }, [selectedVoiceURI]);

  useEffect(() => {
    setSelectedBook(displayBookFromSlug(initialBook));
    setSelectedChapter(String(initialChapter));
    setTranslation((localManifest?.translation ?? requestedTranslation).toUpperCase());
    setPartIndex(0);
    setCurrentTime(0);
    setDurations(localManifest?.audioParts.map(() => Number.NaN) ?? []);
    setErrorMessage(null);
    setFirebaseErrorMessage(null);
    setExpectedFirebaseManifestPath(buildChapterManifestPath(requestedTranslation, initialBook, initialChapter));
    setExpectedFirebaseFolderPath(buildChapterAudioFolder(requestedTranslation, initialBook, initialChapter));
    setFirebaseDebug({
      expectedManifestPath: buildChapterManifestPath(requestedTranslation, initialBook, initialChapter),
      manifestFound: false,
      segmentCount: 0,
      audioUrls: [],
      localFallbackStatus: localManifest ? (localMissingFiles.length === 0 ? "available" : `missing ${localMissingFiles.join(", ")}`) : "not found",
      errorMessage: null
    });
    setIsResolvingAudioSource(true);
    setStatus("loading");

    let cancelled = false;
    loadFirebaseChapterAudioManifest(displayBookFromSlug(initialBook), initialChapter, requestedTranslation)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setExpectedFirebaseManifestPath(result.expectedManifestPath);
        setExpectedFirebaseFolderPath(result.expectedFolderPath);
        setFirebaseDebug({
          expectedManifestPath: result.expectedManifestPath,
          manifestFound: Boolean(result.manifest),
          segmentCount: result.manifest?.audioParts.length ?? 0,
          audioUrls: result.manifest?.audioParts.map((part) => part.url) ?? [],
          localFallbackStatus: localManifest ? (localMissingFiles.length === 0 ? "available" : `missing ${localMissingFiles.join(", ")}`) : "not found",
          errorMessage: result.errorMessage
        });

        if (result.manifest) {
          setManifest(result.manifest);
          setMissingFiles([]);
          setAudioSource("firebase");
          setActiveMode("ai");
          setTranslation(result.manifest.translation.toUpperCase());
          setDurations(result.manifest.audioParts.map(() => Number.NaN));
          setErrorMessage(null);
          setFirebaseErrorMessage(null);
          setStatus("loading");
          return;
        }

        setFirebaseErrorMessage(result.errorMessage);
        if (localManifest && localMissingFiles.length === 0) {
          setManifest(localManifest);
          setMissingFiles(localMissingFiles);
          setAudioSource("local");
          setActiveMode("ai");
          setTranslation(localManifest.translation.toUpperCase());
          setDurations(localManifest.audioParts.map(() => Number.NaN));
          setErrorMessage(null);
          setStatus("loading");
          return;
        }

        setManifest(null);
        setMissingFiles(localMissingFiles);
        setAudioSource("none");
        setActiveMode("ai");
        setErrorMessage(missingAiMessage);
        setStatus("error");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }

        setFirebaseErrorMessage(error instanceof Error ? error.message : "Cloud narration could not be loaded.");
        if (localManifest && localMissingFiles.length === 0) {
          setManifest(localManifest);
          setMissingFiles(localMissingFiles);
          setAudioSource("local");
          setActiveMode("ai");
          setTranslation(localManifest.translation.toUpperCase());
          setDurations(localManifest.audioParts.map(() => Number.NaN));
          setErrorMessage(null);
          setStatus("loading");
        } else {
          setManifest(null);
          setAudioSource("none");
          setActiveMode("ai");
          setErrorMessage(missingAiMessage);
          setStatus("error");
          setFirebaseDebug((current) => ({
            ...current,
            manifestFound: false,
            segmentCount: 0,
            audioUrls: [],
            errorMessage: error instanceof Error ? error.message : "Cloud narration could not be loaded."
          }));
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingAudioSource(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [audioRetryCount, initialBook, initialChapter, localManifest, localMissingFiles, requestedTranslation]);

  useEffect(() => {
    let cancelled = false;

    setScriptureStatus("loading");
    setScriptureError(null);
    fetch("/api/bible/chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book: activeBook, chapter: activeChapter, translation })
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (data.status !== "resolved" || !data.text) {
          throw new Error(data.message ?? `${translation} ${chapterLabel} text is not available yet.`);
        }
        const text = String(data.text);
        setScriptureText(text);
        setDeviceText(text);
        deviceTextRef.current = [];
        setScriptureStatus("ready");
      })
      .catch((error: unknown) => {
        if (cancelled) {
          return;
        }
        setScriptureText("");
        setScriptureError(error instanceof Error ? error.message : "Chapter text could not be loaded.");
        setScriptureStatus("error");
      });

    return () => {
      cancelled = true;
    };
  }, [activeBook, activeChapter, chapterLabel, translation]);

  useEffect(() => {
    if (!manifest || audioParts.length === 0 || !audioRef.current || missingFiles.length > 0) {
      return;
    }

    loadPart(0, false);
  }, [audioParts.length, loadPart, manifest, missingFiles.length]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = aiRate;
  }, [aiRate]);

  useEffect(() => {
    if (!manifest || audioParts.length === 0) {
      return;
    }

    const cancelled = { value: false };
    audioParts.forEach((part, index) => {
      const audio = new Audio(part.url);
      audio.preload = index === partIndex + 1 ? "auto" : "metadata";
      audio.addEventListener("loadedmetadata", () => {
        if (cancelled.value) {
          return;
        }
        setDurations((current) => {
          const next = [...current];
          next[index] = audio.duration;
          return next;
        });
      });
    });

    return () => {
      cancelled.value = true;
    };
  }, [audioParts, manifest, partIndex]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const saved = window.localStorage.getItem(progressKey);
    if (saved && audioParts.length > 0) {
      try {
        const parsed = JSON.parse(saved) as { index?: number; time?: number };
        if (typeof parsed.index === "number" && parsed.index > 0 && parsed.index < audioParts.length) {
          loadPart(parsed.index, false);
        } else if (typeof parsed.time === "number") {
          audio.currentTime = parsed.time;
        }
      } catch {
        window.localStorage.removeItem(progressKey);
      }
    }
  }, [audioParts.length, loadPart, progressKey]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }

    const handleLoadedMetadata = (): void => {
      setDurations((current) => {
        const next = [...current];
        next[partIndex] = audio.duration;
        return next;
      });

      if (autoPlayRef.current) {
        audio.play()
          .then(() => setStatus("playing"))
          .catch(() => {
            setErrorMessage("Playback was blocked. Press play again to start the chapter.");
            setStatus("paused");
          });
      } else {
        setStatus("ready");
      }
    };

    const handleTimeUpdate = (): void => {
      setCurrentTime(audio.currentTime);
      window.localStorage.setItem(progressKey, JSON.stringify({ index: partIndex, time: audio.currentTime }));
    };
    const handlePlay = (): void => setStatus("playing");
    const handlePause = (): void => {
      if (!audio.ended) {
        setStatus("paused");
      }
    };
    const handleError = (): void => {
      setErrorMessage("This chapter audio could not be loaded. Check the upload or regenerate the chapter.");
      setStatus("error");
    };
    const handleEnded = (): void => {
      if (partIndex < audioParts.length - 1) {
        loadPart(partIndex + 1, true);
        return;
      }
      autoPlayRef.current = false;
      window.localStorage.removeItem(progressKey);
      setStatus("ended");
      setCurrentTime(audio.duration || currentTime);
    };

    audio.addEventListener("loadedmetadata", handleLoadedMetadata);
    audio.addEventListener("timeupdate", handleTimeUpdate);
    audio.addEventListener("play", handlePlay);
    audio.addEventListener("pause", handlePause);
    audio.addEventListener("error", handleError);
    audio.addEventListener("ended", handleEnded);

    return () => {
      audio.removeEventListener("loadedmetadata", handleLoadedMetadata);
      audio.removeEventListener("timeupdate", handleTimeUpdate);
      audio.removeEventListener("play", handlePlay);
      audio.removeEventListener("pause", handlePause);
      audio.removeEventListener("error", handleError);
      audio.removeEventListener("ended", handleEnded);
    };
  }, [audioParts.length, currentTime, loadPart, partIndex, progressKey]);

  const playAi = (): void => {
    const audio = audioRef.current;
    if (!audio || !aiReady || !activePart) {
      return;
    }
    window.speechSynthesis?.cancel();
    setDeviceStatus("paused");
    if (!audio.src) {
      loadPart(partIndex, true);
      return;
    }
    audio.play()
      .then(() => {
        setErrorMessage(null);
        setStatus("playing");
      })
      .catch(() => {
        setErrorMessage("Playback was blocked. Press play again to start the chapter.");
        setStatus("paused");
      });
  };

  const pauseAi = (): void => {
    audioRef.current?.pause();
    setStatus("paused");
  };

  const replayAi = (): void => {
    window.localStorage.removeItem(progressKey);
    loadPart(0, status === "playing");
  };

  const goToPart = (nextIndex: number, shouldPlay = status === "playing"): void => {
    if (!aiReady || nextIndex < 0 || nextIndex >= audioParts.length) {
      return;
    }
    loadPart(nextIndex, shouldPlay);
  };

  const handleSeek = (value: number): void => {
    if (activeMode === "device") {
      return;
    }

    const audio = audioRef.current;
    if (!audio || !aiReady) {
      return;
    }

    if (!knownDuration) {
      audio.currentTime = ((audio.duration || 0) * value) / 100;
      return;
    }

    const target = (chapterDuration * value) / 100;
    let accumulated = 0;
    for (let index = 0; index < durations.length; index += 1) {
      const duration = durations[index];
      if (target <= accumulated + duration || index === durations.length - 1) {
        const nextTime = Math.max(0, target - accumulated);
        if (index !== partIndex) {
          loadPart(index, status === "playing");
          window.setTimeout(() => {
            if (audioRef.current) {
              audioRef.current.currentTime = nextTime;
            }
          }, 80);
        } else {
          audio.currentTime = nextTime;
        }
        break;
      }
      accumulated += duration;
    }
  };

  const fetchDeviceText = async (): Promise<string[]> => {
    if (deviceTextRef.current.length > 0) {
      return deviceTextRef.current;
    }

    setDeviceStatus("loading");
    setDeviceError(null);
    const response = await fetch("/api/bible/chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book: activeBook, chapter: activeChapter, translation: translation.toUpperCase() })
    });
    const data = await response.json();

    if (data.status !== "resolved" || !data.text) {
      throw new Error(data.message ?? `${translation} chapter text is not available for device voice yet.`);
    }

    const blocks = splitSpeechText(data.text);
    deviceTextRef.current = blocks;
    setDeviceText(data.text);
    setDeviceTotal(blocks.length);
    return blocks;
  };

  const speakDeviceFrom = (index: number): void => {
    const blocks = deviceTextRef.current;
    const text = blocks[index];
    if (!text) {
      setDeviceStatus("ended");
      setDeviceProgress(blocks.length);
      return;
    }

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.rate = deviceRate;
    utterance.pitch = devicePitch;
    if (selectedVoice) {
      utterance.voice = selectedVoice;
    }
    utterance.onstart = () => {
      setDeviceStatus("playing");
      setDeviceProgress(index + 1);
    };
    utterance.onend = () => {
      if (deviceIndexRef.current === index) {
        deviceIndexRef.current = index + 1;
        speakDeviceFrom(index + 1);
      }
    };
    utterance.onerror = () => {
      setDeviceError("Device voice playback stopped. Try another system voice.");
      setDeviceStatus("error");
    };

    deviceUtteranceRef.current = utterance;
    window.speechSynthesis.speak(utterance);
  };

  const playDevice = async (): Promise<void> => {
    if (!("speechSynthesis" in window)) {
      setDeviceError("This browser does not support device voices.");
      setDeviceStatus("error");
      return;
    }

    audioRef.current?.pause();
    if (window.speechSynthesis.paused) {
      window.speechSynthesis.resume();
      setDeviceStatus("playing");
      return;
    }

    try {
      const blocks = await fetchDeviceText();
      if (blocks.length === 0) {
        throw new Error("No chapter text was available for device voice.");
      }
      window.speechSynthesis.cancel();
      deviceIndexRef.current = Math.min(deviceIndexRef.current, blocks.length - 1);
      speakDeviceFrom(deviceIndexRef.current);
    } catch (error) {
      setDeviceError(error instanceof Error ? error.message : "Device voice could not load chapter text.");
      setDeviceStatus("error");
    }
  };

  const pauseDevice = (): void => {
    window.speechSynthesis?.pause();
    setDeviceStatus("paused");
  };

  const replayDevice = async (): Promise<void> => {
    window.speechSynthesis?.cancel();
    deviceIndexRef.current = 0;
    setDeviceProgress(0);
    await playDevice();
  };

  const switchMode = (mode: AudioMode): void => {
    setActiveMode(mode);
    if (mode === "ai") {
      window.speechSynthesis?.pause();
      setDeviceStatus((current) => current === "playing" ? "paused" : current);
    } else {
      audioRef.current?.pause();
    }
  };

  const checkAgain = (): void => {
    setErrorMessage(null);
    setFirebaseErrorMessage(null);
    setIsResolvingAudioSource(true);
    setAudioRetryCount((count) => count + 1);
  };

  const navigateToSelection = (): void => {
    const bookSlug = slugify(selectedBook);
    const chapter = Math.max(1, Math.min(Number(selectedChapter) || 1, selectedBookMeta.chapters));
    router.push(`/audio/${bookSlug}/${chapter}?translation=${translation.toLowerCase()}`);
  };

  const mainStatus = isResolvingAudioSource
    ? "Finding narration"
    : activeMode === "ai"
      ? status === "playing" ? "Playing AI Voice" : status === "paused" ? "Paused" : status === "ended" ? "Finished" : aiReady ? "Ready" : "Needs upload"
      : deviceStatus === "playing" ? "Reading with Device Voice" : deviceStatus === "paused" ? "Paused" : deviceStatus === "loading" ? "Loading text" : "Device Voice";
  const modeLine = activeMode === "ai" ? "AI Voice: generated MP3 chapter audio" : `Device Voice — uses your browser/system voice`;

  return (
    <div className="audio-page audio-listening-page">
      <audio ref={audioRef} preload="metadata" />

      <section className="listen-hero" aria-label="Bible audio player">
        <div className="listen-topbar">
          <Link href={`/read/${translation}/${slugify(activeBook)}/${activeChapter}`} className="listen-back">Back to reading</Link>
          <span className="listen-now-pill">{mainStatus}</span>
        </div>

        <div className="listen-artwork" aria-hidden="true">
          <div className="listen-artwork-ring">
            <span>{translation}</span>
            <strong>{activeBook}</strong>
            <em>{activeChapter}</em>
          </div>
        </div>

        <div className="listen-title">
          <p>{translation} • Full Chapter Audio</p>
          <h2>{chapterLabel}</h2>
          <span className="listen-source-line">{modeLine}</span>
        </div>

        <div className="listen-mode-toggle" role="tablist" aria-label="Audio mode">
          <button
            type="button"
            className={activeMode === "ai" ? "is-active" : ""}
            onClick={() => switchMode("ai")}
            disabled={isResolvingAudioSource}
          >
            <strong>AI Voice</strong>
            <span>Generated chapter audio</span>
          </button>
          <button
            type="button"
            className={activeMode === "device" ? "is-active" : ""}
            onClick={() => switchMode("device")}
          >
            <strong>Device Voice</strong>
            <span>Browser/system voice</span>
          </button>
        </div>

        <div className="listen-progress-card">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progressPercent}
            onChange={(event) => handleSeek(Number(event.target.value))}
            disabled={activeMode !== "ai" || !aiReady}
            aria-label="Chapter progress"
            className="listen-progress"
          />
          <div className="listen-time-row">
            {activeMode === "ai" ? (
              <>
                <span>{formatTime(chapterElapsed)}</span>
                <span>-{formatTime(chapterRemaining)}</span>
              </>
            ) : (
              <>
                <span>{deviceTotal > 0 ? `${deviceProgress}/${deviceTotal}` : "Ready"}</span>
                <span>{selectedVoice ? selectedVoice.name : "System voice"}</span>
              </>
            )}
          </div>
        </div>

        <div className="listen-controls" aria-label="Playback controls">
          <button
            type="button"
            className="listen-icon-button"
            onClick={() => activeMode === "ai" ? goToPart(partIndex - 1) : void replayDevice()}
            disabled={activeMode === "ai" ? !aiReady || partIndex === 0 : deviceStatus === "loading"}
            aria-label={activeMode === "ai" ? "Back" : "Replay device voice"}
            title={activeMode === "ai" ? "Back" : "Replay"}
          >
            ↺
          </button>
          <button
            type="button"
            className="listen-play-button"
            onClick={() => {
              if (activeMode === "ai") {
                status === "playing" ? pauseAi() : playAi();
              } else {
                deviceStatus === "playing" ? pauseDevice() : void playDevice();
              }
            }}
            disabled={activeMode === "ai" ? !aiReady || status === "loading" : deviceStatus === "loading"}
            aria-label={(activeMode === "ai" ? status : deviceStatus) === "playing" ? "Pause" : "Play"}
          >
            {(activeMode === "ai" ? status : deviceStatus) === "playing" ? "II" : "▶"}
          </button>
          <button
            type="button"
            className="listen-icon-button"
            onClick={() => activeMode === "ai" ? goToPart(partIndex + 1) : window.speechSynthesis.cancel()}
            disabled={activeMode === "ai" ? !aiReady || partIndex >= audioParts.length - 1 : deviceStatus !== "playing"}
            aria-label={activeMode === "ai" ? "Forward" : "Stop device voice"}
            title={activeMode === "ai" ? "Forward" : "Stop"}
          >
            ↷
          </button>
        </div>

        <div className="listen-settings-grid">
          <label>
            Translation
            <select value={translation} onChange={(event) => setTranslation(event.target.value)}>
              {TRANSLATIONS.map((item) => <option key={item} value={item}>{item}</option>)}
            </select>
          </label>
          <label>
            Book
            <select value={selectedBook} onChange={(event) => setSelectedBook(event.target.value)}>
              {BIBLE_BOOKS.map((book) => <option key={book.code} value={book.name}>{book.name}</option>)}
            </select>
          </label>
          <label>
            Chapter
            <select value={selectedChapter} onChange={(event) => setSelectedChapter(event.target.value)}>
              {Array.from({ length: selectedBookMeta.chapters }, (_, index) => String(index + 1)).map((chapter) => (
                <option key={chapter} value={chapter}>{chapter}</option>
              ))}
            </select>
          </label>
          <button type="button" onClick={navigateToSelection}>Open</button>
        </div>
      </section>

      <section className="listen-detail-grid">
        <div className="listen-panel">
          <div className="listen-panel-header">
            <h3>AI Voice</h3>
            <span>{sourceLabel}</span>
          </div>
          <p>{aiReady ? `Ready from ${sourceLabel.toLowerCase()} with ${audioParts.length} audio segments stitched into one chapter.` : "Generated MP3 chapter narration appears here as soon as the Firebase upload is available."}</p>
          <label>
            Playback speed
            <select value={aiRate} onChange={(event) => setAiRate(Number(event.target.value))}>
              {AI_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed.toFixed(2)}x</option>)}
            </select>
          </label>
          <div className="listen-button-row">
            <button type="button" className="listen-secondary-button" onClick={replayAi} disabled={!aiReady}>Replay chapter</button>
            <button type="button" className="listen-secondary-button is-quiet" onClick={checkAgain} disabled={isResolvingAudioSource}>
              {isResolvingAudioSource ? "Checking..." : "Check again"}
            </button>
          </div>
        </div>

        <div className="listen-panel">
          <div className="listen-panel-header">
            <h3>Device Voice</h3>
            <span>{voices.length} voices</span>
          </div>
          <p>Device Voice — uses your browser/system voice. Keep this as a fallback when AI narration has not been uploaded yet.</p>
          <label>
            Voice
            <select value={selectedVoiceURI} onChange={(event) => setSelectedVoiceURI(event.target.value)}>
              {voices.map((voice) => (
                <option key={voice.voiceURI} value={voice.voiceURI}>
                  {isAppleVoice(voice) ? "Apple • " : ""}{voice.name} ({voice.lang})
                </option>
              ))}
            </select>
          </label>
          <div className="listen-two-controls">
            <label>
              Rate
              <select value={deviceRate} onChange={(event) => setDeviceRate(Number(event.target.value))}>
                {DEVICE_RATES.map((rate) => <option key={rate} value={rate}>{rate.toFixed(2)}x</option>)}
              </select>
            </label>
            <label>
              Pitch
              <input type="range" min="0.8" max="1.2" step="0.05" value={devicePitch} onChange={(event) => setDevicePitch(Number(event.target.value))} />
            </label>
          </div>
        </div>
      </section>

      {(!manifest || missingFiles.length > 0 || errorMessage || deviceError || (audioSource === "local" && firebaseErrorMessage)) ? (
        <section className="audio-message-band listen-missing-card" role="status">
          <h3>{manifest ? "Listening note" : "Upload chapter narration"}</h3>
          <p>{deviceError ?? errorMessage ?? (audioSource === "local" && firebaseErrorMessage ? `${missingAiMessage} Using local chapter audio fallback in development.` : missingAiMessage)}</p>
          <div className="listen-command-stack" aria-label="Audio setup commands">
            <span>Generate</span>
            <pre>{generationCommand}</pre>
            <span>Upload</span>
            <pre>{uploadCommand}</pre>
          </div>
          <div className="listen-missing-actions">
            <button type="button" className="listen-secondary-button" onClick={checkAgain} disabled={isResolvingAudioSource}>
              {isResolvingAudioSource ? "Checking Firebase..." : "Check again"}
            </button>
            <span>Expected Firebase path: <code>{expectedFirebasePath}</code></span>
          </div>
        </section>
      ) : null}

      {isDev ? (
        <section className="listen-debug-panel" aria-label="Firebase audio debug">
          <div>
            <strong>Firebase debug</strong>
            <span>{firebaseDebug.manifestFound ? "manifest found" : "manifest missing"}</span>
          </div>
          <dl>
            <dt>Expected manifest</dt>
            <dd><code>{firebaseDebug.expectedManifestPath}</code></dd>
            <dt>Audio segments</dt>
            <dd>{firebaseDebug.segmentCount}</dd>
            <dt>Resolved URLs</dt>
            <dd>{firebaseDebug.audioUrls.length > 0 ? firebaseDebug.audioUrls.map((url, index) => <code key={url}>{index + 1}. {url}</code>) : "none"}</dd>
            <dt>Local fallback</dt>
            <dd>{firebaseDebug.localFallbackStatus} at <code>{attemptedPath}</code></dd>
            <dt>Last Firebase message</dt>
            <dd>{firebaseDebug.errorMessage ?? "none"}</dd>
          </dl>
        </section>
      ) : null}

      <section className={`scripture-listening-section ${isFocusMode ? "is-focus-mode" : ""}`} aria-label={`${chapterLabel} scripture text`}>
        <div className="scripture-now-reading">
          <div>
            <span>{translation}</span>
            <h2>Now reading {chapterLabel}</h2>
            <p>{activeMode === "ai" && aiReady ? "Follow the chapter while AI narration plays." : "Read devotionally here, or switch to Device Voice for system narration."}</p>
          </div>
          <button type="button" className="listen-secondary-button is-quiet" onClick={() => setIsFocusMode((value) => !value)}>
            {isFocusMode ? "Show full page" : "Focus mode"}
          </button>
        </div>

        {scriptureStatus === "loading" ? (
          <div className="scripture-loading">Preparing {translation} {chapterLabel}...</div>
        ) : scriptureStatus === "error" ? (
          <div className="scripture-loading">{scriptureError}</div>
        ) : (
          <article className="scripture-reader-card">
            {scriptureVerses.map((verse) => (
              <p key={`${chapterLabel}-${verse.number}`} className="scripture-listen-verse">
                <span>{verse.number}</span>
                {verse.text}
              </p>
            ))}
          </article>
        )}
      </section>

      {(status === "playing" || status === "paused" || deviceStatus === "playing" || deviceStatus === "paused") ? (
        <div className="listen-mobile-mini" aria-label="Now playing">
          <div>
            <strong>{chapterLabel}</strong>
            <span>{activeMode === "ai" ? "AI Voice" : "Device Voice"}</span>
          </div>
          <button
            type="button"
            onClick={() => {
              if (activeMode === "ai") {
                status === "playing" ? pauseAi() : playAi();
              } else {
                deviceStatus === "playing" ? pauseDevice() : void playDevice();
              }
            }}
          >
            {(activeMode === "ai" ? status : deviceStatus) === "playing" ? "Pause" : "Play"}
          </button>
        </div>
      ) : null}
    </div>
  );
}
