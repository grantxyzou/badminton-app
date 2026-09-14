'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '../BottomSheet';
import { RACKET_STANDIN_SRC } from './RacketThumb';
import { shareOrSaveImage } from '@/lib/shareImage';
import { drawSetupShareCanvas } from '@/lib/setupShareCanvas';
import { setupShareText, type SetupShare } from '@/lib/gearSetup';

export interface SetupShareSheetProps {
  open: boolean;
  onClose: () => void;
  /** Gear only, by type — see `SetupShare`. */
  share: SetupShare;
}

/**
 * "Share your set-up" (claude.ai/design "Equipment redesign", screen 07).
 *
 * What gets shared is shown before it leaves, and it is gear only: the card
 * and the text are built from a `SetupShare`, which has no field for a level,
 * a game or a kudos. Saying so on the sheet is a promise the type keeps.
 *
 * The preview IS the exported PNG once it exists — the `ReceiptSheet` pattern:
 * the canvas is drawn from a callback ref the moment it mounts (a passive
 * effect raced the ref and left a blank preview there), and the image is what
 * iOS offers "Save to Photos" on when a programmatic save is not possible.
 * `shareOrSaveImage` marks the external excursion before any hand-off.
 */
export default function SetupShareSheet({ open, onClose, share }: SetupShareSheetProps) {
  const t = useTranslations('stats.gear.setup');
  const tGear = useTranslations('stats.gear');
  const tRecovery = useTranslations('recovery');
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [png, setPng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveHint, setSaveHint] = useState(false);

  const title = t('shareCardTitle', { name: share.name });
  const labels = useMemo(
    () => ({ title, racket: tGear('catRacket'), string: tGear('catString'), lb: tGear('lb') }),
    [title, tGear],
  );
  const text = setupShareText(share, { ...labels, footer: t('shareTextFooter') });

  const drawCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (!canvas) return;
    const img = new Image();
    const paint = () => { if (canvasRef.current === canvas) setPng(drawSetupShareCanvas(canvas, share, labels, img)); };
    // Draw at once without the racket, then again when it (and the fonts) land.
    setPng(drawSetupShareCanvas(canvas, share, labels, null));
    img.onload = () => {
      const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
      fonts.then(paint).catch(paint);
    };
    img.src = RACKET_STANDIN_SRC;
  }, [share, labels]);

  async function saveImage() {
    setError(null);
    setSaveHint(false);
    const outcome = await shareOrSaveImage(canvasRef.current, 'bpm-set-up.png');
    if (outcome.kind === 'error') setError(t('shareError'));
    else if (outcome.kind === 'manual-save') setSaveHint(true);
  }

  async function copyText() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('copyError'));
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('shareTitle')} maxHeight="88dvh">
      <BottomSheetHeader>
        <span className="fs-stat" style={{ fontFamily: 'var(--font-display)', fontWeight: 700, letterSpacing: '-0.015em' }}>
          {t('shareTitle')}
        </span>
        <button
          type="button"
          onClick={onClose}
          aria-label={tRecovery('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <canvas ref={drawCanvas} aria-hidden="true" style={{ display: 'none' }} />
          {png ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL from the canvas above; next/image cannot optimise it and must not try.
            <img src={png} alt={text} className="setup-share-preview" />
          ) : (
            <div role="status" aria-label={title} className="setup-share-preview setup-share-preview--pending" />
          )}
          {saveHint && <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('saveHint')}</p>}
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>{t('shareNote')}</p>
          {error && <ErrorState message={error} />}
        </div>
      </BottomSheetBody>

      <BottomSheetFooter>
        <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
          <button type="button" className="btn-primary" style={{ flex: 1 }} onClick={() => { void saveImage(); }} disabled={!png}>
            {t('saveImage')}
          </button>
          <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => { void copyText(); }}>
            {copied ? t('copied') : t('copyText')}
          </button>
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
