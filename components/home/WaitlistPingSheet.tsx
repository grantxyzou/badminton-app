'use client';

import { useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { UsePushResult } from '@/lib/usePush';
import type { WaitlistPingKind } from '@/lib/waitlistPing';

export { waitlistPingKind, type WaitlistPingKind } from '@/lib/waitlistPing';

interface Props {
  kind: WaitlistPingKind | null;
  onClose: () => void;
  /** The web ask's action: close this, open `MigrateSheet`. */
  onGetApp: () => void;
  /** HomeShell's one `usePush()`; a second would be a second token listener. */
  push: UsePushResult;
}

/**
 * "Want a ping if a spot opens?" — opened right after a waitlist join, the
 * one moment push is obviously useful (Grant chose a sheet over a row in the
 * card). A freed spot already promotes the first waitlister and pushes them
 * (`lib/waitlistPromote.ts`); this is what makes that push reach them.
 */
export default function WaitlistPingSheet({ kind, onClose, onGetApp, push }: Props) {
  const t = useTranslations('home.waitlistPing');
  const tp = useTranslations('profile.push');
  const online = useOnline();
  const open = kind !== null;
  const isOn = push.state.status === 'on';

  // Turned on: the job is done, and the card now says so. Close.
  useEffect(() => {
    if (kind === 'enable' && isOn) onClose();
  }, [kind, isOn, onClose]);

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={t('notNow')}>
        <h2 className="bpm-h3 m-0">{t('title')}</h2>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <p className="fs-md m-0" style={{ color: 'var(--text-primary)' }}>
            {kind === 'app' ? t('appBody') : t('enableBody')}
          </p>
        </div>
      </BottomSheetBody>
      {/* The answer, pinned to the bottom of the screen, with what the last
          tap did just above it. */}
      <BottomSheetFooter>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {kind === 'enable' && push.state.status === 'denied' && (
            // The prompt was answered "no" just now: say what is left, plainly.
            <p className="fs-base m-0" role="status" style={{ color: 'var(--text-secondary)' }}>{tp('blocked')}</p>
          )}
          {kind === 'enable' && push.error && push.error !== 'auth' && (
            <p className="field-error" role="alert">{tp('errorGeneric')}</p>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {kind === 'app' ? (
              <button type="button" className="btn-primary w-full" onClick={onGetApp}>
                {t('getApp')}
              </button>
            ) : (
              push.state.status === 'off' && (
                <button
                  type="button"
                  className="btn-primary w-full"
                  // Network-mutating: unavailable offline, not failing after the tap.
                  disabled={push.busy || !online}
                  onClick={() => void push.enable()}
                >
                  {push.busy ? t('turningOn') : t('turnOn')}
                </button>
              )
            )}
            <button type="button" className="btn-ghost w-full" onClick={onClose}>
              {t('notNow')}
            </button>
          </div>
        </div>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
