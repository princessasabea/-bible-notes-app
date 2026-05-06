"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import type { ChapterAudioManifest } from "@/lib/audio/chapter-audio";
import { loadFirebaseChapterAudioManifest } from "@/lib/audio/firebase-chapter-audio";
import { buildChapterManifestPath } from "@/lib/audio/storage-paths";

type Props = {
  initialBook: string;
  initialChapter: number;
  manifest: ChapterAudioManifest | null;
  missingFiles: string[];
  attemptedPath: string;
  requestedTranslation: string;
};

type PlayerStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";
type ScriptureStatus = "idle" | "loading" | "ready" | "error";

type ScriptureVerse = {
  number: string;
  text: string;
};

const TRANSLATIONS = ["AMP", "AMPC", "NKJV", "KJV", "ESV"] as const;
const PLAYBACK_SPEEDS = [0.85, 0.9, 1, 1.1, 1.2] as const;

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, "and")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function displayBookFromSlug(value: string): string {
  const found = BIBLE_BOOKS.find((book) => slugify(book.name) === slugify(value));
  return found?.name ?? value.split("-").filter(Boolean).map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(" ");
}

function formatTime(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "--:--";
  }

  const rounded = Math.floor(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function sumDurations(durations: number[], endIndex: number): number {
  return durations
    .slice(0, endIndex)
    .reduce((total, duration) => total + (Number.isFinite(duration) ? duration : 0), 0);
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

  return matches
    .map((match, index) => ({
      number: match[1] || String(index + 1),
      text: match[2].trim()
    }))
    .filter((verse) => verse.text.length > 0);
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

  const initialTranslation = requestedTranslation.toUpperCase();
  const initialFirebaseManifestPath = buildChapterManifestPath(requestedTranslation, initialBook, initialChapter);

  const [manifest, setManifest] = useState<ChapterAudioManifest | null>(localManifest);
  const [audioSource, setAudioSource] = useState<"firebase" | "local" | "none">(localManifest && localMissingFiles.length === 0 ? "local" : "none");
  const [selectedBook, setSelectedBook] = useState(displayBookFromSlug(initialBook));
  const [selectedChapter, setSelectedChapter] = useState(String(initialChapter));
  const [translation, setTranslation] = useState((localManifest?.translation ?? initialTranslation).toUpperCase());
  const [expectedFirebaseManifestPath, setExpectedFirebaseManifestPath] = useState(initialFirebaseManifestPath);
  const [isResolvingAudio, setIsResolvingAudio] = useState(true);
  const [status, setStatus] = useState<PlayerStatus>(localManifest ? "loading" : "idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [partIndex, setPartIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [durations, setDurations] = useState<number[]>(() => localManifest?.audioParts.map(() => Number.NaN) ?? []);
  const [playbackRate, setPlaybackRate] = useState(1);
  const [audioRetryCount, setAudioRetryCount] = useState(0);
  const [scriptureText, setScriptureText] = useState("");
  const [scriptureStatus, setScriptureStatus] = useState<ScriptureStatus>("idle");
  const [scriptureError, setScriptureError] = useState<string | null>(null);
  const [isFocusMode, setIsFocusMode] = useState(false);

  const activeBook = manifest?.book ?? displayBookFromSlug(initialBook);
  const activeChapter = manifest?.chapter ?? initialChapter;
  const chapterLabel = `${activeBook} ${activeChapter}`;
  const audioParts = manifest?.audioParts ?? [];
  const activePart = audioParts[partIndex] ?? null;
  const audioReady = Boolean(manifest && audioParts.length > 0 && !errorMessage);
  const isLocalPreview = audioSource === "local";
  const missingMessage = "Chapter narration is not ready yet.";
  const generationCommand = `npm run audio:chapter -- --translation ${requestedTranslation.toLowerCase()} --book ${activeBook} --chapter ${activeChapter} --input local-chapters/${requestedTranslation.toLowerCase()}/${slugify(activeBook)}/${activeChapter}.txt`;
  const uploadCommand = `npm run audio:upload -- --translation ${requestedTranslation.toLowerCase()} --book ${activeBook} --chapter ${activeChapter} --service-account ./serviceAccountKey.json`;
  const progressKey = `chapter-audio:${requestedTranslation.toLowerCase()}:${slugify(activeBook)}:${activeChapter}`;
  const scriptureVerses = useMemo(() => splitScriptureVerses(scriptureText), [scriptureText]);
  const selectedBookMeta = useMemo(
    () => BIBLE_BOOKS.find((book) => book.name === selectedBook) ?? BIBLE_BOOKS.find((book) => book.name === activeBook) ?? BIBLE_BOOKS[0],
    [activeBook, selectedBook]
  );

  const knownDuration = durations.length > 0 && durations.every((duration) => Number.isFinite(duration));
  const chapterDuration = knownDuration ? sumDurations(durations, durations.length) : Number.NaN;
  const chapterElapsed = sumDurations(durations, partIndex) + currentTime;
  const chapterRemaining = knownDuration ? Math.max(0, chapterDuration - chapterElapsed) : Number.NaN;
  const progressPercent = knownDuration && chapterDuration > 0
    ? Math.min(100, Math.max(0, (chapterElapsed / chapterDuration) * 100))
    : activePart && audioRef.current?.duration
      ? Math.min(100, Math.max(0, (currentTime / audioRef.current.duration) * 100))
      : 0;

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
    audio.playbackRate = playbackRate;
    audio.load();
  }, [audioParts, playbackRate]);

  useEffect(() => {
    setSelectedBook(displayBookFromSlug(initialBook));
    setSelectedChapter(String(initialChapter));
    setTranslation((localManifest?.translation ?? requestedTranslation).toUpperCase());
    setManifest(null);
    setAudioSource("none");
    setPartIndex(0);
    setCurrentTime(0);
    setDurations([]);
    setErrorMessage(null);
    setExpectedFirebaseManifestPath(buildChapterManifestPath(requestedTranslation, initialBook, initialChapter));
    setIsResolvingAudio(true);
    setStatus("loading");

    let cancelled = false;
    loadFirebaseChapterAudioManifest(displayBookFromSlug(initialBook), initialChapter, requestedTranslation)
      .then((result) => {
        if (cancelled) {
          return;
        }

        setExpectedFirebaseManifestPath(result.expectedManifestPath);
        if (result.manifest) {
          setManifest(result.manifest);
          setAudioSource("firebase");
          setTranslation(result.manifest.translation.toUpperCase());
          setDurations(result.manifest.audioParts.map(() => Number.NaN));
          setErrorMessage(null);
          setStatus("loading");
          return;
        }

        if (process.env.NODE_ENV !== "production" && localManifest && localMissingFiles.length === 0) {
          setManifest(localManifest);
          setAudioSource("local");
          setTranslation(localManifest.translation.toUpperCase());
          setDurations(localManifest.audioParts.map(() => Number.NaN));
          setErrorMessage(null);
          setStatus("loading");
          return;
        }

        setManifest(null);
        setAudioSource("none");
        setErrorMessage(missingMessage);
        setStatus("error");
      })
      .catch(() => {
        if (cancelled) {
          return;
        }

        if (process.env.NODE_ENV !== "production" && localManifest && localMissingFiles.length === 0) {
          setManifest(localManifest);
          setAudioSource("local");
          setTranslation(localManifest.translation.toUpperCase());
          setDurations(localManifest.audioParts.map(() => Number.NaN));
          setErrorMessage(null);
          setStatus("loading");
        } else {
          setManifest(null);
          setAudioSource("none");
          setErrorMessage(missingMessage);
          setStatus("error");
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsResolvingAudio(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [audioRetryCount, initialBook, initialChapter, localManifest, localMissingFiles.length, requestedTranslation]);

  useEffect(() => {
    let cancelled = false;

    setScriptureStatus("loading");
    setScriptureError(null);
    fetch("/api/bible/chapter", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ book: displayBookFromSlug(initialBook), chapter: initialChapter, translation: requestedTranslation.toUpperCase() })
    })
      .then((response) => response.json())
      .then((data) => {
        if (cancelled) {
          return;
        }
        if (data.status !== "resolved" || !data.text) {
          throw new Error(data.message ?? `${requestedTranslation.toUpperCase()} ${chapterLabel} text is not available yet.`);
        }
        setScriptureText(String(data.text));
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
  }, [chapterLabel, initialBook, initialChapter, requestedTranslation]);

  useEffect(() => {
    if (!manifest || audioParts.length === 0 || !audioRef.current) {
      return;
    }

    loadPart(0, false);
  }, [audioParts.length, loadPart, manifest]);

  useEffect(() => {
    const audio = audioRef.current;
    if (!audio) {
      return;
    }
    audio.playbackRate = playbackRate;
  }, [playbackRate]);

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
    if (!audio || audioParts.length === 0) {
      return;
    }

    const saved = window.localStorage.getItem(progressKey);
    if (!saved) {
      return;
    }

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
            setErrorMessage("Press play again to start the chapter.");
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
      setErrorMessage("Chapter audio could not be loaded. Check the Firebase upload and try again.");
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

  const playChapter = (): void => {
    const audio = audioRef.current;
    if (!audio || !audioReady || !activePart) {
      return;
    }

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
        setErrorMessage("Press play again to start the chapter.");
        setStatus("paused");
      });
  };

  const pauseChapter = (): void => {
    audioRef.current?.pause();
    setStatus("paused");
  };

  const togglePlayback = (): void => {
    if (status === "playing") {
      pauseChapter();
      return;
    }

    playChapter();
  };

  const replayChapter = (): void => {
    window.localStorage.removeItem(progressKey);
    loadPart(0, status === "playing");
  };

  const handleSeek = (value: number): void => {
    const audio = audioRef.current;
    if (!audio || !audioReady) {
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

  const navigateToSelection = (): void => {
    const bookSlug = slugify(selectedBook);
    const chapter = Math.max(1, Math.min(Number(selectedChapter) || 1, selectedBookMeta.chapters));
    router.push(`/audio/${bookSlug}/${chapter}?translation=${translation.toLowerCase()}`);
  };

  const checkAgain = (): void => {
    setErrorMessage(null);
    setIsResolvingAudio(true);
    setAudioRetryCount((count) => count + 1);
  };

  const statusLabel = isResolvingAudio
    ? "Finding chapter narration"
    : status === "playing"
      ? "Now playing"
      : audioReady
        ? "Ready to listen"
        : "Narration needed";

  return (
    <main className="chapter-audio-page">
      <audio ref={audioRef} preload="metadata" />

      <section className="chapter-audio-hero" aria-label={`${chapterLabel} audio`}>
        <div className="chapter-audio-nav">
          <Link href={`/read/${translation.toLowerCase()}/${slugify(activeBook)}/${activeChapter}`}>Back to reading</Link>
          <span>{statusLabel}</span>
        </div>

        <div className="chapter-audio-heading">
          <span className="chapter-translation-badge">{translation}</span>
          <h1>{chapterLabel}</h1>
          <p>Full chapter narration</p>
          {isLocalPreview ? <em>Local preview</em> : null}
        </div>

        <button
          type="button"
          className="chapter-main-play"
          onClick={togglePlayback}
          disabled={!audioReady || status === "loading" || isResolvingAudio}
          aria-label={status === "playing" ? "Pause chapter" : "Play chapter"}
        >
          <span>{status === "playing" ? "Pause" : "Play"}</span>
          <strong>{status === "playing" ? "II" : "▶"}</strong>
        </button>

        <div className="chapter-progress-wrap">
          <input
            type="range"
            min="0"
            max="100"
            step="0.1"
            value={progressPercent}
            onChange={(event) => handleSeek(Number(event.target.value))}
            disabled={!audioReady}
            aria-label="Chapter progress"
          />
          <div>
            <span>{formatTime(chapterElapsed)}</span>
            <span>-{formatTime(chapterRemaining)}</span>
          </div>
        </div>

        <div className="chapter-audio-actions">
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
          <label>
            Speed
            <select value={playbackRate} onChange={(event) => setPlaybackRate(Number(event.target.value))}>
              {PLAYBACK_SPEEDS.map((speed) => <option key={speed} value={speed}>{speed.toFixed(2)}x</option>)}
            </select>
          </label>
          <button type="button" onClick={navigateToSelection}>Open</button>
        </div>
      </section>

      {!audioReady && !isResolvingAudio ? (
        <section className="chapter-audio-missing" role="status">
          <div>
            <span>{translation}</span>
            <h2>{missingMessage}</h2>
            <p>Generate and upload this chapter once, then return here and press play.</p>
          </div>
          <dl>
            <dt>Expected Firebase path</dt>
            <dd><code>{expectedFirebaseManifestPath}</code></dd>
            <dt>Generate</dt>
            <dd><pre>{generationCommand}</pre></dd>
            <dt>Upload</dt>
            <dd><pre>{uploadCommand}</pre></dd>
            {process.env.NODE_ENV !== "production" ? (
              <>
                <dt>Local fallback checked</dt>
                <dd><code>{attemptedPath}</code></dd>
              </>
            ) : null}
          </dl>
          <button type="button" onClick={checkAgain}>Check again</button>
        </section>
      ) : null}

      {audioReady ? (
        <section className="chapter-audio-library-note" aria-label="Audio source">
          <span>{audioParts.length} audio {audioParts.length === 1 ? "section" : "sections"}</span>
          <button type="button" onClick={replayChapter}>Replay chapter</button>
        </section>
      ) : null}

      <section className={`scripture-listening-section ${isFocusMode ? "is-focus-mode" : ""}`} aria-label={`${chapterLabel} scripture text`}>
        <div className="scripture-now-reading">
          <div>
            <span>{translation}</span>
            <h2>Now reading {chapterLabel}</h2>
            <p>Follow the chapter at your own pace while the narration carries the reading.</p>
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

      {(status === "playing" || status === "paused") && audioReady ? (
        <div className="chapter-sticky-player" aria-label="Now playing">
          <div>
            <strong>{chapterLabel}</strong>
            <span>{translation} chapter narration</span>
          </div>
          <button type="button" onClick={togglePlayback}>
            {status === "playing" ? "Pause" : "Play"}
          </button>
        </div>
      ) : null}
    </main>
  );
}
