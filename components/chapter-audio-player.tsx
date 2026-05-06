"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { BIBLE_BOOKS } from "@/lib/bible/books";
import type { ChapterAudioManifest } from "@/lib/audio/chapter-audio";

type Props = {
  initialBook: string;
  initialChapter: number;
  manifest: ChapterAudioManifest | null;
  missingFiles: string[];
  attemptedPath: string;
  requestedTranslation: string;
};

type PlayerStatus = "idle" | "loading" | "ready" | "playing" | "paused" | "ended" | "error";

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
  const minutes = Math.floor(rounded / 60);
  const remainingSeconds = rounded % 60;
  return `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
}

function sumDurations(durations: number[], endIndex: number): number {
  return durations.slice(0, endIndex).reduce((total, duration) => total + (Number.isFinite(duration) ? duration : 0), 0);
}

export function ChapterAudioPlayer({
  initialBook,
  initialChapter,
  manifest,
  missingFiles,
  attemptedPath,
  requestedTranslation
}: Props): React.ReactElement {
  const router = useRouter();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const autoPlayRef = useRef(false);
  const [selectedBook, setSelectedBook] = useState(displayBookFromSlug(initialBook));
  const [selectedChapter, setSelectedChapter] = useState(String(initialChapter));
  const [translation, setTranslation] = useState((manifest?.translation ?? requestedTranslation).toUpperCase());
  const [partIndex, setPartIndex] = useState(0);
  const [status, setStatus] = useState<PlayerStatus>(manifest ? "loading" : "error");
  const [errorMessage, setErrorMessage] = useState<string | null>(manifest ? null : "No generated chapter manifest found.");
  const [currentTime, setCurrentTime] = useState(0);
  const [durations, setDurations] = useState<number[]>(() => manifest?.audioParts.map(() => Number.NaN) ?? []);

  const activeBook = manifest?.book ?? displayBookFromSlug(initialBook);
  const activeChapter = manifest?.chapter ?? initialChapter;
  const audioParts = manifest?.audioParts ?? [];
  const activePart = audioParts[partIndex] ?? null;
  const isReady = Boolean(manifest && audioParts.length > 0 && missingFiles.length === 0 && !errorMessage);
  const knownDuration = durations.every((duration) => Number.isFinite(duration));
  const chapterDuration = knownDuration ? sumDurations(durations, durations.length) : Number.NaN;
  const chapterElapsed = sumDurations(durations, partIndex) + currentTime;
  const chapterRemaining = knownDuration ? Math.max(0, chapterDuration - chapterElapsed) : Number.NaN;
  const progressPercent = knownDuration && chapterDuration > 0
    ? Math.min(100, Math.max(0, (chapterElapsed / chapterDuration) * 100))
    : activePart && audioRef.current?.duration
      ? Math.min(100, Math.max(0, (currentTime / audioRef.current.duration) * 100))
      : 0;

  const selectedBookMeta = useMemo(
    () => BIBLE_BOOKS.find((book) => book.name === selectedBook) ?? BIBLE_BOOKS.find((book) => book.name === activeBook) ?? BIBLE_BOOKS[0],
    [activeBook, selectedBook]
  );

  const generationCommand = `npm run audio:chapter -- --translation ${requestedTranslation} --book "${activeBook}" --chapter ${activeChapter} --input local-chapters/${requestedTranslation}/${slugify(activeBook)}/${activeChapter}.txt`;

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
    audio.load();
  }, [audioParts]);

  useEffect(() => {
    setSelectedBook(displayBookFromSlug(initialBook));
    setSelectedChapter(String(initialChapter));
    setTranslation((manifest?.translation ?? requestedTranslation).toUpperCase());
    setPartIndex(0);
    setCurrentTime(0);
    setDurations(manifest?.audioParts.map(() => Number.NaN) ?? []);
    setErrorMessage(manifest ? null : "No generated chapter manifest found.");
    setStatus(manifest ? "loading" : "error");
  }, [initialBook, initialChapter, manifest, requestedTranslation]);

  useEffect(() => {
    if (!manifest || audioParts.length === 0 || !audioRef.current || missingFiles.length > 0) {
      return;
    }

    loadPart(0, false);
  }, [audioParts.length, loadPart, manifest, missingFiles.length]);

  useEffect(() => {
    if (!manifest || audioParts.length === 0) {
      return;
    }

    const cancelled = { value: false };
    audioParts.forEach((part, index) => {
      const audio = new Audio(part.url);
      audio.preload = "metadata";
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
  }, [audioParts, manifest]);

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
          .then(() => {
            setStatus("playing");
          })
          .catch(() => {
            setErrorMessage("Playback was blocked. Press play again to start the chapter.");
            setStatus("paused");
          });
      } else {
        setStatus("ready");
      }
    };

    const handleTimeUpdate = (): void => setCurrentTime(audio.currentTime);
    const handlePlay = (): void => setStatus("playing");
    const handlePause = (): void => {
      if (!audio.ended) {
        setStatus("paused");
      }
    };
    const handleError = (): void => {
      setErrorMessage("This audio file could not be loaded. Regenerate the chapter or check the MP3 files.");
      setStatus("error");
    };
    const handleEnded = (): void => {
      if (partIndex < audioParts.length - 1) {
        loadPart(partIndex + 1, true);
        return;
      }

      autoPlayRef.current = false;
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
  }, [audioParts.length, currentTime, loadPart, partIndex]);

  const play = (): void => {
    const audio = audioRef.current;
    if (!audio || !isReady || !activePart) {
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
        setErrorMessage("Playback was blocked. Press play again to start the chapter.");
        setStatus("paused");
      });
  };

  const pause = (): void => {
    audioRef.current?.pause();
    setStatus("paused");
  };

  const togglePlay = (): void => {
    if (status === "playing") {
      pause();
      return;
    }

    play();
  };

  const goToPart = (nextIndex: number, shouldPlay = status === "playing"): void => {
    if (!isReady || nextIndex < 0 || nextIndex >= audioParts.length) {
      return;
    }

    loadPart(nextIndex, shouldPlay);
  };

  const handleSeek = (value: number): void => {
    const audio = audioRef.current;
    if (!audio || !isReady) {
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
    const translationSlug = translation.toLowerCase();
    router.push(`/audio/${bookSlug}/${chapter}?translation=${translationSlug}`);
  };

  const playerSubtitle = `${translation} • ${audioParts.length || 0} audio ${audioParts.length === 1 ? "section" : "sections"}`;

  return (
    <div className="audio-page">
      <audio ref={audioRef} preload="metadata" />

      <section className="audio-player-shell" aria-label="Bible audio player">
        <div className="audio-player-layout">
          <div className="audio-cover" aria-hidden="true">
            <div className="audio-cover-inner">
              <span>{translation}</span>
              <strong>{activeBook}</strong>
              <em>{activeChapter}</em>
            </div>
          </div>

          <div className="audio-player-main">
            <div className="audio-kicker-row">
              <span className="audio-kicker">Chapter Audio</span>
              <span className={`audio-status-pill is-${status}`}>{status === "playing" ? "Playing" : status === "paused" ? "Paused" : status === "ended" ? "Complete" : status === "loading" ? "Loading" : status === "error" ? "Needs audio" : "Ready"}</span>
            </div>

            <div className="audio-title-block">
              <p>{playerSubtitle}</p>
              <h2>{activeBook} {activeChapter}</h2>
            </div>

            <div className="audio-progress-block">
              <input
                type="range"
                min="0"
                max="100"
                step="0.1"
                value={progressPercent}
                onChange={(event) => handleSeek(Number(event.target.value))}
                disabled={!isReady}
                aria-label="Chapter progress"
                className="audio-progress-range"
              />
              <div className="audio-time-row">
                <span>{formatTime(chapterElapsed)}</span>
                <span>-{formatTime(chapterRemaining)}</span>
              </div>
            </div>

            <div className="audio-controls" aria-label="Playback controls">
              <button
                type="button"
                className="audio-icon-button"
                onClick={() => goToPart(partIndex - 1)}
                disabled={!isReady || partIndex === 0}
                aria-label="Previous audio section"
                title="Previous audio section"
              >
                &#9198;
              </button>
              <button
                type="button"
                className="audio-play-button"
                onClick={togglePlay}
                disabled={!isReady || status === "loading"}
                aria-label={status === "playing" ? "Pause chapter" : "Play chapter"}
                title={status === "playing" ? "Pause chapter" : "Play chapter"}
              >
                {status === "playing" ? "II" : "▶"}
              </button>
              <button
                type="button"
                className="audio-icon-button"
                onClick={() => goToPart(partIndex + 1)}
                disabled={!isReady || partIndex >= audioParts.length - 1}
                aria-label="Next audio section"
                title="Next audio section"
              >
                &#9197;
              </button>
            </div>

            <div className="audio-section-meter" aria-label="Playback section">
              {audioParts.map((part, index) => (
                <span
                  key={part.fileName}
                  className={index === partIndex ? "is-active" : index < partIndex ? "is-complete" : ""}
                />
              ))}
            </div>
          </div>
        </div>
      </section>

      <section className="audio-picker-band" aria-label="Choose chapter audio">
        <label>
          Book
          <select value={selectedBook} onChange={(event) => setSelectedBook(event.target.value)}>
            {BIBLE_BOOKS.map((book) => (
              <option key={book.code} value={book.name}>{book.name}</option>
            ))}
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
          Translation
          <select value={translation} onChange={(event) => setTranslation(event.target.value)}>
            <option value="AMP">AMP</option>
            <option value="AMPC">AMPC</option>
          </select>
        </label>
        <button type="button" onClick={navigateToSelection}>Open Chapter</button>
      </section>

      {(!manifest || missingFiles.length > 0 || errorMessage) ? (
        <section className="audio-message-band" role="status">
          <h3>{manifest && missingFiles.length > 0 ? "Audio files are missing" : manifest ? "Playback needs attention" : "Generate this chapter first"}</h3>
          <p>{errorMessage ?? `Missing: ${missingFiles.join(", ")}`}</p>
          <p>The player looked for <code>{attemptedPath}</code>.</p>
          <pre>{generationCommand}</pre>
        </section>
      ) : null}
    </div>
  );
}
