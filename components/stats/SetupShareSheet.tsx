'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '../BottomSheet';
import { racketLook, racketSrc } from '@/lib/racketLook';
import { hasItemLook, modelInputs } from '@/lib/racketCustom';
import type { ItemLook } from '@/lib/types';
import { shareOrSaveImage } from '@/lib/shareImage';
import { recordEngagement } from '@/lib/engagement';
import { drawSetupShareCanvas, type ShareCanvasContent } from '@/lib/setupShareCanvas';
import { shareCardText, stringsFact, tensionFact, type ShareCard } from '@/lib/shareCard';
import type { SetupShare } from '@/lib/gearSetup';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface SetupShareSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the card already knows locally. Shown if the server's facts cannot
   *  be read, so the sheet still works — with only the gear lines. */
  share: SetupShare;
  /** The racket in play's catalog id, for its drawing. */
  racketCatalogId?: string | null;
  /** The member's string and wrap colours (and a typed racket's paint). When
   *  set, the card draws a still of the 3D model in those colours instead of
   *  the catalog pre-render. */
  racketItemLook?: ItemLook;
}

/** The card with nothing the server would have added: every club and history
 *  line dropped, the gear lines kept. Never zeros. */
function localCard(share: SetupShare): ShareCard {
  const name = share.name.trim();
  return {
    name, initial: name.charAt(0).toUpperCase(), sinceYear: null, clubName: null,
    racket: share.racket ? { name: share.racket, brand: null, weight: null, balance: null } : null,
    restrings: null, tensionVsClub: null, string: share.string, tensionLbs: share.tensionLbs, crosses: share.crosses ?? null, grip: null, clubCount: null,
  };
}

/**
 * "Answer 'what are you playing?'" (claude.ai/design "Equipment redesign",
 * screen 07, reworked). Identity and club-relative facts lead; specs support.
 *
 * Every number is server-derived (`GET /api/equipment/share-card`, built by
 * `lib/shareCard.ts`), and a fact the server cannot honestly state is null and
 * its line is dropped. What gets shared is shown before it leaves: the preview
 * IS the exported PNG (the `ReceiptSheet` callback-ref pattern), and "Copy as
 * text" says the same facts, one per line.
 */
