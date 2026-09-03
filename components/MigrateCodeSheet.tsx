'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import PinInput from './PinInput';
import { setIdentity } from '@/lib/identity';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * The NATIVE side of "Move to the app", for the person who has the six
 * digits rather than the link. Copies EnterCodeSheet's shape (name + code +
 * the four error states); the endpoint and the outcome are the only
 * differences. Rendered only when `isNative()`.
 */
export default function MigrateCodeSheet({ open, onClose }: Props) {
  const t = useTranslations('profile.migrate');
  const online = useOnline();
  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<'invalid' | 'rate_limited' | 'server' | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [success, setSuccess] = useState<string | null>(null);

  async function submit() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/migrate/claim`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: name.trim(), short: code }),
        cache: 'no-store',
      });
      if (res.status === 429) { setError('rate_limited'); return; }
      // A 5xx is the server, not the code — and claims are rate-limited, so
      // burning an attempt on an outage is costly. Split it out.
      if (res.status >= 500) { setError('server'); return; }
      if (!res.ok) { setError('invalid'); return; }
      const body = (await res.json()) as { name: string; deleteToken: string | null; sessionId: string };
      setIdentity({ name: body.name, token: body.deleteToken ?? undefined, sessionId: body.sessionId });
      setSuccess(body.name);
      setName('');
      setCode('');
      setTimeout(() => { onClose(); setSuccess(null); }, 1500);
    } catch {
      setError('server');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('claimTitle')}>
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('claimTitle')}</span>
        <button
          type="button"
          onClick={onClose}
          aria-label={t('close')}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', minWidth: 44, minHeight: 44, display: 'flex', alignItems: 'center', justifyContent: 'center' }}
        >
          <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
        </button>
      </BottomSheetHeader>
      <BottomSheetBody>
        {success ? (
          <p className="fs-lg" style={{ textAlign: 'center', color: 'var(--text-primary)' }}>
            {t('welcome', { name: success })}
          </p>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <p className="fs-sm" style={{ color: 'var(--text-secondary)', margin: '0', lineHeight: 'var(--lh-normal)' }}>
              {t('claimHelp')}
            </p>
            <input
              type="text"
              aria-label={t('nameLabel')}
              placeholder={t('nameLabel')}
              value={name}
              onChange={(e) => setName(e.target.value)}
              autoComplete="nickname"
              style={{
                width: '100%',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-md)',
                border: '1px solid var(--glass-border)',
                background: 'var(--input-bg, rgba(255,255,255,0.05))',
                color: 'var(--text-primary)',
              }}
            />
            <PinInput
              value={code}
              onChange={setCode}
              digits={6}
              label={t('codeLabel')}
              ariaInvalid={error === 'invalid'}
            />
            <button
              type="button"
              disabled={submitting || !online || !name.trim() || code.length !== 6}
              onClick={submit}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ marginTop: 'var(--space-1)' }}
            >
              {t('submit')}
            </button>
            {!online && <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0' }}>{t('offline')}</p>}
            {error === 'invalid' && <p role="alert" className="field-error">{t('errorInvalid')}</p>}
            {error === 'rate_limited' && <p role="alert" className="field-error">{t('errorRateLimited')}</p>}
            {error === 'server' && <p role="alert" className="field-error">{t('errorServer')}</p>}
          </div>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
