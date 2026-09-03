'use client';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import { useOnline } from '@/lib/useOnline';
import ErrorState from './primitives/ErrorState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
}

type Minted = { link: string; linkCode: string; shortCode: string; expiresAt: string };
type Failure = 'auth' | 'rate_limited' | 'server';

/**
 * The PWA side of "Move to the app": mint a one-time link + short code and
 * show both. Opened from the Profile settings row; the native app claims it.
 *
 * Two ways in, one mint. "Open in the BPM app" is a CUSTOM-SCHEME link
 * (`bpm://`): from inside the PWA a universal link on our own domain would
 * just navigate in place, whereas a scheme hands off to the installed app. The
 * six digits beside it are for the person who does not have the app yet, or
 * whose link resolution misfires — which it will.
 */
export default function MigrateSheet({ open, onClose }: Props) {
  const t = useTranslations('profile.migrate');
  const online = useOnline();
  const [minted, setMinted] = useState<Minted | null>(null);
  const [failure, setFailure] = useState<Failure | null>(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const mintSeq = useRef(0);

  async function mint() {
    const seq = ++mintSeq.current;
    setBusy(true);
    setFailure(null);
    try {
      const res = await fetch(`${BASE}/api/auth/migrate/start`, { method: 'POST', cache: 'no-store' });
      if (seq !== mintSeq.current) return;
      if (res.status === 401) { setFailure('auth'); return; }
      if (res.status === 429) { setFailure('rate_limited'); return; }
      if (!res.ok) { setFailure('server'); return; }
      setMinted((await res.json()) as Minted);
      setNow(Date.now());
    } catch {
      if (seq === mintSeq.current) setFailure('server');
    } finally {
      if (seq === mintSeq.current) setBusy(false);
    }
  }

  // Mint on open, and forget everything on close: a code that outlives the
  // sheet is a credential nobody is looking at.
  useEffect(() => {
    if (!open) {
      setMinted(null);
      setFailure(null);
      return;
    }
    if (online) void mint();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // Countdown tick while a code is live.
  useEffect(() => {
    if (!open || !minted) return;
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [open, minted]);

  const remainingMs = minted ? Math.max(0, Date.parse(minted.expiresAt) - now) : 0;
  const expired = !!minted && remainingMs === 0;
  const mm = Math.floor(remainingMs / 60000);
  const ss = String(Math.floor((remainingMs % 60000) / 1000)).padStart(2, '0');

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>{t('title')}</span>
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
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
          <p className="fs-md" style={{ color: 'var(--text-secondary)', margin: '0', lineHeight: 'var(--lh-normal)' }}>
            {t('help')}
          </p>

          {!online && <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0' }}>{t('offline')}</p>}
          {failure === 'auth' && <ErrorState message={t('errorAuth')} />}
          {failure === 'rate_limited' && <ErrorState message={t('errorRateLimited')} />}
          {failure === 'server' && <ErrorState message={t('errorServer')} />}

          {minted && !expired && (
            <>
              <a
                href={`bpm://migrate?c=${minted.linkCode}`}
                className="btn-primary"
                style={{ display: 'block', textAlign: 'center', textDecoration: 'none' }}
              >
                {t('openInApp')}
              </a>
              <div>
                <p className="section-label" style={{ margin: '0 0 var(--space-2)' }}>{t('orCode')}</p>
                <p
                  aria-label={t('codeLabel')}
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-stat-lg)',
                    letterSpacing: '0.2em',
                    color: 'var(--text-primary)',
                    margin: '0',
                  }}
                >
                  {minted.shortCode.slice(0, 3)} {minted.shortCode.slice(3)}
                </p>
                <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 'var(--space-2) 0 0' }}>
                  {t('codeHelp')} · {t('expiresIn', { time: `${mm}:${ss}` })}
                </p>
              </div>
            </>
          )}

          {(expired || (failure && failure !== 'auth')) && online && (
            <button type="button" className="cc-btn cc-btn-secondary" disabled={busy} onClick={() => void mint()}>
              {expired ? t('expiredNewCode') : t('tryAgain')}
            </button>
          )}

          <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: '0', lineHeight: 'var(--lh-normal)' }}>
            {t('storesNote')}
          </p>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
