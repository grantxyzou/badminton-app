'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { useBodyScrollLock } from '@/components/BottomSheet/useBodyScrollLock';
import { splitForFold, useFold } from '@/lib/fold';
import StatusBadge from '@/components/primitives/StatusBadge';
import { isFlagOn } from '@/lib/flags';
import { primeHaptics, tapSuccess } from '@/lib/haptics';
import { addPoint, reachedInterval, scoreState, serving, type Score, type Side } from '@/lib/scoreRules';
import { useVoiceScore, type VoiceProblem } from '@/lib/useVoiceScore';
import { heardText, matchCall, type Heard, type ParsedCall } from '@/lib/voiceScore';

/**
 * The courtside scoreboard (docs/plans/foldable-layout.md, step 3). Prop the
 * phone half-open on the bench like a laptop: the upright half shows the
 * score, big enough to read from the court; the half lying flat holds the
 * +1 buttons for whoever is sitting out. Folded like a book, the score is on
 * the left and the buttons on the right.
 *
 * The split is the FOLD, read live through `lib/fold.ts` (the store app's
 * plugin, or the web's posture API); when no source can say, the screen's
 * centre, which is where every fold is — so on a flat phone this is still a
 * perfectly usable scoreboard, with the score above the buttons.
 *
 * The rules are `lib/scoreRules.ts`, the umpire's: game point, "20 all",
 * "29 all · next point wins", the interval at 11, the server as whoever won
 * the last rally. The game lives on the phone and touches the server only
 * when Save game hands it to Add a game (`YourRecordCard`), prefilled — Swap
 * sides is there, because the scoreboard cannot know which side was yours.
 *
 * A fixed, portaled overlay (like a sheet): the split is measured against
 * the viewport, so it cannot sit inside the tab's scrolling column.
 *
 * VOICE (Preview, `NEXT_PUBLIC_FLAG_VOICE_SCORE`, docs/plans/voice-score.md):
 * a mic above the +1 buttons listens for the umpire's call and scores a rally
 * only when the call is exactly one rally on (`lib/voiceScore.ts`), so another
 * court's call is shown as heard and never scored. At a level score the words
 * cannot say who won, so the board asks. The mic is offered only where the
 * browser has a recogniser (`lib/useVoiceScore.ts`): never in the store app.
 */
interface Props {
  open: boolean;
  onClose: () => void;
  /** Null when there is no session to log into — Save explains, instead of a dead button. */
  onSave: ((score: Score) => void) | null;
}

const INTERVAL_SHOWN_MS = 4000;

function useViewportSize(): { width: number; height: number } {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const read = () => setSize({ width: window.innerWidth, height: window.innerHeight });
    read();
    window.addEventListener('resize', read);
    return () => window.removeEventListener('resize', read);
  }, []);
  return size;
}

/** Keep the screen on while the board is up: a bench phone goes dark in a minute otherwise. */
function useWakeLock(active: boolean): void {
  useEffect(() => {
    if (!active) return;
    let lock: { release: () => Promise<void> } | null = null;
    let cancelled = false;
    const request = async () => {
      try {
        const wl = (navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } }).wakeLock;
        if (!wl) return;
        const l = await wl.request('screen');
        if (cancelled) void l.release();
        else lock = l;
      } catch {
        /* denied or unsupported: the board still works, the screen just dims */
      }
    };
    const onVisible = () => {
      if (document.visibilityState === 'visible') void request();
    };
    void request();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      cancelled = true;
      document.removeEventListener('visibilitychange', onVisible);
      if (lock) void lock.release();
    };
  }, [active]);
}

