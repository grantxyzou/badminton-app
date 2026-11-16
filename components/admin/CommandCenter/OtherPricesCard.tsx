'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import MoneyInput from '@/components/primitives/MoneyInput';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import ErrorState from '@/components/primitives/ErrorState';
import StateCard, { StateLink, PreviewRow } from '@/components/primitives/StateCard';
import { useOnline } from '@/lib/useOnline';
import { formatServicePrice, MAX_PRICING_NOTE_LEN, type ServicePrice } from '@/lib/stringingRateCard';
import { parsePrice, priceDraftOf } from '@/lib/shelfEdit';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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
 *
 * On the Inventory page it is ONE row above the strings (canvas v3,
 * docs/plans/string-inventory-list.md): "Other prices · Own string $20 ›",
 * which opens a sheet with both fields and Save pinned to its foot — a
 * phone's settings pattern, where a list shows a value and editing happens
 * where you tapped, rather than two fields and a Save always open in a card.
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
  const [open, setOpen] = useState(false);

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

  /**
   * Send ONLY the fields being changed: the route keeps what it is not sent,
   * so a phone holding a stale copy of one field cannot write it back over
   * another device's edit. Only the drafts for the fields sent are reset
   * from the answer, so clearing the old list keeps an unsaved price or note.
   */
  async function save(body: Partial<Pricing>): Promise<boolean> {
    if (busy || !online) return false;
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
      if ('ownStringCents' in body) setOwn(priceDraftOf(p.ownStringCents));
      if ('note' in body) setNote(p.note);
      return true;
    } catch {
      setSaveError(true);
      return false;
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

  // While the first read is in flight: the row's shape with no value. An
  // empty value there would read as "no own-string price".
  if (pricing === null) {
    return (
      <div className="glass-card inventory-row-card" role="status" aria-label={t('rowLabel')}>
        <div className="shelf-row" style={{ cursor: 'default' }}>
          <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>request_quote</span>
          <span className="shelf-row-body"><PreviewRow width="40%" /></span>
        </div>
      </div>
    );
  }

  const ownParsed = parsePrice(own);
  const ownChanged = ownParsed !== undefined && ownParsed !== pricing.ownStringCents;
  const noteChanged = note.trim() !== pricing.note;
  const changed = ownParsed !== undefined && (ownChanged || noteChanged);
  const ownShown = formatServicePrice(pricing.ownStringCents);
  const close = () => {
    // Closing without saving drops the drafts, so the sheet reopens on what is stored.
    setOpen(false);
    setSaveError(false);
    setOwn(priceDraftOf(pricing.ownStringCents));
    setNote(pricing.note);
  };

  return (
    <div className="glass-card inventory-row-card">
      <button type="button" className="shelf-row" onClick={() => setOpen(true)} aria-haspopup="dialog">
        <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>request_quote</span>
        <span className="shelf-row-body"><span className="shelf-row-name">{t('rowLabel')}</span></span>
        <span className="fs-sm" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
          {ownShown ? t('rowOwn', { price: ownShown }) : t('rowAsk')}
        </span>
        <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>
      </button>

      <BottomSheet open={open} onClose={close} ariaLabel={t('title')}>
        <BottomSheetHeader onClose={close} closeLabel={tRoot('actions.close')}>
          <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('title')}</span>
        </BottomSheetHeader>
        <BottomSheetBody>
          <div className="flex flex-col gap-4">
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('subtitle')}</p>

            <div className="flex flex-col gap-2">
              <label htmlFor="own-string-price" className="section-label-muted">{t('own')}</label>
              <MoneyInput
                id="own-string-price"
                value={own}
                onChange={setOwn}
                placeholder={tRoot('strings.priceAsk')}
                maxLength={7}
              />
              {ownParsed === undefined
                ? <p className="field-error" role="alert">{tRoot('shelf.sheet.priceInvalid')}</p>
                : <p className="fs-xs" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('ownHint')}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <label htmlFor="pricing-note" className="section-label-muted">{t('note')}</label>
              <textarea
                id="pricing-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder={t('notePlaceholder')}
                maxLength={MAX_PRICING_NOTE_LEN}
                rows={3}
              />
            </div>

            {pricing.services.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                  {t('oldList', { count: pricing.services.length })}{' '}
                  {pricing.services
                    .map((sv) => `${sv.label} ${formatServicePrice(sv.priceCents) ?? tRoot('strings.priceAsk')}`)
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
        </BottomSheetBody>
        <BottomSheetFooter className="flex flex-col gap-3">
          {saveError && <ErrorState message={t('saveError')} />}
          <button
            type="button"
            className="cc-btn cc-btn-primary cc-btn-lg"
            disabled={busy || !online || !changed}
            onClick={() =>
              void save({
                ...(ownChanged ? { ownStringCents: ownParsed ?? null } : {}),
                ...(noteChanged ? { note: note.trim() } : {}),
              }).then((ok) => { if (ok) setOpen(false); })
            }
          >
            {t('save')}
          </button>
        </BottomSheetFooter>
      </BottomSheet>
    </div>
  );
}
