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
  const folderHint = `${expectedFirebaseFolderPath}/`;
  const generationCommand = `npm run audio:chapter -- --translation ${requestedTranslation} --book "${activeBook}" --chapter ${activeChapter} --input local-chapters/${requestedTranslation}/${slugify(activeBook)}/${activeChapter}.txt`;
  const progressKey = `chapter-audio:${requestedTranslation}:${slugify(activeBook)}:${activeChapter}`;

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
        setActiveMode("device");
        setErrorMessage("Cloud narration is not uploaded yet, and no complete local chapter audio is available.");
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
          setActiveMode("device");
          setErrorMessage("Cloud narration is not uploaded yet, and no complete local chapter audio is available.");
          setStatus("error");
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
  }, [initialBook, initialChapter, localManifest, localMissingFiles, requestedTranslation]);

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
          <p>{sourceLabel}</p>
          <h2>{chapterLabel}</h2>
        </div>

        <div className="listen-mode-toggle" role="tablist" aria-label="Audio mode">
          <button
            type="button"
            className={activeMode === "ai" ? "is-active" : ""}
            onClick={() => switchMode("ai")}
            disabled={!aiReady && isResolvingAudioSource}
          >
            AI Voice
          </button>
          <button
            type="button"
            className={activeMode === "device" ? "is-active" : ""}
            onClick={() => switchMode("device")}
          >
            Device Voice
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
          <p>Professional chapter narration plays as one continuous devotional listen when the chapter exists in your audio library.</p>
          <label>
            Playback speed
            <select value={aiRate} onChange={(event) => setAiRate(Number(event.target.value))}>
              {AI_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed.toFixed(2)}x</option>)}
            </select>
          </label>
          <button type="button" className="listen-secondary-button" onClick={replayAi} disabled={!aiReady}>Replay chapter</button>
        </div>

        <div className="listen-panel">
          <div className="listen-panel-header">
            <h3>Device Voice</h3>
            <span>{voices.length} voices</span>
          </div>
          <p>Use Apple or system voices when cloud narration has not been uploaded yet, or when you want a lighter fallback.</p>
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
          <p>{deviceError ?? errorMessage ?? (audioSource === "local" && firebaseErrorMessage ? `Cloud narration was not available: ${firebaseErrorMessage}` : "Cloud narration is missing for this chapter.")}</p>
          <p>Expected Firebase folder:</p>
          <pre>{folderHint}</pre>
          <p>Local fallback checked <code>{attemptedPath}</code>.</p>
          <pre>{generationCommand}</pre>
        </section>
      ) : null}

      {deviceText ? <p className="listen-device-preview">Device voice text loaded for {chapterLabel}.</p> : null}
    </div>
  );
}
