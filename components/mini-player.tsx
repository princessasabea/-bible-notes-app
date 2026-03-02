"use client";

import { useEffect, useMemo, useState } from "react";
import { useQueue } from "@/components/queue-context";

const SPEED_PRESETS = [0.85, 0.95, 1, 1.1, 1.2] as const;
const AI_VOICES = [
  { id: "alloy", label: "Alloy" },
  { id: "verse", label: "Verse" }
] as const;

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
    ttsEngine,
    voices,
    voiceFilter,
    selectedVoiceName,
    aiVoiceId,
    statusMessage,
    playFromCurrent,
    playChapterNow,
    playNowViewing,
    playNext,
    playPrevious,
    togglePause,
    setSpeechRate,
    setRepeatMode,
    setTtsEngine,
    setVoiceFilter,
    setShowAllVoices,
    setSelectedVoiceName,
    setAiVoiceId,
    primeSpeechFromUserGesture
  } = useQueue();

  const [isExpanded, setIsExpanded] = useState(false);
  const [showRepeatPicker, setShowRepeatPicker] = useState(false);
  const [showVoicePicker, setShowVoicePicker] = useState(false);
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
  const activeAiVoice = AI_VOICES.find((voice) => voice.id === aiVoiceId) ?? AI_VOICES[0];
  const voiceLabel = ttsEngine === "openai"
    ? `AI: ${activeAiVoice.label}`
    : `Device: ${selectedVoiceName || "Auto"}`;
  const deviceVoices = useMemo(() => {
    const keyword = voiceFilter === "premium" ? "premium" : "enhanced";
    const filtered = voices.filter((voice) => voice.name.toLowerCase().includes(keyword));

    if (filtered.length > 0) {
      return filtered;
    }

    return voices;
  }, [voiceFilter, voices]);

  useEffect(() => {
    const updateVerseCount = (): void => {
      const count = document.querySelectorAll(".bible-content p sup").length;
      setChapterVerseCount(count);
    };

    updateVerseCount();
    const timer = window.setTimeout(updateVerseCount, 250);
    return () => window.clearTimeout(timer);
  }, [currentIndex, currentChapterTitle]);

  useEffect(() => {
    if (!isExpanded) {
      setShowRepeatPicker(false);
      setShowVoicePicker(false);
    }
  }, [isExpanded]);

  useEffect(() => {
    setShowAllVoices(false);
  }, [setShowAllVoices]);

  useEffect(() => {
    if (!selectedVoiceName) {
      return;
    }

    const exists = deviceVoices.some((voice) => voice.name === selectedVoiceName);
    if (!exists) {
      setSelectedVoiceName("");
    }
  }, [deviceVoices, selectedVoiceName, setSelectedVoiceName]);

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
                onClick={() => {
                  setShowRepeatPicker((current) => !current);
                  setShowVoicePicker(false);
                }}
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

              <button
                type="button"
                className={`mini-apple-voice-pill ${showVoicePicker ? "is-active" : ""}`}
                onClick={() => {
                  setShowVoicePicker((current) => !current);
                  setShowRepeatPicker(false);
                }}
                aria-label={`Voice ${voiceLabel}`}
                title={voiceLabel}
              >
                Voice
              </button>
            </div>

            {showRepeatPicker ? (
              <div className="mini-apple-repeat-panel">
                <button
                  type="button"
                  className={`mini-apple-repeat-option ${repeatMode === "off" ? "is-active" : ""}`}
                  onClick={() => setRepeatMode("off")}
                >
                  Do not repeat
                </button>
                <button
                  type="button"
                  className={`mini-apple-repeat-option ${repeatMode === "chapter" ? "is-active" : ""}`}
                  onClick={() => setRepeatMode("chapter")}
                >
                  Repeat Chapter
                </button>
                <button
                  type="button"
                  className={`mini-apple-repeat-option ${repeatMode === "playlist" ? "is-active" : ""}`}
                  onClick={() => setRepeatMode("playlist")}
                >
                  Repeat Playlist
                </button>
              </div>
            ) : null}

            {showVoicePicker ? (
              <div className="mini-apple-voice-panel">
                <div className="mini-apple-engine-toggle" role="group" aria-label="Voice engine">
                  <button
                    type="button"
                    className={`mini-apple-engine-btn ${ttsEngine === "browser" ? "is-active" : ""}`}
                    onClick={() => setTtsEngine("browser")}
                  >
                    Device
                  </button>
                  <button
                    type="button"
                    className={`mini-apple-engine-btn ${ttsEngine === "openai" ? "is-active" : ""}`}
                    onClick={() => setTtsEngine("openai")}
                  >
                    AI
                  </button>
                </div>

                {ttsEngine === "browser" ? (
                  <label className="mini-apple-voice-label">
                    Device Voice
                    <div className="mini-apple-engine-toggle" role="group" aria-label="Voice quality">
                      <button
                        type="button"
                        className={`mini-apple-engine-btn ${voiceFilter === "enhanced" ? "is-active" : ""}`}
                        onClick={() => setVoiceFilter("enhanced")}
                      >
                        Enhanced
                      </button>
                      <button
                        type="button"
                        className={`mini-apple-engine-btn ${voiceFilter === "premium" ? "is-active" : ""}`}
                        onClick={() => setVoiceFilter("premium")}
                      >
                        Premium
                      </button>
                    </div>
                    <select
                      value={selectedVoiceName}
                      onChange={(event) => setSelectedVoiceName(event.target.value)}
                    >
                      <option value="">Auto (en-US)</option>
                      {deviceVoices.map((voice, index) => (
                        <option key={`${voice.name}-${voice.lang}-${index}`} value={voice.name}>
                          {voice.name} ({voice.lang})
                        </option>
                      ))}
                    </select>
                  </label>
                ) : (
                  <label className="mini-apple-voice-label">
                    AI Voice
                    <select value={aiVoiceId} onChange={(event) => setAiVoiceId(event.target.value)}>
                      {AI_VOICES.map((voice) => (
                        <option key={voice.id} value={voice.id}>
                          {voice.label}
                        </option>
                      ))}
                    </select>
                  </label>
                )}
              </div>
            ) : null}
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
