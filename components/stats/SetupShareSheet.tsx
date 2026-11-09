'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter, SheetCloseButton } from '../BottomSheet';
import { racketHeadSrc } from '@/lib/racketLook';
import { STOCK_STRING } from '@/lib/racketCustom';
import type { ItemLook } from '@/lib/types';
import { stringPackSrc } from '@/lib/stringPackSrc';
import { indexCatalog, stringSpecLine } from '@/lib/gearSetup';
import { useCatalog } from './useCatalog';
import { shareOrSaveImage } from '@/lib/shareImage';
import { recordEngagement } from '@/lib/engagement';
import { drawSetupShareCanvas, type ShareCanvasContent } from '@/lib/setupShareCanvas';
import { shareCardText, type ShareCard, type ShareString } from '@/lib/shareCard';
import type { SetupShare } from '@/lib/gearSetup';

const LOGO_SRC = `${process.env.NEXT_PUBLIC_BASE_PATH ?? ''}/brand/bpm-trajectory.png`;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface SetupShareSheetProps {
  open: boolean;
  onClose: () => void;
  /** What the card already knows locally. Shown if the server's facts cannot
   *  be read, so the sheet still works — with only the gear lines. */
  share: SetupShare;
  /** The racket in play's catalog id, for its drawing. */
  racketCatalogId?: string | null;
  /** The member's string colour: each packet's string is drawn in it, as the
   *  Equipment card draws it. */
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
    strings: share.string
      ? [
        { role: share.crosses ? 'mains' : null, catalogId: null, label: share.string, tensionLbs: share.tensionLbs },
        ...(share.crosses ? [{ role: 'crosses' as const, catalogId: null, label: share.crosses.name, tensionLbs: share.crosses.tensionLbs }] : []),
      ]
      : [],
  };
}

/** A card read from before the strings list existed carries only names. */
function stringsOf(card: ShareCard): ShareString[] {
  if (card.strings) return card.strings;
  if (!card.string) return [];
  return [
    { role: card.crosses ? 'mains' : null, catalogId: null, label: card.string, tensionLbs: card.tensionLbs },
    ...(card.crosses ? [{ role: 'crosses' as const, catalogId: null, label: card.crosses.name, tensionLbs: card.crosses.tensionLbs }] : []),
  ];
}

/**
 * "Answer 'what are you playing?'" (claude.ai/design "Equipment redesign",
 * screen 07, reworked). Since 2026-11-05 the image mirrors the Equipment card
 * (`lib/setupShareCanvas.ts`). Identity and club-relative facts lead; specs support.
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
  const strings = useCatalog('string');
  const stringRows = useMemo(() => indexCatalog(strings.items), [strings.items]);
  const coil = racketItemLook?.string ?? STOCK_STRING;
  /** Each catalog string's packet, drawn from its spec with the racket's own
   *  string colour (the packet table is loaded only here, on demand). */
  const [packets, setPackets] = useState<Record<string, HTMLCanvasElement>>({});

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
  const rows = useMemo(() => (card ? stringsOf(card) : []), [card]);

  useEffect(() => {
    const ids = rows.map((r) => r.catalogId).filter((id): id is string => !!id && !!stringPackSrc(id));
    if (ids.length === 0) return;
    let live = true;
    void Promise.all([import('@/lib/stringPacks'), import('@/lib/stringPack')]).then(([{ STRING_PACKS }, { drawStringPack }]) => {
      const out: Record<string, HTMLCanvasElement> = {};
      for (const id of ids) {
        const pack = STRING_PACKS[id];
        if (!pack) continue;
        const cv = document.createElement('canvas');
        cv.width = 240;
        cv.height = 336;
        const ctx = cv.getContext('2d');
        if (!ctx) continue;
        drawStringPack(ctx, pack.coil ? { ...pack, coil: { ...pack.coil, colour: coil } } : pack, cv.width, cv.height);
        out[id] = cv;
      }
      if (live) setPackets(out);
    }).catch(() => { /* rows without packets */ });
    return () => { live = false; };
  }, [rows, coil]);

  const content = useMemo<ShareCanvasContent | null>(() => {
    if (!card) return null;
    const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');
    const racket = card.racket
      ? {
        // The card's own words: the bag's full name, its role first under it.
        name: card.racket.label ?? [card.racket.brand, card.racket.name].filter(Boolean).join(' '),
        sub: join(t('mainRacket'), card.racket.weight, card.racket.balance?.toLowerCase()),
      }
      : null;
    const lines = rows.map((r) => ({
      packet: r.catalogId ? packets[r.catalogId] ?? null : null,
      name: r.label,
      sub: join(r.role ? t(r.role) : t('factStrings'), r.catalogId ? stringSpecLine(stringRows.get(r.catalogId), (k) => t(k)) : null),
      lbs: r.tensionLbs,
    }));
    // The story keeps one line on its bottom edge (Grant: "it's so busy",
    // "take out the grip"); the grip, the restrings, the club comparison and
    // the "1 of N" stay in the copied text.
    const footer = card.sinceYear !== null
      ? (club ? t('shareSinceClub', { club, year: card.sinceYear }) : t('shareSince', { year: card.sinceYear }))
      : null;
    return {
      eyebrow: t('eyebrow'),
      name: card.name,
      racket,
      strings: lines,
      footer,
      lbUnit: t('lbUnit'),
    };
  }, [card, club, t, rows, packets, stringRows]);

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
    // Asked with CORS: the racket picture may come from the storage container
    // (`lib/assetUrl.ts`), and a canvas that draws a cross-origin picture
    // without it can no longer be exported. Harmless on the same origin.
    img.crossOrigin = 'anonymous';
    const logo = new Image();
    let headIn = false;
    let logoIn = false;
    const paint = () => {
      if (canvasRef.current === canvas) setPng(drawSetupShareCanvas(canvas, content, headIn ? img : null, logoIn ? logo : null));
    };
    const fonts = () => (document as Document & { fonts?: { ready: Promise<unknown> } }).fonts?.ready ?? Promise.resolve();
    // Draw at once without the pictures, then again as each (and the fonts) lands.
    setPng(drawSetupShareCanvas(canvas, content, null, null));
    img.onload = () => { headIn = true; fonts().then(paint).catch(paint); };
    logo.onload = () => { logoIn = true; fonts().then(paint).catch(paint); };
    // The card's own close-up of the racket head, as the Equipment card draws it.
    img.src = racketHeadSrc(racketCatalogId);
    // The app icon's mark, for the bottom-right corner.
    logo.src = LOGO_SRC;
  }, [content, racketCatalogId]);

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
        <SheetCloseButton onClose={onClose} label={tRecovery('close')} />
      </BottomSheetHeader>

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {content && <canvas key={`${JSON.stringify(card)}|${Object.keys(packets).join(',')}|${stringRows.size}`} ref={drawCanvas} aria-hidden="true" style={{ display: 'none' }} />}
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
