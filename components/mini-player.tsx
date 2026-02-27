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
    if (!playlistModalOpen) {
      return;
    }
    setActiveTab("playlists");
    setIsExpanded(true);
  }, [playlistModalOpen]);

  return (
    <>
      <section className={`mini-player ${isExpanded ? "expanded" : "collapsed"} ${playlistModalOpen ? "is-shrunk" : ""}`} role="region" aria-label="Audio player">
        {!isExpanded ? (
          <button
            type="button"
            className="mini-collapsed"
            onClick={() => setIsExpanded(true)}
          >
            <span className="mini-collapsed-title">🎧 {title}</span>
            <span className="mini-collapsed-meta">
              {currentVerse ? `Verse ${currentVerse}` : queueCountLabel}
            </span>
            <span className={`eq ${isPlaying && !isPaused ? "is-active" : ""}`} aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
        ) : null}

        {isExpanded ? (
          <>
            <div className="mini-top">
              <div className="mini-left">
                <strong>{title}</strong>
                <span>{queueCountLabel}{currentVerse ? ` • Verse ${currentVerse}` : ""}</span>
              </div>
              <button type="button" className="icon-btn" onClick={() => setIsExpanded(false)} aria-label="Collapse player">
                ⌄
              </button>
            </div>

            <div className="progress-bar" aria-hidden="true">
              <div className="progress-fill" style={{ width: `${progress}%` }} />
            </div>

            <div className="mini-controls">
              <button type="button" className="icon-btn" onClick={playPrevious} disabled={currentIndex <= 0 || queue.length === 0}>⏮</button>
              {!isPlaying ? (
                <button
                  type="button"
                  className="icon-btn icon-btn-primary"
                  onClick={() => {
                    primeSpeechFromUserGesture();
                    if (queue.length > 0) {
                      void playFromCurrent();
                    } else if (nowViewingItem) {
                      void playChapterNow(nowViewingItem);
                    } else {
                      void playNowViewing();
                    }
                  }}
                  disabled={queue.length === 0 && !nowViewingItem}
                >
                  ▶
                </button>
              ) : (
                <button type="button" className={`icon-btn icon-btn-primary ${!isPaused ? "is-pulsing" : ""}`} onClick={togglePause}>
                  {isPaused ? "▶" : "⏯"}
                </button>
              )}
              <button type="button" className="icon-btn" onClick={stop} disabled={!isPlaying && !isPaused}>⏹</button>
              <button type="button" className="icon-btn" onClick={playNext} disabled={currentIndex >= queue.length - 1 || queue.length === 0}>⏭</button>
            </div>

            <div className="mini-settings">
              <label>
                Voice Engine
                <div className="engine-selector">
                  <button
                    type="button"
                    className={`mini-tab ${ttsEngine === "browser" ? "is-active" : ""}`}
                    onClick={() => setTtsEngine("browser")}
                  >
                    🟢 Device Voice
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${ttsEngine === "openai" ? "is-active" : ""}`}
                    onClick={() => setTtsEngine("openai")}
                  >
                    🔵 AI Voice
                  </button>
                </div>
                <small className="status-text">
                  {ttsEngine === "browser"
                    ? "Uses your device voices (free/offline)."
                    : "Uses OpenAI voice via API (premium quality)."}
                </small>
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
                        <option value="enhanced">Only Enhanced</option>
                        <option value="premium">Only Premium</option>
                      </select>
                    </label>
                  ) : null}
                </>
              ) : null}

              {ttsEngine === "openai" ? (
                <label>
                  AI Voice
                  <select value={aiVoiceId} onChange={(event) => setAiVoiceId(event.target.value)}>
                    {aiVoices.map((voice) => (
                      <option key={voice.id} value={voice.id}>{voice.label}</option>
                    ))}
                  </select>
                </label>
              ) : null}

              <label>
                Speed {speechRate.toFixed(2)}x
                <input
                  type="range"
                  min={0.8}
                  max={1.2}
                  step={0.05}
                  value={speechRate}
                  onChange={(event) => setSpeechRate(Number(event.target.value))}
                />
              </label>

              <label>
                Crossfade {crossfadeDurationMs}ms
                <input
                  type="range"
                  min={100}
                  max={1500}
                  step={50}
                  value={crossfadeDurationMs}
                  onChange={(event) => setCrossfadeDurationMs(Number(event.target.value))}
                />
              </label>

              <label>
                Repeat
                <div className="engine-selector">
                  <button
                    type="button"
                    className={`mini-tab ${repeatMode === "off" ? "is-active" : ""}`}
                    onClick={() => setRepeatMode("off")}
                  >
                    Off
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${repeatMode === "chapter" ? "is-active" : ""}`}
                    onClick={() => setRepeatMode("chapter")}
                  >
                    Chapter
                  </button>
                  <button
                    type="button"
                    className={`mini-tab ${repeatMode === "playlist" ? "is-active" : ""}`}
                    onClick={() => setRepeatMode("playlist")}
                  >
                    Playlist
                  </button>
                </div>
              </label>
            </div>

            <div className="mini-tabs">
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
                onClick={() => {
                  setActiveTab("playlists");
                  setPlaylistModalOpen(true);
                }}
              >
                Playlists
              </button>
            </div>

            <div className="mini-tab-panel">
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
                      <div key={playlist.id} className="playlist-item">
                        <div>
                          <strong>{playlist.name}</strong>
                          <p>{playlist.chapters.length} chapters • {formatDate(playlist.createdAt)}</p>
                        </div>
                        <div className="action-row">
                          <button type="button" className="ghost-button" onClick={() => void playPlaylist(playlist.id)}>Play</button>
                          <button type="button" className="danger-button" onClick={() => deletePlaylist(playlist.id)}>Delete</button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>

            {statusMessage ? <p className="status-text">{statusMessage}</p> : null}
          </>
        ) : null}
      </section>

      <div className={`playlist-screen ${playlistModalOpen ? "is-open" : ""}`} aria-hidden={!playlistModalOpen}>
        <div className="playlist-screen-inner">
          <div className="playlist-screen-top">
            <button
              type="button"
              className="ghost-button"
              onClick={() => setPlaylistModalOpen(false)}
            >
              Done
            </button>
          </div>

          <div className="playlist-cover">
            <div className="playlist-cover-art" />
            <h2>{selectedPlaylist?.name ?? "My Playlist"}</h2>
            <p>
              {(selectedPlaylist?.chapters.length ?? 0)} Chapters •{" "}
              {Math.max(1, Math.round(((selectedPlaylist?.chapters.length ?? 0) * 12) / 60))}h{" "}
              {((selectedPlaylist?.chapters.length ?? 0) * 12) % 60}m
            </p>
            <div className="playlist-cover-actions">
              <button
                type="button"
                className="player-button"
                onClick={() => {
                  if (!selectedPlaylist) {
                    return;
                  }
                  primeSpeechFromUserGesture();
                  void playPlaylist(selectedPlaylist.id);
                  setPlaylistModalOpen(false);
                }}
              >
                ▶ Play
              </button>
              <button
                type="button"
                className="ghost-button"
                onClick={() => {
                  if (!selectedPlaylist) {
                    return;
                  }
                  primeSpeechFromUserGesture();
                  void playPlaylist(selectedPlaylist.id, { shuffle: true });
                  setPlaylistModalOpen(false);
                }}
              >
                Shuffle
              </button>
            </div>
          </div>

          <div className="playlist-picker">
            {playlists.map((playlist) => (
              <button
                key={playlist.id}
                type="button"
                className={`mini-tab ${selectedPlaylist?.id === playlist.id ? "is-active" : ""}`}
                onClick={() => setSelectedPlaylistId(playlist.id)}
              >
                {playlist.name}
              </button>
            ))}
          </div>

          <div className="playlist-chapter-list">
            {selectedPlaylist?.chapters.map((chapterItem, index) => (
              <button
                type="button"
                key={`${chapterItem.id}-${index}`}
                className="playlist-track"
                onClick={() => {
                  primeSpeechFromUserGesture();
                  void playPlaylist(selectedPlaylist.id, { startIndex: index });
                  setPlaylistModalOpen(false);
                }}
              >
                <span className="track-index">{index + 1}</span>
                <span className="track-title">{chapterItem.title}</span>
              </button>
            )) ?? <p className="status-text">No playlists yet.</p>}
          </div>
        </div>
      </div>

      {statusMessage && !isExpanded ? (
        <div className="mini-toast">
          <span className="status-text">{statusMessage}</span>
        </div>
      ) : null}
    </>
  );
}