export default function SetupShareSheet({ open, onClose, share, racketCatalogId, racketItemLook }: SetupShareSheetProps) {
  const t = useTranslations('stats.gear.setup');
  const tRecovery = useTranslations('recovery');
  const locale = useLocale();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [card, setCard] = useState<ShareCard | null>(null);
  const [png, setPng] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saveHint, setSaveHint] = useState(false);
  /** The racket picture: the catalog pre-render, or a still of the model in the
   *  member's own colours once it has rendered. */
  const [racketImage, setRacketImage] = useState(() => racketSrc(racketCatalogId));

  useEffect(() => {
    if (!hasItemLook(racketItemLook)) return;
    let live = true;
    const { look, tweaks } = modelInputs(racketLook(racketCatalogId), racketItemLook);
    import('@/lib/racketSnapshot')
      .then(({ racketSnapshot }) => racketSnapshot(look, tweaks))
      .then((url) => { if (live && url) setRacketImage(url); })
      .catch(() => { /* the pre-render stays */ });
    return () => { live = false; };
    // Once per opening: the sheet remounts on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/api/equipment/share-card?name=${encodeURIComponent(share.name)}`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (live) setCard((d?.card as ShareCard) ?? localCard(share)); })
      .catch(() => { if (live) setCard(localCard(share)); });
    return () => { live = false; };
    // Read once per opening; the sheet remounts on each open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const monthYear = useCallback((iso: string) => {
    try {
      return new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(new Date(iso));
    } catch {
      return iso.slice(0, 7);
    }
  }, [locale]);

  const club = card?.clubName ?? null;
  const content = useMemo<ShareCanvasContent | null>(() => {
    if (!card) return null;
    const stats: ShareCanvasContent['stats'] = [];
    if (card.restrings) stats.push({ num: String(card.restrings.count), text: t('statRestrings', { count: card.restrings.count, since: monthYear(card.restrings.since) }) });
    if (card.tensionVsClub !== null) stats.push({ num: `${card.tensionVsClub > 0 ? '+' : ''}${card.tensionVsClub}`, text: t('statVsClub') });
    const facts: ShareCanvasContent['facts'] = [];
    const strings = stringsFact(card);
    const tension = tensionFact(card);
    if (strings) facts.push({ label: t('factStrings'), value: strings });
    if (tension) facts.push({ label: t('factTension'), value: tension, unit: t('lbUnit') });
    if (card.grip) facts.push({ label: t('factGrip'), value: card.grip });
    if (card.clubCount !== null) facts.push({ label: club ? t('factAtClub', { club }) : t('factInClub'), value: t('factOneOf', { count: card.clubCount }) });
    const specs = card.racket
      ? [card.racket.brand, card.racket.weight, card.racket.balance ? t('specBalance', { balance: card.racket.balance.toLowerCase() }) : null].filter(Boolean).join(' · ') || null
      : null;
    return {
      initial: card.initial,
      name: card.name,
      since: card.sinceYear !== null ? (club ? t('shareSinceClub', { club, year: card.sinceYear }) : t('shareSince', { year: card.sinceYear })) : null,
      racketName: card.racket?.name ?? null,
      specs,
      stats,
      facts,
    };
  }, [card, club, monthYear, t]);

  const text = useMemo(() => (card ? shareCardText(card, {
    title: t('shareTextTitle', { name: card.name }),
    since: (year) => (club ? t('shareSinceClub', { club, year }) : t('shareSince', { year })),
    restrings: (count, since) => `${count} ${t('statRestrings', { count, since: monthYear(since) })}`,
    vsClub: (delta) => `${delta > 0 ? '+' : ''}${delta} ${t('statVsClub')}`,
    of: (count) => t('factOneOf', { count }),
    racket: t('factRacket'),
    strings: t('factStrings'),
    tension: t('factTension'),
    grip: t('factGrip'),
    atClub: club ? t('factAtClub', { club }) : t('factInClub'),
    lb: t('lbUnit'),
    footer: t('shareTextFooter'),
  }) : ''), [card, club, monthYear, t]);

  const drawCanvas = useCallback((canvas: HTMLCanvasElement | null) => {
    canvasRef.current = canvas;
    if (!canvas || !content) return;
    const img = new Image();
    const paint = () => { if (canvasRef.current === canvas) setPng(drawSetupShareCanvas(canvas, content, img)); };
    // Draw at once without the racket, then again when it (and the fonts) land.
    setPng(drawSetupShareCanvas(canvas, content, null));
    img.onload = () => {
      const fonts = (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
      fonts.then(paint).catch(paint);
    };
    img.src = racketImage;
  }, [content, racketImage]);

  async function saveImage() {
    setError(null);
    setSaveHint(false);
    const outcome = await shareOrSaveImage(canvasRef.current, 'bpm-set-up.png');
    if (outcome.kind === 'error') setError(t('shareError'));
    else {
      recordEngagement('share_card_exported');
      if (outcome.kind === 'manual-save') setSaveHint(true);
    }
  }

  async function copyText() {
    setError(null);
    try {
      await navigator.clipboard.writeText(text);
      recordEngagement('share_card_exported');
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      setError(t('copyError'));
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('shareTitle')}>
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
          {content && <canvas key={`${JSON.stringify(content)}|${racketImage.length}`} ref={drawCanvas} aria-hidden="true" style={{ display: 'none' }} />}
          {png ? (
            // eslint-disable-next-line @next/next/no-img-element -- a data: URL from the canvas above; next/image cannot optimise it and must not try.
            <img src={png} alt={text} className="setup-share-preview" />
          ) : (
            <div role="status" aria-label={t('shareTitle')} className="setup-share-preview setup-share-preview--pending" />
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
          <button type="button" className="btn-ghost" style={{ flex: 1 }} onClick={() => { void copyText(); }} disabled={!card}>
            {copied ? t('copied') : t('copyText')}
          </button>
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
