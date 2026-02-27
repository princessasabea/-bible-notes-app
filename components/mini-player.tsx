"use client";

import { useEffect, useMemo, useState } from "react";
import { useFilteredVoices, useQueue } from "@/components/queue-context";

const aiVoices = [
  { id: "alloy", label: "Alloy (Natural)" },
  { id: "verse", label: "Verse (Warm)" }
];

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    year: "numeric"
  });
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
    crossfadeDurationMs,
    repeatMode,
    selectedVoiceName,
    aiVoiceId,
    showAllVoices,
    voiceFilter,
    ttsEngine,
    playlists,
    playlistModalOpen,
    statusMessage,
    playFromCurrent,
    playFromIndex,
    playChapterNow,
    playPlaylist,
    playNowViewing,
    playNext,
    playPrevious,
    togglePause,
    stop,
    clearQueue,
    removeFromQueue,
    moveItem,
    setCurrentIndex,
    setSelectedVoiceName,
    setAiVoiceId,
    setShowAllVoices,
    setVoiceFilter,
    setTtsEngine,
    setSpeechRate,
    setCrossfadeDurationMs,
    setRepeatMode,
    setPlaylistModalOpen,
    primeSpeechFromUserGesture,
    createPlaylist,
    deletePlaylist
  } = useQueue();

  const filteredVoices = useFilteredVoices();
  const [playlistName, setPlaylistName] = useState("");
  const [isExpanded, setIsExpanded] = useState(false);
  const [activeTab, setActiveTab] = useState<"queue" | "playlists">("queue");
  const [chapterVerseCount, setChapterVerseCount] = useState(0);
  const [selectedPlaylistId, setSelectedPlaylistId] = useState<string | null>(null);

  const activeItem = queue[currentIndex] ?? null;
  const title = currentChapterTitle ?? activeItem?.title ?? "Queue idle";
  const selectedPlaylist = playlists.find((entry) => entry.id === selectedPlaylistId) ?? playlists[0] ?? null;

  const queueCountLabel = useMemo(() => {
    if (queue.length === 0) {
      return "No chapters queued";
    }

    return `${currentIndex + 1}/${queue.length} chapters`;
  }, [queue.length, currentIndex]);

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
      return ((currentIndex + (isPlaying ? 1 : 0)) / queue.length) * 100;
    }

    return 0;
  }, [chapterVerseCount, currentVerse, queue.length, currentIndex, isPlaying]);

  useEffect(() => {
    if (playlistModalOpen) {
      setActiveTab("playlists");
      setIsExpanded(true);
      setPlaylistModalOpen(false);
    }
  }, [playlistModalOpen, setPlaylistModalOpen]);

  useEffect(() => {
    if (playlists.length === 0) {
      setSelectedPlaylistId(null);
      return;
    }

    if (!selectedPlaylistId || !playlists.some((entry) => entry.id === selectedPlaylistId)) {
      setSelectedPlaylistId(playlists[0]?.id ?? null);
    }
  }, [playlists, selectedPlaylistId]);

  const handleDeletePlaylist = (playlistId: string, playlistTitle: string): void => {
    const ok = window.confirm(`Delete \"${playlistTitle}\"? This removes all chapters in it.`);
    if (!ok) {
      return;
    }

    deletePlaylist(playlistId);

    if (selectedPlaylistId === playlistId) {
      setSelectedPlaylistId(null);
    }
  };

  const cycleRepeatMode = (): void => {
    if (repeatMode === "off") {
      setRepeatMode("playlist");
      return;
    }

    if (repeatMode === "playlist") {
      setRepeatMode("chapter");
      return;
    }

    setRepeatMode("off");
  };

  const repeatLabel = repeatMode === "off"
    ? "Repeat Off"
    : repeatMode === "playlist"
      ? "Repeat Playlist"
      : "Repeat Chapter";

  return (
    <>
      <section className={`mini-apple-shell ${isExpanded ? "is-expanded" : "is-collapsed"}`} role="region" aria-label="Now Playing">
        <button
          type="button"
          className="mini-apple-handle"
          onClick={() => setIsExpanded((current) => !current)}
          aria-label={isExpanded ? "Collapse player" : "Expand player"}
        >
          <span className="mini-apple-handle-pill" />
        </button>

        <div className="mini-apple-collapsed-row">
          <div className="mini-apple-artwork" aria-hidden="true" />

          <div className="mini-apple-meta">
            <div className="mini-collapsed-title">{title}</div>
            <div className="mini-collapsed-meta">{currentVerse ? `Verse ${currentVerse}` : queueCountLabel}</div>
            <div className="mini-apple-progress">
              <div className="mini-apple-progress-fill" style={{ width: `${Math.max(0, Math.min(100, progress))}%` }} />
            </div>
          </div>
          <div className="mini-apple-controls-inline">
            <IconButton label="Previous" onClick={playPrevious} disabled={currentIndex <= 0 || queue.length === 0}>⏮</IconButton>
            <button
              type="button"
              className="mini-apple-big-play"
              onClick={() => {
                if (!isPlaying) {
                  primeSpeechFromUserGesture();
                  if (queue.length > 0) {
                    void playFromCurrent();
                  } else if (nowViewingItem) {
                    void playChapterNow(nowViewingItem);
                  } else {
                    void playNowViewing();
                  }
                  return;
                }
                togglePause();
              }}
              disabled={queue.length === 0 && !nowViewingItem}
              aria-label={isPlaying && !isPaused ? "Pause" : "Play"}
            >
              {isPlaying && !isPaused ? "⏸" : "▶"}
            </button>
            <IconButton label="Next" onClick={playNext} disabled={currentIndex >= queue.length - 1 || queue.length === 0}>⏭</IconButton>
            <IconButton label={isExpanded ? "Collapse" : "Expand"} onClick={() => setIsExpanded((current) => !current)}>
              {isExpanded ? "▾" : "▴"}
            </IconButton>
          </div>
        </div>
        {isExpanded ? (
          <div className="mini-apple-expanded">
            <div className="mini-apple-now-playing">
              <div className="mini-apple-artwork mini-apple-artwork-large" aria-hidden="true" />
              <div className="mini-apple-now-playing-meta">
                <h3>{title}</h3>
                <p>{currentVerse ? `Verse ${currentVerse}` : queueCountLabel}</p>
              </div>
              <button
                type="button"
                className={`mini-apple-repeat-pill ${repeatMode === "off" ? "" : "is-active"}`}
                onClick={cycleRepeatMode}
                aria-label={repeatLabel}
                title={repeatLabel}
              >
                {repeatMode === "off" ? "Repeat" : repeatMode === "playlist" ? "Repeat All" : "Repeat Chapter"}
              </button>
            </div>

            <div className="mini-apple-transport">
              <CircleButton label="Previous" onClick={playPrevious} disabled={currentIndex <= 0 || queue.length === 0}>⏮</CircleButton>
              <button
                type="button"
                className="mini-apple-transport-play"
                onClick={() => {
                  if (!isPlaying) {
                    primeSpeechFromUserGesture();
                    if (queue.length > 0) {
                      void playFromCurrent();
                    } else if (nowViewingItem) {
                      void playChapterNow(nowViewingItem);
                    } else {
                      void playNowViewing();
                    }
                    return;
                  }
                  togglePause();
                }}
                disabled={queue.length === 0 && !nowViewingItem}
                aria-label={isPlaying && !isPaused ? "Pause" : "Play"}
              >
                {isPlaying && !isPaused ? "⏸" : "▶"}
              </button>
              <CircleButton label="Next" onClick={playNext} disabled={currentIndex >= queue.length - 1 || queue.length === 0}>⏭</CircleButton>
              <CircleButton label="Stop" onClick={stop} disabled={!isPlaying && !isPaused}>⏹</CircleButton>
            </div>

            <div className="mini-apple-cards">
              <ControlCard label={`Speed ${speechRate.toFixed(2)}x`}>
                <input
                  type="range"
                  min={0.8}
                  max={1.2}
                  step={0.05}
                  value={speechRate}
                  onChange={(event) => setSpeechRate(Number(event.target.value))}
                />
              </ControlCard>
              <ControlCard label={`Crossfade ${crossfadeDurationMs}ms`}>
                <input
                  type="range"
                  min={100}
                  max={1500}
                  step={50}
                  value={crossfadeDurationMs}
                  onChange={(event) => setCrossfadeDurationMs(Number(event.target.value))}
                />
              </ControlCard>
            </div>

            <div className="mini-apple-voice-grid">
              <label>
                Voice Engine
                <div className="engine-selector">
                  <button
                    type="button"
                    className={`mini-tab ${ttsEngine === "browser" ? "is-active" : ""}`}
                    onClick={() => setTtsEngine("browser")}
                  >
                    Device
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${ttsEngine === "openai" ? "is-active" : ""}`}
                    onClick={() => setTtsEngine("openai")}
                  >
                    AI
                  </button>
                </div>
              </label>

              {ttsEngine === "browser" ? (
                <>
                  <label>
                    Voice
                    <select value={selectedVoiceName} onChange={(event) => setSelectedVoiceName(event.target.value)}>
                      <option value="">Auto (en-US)</option>
                      {filteredVoices.map((voice) => (
                        <option key={voice.name} value={voice.name}>{voice.name} ({voice.lang})</option>
                      ))}
                    </select>
                  </label>

                  <label className="checkbox-row">
                    <input type="checkbox" checked={showAllVoices} onChange={(event) => setShowAllVoices(event.target.checked)} />
                    <span>Show all voices</span>
                  </label>

                  {!showAllVoices ? (
                    <label>
                      Voice type
                      <select value={voiceFilter} onChange={(event) => setVoiceFilter(event.target.value as "enhanced" | "premium")}>
                        <option value="enhanced">Enhanced</option>
                        <option value="premium">Premium</option>
                      </select>
                    </label>
                  ) : null}
                </>
              ) : (
                <label>
                  AI Voice
                  <select value={aiVoiceId} onChange={(event) => setAiVoiceId(event.target.value)}>
                    {aiVoices.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.label}</option>
                    ))}
                  </select>
                </label>
              )}
            </div>

            <div className="mini-apple-segmented">
              <button
                type="button"
                className={`mini-tab ${activeTab === "queue" ? "is-active" : ""}`}
                onClick={() => setActiveTab("queue")}
              >
                Queue
              </button>
              <button
                type="button"
                className={`mini-tab ${activeTab === "playlists" ? "is-active" : ""}`}
                onClick={() => setActiveTab("playlists")}
              >
                Playlists
              </button>
            </div>

            <div className="mini-apple-pane">
              {activeTab === "queue" ? (
                <>
                  <div className="queue-list">
                    {queue.length === 0 ? <p className="status-text">Queue is empty.</p> : null}
                    {queue.map((item, index) => (
                      <div key={item.id} className={`queue-item ${index === currentIndex ? "is-current" : ""}`}>
                        <button
                          type="button"
                          className="queue-item-main"
                          onClick={() => {
                            setCurrentIndex(index);
                            void playFromIndex(index);
                          }}
                        >
                          <strong>{item.title}</strong>
                        </button>
                        <div className="queue-item-actions">
                          <button type="button" className="ghost-button" onClick={() => moveItem(index, Math.max(0, index - 1))} disabled={index === 0}>↑</button>
                          <button type="button" className="ghost-button" onClick={() => moveItem(index, Math.min(queue.length - 1, index + 1))} disabled={index === queue.length - 1}>↓</button>
                          <button type="button" className="danger-button" onClick={() => removeFromQueue(item.id)}>Remove</button>
                        </div>
                      </div>
                    ))}
                  </div>
                  <div className="action-row">
                    <button type="button" className="ghost-button" onClick={clearQueue} disabled={queue.length === 0}>Clear All</button>
                  </div>
                </>
              ) : (
                <>
                  <div className="action-row">
                    <input
                      placeholder="Playlist name"
                      value={playlistName}
                      onChange={(event) => setPlaylistName(event.target.value)}
                    />
                    <button
                      type="button"
                      onClick={() => {
                        if (!playlistName.trim()) {
                          return;
                        }
                        void (async () => {
                          const createdId = await createPlaylist(playlistName);
                          if (createdId) {
                            setPlaylistName("");
                          }
                        })();
                      }}
                    >
                      Create
                    </button>
                  </div>

                  <div className="playlist-list">
                    {playlists.length === 0 ? <p className="status-text">No saved playlists yet.</p> : null}
                    {playlists.map((playlist) => (
                      <div key={playlist.id} className={`playlist-item ${playlist.id === selectedPlaylist?.id ? "is-current" : ""}`}>
                        <button
                          type="button"
                          className="queue-item-main"
                          onClick={() => setSelectedPlaylistId(playlist.id)}
                        >
                          <strong>{playlist.name}</strong>
                          <span>{playlist.chapters.length} chapters • {formatDate(playlist.createdAt)}</span>
                        </button>
                        <div className="queue-item-actions">
                          <button type="button" className="ghost-button" onClick={() => void playPlaylist(playlist.id)}>Play</button>
                          <button type="button" className="danger-button" onClick={() => handleDeletePlaylist(playlist.id, playlist.name)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>

                  {selectedPlaylist ? (
                    <div className="playlist-chapter-list">
                      {selectedPlaylist.chapters.map((chapterItem, index) => (
                        <button
                          type="button"
                          key={`${chapterItem.id}-${index}`}
                          className="playlist-track"
                          onClick={() => {
                            primeSpeechFromUserGesture();
                            void playPlaylist(selectedPlaylist.id, { startIndex: index });
                          }}
                        >
                          <span className="track-index">{index + 1}</span>
                          <span className="track-title">{chapterItem.title}</span>
                        </button>
                      ))}
                    </div>
                  ) : null}
                </>
              )}
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

function IconButton({
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
      className="mini-apple-icon-btn"
      aria-label={label}
      title={label}
      disabled={disabled}
    >
      {children}
    </button>
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

function ControlCard({
  label,
  children
}: {
  label: string;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className="mini-apple-control-card">
      <p>{label}</p>
      {children}
    </div>
  );
}
