'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { inviteUrl, type Invite } from '@/lib/useInvites';
import { qrPath } from '@/lib/qr';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** How often the open sheet asks whether its invite has been used. */
export const QR_POLL_MS = 3000;

interface Props {
  open: boolean;
  onClose: () => void;
  /** The invite to draw: the one the card is showing. */
  invite: Invite | null;
  groupName?: string;
  /** Mints the next invite, through the card's own `useInvites`. */
  onNext: () => Promise<Invite | null>;
}

/**
 * "Show as QR": the organiser's phone as the way in for someone standing next
 * to them (docs/superpowers/plans/2026-11-04-app-clip.md, Task 1.3).
 *
 * A one-time invite drawn big, scanned with the other person's camera. It is
 * the same `/bpm/j/<token>` link the card shares (`inviteUrl`), so it opens the
 * app where installed and the sign-up page everywhere else, and later the App
 * Clip.
 *
 * WHEN IT IS USED, THE SHEET SAYS SO. An invite is live exactly while the
 * club's list holds it (`lib/invites.ts`), so the sheet asks the list every
 * `QR_POLL_MS` while it is open and on screen; when its invite is gone it
 * stops showing a code that no longer works and offers "Next person". It does
 * its own read instead of the card's reload, so a failed check is simply
 * skipped and never tips the card behind it into its error state. Revoking
 * from another phone reads the same as a use; that is rare, and either way
 * the code is dead and the next one is one tap away.
 */
export default function InviteQrSheet({ open, onClose, invite, groupName, onNext }: Props) {
  const t = useTranslations('groups.invite');
  const online = useOnline();
  const [current, setCurrent] = useState<Invite | null>(invite);
  const [used, setUsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [nextFailed, setNextFailed] = useState(false);

  // A fresh open shows whatever the card is showing now.
  useEffect(() => {
    if (!open) return;
    setCurrent(invite);
    setUsed(false);
    setNextFailed(false);
    // Only on open: the card may change its own invite while this is up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const currentId = current?.id ?? null;

  useEffect(() => {
    if (!open || used || !currentId) return;
    let stopped = false;

    async function check() {
      if (typeof document !== 'undefined' && document.hidden) return;
      try {
        const res = await fetch(`${BASE}/api/groups/invite`, { cache: 'no-store' });
        if (!res.ok) return;
        const { invites } = (await res.json()) as { invites: Invite[] };
        if (!stopped && Array.isArray(invites) && !invites.some((i) => i.id === currentId)) setUsed(true);
      } catch {
        // Offline or a blip: keep showing the code and ask again next time.
      }
    }

    const timer = window.setInterval(() => void check(), QR_POLL_MS);
    const onVisible = () => {
      if (!document.hidden) void check();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      stopped = true;
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [open, used, currentId]);

  const qr = useMemo(() => (current ? qrPath(inviteUrl(current.token)) : null), [current]);

  async function next() {
    setNextFailed(false);
    setBusy(true);
    const made = await onNext();
    setBusy(false);
    if (!made) {
      setNextFailed(true);
      return;
    }
    setCurrent(made);
    setUsed(false);
  }

  const name = groupName?.trim();

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('showQr')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('qrClose')}>
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>
          {name ? t('qrTitle', { name }) : t('qrTitleNoName')}
        </span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlockEnd: 'var(--space-5)' }}>
          {used || !current || !qr ? (
            <div key="used" className="motion-fade" role="status" style={{ display: 'grid', gap: 'var(--space-4)', justifyItems: 'center', textAlign: 'center' }}>
              <span className="material-icons icon-xl" style={{ color: 'var(--accent)' }} aria-hidden="true">
                check_circle
              </span>
              <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>{t('qrUsed')}</p>
            </div>
          ) : (
            <div key={current.id} className="motion-fade" style={{ display: 'grid', gap: 'var(--space-4)' }}>
              <svg
                className="invite-qr"
                viewBox={`0 0 ${qr.size} ${qr.size}`}
                role="img"
                aria-label={t('qrAria')}
              >
                <path d={qr.d} />
              </svg>
              <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('qrHint')}</p>
              <div style={{ display: 'grid', gap: 'var(--space-2)', justifyItems: 'center' }}>
                {/* A sentence, not the uppercase label style: a question in
                    capitals reads as shouting. */}
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('qrCodeHint')}</p>
                <p
                  style={{
                    margin: 0,
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-stat)',
                    letterSpacing: '0.12em',
                    color: 'var(--text-primary)',
                  }}
                >
                  {current.code.slice(0, 4)} {current.code.slice(4)}
                </p>
              </div>
            </div>
          )}

          {(used || !current) && (
            <button
              type="button"
              onClick={() => void next()}
              disabled={busy || !online}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('creating') : t('qrNext')}
            </button>
          )}
          {nextFailed && <p className="field-error" role="alert">{t('qrNextFailed')}</p>}
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
