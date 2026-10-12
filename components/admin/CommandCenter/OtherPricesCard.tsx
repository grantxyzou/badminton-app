'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useOnline } from '@/lib/useOnline';
import { formatServicePrice, type ServicePrice } from '@/lib/stringingRateCard';
import { parsePrice, priceDraftOf } from '@/lib/shelfEdit';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const MAX_NOTE = 140;

interface Pricing {
  services: ServicePrice[];
  ownStringCents: number | null;
  note: string;
}

/**
 * What is left of the rate card once each string carries its own restring
 * price (docs/plans/bench-redesign.md, Grant's call 2026-10-12): the price of
 * a restring with the player's OWN string, and a note players read under the
 * prices. The old per-service list is still stored (rollback) but no player
 * sees it; while it holds lines this card says so, once, with a way to clear
 * it, so a price that quietly stopped showing is never a surprise.
 */
export default function OtherPricesCard() {
  const t = useTranslations('admin.stringing.otherPrices');
  const tRoot = useTranslations('admin.stringing');
  const online = useOnline();
  const [pricing, setPricing] = useState<Pricing | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [own, setOwn] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setLoadError(false);
    fetch(`${BASE}/api/stringing/pricing`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        // `services: null` is the route's "unknown", never an empty card.
        if (!Array.isArray(d?.services)) throw new Error('unknown');
        const p: Pricing = { services: d.services, ownStringCents: d.ownStringCents ?? null, note: d.note ?? '' };
        setPricing(p);
        setOwn(priceDraftOf(p.ownStringCents));
        setNote(p.note);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  async function save(body: Partial<Pricing>) {
    if (busy || !online) return;
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/pricing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      const p: Pricing = { services: d.services ?? [], ownStringCents: d.ownStringCents ?? null, note: d.note ?? '' };
      setPricing(p);
      setOwn(priceDraftOf(p.ownStringCents));
      setNote(p.note);
    } catch {
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  if (loadError) {
    return (
      <StateCard
        tone="danger"
        icon="request_quote"
        title={t('title')}
        message={<>{t('loadError')} <StateLink onClick={() => setAttempt((n) => n + 1)}>{tRoot('retry')}</StateLink></>}
      >
        <PreviewRow width="48%" />
      </StateCard>
    );
  }

  const ownParsed = parsePrice(own);
  const changed =
    pricing !== null &&
    ownParsed !== undefined &&
    (ownParsed !== pricing.ownStringCents || note.trim() !== pricing.note);

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="request_quote" title={t('title')} subtitle={t('subtitle')} />

      {saveError && <ErrorState message={t('saveError')} />}

      <div className="flex flex-col gap-2">
        <label htmlFor="own-string-price" className="section-label-muted">{t('own')}</label>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="fs-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>$</span>
          <input
            id="own-string-price"
            type="text"
            inputMode="decimal"
            value={own}
            onChange={(e) => setOwn(e.target.value)}
            placeholder={tRoot('strings.priceAsk')}
            maxLength={7}
            disabled={pricing === null}
            style={{ flex: 1, minWidth: 0, fontFamily: 'var(--font-mono)' }}
          />
        </div>
        <p className="fs-xs" style={{ margin: 0, color: ownParsed === undefined ? 'var(--sev-crit-text)' : 'var(--text-muted)' }}>
          {ownParsed === undefined ? tRoot('shelf.sheet.priceInvalid') : t('ownHint')}
        </p>
      </div>

      <div className="flex flex-col gap-2">
        <label htmlFor="pricing-note" className="section-label-muted">{t('note')}</label>
        <textarea
          id="pricing-note"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder={t('notePlaceholder')}
          maxLength={MAX_NOTE}
          rows={2}
          disabled={pricing === null}
        />
      </div>

      <button
        type="button"
        className="cc-btn cc-btn-secondary"
        style={{ width: '100%' }}
        disabled={busy || !online || !changed}
        onClick={() => void save({ ownStringCents: ownParsed ?? null, note: note.trim() })}
      >
        {t('save')}
      </button>

      {pricing !== null && pricing.services.length > 0 && (
        <div className="flex flex-col gap-2" style={{ paddingTop: 'var(--space-2)' }}>
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {t('oldList', { count: pricing.services.length })}{' '}
            {pricing.services
              .map((s) => `${s.label} ${formatServicePrice(s.priceCents) ?? tRoot('strings.priceAsk')}`)
              .join(' · ')}
          </p>
          <div>
            <button
              type="button"
              className="cc-btn cc-btn-ghost"
              disabled={busy || !online}
              onClick={() => void save({ services: [] })}
            >
              {t('oldListClear')}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
