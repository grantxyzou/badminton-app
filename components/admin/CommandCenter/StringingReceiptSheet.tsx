'use client';

import { useCallback, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import {
  renderStringingReceiptCanvas,
  stringingReceiptText,
  type StringingReceiptInput,
} from '@/lib/receiptTemplate';
import { shareOrSaveImage, saveImage, type ShareImageOutcome } from '@/lib/shareImage';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import { formatReadyBy } from '@/lib/stringingDue';
import { fmtMoney } from '@/lib/fmt';
import { APP_NAME } from '@/lib/brand';
import type { StringingJob } from '@/lib/types';

type T = ReturnType<typeof useTranslations>;

/**
 * What the walk-up's receipt says (job page canvas frame, 2026-11-12). Pure
 * apart from `t`, so the words are tested without a canvas.
 *
 * It names the person and the job and NEVER the contact: the image leaves the
 * app, and the stringer is the one choosing where it goes.
 */
export function buildStringingReceipt(job: StringingJob, clubName: string, t: T, locale: string): StringingReceiptInput {
  const dropped = job.history.find((h) => h.status === 'received')?.at ?? job.createdAt;
  const droppedOn = (() => {
    try {
      return new Date(dropped).toLocaleDateString(locale, {
        timeZone: 'America/Vancouver',
        weekday: 'short',
        month: 'short',
        day: 'numeric',
      });
    } catch {
      return dropped.slice(0, 10);
    }
  })();
  const rows: StringingReceiptInput['rows'] = [
    { label: t('walkUp.receipt.racket'), value: job.racketLabel },
    { label: t('walkUp.receipt.string'), value: job.stringColor ? `${job.stringLabel} · ${job.stringColor}` : job.stringLabel },
    {
      label: t('walkUp.receipt.tension'),
      value: t('walkUp.receipt.tensionValue', { mains: job.tensionMains, crosses: job.tensionCrosses }),
    },
    ...(job.readyBy
      ? [{ label: t('walkUp.receipt.readyBy'), value: formatReadyBy(job.readyBy, locale) ?? job.readyBy }]
      : []),
    { label: t('walkUp.receipt.droppedOff'), value: droppedOn },
  ];
  return {
    clubName,
    title: t('walkUp.receipt.heading'),
    jobNo: job.jobNo,
    forLine: t('walkUp.receipt.for', { name: job.memberName }),
    rows,
    totalLabel: t('walkUp.receipt.total'),
    total: typeof job.priceCents === 'number' ? fmtMoney(job.priceCents / 100) : t('walkUp.receipt.ask'),
    note: job.paidAt ? t('walkUp.receipt.paid') : t('walkUp.receipt.payAtPickup'),
  };
}

interface Props {
  open: boolean;
  onClose: () => void;
  job: StringingJob;
}

/**
 * "Receipt for {name}": the walk-up's job as an image to text, AirDrop or save
 * (docs/plans/stringing-walk-ups.md, 2026-11-12). Built like the session
 * receipt (`ReceiptSheet`): the canvas is drawn from a CALLBACK REF the instant
 * it mounts and shown as an exported PNG, never read from a passive effect
 * (that raced the ref and left a blank preview). Both buttons go through
 * `lib/shareImage.ts`, which marks the external excursion before any hand-off
 * (app-shell.md) and never completes silently.
 */
export default function StringingReceiptSheet({ open, onClose, job }: Props) {
  const t = useTranslations('admin.stringing');
  const ta = useTranslations('a11y');
  const locale = useLocale();
  const { group } = useCurrentGroup();
  const clubName = group?.name?.trim() || APP_NAME;
  const input = useMemo(() => buildStringingReceipt(job, clubName, t, locale), [job, clubName, t, locale]);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [imageDataUrl, setImageDataUrl] = useState('');
  const [actionError, setActionError] = useState<string | null>(null);
  const [saveHint, setSaveHint] = useState(false);
  const [busy, setBusy] = useState(false);

  // Reset the per-open messages during render, as ReceiptSheet does.
  const [prevOpen, setPrevOpen] = useState(open);
  if (prevOpen !== open) {
    setPrevOpen(open);
    if (open) {
      setActionError(null);
      setSaveHint(false);
    }
  }

  const drawCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (!canvas) return;
    setImageDataUrl(renderStringingReceiptCanvas(input, canvas));
    // Redraw in the design faces once they have landed.
    const fontsReady = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready
      ?? Promise.resolve();
    fontsReady.then(() => {
      if (canvasRef.current === canvas) setImageDataUrl(renderStringingReceiptCanvas(input, canvas));
    }).catch(() => {});
  }, [input]);

  async function run(action: (c: HTMLCanvasElement | null, name: string) => Promise<ShareImageOutcome>) {
    if (busy) return;
    setBusy(true);
    setActionError(null);
    setSaveHint(false);
    try {
      const outcome = await action(canvasRef.current, `receipt-${job.jobNo}.png`);
      if (outcome.kind === 'error') setActionError(outcome.message);
      else if (outcome.kind === 'manual-save') setSaveHint(true);
    } finally {
      setBusy(false);
    }
  }

  const title = t('walkUp.receipt.title', { name: job.memberName });

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={title}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('walkUp.receipt.close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{title}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 'var(--space-3)' }}>
          {/* The generator: drawn to, then exported as the PNG below. */}
          <canvas ref={drawCanvas} aria-hidden="true" style={{ display: 'none' }} />
          {imageDataUrl ? (
            // A data: URL drawn on this page; next/image has nothing to optimise.
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={imageDataUrl}
              alt={stringingReceiptText(input)}
              style={{ width: '100%', maxWidth: 320, height: 'auto', display: 'block' }}
            />
          ) : (
            <div
              role="status"
              aria-label={ta('loading')}
              className="shimmer-line"
              style={{ width: '100%', maxWidth: 320, aspectRatio: '390 / 470', borderRadius: 'var(--radius-lg)' }}
            />
          )}
          {saveHint && (
            <p role="status" className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0', textAlign: 'center', maxWidth: 320 }}>
              {t('walkUp.receipt.saveHint')}
            </p>
          )}
        </div>
      </BottomSheetBody>
      <BottomSheetFooter className="flex flex-col gap-3">
        {actionError && (
          <p role="alert" className="field-error" style={{ margin: '0' }}>
            {actionError}
          </p>
        )}
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            type="button"
            className="cc-btn cc-btn-secondary"
            style={{ flex: 1 }}
            disabled={!imageDataUrl || busy}
            onClick={() => void run(saveImage)}
          >
            {t('walkUp.receipt.save')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-primary"
            style={{ flex: 1 }}
            disabled={!imageDataUrl || busy}
            onClick={() => void run(shareOrSaveImage)}
          >
            {t('walkUp.receipt.share')}
          </button>
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
