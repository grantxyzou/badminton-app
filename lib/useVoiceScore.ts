'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isNative } from './native';
import { parseCall, type ParsedCall } from './voiceScore';

/**
 * The courtside board's ear (docs/plans/voice-score.md): the browser's own
 * speech recogniser, handed to `lib/voiceScore.ts` one final result at a time.
 *
 * Two modes, picked by the platform:
 *  - `continuous` (Chrome on Android, desktop): listens until stopped. The
 *    recogniser ends itself after a stretch of silence, so `onend` starts it
 *    again while the person still wants it on.
 *  - `tap` (iPhone and iPad): WebKit's continuous mode is reported to stall
 *    (WebKit bug 225298 and developer reports), so one tap hears one call and
 *    stops. A continuous session that keeps ending as soon as it starts drops
 *    to `tap` too.
 *
 * Nothing is recorded or kept: the transcript is parsed and dropped. The
 * browser sends the audio to its own speech service (Google's in Chrome,
 * Apple's in Safari), which is why the flag stays off until the privacy policy
 * says so.
 *
 * Not offered in the store app: its WebViews have no recogniser and the app
 * declares no microphone permission.
 */

export type VoiceMode = 'continuous' | 'tap';
export type VoiceProblem = 'denied' | 'network' | 'failed';

interface RecognitionAlternative {
  transcript: string;
}
interface RecognitionResult {
  isFinal: boolean;
  length: number;
  [index: number]: RecognitionAlternative;
}
interface RecognitionEvent {
  resultIndex: number;
  results: { length: number; [index: number]: RecognitionResult };
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  maxAlternatives: number;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start: () => void;
  abort: () => void;
}
type RecognitionCtor = new () => Recognition;

/** The recogniser this page can use, or null. */
export function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === 'undefined' || isNative()) return null;
  const w = window as unknown as { SpeechRecognition?: RecognitionCtor; webkitSpeechRecognition?: RecognitionCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** iPhone and iPad, including an iPad that reports itself as a Mac. */
export function isAppleTouch(): boolean {
  if (typeof navigator === 'undefined') return false;
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && (navigator.maxTouchPoints ?? 0) > 1);
}

/** A continuous session this short is the recogniser giving up, not silence. */
const QUICK_END_MS = 1500;
/** That many quick ends in a row, and it drops to tap. */
const QUICK_ENDS_TO_TAP = 3;

interface Options {
  /** False while the board is closed: nothing listens. */
  enabled: boolean;
  /** Every final result: one parse per alternative the recogniser offered, best first. */
  onCalls: (calls: ParsedCall[], transcript: string) => void;
}

export interface VoiceScore {
  /** The browser has a recogniser and this is not the store app. */
  supported: boolean;
  mode: VoiceMode;
  /** The mic is on right now. */
  listening: boolean;
  problem: VoiceProblem | null;
  start: () => void;
  stop: () => void;
}

export function useVoiceScore({ enabled, onCalls }: Options): VoiceScore {
  const [supported, setSupported] = useState(false);
  const [mode, setMode] = useState<VoiceMode>('continuous');
  const [listening, setListening] = useState(false);
  const [problem, setProblem] = useState<VoiceProblem | null>(null);

  const recRef = useRef<Recognition | null>(null);
  /** The person wants the mic on (continuous mode keeps restarting while true). */
  const wantRef = useRef(false);
  const modeRef = useRef<VoiceMode>('continuous');
  const startedAtRef = useRef(0);
  const quickEndsRef = useRef(0);
  /** `begin`, for the restart inside its own `onend`. */
  const beginRef = useRef<(() => void) | null>(null);
  const onCallsRef = useRef(onCalls);
  useEffect(() => {
    onCallsRef.current = onCalls;
  }, [onCalls]);

  // Read after mount: the server render has no window, and a hydration
  // mismatch would follow from reading it during render.
  useEffect(() => {
    setSupported(recognitionCtor() !== null);
    const m: VoiceMode = isAppleTouch() ? 'tap' : 'continuous';
    modeRef.current = m;
    setMode(m);
  }, []);

  const begin = useCallback(() => {
    const Ctor = recognitionCtor();
    if (!Ctor) return;
    const rec = new Ctor();
    rec.lang = 'en-US';
    rec.continuous = modeRef.current === 'continuous';
    rec.interimResults = false;
    rec.maxAlternatives = 5;
    rec.onresult = (e) => {
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const result = e.results[i];
        if (!result.isFinal) continue;
        const alternatives: string[] = [];
        for (let j = 0; j < result.length; j++) alternatives.push(result[j].transcript);
        onCallsRef.current(alternatives.map(parseCall), alternatives[0] ?? '');
      }
    };
    rec.onerror = (e) => {
      // Silence and our own abort are not problems.
      if (e.error === 'no-speech' || e.error === 'aborted') return;
      wantRef.current = false;
      setProblem(e.error === 'not-allowed' || e.error === 'service-not-allowed' ? 'denied' : e.error === 'network' ? 'network' : 'failed');
    };
    rec.onend = () => {
      if (recRef.current !== rec) return;
      recRef.current = null;
      if (wantRef.current && modeRef.current === 'continuous') {
        const quick = Date.now() - startedAtRef.current < QUICK_END_MS;
        quickEndsRef.current = quick ? quickEndsRef.current + 1 : 0;
        if (quickEndsRef.current < QUICK_ENDS_TO_TAP) {
          beginRef.current?.();
          return;
        }
        // It keeps giving up: one call per tap from here.
        modeRef.current = 'tap';
        setMode('tap');
      }
      wantRef.current = false;
      setListening(false);
    };
    recRef.current = rec;
    startedAtRef.current = Date.now();
    try {
      rec.start();
      setListening(true);
    } catch {
      recRef.current = null;
      wantRef.current = false;
      setListening(false);
      setProblem('failed');
    }
  }, []);

  useEffect(() => {
    beginRef.current = begin;
  }, [begin]);

  const start = useCallback(() => {
    if (!enabled || recRef.current) return;
    setProblem(null);
    quickEndsRef.current = 0;
    wantRef.current = true;
    begin();
  }, [enabled, begin]);

  const stop = useCallback(() => {
    wantRef.current = false;
    const rec = recRef.current;
    recRef.current = null;
    setListening(false);
    if (rec) {
      try {
        rec.abort();
      } catch {
        /* already stopped */
      }
    }
  }, []);

  // Closing the board, or leaving the page, turns the mic off.
  useEffect(() => {
    if (!enabled) stop();
    return () => stop();
  }, [enabled, stop]);

  return { supported, mode, listening, problem, start, stop };
}
