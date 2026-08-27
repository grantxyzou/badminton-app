'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { TENSION_MIN_LB, TENSION_MAX_LB } from '@/lib/stringing';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  onRequested: () => void;
}

/**
 * A player asking for a restring.
 *
 * NO PRICE FIELD, and that is the point rather than an omission. The stringer
 * sets the price; a player proposing one would invite a negotiation the app has
 * no way to hold, and the whole feature is built so the exact figure lives on
 * one side of the wall. What comes back is a range, later, once it is quoted.
 *
 * The tension defaults to 26/28 — the club's common setup — and is a stepper
 * rather than a free field, so a request can never carry a number a machine
 * cannot hold. The same bounds are re-checked on the server, because a stepper
 * is a convenience and not a guarantee.
 */
export default function RequestStringingSheet({ open, onClose, onRequested }: Props) {
  const t = useTranslations('home.stringing');
  const online = useOnline();
  const [racketLabel, setRacketLabel] = useState('');
  const [stringLabel, setStringLabel] = useState('');
  const [mains, setMains] = useState(26);
  const [crosses, setCrosses] = useState(28);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const clamp = (n: number) => Math.max(TENSION_MIN_LB, Math.min(TENSION_MAX_LB, n));
  const canSubmit = !busy && online && !!racketLabel.trim() && !!stringLabel.trim();

  async function submit() {
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/stringing/requests`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          racketLabel: racketLabel.trim(),
          stringLabel: stringLabel.trim(),
          tensionMains: mains,
          tensionCrosses: crosses,
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        // Distinct copy per reason. "Couldn't send that" for a closed shop
        // would have someone retrying a thing that cannot succeed.
        setError(t(`error.${data.error ?? 'generic'}`));
        setBusy(false);
        return;
      }
      setDone(true);
      setBusy(false);
      onRequested();
    } catch {
      setError(t('error.generic'));
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('requestTitle')}>
      <BottomSheetHeader>{t('requestTitle')}</BottomSheetHeader>
      <BottomSheetBody>
        {done ? (
          <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
            <p role="status" className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
              {t('requestSent')}
            </p>
            <button
              type="button"
              onClick={onClose}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {t('requestDone')}
            </button>
          </div>
        ) : (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
              {t('requestBody')}
            </p>
            <input
              type="text"
              value={racketLabel}
              onChange={(e) => setRacketLabel(e.target.value)}
              placeholder={t('racketPlaceholder')}
              aria-label={t('racketPlaceholder')}
              maxLength={80}
              autoFocus
            />
            <input
              type="text"
              value={stringLabel}
              onChange={(e) => setStringLabel(e.target.value)}
              placeholder={t('stringPlaceholder')}
              aria-label={t('stringPlaceholder')}
              maxLength={80}
            />

            {([
              [t('mains'), mains, setMains],
              [t('crosses'), crosses, setCrosses],
            ] as [string, number, (n: number) => void][]).map(([lbl, value, set]) => (
              <div key={lbl} style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)' }}>
                <span className="fs-md" style={{ flex: 1 }}>{lbl}</span>
                <button
                  type="button"
                  onClick={() => set(clamp(value - 1))}
                  aria-label={t('decrease', { field: lbl })}
                  className="cc-btn cc-btn-secondary"
                  style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: 0 }}
                >
                  <span className="material-icons icon-sm">remove</span>
                </button>
                <span
                  className="fs-stat"
                  style={{ minWidth: 62, textAlign: 'center', fontWeight: 700, fontFamily: 'var(--font-mono)' }}
                >
                  {value}
                  <span className="fs-sm" style={{ marginLeft: 2, color: 'var(--text-muted)' }}>
                    {t('lb')}
                  </span>
                </span>
                <button
                  type="button"
                  onClick={() => set(clamp(value + 1))}
                  aria-label={t('increase', { field: lbl })}
                  className="cc-btn cc-btn-secondary"
                  style={{ width: 44, height: 44, borderRadius: 'var(--radius-pill)', padding: 0 }}
                >
                  <span className="material-icons icon-sm">add</span>
                </button>
              </div>
            ))}

            {/* Said before they commit, not after. The player never sees the
                stringer's figure, so the honest thing is to be plain that a
                number is coming rather than to imply one has been agreed. */}
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
              {t('priceLater')}
            </p>

            {error && <p className="field-error">{error}</p>}

            <button
              type="button"
              onClick={submit}
              disabled={!canSubmit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('requestSending') : t('sendCta')}
            </button>
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
