'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Redeem a gift card into your own store credit (docs/plans/payments.md).
 *
 * Wrong, used and unknown codes get ONE message on purpose — the server
 * answers them identically so a guesser learns nothing, and the sheet must not
 * re-introduce the difference.
 */
export default function RedeemGiftSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useTranslations('profile.redeem');
  const online = useOnline();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<'notFound' | 'rateLimited' | 'server' | null>(null);
  const [added, setAdded] = useState<number | null>(null);

  async function submit() {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/credit/redeem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ code }),
      });
      if (res.status === 429) return setError('rateLimited');
      if (res.status === 404) return setError('notFound');
      if (!res.ok) return setError('server');
      const { amountCents } = (await res.json()) as { amountCents: number };
      setAdded(amountCents);
      setCode('');
      // The Home balance card re-reads, so the new credit shows without a reload.
      window.dispatchEvent(new Event(BALANCE_EVENT));
    } catch {
      setError('server');
    } finally {
      setBusy(false);
    }
  }

  function close() {
    setAdded(null);
    setError(null);
    onClose();
  }

  return (
    <BottomSheet open={open} onClose={close} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={close} closeLabel={t('close')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('title')}</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        {added !== null ? (
          <p className="motion-fade fs-md" style={{ margin: '0', textAlign: 'center', color: 'var(--text-primary)' }}>
            {t('success', { amount: `$${(added / 100).toFixed(2).replace(/\.00$/, '')}` })}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p className="fs-sm" style={{ margin: '0', color: 'var(--text-secondary)' }}>{t('help')}</p>
            <input
              type="text"
              aria-label={t('placeholder')}
              placeholder={t('placeholder')}
              value={code}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
              autoCapitalize="characters"
              autoComplete="off"
              spellCheck={false}
              style={{
                width: '100%',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--glass-border)',
                background: 'var(--input-bg)',
                color: 'var(--text-primary)',
                fontFamily: 'var(--font-mono)',
                letterSpacing: '0.08em',
              }}
            />
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              disabled={!online || busy || code.replace(/[^A-Za-z0-9]/g, '').length < 8}
              onClick={() => void submit()}
            >
              {t('submit')}
            </button>
            {error && (
              <p className="field-error" role="alert">
                {t(error === 'notFound' ? 'notFound' : error === 'rateLimited' ? 'rateLimited' : 'error')}
              </p>
            )}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
