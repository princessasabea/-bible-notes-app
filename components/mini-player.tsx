"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueue } from "@/components/queue-context";

const SPEED_PRESETS = [0.85, 0.95, 1, 1.1, 1.2] as const;

function extractTranslationFromTitle(value: string): string | null {
  const match = value.match(/\(([^)]+)\)\s*$/);
  return match?.[1]?.trim() ?? null;
}

function nextSpeed(current: number): number {
  let closestIndex = 0;
  let smallestDistance = Number.POSITIVE_INFINITY;

  for (let index = 0; index < SPEED_PRESETS.length; index += 1) {
    const distance = Math.abs(SPEED_PRESETS[index] - current);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      closestIndex = index;
    }
  }

  return SPEED_PRESETS[(closestIndex + 1) % SPEED_PRESETS.length];
}

export function MiniPlayer(): React.ReactElement {
  const {
    queue,
    currentIndex,
    currentVerse,
    currentChapterTitle,
    nowViewingItem,
    isPlaying,
    isPaused,
    speechRate,
    repeatMode,
    statusMessage,
    playFromCurrent,
    playChapterNow,
    playNowViewing,
    playNext,
    playPrevious,
    togglePause,
    setSpeechRate,
    setRepeatMode,
    primeSpeechFromUserGesture
  } = useQueue();

  const [isExpanded, setIsExpanded] = useState(false);
  const [chapterVerseCount, setChapterVerseCount] = useState(0);

  const activeItem = queue[currentIndex] ?? nowViewingItem ?? null;
  const title = currentChapterTitle ?? activeItem?.title ?? "Now Playing";
  const translation = activeItem?.translation ?? extractTranslationFromTitle(title) ?? "NKJV";

  const queuePosition = queue.length > 0
    ? `${currentIndex + 1}/${queue.length}`
    : "Single chapter";

  const subtitle = currentVerse && currentVerse > 0
    ? `${translation} • Verse ${currentVerse}`
    : `${translation} • ${queuePosition}`;

  useEffect(() => {
    const updateVerseCount = (): void => {
      const count = document.querySelectorAll(".bible-content p sup").length;
      setChapterVerseCount(count);
    };

    updateVerseCount();
    const timer = window.setTimeout(updateVerseCount, 250);
    return () => window.clearTimeout(timer);
  }, [currentIndex, currentChapterTitle]);

  const progress = useMemo(() => {
    if (chapterVerseCount > 0 && currentVerse && currentVerse > 0) {
      return Math.min(100, Math.max(0, (currentVerse / chapterVerseCount) * 100));
    }

    if (queue.length > 0) {
      return Math.min(100, Math.max(0, ((currentIndex + 1) / queue.length) * 100));
    }

    return 0;
  }, [chapterVerseCount, currentVerse, queue.length, currentIndex]);

  const canPlay = queue.length > 0 || Boolean(nowViewingItem);

  const handlePlayPause = (): void => {
    if (!isPlaying) {
      primeSpeechFromUserGesture();
      if (queue.length > 0) {
        void playFromCurrent();
        return;
      }
      if (nowViewingItem) {
        void playChapterNow(nowViewingItem);
        return;
      }
      void playNowViewing();
      return;
    }

    togglePause();
  };

  const cycleRepeatMode = (): void => {
    if (repeatMode === "off") {
      setRepeatMode("chapter");
      return;
    }

    if (repeatMode === "chapter") {
      setRepeatMode("playlist");
      return;
    }

    setRepeatMode("off");
  };

  const repeatLabel = repeatMode === "off"
    ? "Repeat Off"
    : repeatMode === "chapter"
      ? "Repeat Chapter"
      : "Repeat Playlist";

  return (
    <>
      <section
        className={`mini-apple-shell ${isExpanded ? "is-expanded" : "is-collapsed"}`}
        role="region"
        aria-label="Now Playing"
      >
        <button
          type="button"
          className="mini-apple-handle"
          onClick={() => setIsExpanded((value) => !value)}
          aria-label={isExpanded ? "Collapse player" : "Expand player"}
        >
          <span className="mini-apple-handle-pill" />
        </button>

        <div className="mini-apple-collapsed-row">
          <div className="mini-apple-artwork" aria-hidden="true" />

          <div className="mini-apple-meta">
            <p className="mini-collapsed-title">{title}</p>
            <p className="mini-collapsed-meta">{subtitle}</p>
          </div>

          <button
            type="button"
            className="mini-apple-big-play"
            onClick={handlePlayPause}
            disabled={!canPlay}
            aria-label={isPlaying && !isPaused ? "Pause" : "Play"}
          >
            {isPlaying && !isPaused ? "⏸" : "▶"}
          </button>
        </div>

        <div className="mini-apple-progress" aria-hidden="true">
          <div className="mini-apple-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
        </div>

        {isExpanded ? (
          <div className="mini-apple-expanded">
            <div className="mini-apple-now-playing">
              <div className="mini-apple-artwork mini-apple-artwork-large" aria-hidden="true" />
              <h3>{title}</h3>
              <p>{subtitle}</p>
            </div>

            <div className="mini-apple-transport">
              <CircleButton label="Previous" onClick={playPrevious} disabled={currentIndex <= 0 || queue.length === 0}>⏮</CircleButton>
              <button
                type="button"
                className="mini-apple-transport-play"
                onClick={handlePlayPause}
                disabled={!canPlay}
                aria-label={isPlaying && !isPaused ? "Pause" : "Play"}
              >
                {isPlaying && !isPaused ? "⏸" : "▶"}
              </button>
              <CircleButton label="Next" onClick={playNext} disabled={currentIndex >= queue.length - 1 || queue.length === 0}>⏭</CircleButton>
            </div>

            <div className="mini-apple-controls-row">
              <button
                type="button"
                className={`mini-apple-repeat-pill ${repeatMode === "off" ? "" : "is-active"}`}
                onClick={cycleRepeatMode}
                aria-label={repeatLabel}
                title={repeatLabel}
              >
                {repeatMode === "off" ? "Repeat" : repeatMode === "chapter" ? "Repeat Chapter" : "Repeat Playlist"}
              </button>

              <button
                type="button"
                className="mini-apple-speed-pill"
                onClick={() => setSpeechRate(nextSpeed(speechRate))}
                aria-label={`Speech speed ${speechRate.toFixed(2)}x`}
              >
                Speed {speechRate.toFixed(2)}x
              </button>
            </div>
          </div>
        ) : null}
      </section>

      {statusMessage && !isExpanded ? (
        <div className="mini-toast">
          <span className="status-text">{statusMessage}</span>
        </div>
      ) : null}
    </>
  );
}

function CircleButton({
  label,
  onClick,
  children,
  disabled
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
  disabled?: boolean;
}): React.ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      className="mini-apple-circle-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
  );
}
