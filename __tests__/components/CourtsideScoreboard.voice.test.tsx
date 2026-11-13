// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import CourtsideScoreboard from '../../components/stats/CourtsideScoreboard';
import { recognitionCtor } from '../../lib/useVoiceScore';

/**
 * Voice scoring on the courtside board (docs/plans/voice-score.md), behind
 * NEXT_PUBLIC_FLAG_VOICE_SCORE. jsdom has no speech recogniser, so a fake one
 * stands in: each test speaks to it through `say()` and ends it through
 * `end()`, the way a browser's recogniser does.
 */
class FakeRecognition {
  static instances: FakeRecognition[] = [];
  lang = '';
  continuous = false;
  interimResults = true;
  maxAlternatives = 1;
  started = false;
  aborted = false;
  onresult: ((e: unknown) => void) | null = null;
  onerror: ((e: { error: string }) => void) | null = null;
  onend: (() => void) | null = null;
  constructor() {
    FakeRecognition.instances.push(this);
  }
  start() {
    this.started = true;
  }
  abort() {
    this.aborted = true;
  }
}

const latest = () => FakeRecognition.instances[FakeRecognition.instances.length - 1];

/** One final result with these alternatives, best first. */
function say(...alternatives: string[]) {
  const result = Object.assign(alternatives.map((transcript) => ({ transcript })), { isFinal: true });
  act(() => {
    latest().onresult?.({ resultIndex: 0, results: [result] });
  });
}
function end() {
  act(() => {
    latest().onend?.();
  });
}

function renderBoard() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <CourtsideScoreboard open onClose={vi.fn()} onSave={vi.fn()} />
    </NextIntlClientProvider>,
  );
}

const scoreA = () => screen.getByTestId('score-a').textContent;
const scoreB = () => screen.getByTestId('score-b').textContent;
const UA = navigator.userAgent;

function setUserAgent(ua: string) {
  Object.defineProperty(window.navigator, 'userAgent', { value: ua, configurable: true });
}

describe('CourtsideScoreboard voice (Preview)', () => {
  beforeEach(() => {
    FakeRecognition.instances = [];
    process.env.NEXT_PUBLIC_FLAG_VOICE_SCORE = 'true';
    (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition = FakeRecognition;
  });
  afterEach(() => {
    cleanup();
    delete process.env.NEXT_PUBLIC_FLAG_VOICE_SCORE;
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    delete (window as unknown as { Capacitor?: unknown }).Capacitor;
    setUserAgent(UA);
  });

  it('flag off: no mic', () => {
    process.env.NEXT_PUBLIC_FLAG_VOICE_SCORE = 'false';
    renderBoard();
    expect(screen.queryByRole('button', { name: /Listen for the score/ })).toBeNull();
  });

  it('a browser with no recogniser gets no mic, rather than a dead one', () => {
    delete (window as unknown as { webkitSpeechRecognition?: unknown }).webkitSpeechRecognition;
    renderBoard();
    expect(screen.queryByRole('button', { name: /Listen for the score/ })).toBeNull();
  });

  it('the store app is never offered the mic', () => {
    (window as unknown as { Capacitor?: unknown }).Capacitor = { isNativePlatform: () => true };
    expect(recognitionCtor()).toBeNull();
  });

  it('listens hands-free in English and scores a call that is one rally on', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    const rec = latest();
    expect(rec.started).toBe(true);
    expect(rec.continuous).toBe(true);
    expect(rec.lang).toBe('en-US');
    expect(screen.getByText("Listening. Call the score, server's first.")).toBeTruthy();

    // The first rally at love all: the words cannot say who won, so it asks.
    say('one love');
    expect(screen.getByText('Heard 1–0. Who won the rally?')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'A side won' }));
    expect(scoreA()).toBe('1');

    say('two love');
    expect(scoreA()).toBe('2');
    expect(screen.getByText('Heard 2–0 · +1 A side')).toBeTruthy();

    // B wins the serve back: B's score called first.
    say('one two');
    expect(scoreB()).toBe('1');
  });

  it('another court\'s call is shown and never scored', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    say('fourteen twelve');
    expect(scoreA()).toBe('0');
    expect(scoreB()).toBe('0');
    expect(screen.getByText('Heard 14–12: not one rally on, so not scored')).toBeTruthy();
  });

  it('tries the recogniser\'s other guesses when the first is not a score', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    say('one love');
    fireEvent.click(screen.getByRole('button', { name: 'B side won' }));
    say('two heaven', 'two love');
    expect(scoreB()).toBe('2');
  });

  it('"Neither" dismisses the question and scores nothing', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    say('one love');
    fireEvent.click(screen.getByRole('button', { name: 'Neither' }));
    expect(screen.queryByText(/Who won the rally/)).toBeNull();
    expect(scoreA()).toBe('0');
    expect(scoreB()).toBe('0');
  });

  it('hands-free starts again after the silence that ends it, and stops when asked', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    const first = latest();
    // A session that ran a while before ending: silence, not a failure.
    vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 10_000);
    end();
    vi.restoreAllMocks();
    expect(FakeRecognition.instances.length).toBe(2);
    expect(latest()).not.toBe(first);
    fireEvent.click(screen.getByRole('button', { name: 'Stop listening' }));
    expect(latest().aborted).toBe(true);
    expect(screen.getByRole('button', { name: /Listen for the score/ })).toBeTruthy();
  });

  it('a session that keeps ending at once drops to tap-to-speak', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    end();
    end();
    end();
    expect(screen.getByRole('button', { name: 'Tap, then call the score' })).toBeTruthy();
  });

  it('on an iPhone one tap hears one call', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: 'Tap, then call the score' }));
    expect(latest().continuous).toBe(false);
    say('one love');
    end();
    // No restart: the next call is the next tap.
    expect(FakeRecognition.instances.length).toBe(1);
    expect(screen.getByRole('button', { name: 'Tap, then call the score' })).toBeTruthy();
  });

  it('a blocked microphone says so', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    act(() => latest().onerror?.({ error: 'not-allowed' }));
    end();
    expect(screen.getByText(/The microphone is blocked/)).toBeTruthy();
  });

  it('the +1 buttons still work, and clear a pending question', () => {
    renderBoard();
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    say('one love');
    fireEvent.click(screen.getByRole('button', { name: '+1 B side' }));
    expect(screen.queryByText(/Who won the rally/)).toBeNull();
    expect(scoreB()).toBe('1');
  });
});
