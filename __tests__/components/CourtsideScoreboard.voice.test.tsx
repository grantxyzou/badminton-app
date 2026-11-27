// @vitest-environment jsdom
// @vitest-environment-options { "url": "http://localhost:3000/bpm" }
import { describe, it, expect, afterEach, beforeEach, vi } from 'vitest';
import { render, screen, cleanup, fireEvent, act } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import enMessages from '../../messages/en.json';
import CourtsideScoreboard from '../../components/stats/CourtsideScoreboard';
import { recognitionCtor, SESSION_WATCHDOG_MS } from '../../lib/useVoiceScore';

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

/** The new opening: say who serves (that tap turns the mic on), then "zero zero". */
function chooseServer(side: 'A' | 'B' = 'A') {
  fireEvent.click(screen.getByRole('button', { name: `${side} side serves` }));
}
function startByVoice(side: 'A' | 'B' = 'A') {
  chooseServer(side);
  say('zero zero');
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
    chooseServer();
    const rec = latest();
    expect(rec.started).toBe(true);
    // One phrase per session: Chrome's own continuous mode stopped after the
    // first call on an Android Fold (2026-11-17), so hands-free is a restart.
    expect(rec.continuous).toBe(false);
    expect(rec.lang).toBe('en-US');
    expect(screen.getByText('Listening…')).toBeTruthy();
    expect(screen.getByTestId('voice-hint').textContent).toBe('Say “zero zero” to start the game.');
    say('zero zero');
    expect(screen.getByText('Game on · A side serving')).toBeTruthy();
    // At love all either side's first point is "1 0".
    expect(screen.getByTestId('voice-hint').textContent).toBe('If A side wins, say “1 0”. If B side wins, say “1 0”.');

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
    startByVoice();
    say('fourteen twelve');
    expect(scoreA()).toBe('0');
    expect(scoreB()).toBe('0');
    expect(screen.getByText('Heard 14–12: not one rally on, so not scored')).toBeTruthy();
  });

  it('tries the recogniser\'s other guesses when the first is not a score', () => {
    renderBoard();
    startByVoice();
    say('one love');
    fireEvent.click(screen.getByRole('button', { name: 'B side won' }));
    say('two heaven', 'two love');
    expect(scoreB()).toBe('2');
  });

  it('"Neither" dismisses the question and scores nothing', () => {
    renderBoard();
    startByVoice();
    say('one love');
    fireEvent.click(screen.getByRole('button', { name: 'Neither' }));
    expect(screen.queryByText(/Who won the rally/)).toBeNull();
    expect(scoreA()).toBe('0');
    expect(scoreB()).toBe('0');
  });

  it('keeps scoring call after call, each in a fresh session (the Fold report, 2026-11-17)', () => {
    renderBoard();
    startByVoice();
    const spy = vi.spyOn(Date, 'now');
    let t = Date.now();
    const call = (text: string) => {
      say(text);
      t += 4000; // the phrase took a few seconds: not a quick end
      spy.mockReturnValue(t);
      end();
    };
    spy.mockReturnValue(t);
    call('one love');
    fireEvent.click(screen.getByRole('button', { name: 'A side won' }));
    call('2-0');
    expect(scoreA()).toBe('2');
    call('one two'); // B wins the serve back
    expect(scoreB()).toBe('1');
    call('11'); // "one one" glued by Chrome: at 2–1 that is not one rally on
    expect(scoreB()).toBe('1');
    call('2 all');
    expect(scoreB()).toBe('2');
    spy.mockRestore();
    // A session per call, and the mic is still on.
    expect(FakeRecognition.instances.length).toBe(6);
    expect(screen.getByRole('button', { name: 'Stop listening' })).toBeTruthy();
  });

  it('a session that goes quiet without ending is replaced after the watchdog', () => {
    vi.useFakeTimers();
    try {
      renderBoard();
      chooseServer();
      const hung = latest();
      act(() => {
        vi.advanceTimersByTime(SESSION_WATCHDOG_MS + 10);
      });
      expect(hung.aborted).toBe(true);
      expect(latest()).not.toBe(hung);
      expect(latest().started).toBe(true);
      // The hung session's late end changes nothing.
      act(() => hung.onend?.());
      expect(screen.getByRole('button', { name: 'Stop listening' })).toBeTruthy();
      say('zero zero');
      say('one love');
      expect(screen.getByText('Heard 1–0. Who won the rally?')).toBeTruthy();
    } finally {
      vi.useRealTimers();
    }
  });

  it('hands-free starts again after the silence that ends it, and stops when asked', () => {
    renderBoard();
    chooseServer();
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
    chooseServer();
    end();
    end();
    end();
    expect(screen.getByRole('button', { name: 'Tap, then call the score' })).toBeTruthy();
  });

  it('on an iPhone one tap hears one call', () => {
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1');
    renderBoard();
    chooseServer();
    expect(latest().continuous).toBe(false);
    say('zero zero');
    end();
    // No restart: the next call is the next tap.
    expect(FakeRecognition.instances.length).toBe(1);
    expect(screen.getByRole('button', { name: 'Tap, then call the score' })).toBeTruthy();
  });

  it('a miss shows the words it heard, so the person can see what the phone understood', () => {
    renderBoard();
    startByVoice();
    say('great rally');
    expect(screen.getByText('Heard “great rally”: no score in that')).toBeTruthy();
  });

  it('"10" from Chrome is heard as one love', () => {
    renderBoard();
    startByVoice();
    say('10');
    expect(screen.getByText('Heard 1–0. Who won the rally?')).toBeTruthy();
  });

  it('says how to call the score before the mic is on, and the exact next calls while it listens', () => {
    renderBoard();
    expect(screen.getByTestId('voice-hint').textContent).toMatch(/Pick the serving side/);
    // A tapped point starts the game too: no question, and the mic is offered.
    for (let i = 0; i < 3; i++) fireEvent.click(screen.getByRole('button', { name: '+1 A side' }));
    for (let i = 0; i < 2; i++) fireEvent.click(screen.getByRole('button', { name: '+1 B side' }));
    expect(screen.queryByText('Which side serves first?')).toBeNull();
    expect(screen.getByTestId('voice-hint').textContent).toMatch(/winner's points first: “one zero”/);
    fireEvent.click(screen.getByRole('button', { name: /Listen for the score/ }));
    // 3–2: A winning makes it 4 2; B winning makes it 3 all.
    expect(screen.getByTestId('voice-hint').textContent).toBe('If A side wins, say “4 2”. If B side wins, say “3 all”.');
  });

  it('a blocked microphone says so', () => {
    renderBoard();
    chooseServer();
    act(() => latest().onerror?.({ error: 'not-allowed' }));
    end();
    expect(screen.getByText(/The microphone is blocked/)).toBeTruthy();
  });

  it('the +1 buttons still work, and clear a pending question', () => {
    renderBoard();
    startByVoice();
    say('one love');
    fireEvent.click(screen.getByRole('button', { name: '+1 B side' }));
    expect(screen.queryByText(/Who won the rally/)).toBeNull();
    expect(scoreB()).toBe('1');
  });

  describe('the opening: who serves, then "zero zero" (Grant, 2026-11-27)', () => {
    it('asks which side serves before the mic is offered, and shows the server on the board', () => {
      renderBoard();
      expect(screen.getByText('Which side serves first?')).toBeTruthy();
      expect(screen.queryByRole('button', { name: /Listen for the score/ })).toBeNull();
      chooseServer('B');
      expect(latest().started).toBe(true);
      expect(screen.getByText('B side serving')).toBeTruthy();
      expect(screen.getByRole('button', { name: 'Stop listening' })).toBeTruthy();
    });

    it('nothing scores before "zero zero": another court\'s "one zero" cannot open the game', () => {
      renderBoard();
      chooseServer();
      say('one zero');
      expect(scoreA()).toBe('0');
      expect(screen.queryByText(/Who won the rally/)).toBeNull();
      expect(screen.getByText('Heard “one zero”. Say “zero zero” to start.')).toBeTruthy();
      say('love all');
      expect(screen.getByText('Game on · A side serving')).toBeTruthy();
    });

    it('"service over" at love all is scored without asking: the board knows who served', () => {
      renderBoard();
      startByVoice('A');
      say('service over, one zero');
      expect(scoreB()).toBe('1');
      expect(screen.queryByText(/Who won the rally/)).toBeNull();
    });

    it('a level-score call flashes the whole board and keeps the buttons', () => {
      renderBoard();
      startByVoice();
      const board = screen.getByRole('dialog');
      expect(board.getAttribute('data-ask')).toBe('false');
      say('one zero');
      expect(board.getAttribute('data-ask')).toBe('true');
      expect(screen.getByText('Which side won?')).toBeTruthy();
      fireEvent.click(screen.getByRole('button', { name: 'B side won' }));
      expect(scoreB()).toBe('1');
      expect(board.getAttribute('data-ask')).toBe('false');
    });

    it('New game asks who serves again and turns the mic off until it is answered', () => {
      renderBoard();
      startByVoice();
      say('one zero');
      fireEvent.click(screen.getByRole('button', { name: 'A side won' }));
      fireEvent.click(screen.getByRole('button', { name: 'New game' }));
      expect(latest().aborted).toBe(true);
      expect(screen.getByText('Which side serves first?')).toBeTruthy();
    });
  });
});
