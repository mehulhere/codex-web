import { useCallback, useEffect, useRef, useState } from "react";

export const DICTATION_CHUNK_INTERVAL_MS = 10_000;

export type DictationState = "idle" | "connecting" | "recording" | "transcribing" | "error";

interface SpeechRecognitionResultLike {
  isFinal: boolean;
  0?: { transcript?: string };
}

interface SpeechRecognitionEventLike {
  resultIndex: number;
  results: ArrayLike<SpeechRecognitionResultLike>;
}

interface SpeechRecognitionLike {
  continuous: boolean;
  interimResults: boolean;
  lang: string;
  onresult: ((event: SpeechRecognitionEventLike) => void) | null;
  onerror: ((event: { error?: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  stop: () => void;
  abort: () => void;
}

type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const speechWindow = window as typeof window & {
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  };
  return speechWindow.SpeechRecognition ?? speechWindow.webkitSpeechRecognition ?? null;
}

export function appendTranscript(current: string, transcript: string): string {
  const clean = transcript.trim();
  if (!clean) return current;
  if (!current) return clean;
  return `${current.trimEnd()} ${clean}`;
}

export function useDictation(onTranscript: (text: string) => void): {
  state: DictationState;
  error: string | null;
  start: () => Promise<void>;
  finish: () => void;
  cancel: () => void;
} {
  const [state, setState] = useState<DictationState>("idle");
  const [error, setError] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null);
  const timerRef = useRef<number | null>(null);
  const continuesRef = useRef(false);
  const sessionIdRef = useRef(0);
  const onTranscriptRef = useRef(onTranscript);

  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  const clearTimer = useCallback(() => {
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = null;
  }, []);

  const cancel = useCallback(() => {
    sessionIdRef.current += 1;
    continuesRef.current = false;
    clearTimer();
    const recognition = recognitionRef.current;
    recognitionRef.current = null;
    if (recognition) {
      recognition.onresult = null;
      recognition.onerror = null;
      recognition.onend = null;
      recognition.abort();
    }
    setState("idle");
  }, [clearTimer]);

  const finish = useCallback(() => {
    if (!recognitionRef.current) return;
    continuesRef.current = false;
    clearTimer();
    setState("transcribing");
    recognitionRef.current.stop();
  }, [clearTimer]);

  const start = useCallback(async () => {
    if (state !== "idle" && state !== "error") return;
    setError(null);
    setState("connecting");
    if (window.isSecureContext === false) {
      setError("Voice dictation requires HTTPS. Open the Tailscale Serve HTTPS address in Safari.");
      setState("error");
      return;
    }
    const SpeechRecognition = getSpeechRecognitionConstructor();
    if (!SpeechRecognition) {
      setError("Voice dictation is unavailable in this browser. Open the installed PWA in Safari.");
      setState("error");
      return;
    }

    const recognition = new SpeechRecognition();
    const sessionId = sessionIdRef.current + 1;
    sessionIdRef.current = sessionId;
    recognitionRef.current = recognition;
    continuesRef.current = true;
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = navigator.language || "en-US";
    recognition.onresult = (event) => {
      if (sessionIdRef.current !== sessionId || recognitionRef.current !== recognition) return;
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const result = event.results[index];
        if (result?.isFinal && result[0]?.transcript) onTranscriptRef.current(result[0].transcript);
      }
    };
    recognition.onerror = (event) => {
      if (sessionIdRef.current !== sessionId || recognitionRef.current !== recognition) return;
      if (event.error === "aborted" && !continuesRef.current) return;
      continuesRef.current = false;
      clearTimer();
      recognitionRef.current = null;
      setError(event.error ? `Dictation failed: ${event.error}` : "Dictation failed");
      setState("error");
    };
    recognition.onend = () => {
      if (sessionIdRef.current !== sessionId || recognitionRef.current !== recognition) return;
      if (continuesRef.current) {
        try {
          recognition.start();
        } catch {
          continuesRef.current = false;
          clearTimer();
          recognitionRef.current = null;
          setError("Could not continue dictation");
          setState("error");
        }
      } else {
        recognitionRef.current = null;
        setState("idle");
      }
    };

    try {
      recognition.start();
      timerRef.current = window.setInterval(() => {
        if (
          sessionIdRef.current === sessionId &&
          recognitionRef.current === recognition &&
          continuesRef.current
        ) recognition.stop();
      }, DICTATION_CHUNK_INTERVAL_MS);
      setState("recording");
    } catch (caught) {
      continuesRef.current = false;
      recognitionRef.current = null;
      setError(caught instanceof Error ? caught.message : "Microphone access failed");
      setState("error");
    }
  }, [clearTimer, state]);

  useEffect(() => {
    return () => {
      sessionIdRef.current += 1;
      continuesRef.current = false;
      clearTimer();
      const recognition = recognitionRef.current;
      recognitionRef.current = null;
      if (recognition) {
        recognition.onresult = null;
        recognition.onerror = null;
        recognition.onend = null;
        recognition.abort();
      }
    };
  }, [clearTimer]);

  return { state, error, start, finish, cancel };
}
