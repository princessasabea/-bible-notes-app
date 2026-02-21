"use client";

import { useEffect, useRef, useState } from "react";

export function useBrowserTTS(): {
  available: boolean;
  isSpeaking: boolean;
  isPaused: boolean;
  speak: (input: string | string[], selectedVoiceName?: string) => void;
  pause: () => void;
  resume: () => void;
  stop: () => void;
} {
  const utteranceRef = useRef<SpeechSynthesisUtterance | null>(null);
  const verseQueueRef = useRef<string[]>([]);
  const currentIndexRef = useRef(0);
  const isPlayingRef = useRef(false);
  const nextTimerRef = useRef<number | null>(null);

  const [available, setAvailable] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [isPaused, setIsPaused] = useState(false);

  useEffect(() => {
    const synth = window.speechSynthesis;
    setAvailable(Boolean(synth));

    const handleVoicesChanged = (): void => {
      synth.getVoices();
    };

    synth.onvoiceschanged = handleVoicesChanged;
    synth.getVoices();

    return () => {
      synth.onvoiceschanged = null;
      if (nextTimerRef.current !== null) {
        window.clearTimeout(nextTimerRef.current);
        nextTimerRef.current = null;
      }
      verseQueueRef.current = [];
      currentIndexRef.current = 0;
      isPlayingRef.current = false;
      synth.cancel();
      utteranceRef.current = null;
      setIsSpeaking(false);
      setIsPaused(false);
    };
  }, []);

  const speak = (input: string | string[], selectedVoiceName?: string): void => {
    if (!window.speechSynthesis) {
      return;
    }

    if (isPlayingRef.current) {
      return;
    }

    const verses = (Array.isArray(input) ? input : [input])
      .map((entry) => entry.trim())
      .filter(Boolean);

    if (verses.length === 0) {
      return;
    }

    const allVoices = speechSynthesis.getVoices();
    const selectedVoice = selectedVoiceName
      ? allVoices.find((entry) => entry.name === selectedVoiceName)
      : allVoices.find((entry) => entry.lang.startsWith("en")) ?? allVoices[0] ?? null;

    if (!selectedVoice) {
      console.log("No voices available");
      return;
    }

    console.log("Using voice:", selectedVoice.name);

    speechSynthesis.cancel();
    verseQueueRef.current = verses;
    currentIndexRef.current = 0;
    isPlayingRef.current = true;
    setIsPaused(false);

    const speakNext = (): void => {
      if (currentIndexRef.current >= verseQueueRef.current.length) {
        isPlayingRef.current = false;
        utteranceRef.current = null;
        setIsSpeaking(false);
        setIsPaused(false);
        return;
      }

      const utterance = new SpeechSynthesisUtterance(verseQueueRef.current[currentIndexRef.current]);
      utterance.voice = selectedVoice;
      utterance.rate = 0.95;
      utterance.pitch = 1;
      utterance.lang = selectedVoice.lang || "en-US";

      utterance.onstart = () => {
        setIsSpeaking(true);
        setIsPaused(false);
      };

      utterance.onpause = () => {
        setIsPaused(true);
      };

      utterance.onresume = () => {
        setIsPaused(false);
        setIsSpeaking(true);
      };

      const queueNext = (): void => {
        currentIndexRef.current += 1;
        nextTimerRef.current = window.setTimeout(() => {
          nextTimerRef.current = null;
          if (isPlayingRef.current) {
            speakNext();
          }
        }, 120);
      };

      utterance.onerror = (event) => {
        console.log("Utterance error:", event.error);
        queueNext();
      };

      utterance.onend = () => {
        queueNext();
      };

      utteranceRef.current = utterance;
      speechSynthesis.speak(utterance);
    };

    speakNext();
  };

  const pause = (): void => {
    if (speechSynthesis.speaking) {
      speechSynthesis.pause();
      setIsPaused(true);
    }
  };

  const resume = (): void => {
    if (speechSynthesis.paused) {
      speechSynthesis.resume();
      setIsPaused(false);
      setIsSpeaking(true);
    }
  };

  const stop = (): void => {
    if (nextTimerRef.current !== null) {
      window.clearTimeout(nextTimerRef.current);
      nextTimerRef.current = null;
    }
    verseQueueRef.current = [];
    currentIndexRef.current = 0;
    isPlayingRef.current = false;
    speechSynthesis.cancel();
    utteranceRef.current = null;
    setIsPaused(false);
    setIsSpeaking(false);
  };

  return { available, isSpeaking, isPaused, speak, pause, resume, stop };
}
