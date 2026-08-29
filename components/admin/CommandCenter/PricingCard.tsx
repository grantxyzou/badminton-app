'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import { useOnline } from '@/lib/useOnline';
import { MAX_SERVICES, formatServicePrice, type ServicePrice } from '@/lib/stringingPricing';
import { moveItem, canMove } from '@/lib/reorder';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The rate card players see behind "View pricing".
 *
 * Prices are optional PER SERVICE. "Special requests" genuinely has no fixed
 * price, and a rate card that showed $0.00 for it would be worse than one that
 * says "Ask" — leave the field blank and that is what a player reads.
 *
 * Order is preserved as typed. This is a menu, and the ordering is editorial:
 * cheapest first, or most common first, is the stringer's call and not the
 * app's.
 */
export default function PricingCard() {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  const [services, setServices] = useState<ServicePrice[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [label, setLabel] = useState('');
  const [price, setPrice] = useState('');
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [editLabel, setEditLabel] = useState('');
  const [editPrice, setEditPrice] = useState('');
  const [editError, setEditError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/pricing`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (cancelled) return;
        if (Array.isArray(d.services)) setServices(d.services);
        else setLoadError(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function save(next: ServicePrice[]) {
    if (busy || !online) return;
    const previous = services;
    setServices(next);
    setBusy(true);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/pricing`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ services: next }),
      });
      if (!res.ok) throw new Error(String(res.status));
      const d = await res.json();
      if (Array.isArray(d.services)) setServices(d.services);
    } catch {
      // Roll back to exactly what was on screen rather than leaving a row that
      // was never saved.
      setServices(previous);
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  }

  // Blank is a legitimate price meaning "ask"; a non-number is not.
  const parsed = (() => {
    const raw = price.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(n * 100);
  })();
  const canAdd =
    !busy && online && !!label.trim() && parsed !== undefined && services !== null &&
    services.length < MAX_SERVICES;

  function beginEdit(i: number) {
    if (!services || busy || !online) return;
    const svc = services[i];
    setEditIndex(i);
    setEditLabel(svc.label);
    // Blank means "ask", and round-tripping it through "0" would turn a
    // deliberate no-price into a free service.
    setEditPrice(svc.priceCents === null ? '' : String(svc.priceCents / 100));
    setEditError(false);
  }

  function cancelEdit() {
    setEditIndex(null);
    setEditError(false);
  }

  const editParsed = (() => {
    const raw = editPrice.trim();
    if (!raw) return null;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < 0) return undefined;
    return Math.round(n * 100);
  })();
  const canCommitEdit =
    !busy && online && !!editLabel.trim() && editParsed !== undefined && editIndex !== null;

  function commitEdit() {
    if (!canCommitEdit || !services || editIndex === null) return;
    const name = editLabel.trim();
    /* `normalisePricing` de-dupes by lowercased label with `continue`, NOT an
       error — so renaming a row onto an existing name would make the server
       silently drop it and the row would just vanish. Caught here instead. */
    const clash = services.some(
      (s2, j) => j !== editIndex && s2.label.toLowerCase() === name.toLowerCase(),
    );
    if (clash) {
      setEditError(true);
      return;
    }
    const next = services.map((s2, j) =>
      j === editIndex ? { label: name, priceCents: editParsed as number | null } : s2,
    );
    setEditIndex(null);
    setEditError(false);
    void save(next);
  }

  function move(index: number, delta: -1 | 1) {
    if (!services || busy || !online) return;
    if (!canMove(index, delta, services.length)) return;
    void save(moveItem(services, index, index + delta));
  }

  function add() {
    if (!canAdd || !services) return;
    const name = label.trim();
    if (services.some((s) => s.label.toLowerCase() === name.toLowerCase())) return;
    setLabel('');
    setPrice('');
    void save([...services, { label: name, priceCents: parsed as number | null }]);
  }

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="payments" title={t('pricing.title')} subtitle={t('pricing.hint')} />

      {loadError && <ErrorState message={t('pricing.loadError')} />}
      {saveError && <ErrorState message={t('pricing.saveError')} />}

      {services !== null && services.length === 0 && !loadError && (
        /* Standing, not inline. The card's whole current report IS the
            emptiness — the add row below is an affordance, not content — and
            EmptyState's own rule is that a bare sentence left-aligned under a
            header reads as a caption someone forgot to finish. It also fixes
            the stair-step: CardHeader nests its subtitle beside the icon, so
            an inline line at the card's padding sits to the LEFT of the
            subtitle above it. Centred copy sidesteps the mismatch instead of
            hand-tuning an indent that would drift. */
        <EmptyState icon="request_quote">{t('pricing.empty')}</EmptyState>
      )}

      {services !== null && services.length > 0 && (
        <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
          {services.map((svc, i) => {
            const rowBusy = busy || !online;

            /* EDITING IS A TWO-LINE FORM, NOT AN INLINE SWAP.
               First cut kept the row shape and swapped the label and price for
               inputs — five controls on one line at 430px, which crushed the
               label field to about 70px and rendered "Labour for BPM Friends"
               as "iends". A phone row does not have space for a form, so while
               editing the row becomes one: label across the full width, then
               price and the two actions beneath it. The arrows and the × are
               gone rather than disabled, because a control you cannot use is
               width spent on nothing. */
            if (editIndex === i) {
              return (
                <div
                  key={svc.label}
                  style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}
                >
                  <input
                    type="text"
                    value={editLabel}
                    onChange={(e) => setEditLabel(e.target.value)}
                    aria-label={t('pricing.edit', { name: svc.label })}
                    maxLength={60}
                    style={{ width: '100%' }}
                    autoFocus
                  />
                  <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                    <input
                      type="text"
                      inputMode="decimal"
                      value={editPrice}
                      onChange={(e) => setEditPrice(e.target.value)}
                      /* NOT the placeholder. The add form's price input already
                         uses that, so both fields answered to the accessible
                         name "30" — two controls with the same name on one
                         screen, neither of which says what it does. */
                      aria-label={t('pricing.editPrice', { name: svc.label })}
                      maxLength={8}
                      style={{ width: 84, flex: 'none', fontFamily: 'var(--font-mono)' }}
                    />
                    <button
                      type="button"
                      onClick={commitEdit}
                      disabled={!canCommitEdit}
                      className="cc-btn cc-btn-secondary"
                      style={{ flex: 1 }}
                    >
                      {t('pricing.save')}
                    </button>
                    <button
                      type="button"
                      onClick={cancelEdit}
                      className="cc-btn cc-btn-ghost"
                      style={{ flex: 1 }}
                    >
                      {t('pricing.cancel')}
                    </button>
                  </div>
                </div>
              );
            }

            return (
              <div
                key={svc.label}
                style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
              >
                {/* Up/down rather than a drag handle. Disabled at the ends,
                    because a control that is present but does nothing is worse
                    than one that says it cannot. */}
                <div style={{ display: 'flex', flexDirection: 'column' }}>
                  {([-1, 1] as const).map((delta) => (
                    <button
                      key={delta}
                      type="button"
                      onClick={() => move(i, delta)}
                      disabled={rowBusy || !canMove(i, delta, services.length)}
                      aria-label={t(delta === -1 ? 'pricing.moveUp' : 'pricing.moveDown', {
                        name: svc.label,
                      })}
                      className="cc-btn cc-btn-ghost"
                      style={{ padding: '0 var(--space-1)', minHeight: 18, lineHeight: 1 }}
                    >
                      <span className="material-icons icon-sm" style={{ color: 'var(--text-muted)' }}>
                        {delta === -1 ? 'expand_less' : 'expand_more'}
                      </span>
                    </button>
                  ))}
                </div>

                {/* The row itself is the edit affordance — a separate pencil
                    would be a fourth control on a row that already has two
                    arrows and an ×. */}
                <button
                  type="button"
                  onClick={() => beginEdit(i)}
                  disabled={rowBusy}
                  className="cc-btn cc-btn-ghost"
                  style={{
                    flex: 1,
                    minWidth: 0,
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    justifyContent: 'space-between',
                    padding: 'var(--space-2)',
                    textAlign: 'left',
                  }}
                >
                  <span
                    className="fs-md"
                    style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                  >
                    {svc.label}
                  </span>
                  <span className="fs-md" style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                    {formatServicePrice(svc.priceCents) ?? t('pricing.ask')}
                  </span>
                </button>
                <button
                  type="button"
                  disabled={rowBusy}
                  onClick={() => void save(services.filter((s) => s.label !== svc.label))}
                  aria-label={t('pricing.remove', { name: svc.label })}
                  className="cc-btn cc-btn-ghost"
                  style={{ padding: 'var(--space-2)' }}
                >
                  <span className="material-icons icon-sm" style={{ color: 'var(--text-muted)' }}>
                    close
                  </span>
                </button>
              </div>
            );
          })}
        </div>
      )}
      {editError && <p className="field-error" role="alert">{t('pricing.duplicate')}</p>}

      <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
        <input
          type="text"
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={t('pricing.labelPlaceholder')}
          aria-label={t('pricing.labelPlaceholder')}
          maxLength={60}
          style={{ flex: 1, minWidth: 0 }}
          disabled={services === null}
        />
        <input
          type="text"
          inputMode="decimal"
          value={price}
          onChange={(e) => setPrice(e.target.value)}
          placeholder={t('pricing.pricePlaceholder')}
          aria-label={t('pricing.pricePlaceholder')}
          maxLength={8}
          /* FIXED, not a share of a proportional split. A price is 4-6
             characters ("30", "28.50") with a known maximum, so giving it
             `flex: 1` beside the label spent width it could never use — at a
             430px phone the label truncated mid-placeholder to
             "Service, e.g. Labour +", which reads as a broken field rather
             than a hint. The label now takes everything left over. */
          style={{ width: 84, flex: 'none', fontFamily: 'var(--font-mono)' }}
          disabled={services === null}
        />
        <button type="button" onClick={add} disabled={!canAdd} className="cc-btn cc-btn-secondary">
          {t('pricing.add')}
        </button>
      </div>
      {parsed === undefined && <p className="field-error">{t('pricing.badPrice')}</p>}
      {/* `margin: 0` here was CANCELLING the card's `space-y-3`. Tailwind
          implements that class as a margin-top on each sibling after the
          first, and an inline style beats a class — so this note was not
          under-spaced, its spacing was being deleted, and it sat flush against
          the input row. It is a caption ON that row rather than a sibling of
          it, so it takes a deliberate 8px rather than the card's 12px rhythm. */}
      <p className="fs-sm" style={{ margin: 'var(--space-3) 0 0', color: 'var(--text-muted)' }}>
        {t('pricing.blankMeansAsk')}
      </p>
    </div>
  );
}