export default function CourtsideScoreboard({ open, onClose, onSave }: Props) {
  const t = useTranslations('stats.courtside');
  const [points, setPoints] = useState<Side[]>([]);
  const [interval, setInterval_] = useState(false);
  const intervalTimer = useRef<number | null>(null);
  const fold = useFold();
  const viewport = useViewportSize();
  const gridRef = useRef<HTMLDivElement | null>(null);
  const voiceFlag = isFlagOn('NEXT_PUBLIC_FLAG_VOICE_SCORE');
  /** The last thing the mic made of a call, shown under it. */
  const [heard, setHeard] = useState<string | null>(null);
  /** A level-score call either side could have won: the board asks. */
  const [ask, setAsk] = useState<Heard | null>(null);

  useBodyScrollLock(open);
  useWakeLock(open);

  const score: Score = {
    a: points.filter((p) => p === 'a').length,
    b: points.filter((p) => p === 'b').length,
  };
  const state = scoreState(score);
  const server = serving(points);

  const clearInterval_ = useCallback(() => {
    if (intervalTimer.current !== null) window.clearTimeout(intervalTimer.current);
    intervalTimer.current = null;
    setInterval_(false);
  }, []);

  const point = (side: Side) => {
    setAsk(null);
    if (state.over) return;
    const next = addPoint(score, side);
    setPoints((prev) => [...prev, side]);
    // One light tap under the finger, in the store app only (lib/haptics.ts):
    // on a bench the eyes are on the court, not the phone.
    tapSuccess();
    clearInterval_();
    if (reachedInterval(score, next)) {
      setInterval_(true);
      intervalTimer.current = window.setTimeout(() => setInterval_(false), INTERVAL_SHOWN_MS);
    }
  };
  const undo = () => {
    clearInterval_();
    setAsk(null);
    setHeard(null);
    setPoints((prev) => prev.slice(0, -1));
  };
  const newGame = () => {
    clearInterval_();
    setAsk(null);
    setHeard(null);
    setPoints([]);
  };

  useEffect(() => () => clearInterval_(), [clearInterval_]);

  const sideOf = (s: Side) => (s === 'a' ? t('sideA') : t('sideB'));
  const onCalls = (calls: ParsedCall[]) => {
    const m = matchCall(score, server, calls);
    if (m.kind === 'point') {
      point(m.side);
      setHeard(t('voice.heardPoint', { score: heardText(m.heard), side: sideOf(m.side) }));
    } else if (m.kind === 'ask') {
      setAsk(m.heard);
      setHeard(null);
    } else if (m.kind === 'ignored') {
      setHeard(t('voice.heardIgnored', { score: heardText(m.heard) }));
    } else if (m.kind === 'none') {
      setHeard(t('voice.heardNone'));
    }
    // 'same' (the board's own score repeated) and 'over' change nothing.
  };
  const voice = useVoiceScore({ enabled: open && voiceFlag, onCalls });
  const { stop: stopVoice } = voice;
  // A finished game has nothing left to hear.
  useEffect(() => {
    if (state.over) stopVoice();
  }, [state.over, stopVoice]);
  useEffect(() => {
    if (!open) {
      setAsk(null);
      setHeard(null);
    }
  }, [open]);

  // The split: the fold's rectangle when known, else the centre. Set on the
  // element rather than as inline style values so the measured pixels never
  // read as hand-typed spacing. `open` is a dependency on purpose: the board
  // usually opens AFTER the viewport and the fold are known, so the split
  // has not changed since the last render — and without it the element that
  // just mounted got the CSS fallback halves, never the fold (found on screen,
  // 2026-11-04: computed rows read 500/0/500 against an injected 488/24/488).
  const split = splitForFold(fold, viewport.width, viewport.height);
  useEffect(() => {
    const el = gridRef.current;
    if (!open || !el) return;
    el.style.setProperty('--court-first', `${split.first}px`);
    el.style.setProperty('--court-gap', `${split.gap}px`);
    el.style.setProperty('--court-second', `${split.second}px`);
  }, [open, split.first, split.gap, split.second]);

  useEffect(() => {
    if (!open) return;
    // Fetch the haptics chunk while the board opens, so the first +1 buzzes
    // on time (the shell loads the live site; the first import is a download).
    primeHaptics();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open || typeof document === 'undefined') return null;

  const sideName = sideOf;
  const problemText = (p: VoiceProblem) =>
    p === 'denied' ? t('voice.denied') : p === 'network' ? t('voice.network') : t('voice.failed');
  const voiceLine = voice.problem
    ? problemText(voice.problem)
    : (heard ?? (voice.listening ? t('voice.listening') : ''));
  const status = state.over
    ? t('gameOver', { side: sideName(state.winner as Side) })
    : interval
      ? t('interval')
      : state.nextPointWins
        ? t('nextPointWins')
        : state.allAt !== null
          ? t('all', { n: state.allAt })
          : state.gamePoint
            ? t('gamePoint', { side: sideName(state.gamePoint) })
            : server
              ? t('serving', { side: sideName(server) })
              : t('hint');

  return createPortal(
    <div
      ref={gridRef}
      role="dialog"
      aria-modal="true"
      aria-label={t('title')}
      className="courtside motion-fade"
      data-axis={split.axis}
      data-posture={fold.posture ?? 'unknown'}
      style={{ zIndex: 60 }}
    >
      {/* The half that faces the court. */}
      <section className="courtside-board" aria-live="polite">
        <div className="courtside-sides">
          {(['a', 'b'] as const).map((s) => (
            <div key={s} className="courtside-side" data-serving={server === s} data-winner={state.winner === s}>
              <span className="courtside-side-label">{sideName(s)}</span>
              {/* Keyed on the value: a new number fades in (the Appear
                  recipe) rather than flicking — content arriving into a
                  surface already on screen. */}
              <span key={score[s]} className="courtside-digit motion-fade" data-testid={`score-${s}`}>{score[s]}</span>
            </div>
          ))}
        </div>
        {/* Keyed on its text, so each new line fades in. The game ending is
            the board's one consequential moment, so that line alone takes
            `.status-celebrate` (check-in saved, session created, a game won). */}
        <p
          key={status}
          className={state.over ? 'courtside-status status-celebrate' : 'courtside-status motion-fade'}
          data-interval={interval}
          data-over={state.over}
        >
          {status}
        </p>
      </section>

      {/* The fold. Empty on purpose: nothing may sit on it. */}
      <div className="courtside-fold" aria-hidden="true" />

      {/* The half in the hand, or on the bench. */}
      <section className="courtside-controls">
        {voiceFlag && voice.supported && (
          <div className="courtside-voice">
            <div className="courtside-voice-row">
              <button
                type="button"
                className="courtside-voice-btn"
                data-listening={voice.listening}
                aria-pressed={voice.listening}
                disabled={state.over}
                onClick={voice.listening ? voice.stop : voice.start}
              >
                <span className="courtside-voice-dot" aria-hidden="true" />
                {voice.listening ? t('voice.stop') : voice.mode === 'tap' ? t('voice.tap') : t('voice.listen')}
              </button>
              <StatusBadge variant="accent">{t('voice.preview')}</StatusBadge>
            </div>
            {ask ? (
              <div className="courtside-voice-ask" role="group" aria-label={t('voice.askTitle', { score: heardText(ask) })}>
                <p className="courtside-voice-line">{t('voice.askTitle', { score: heardText(ask) })}</p>
                <div className="courtside-voice-choices">
                  {(['a', 'b'] as const).map((s) => (
                    <button key={s} type="button" className="cc-btn cc-btn-primary" onClick={() => point(s)}>
                      {t('voice.askSide', { side: sideName(s) })}
                    </button>
                  ))}
                  <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setAsk(null)}>
                    {t('voice.askNeither')}
                  </button>
                </div>
              </div>
            ) : (
              <p key={voiceLine} className="courtside-voice-line motion-fade" role="status" aria-live="polite">
                {voiceLine}
              </p>
            )}
          </div>
        )}
        <div className="courtside-points">
          {(['a', 'b'] as const).map((s) => (
            <button
              key={s}
              type="button"
              className="courtside-point"
              disabled={state.over}
              onClick={() => point(s)}
              aria-label={t('point', { side: sideName(s) })}
            >
              <span className="courtside-point-label">{t('point', { side: sideName(s) })}</span>
              <span className="courtside-point-score">{score[s]}</span>
            </button>
          ))}
        </div>
        <div className="courtside-actions">
          <button type="button" className="cc-btn cc-btn-ghost" onClick={undo} disabled={points.length === 0}>
            {t('undo')}
          </button>
          <button type="button" className="cc-btn cc-btn-ghost" onClick={newGame} disabled={points.length === 0}>
            {t('newGame')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-primary"
            disabled={!onSave || points.length === 0}
            title={onSave ? undefined : t('saveNeedsSession')}
            onClick={() => onSave?.(score)}
          >
            {t('save')}
          </button>
          <button type="button" className="cc-btn cc-btn-ghost" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        {!onSave && <p className="courtside-note">{t('saveNeedsSession')}</p>}
      </section>
    </div>,
    document.body,
  );
}
