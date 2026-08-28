'use client';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from './BottomSheet';
import { useOnline } from '@/lib/useOnline';
import type { UsePushResult } from '@/lib/usePush';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Opens the "Add to Home Screen" instructions — the only actionable path
   *  for an iOS user in a browser tab, where push is unavailable by design. */
  onOpenInstall: () => void;
  /** Owned by ProfileTab and shared with the settings row, so toggling here
   *  updates the row's On/Off label immediately. A second usePush() here would
   *  be a separate state and the row would go stale. */
  push: UsePushResult;
}

/**
 * Notification opt-in.
 *
 * Every terminal state is rendered honestly rather than collapsed into a
 * generic "not available": a user who CAN fix their situation is told how, and
 * a user who cannot is told plainly instead of being offered a button that
 * silently does nothing.
 */
export default function PushSheet({ open, onClose, onOpenInstall, push }: Props) {
  const t = useTranslations('profile.push');
  const online = useOnline();
  const { state, enable, disable, busy, error } = push;

  function body() {
    if (state.status === 'loading') {
      return <p className="fs-base" style={{ color: 'var(--text-muted)' }}>{t('checking')}</p>;
    }

    if (state.status === 'unsupported') {
      if (state.reason === 'ios-not-installed') {
        return (
          <>
            <p className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('iosNeedsInstall')}</p>
            <button
              type="button"
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ marginTop: 'var(--space-4)', width: '100%' }}
              onClick={onOpenInstall}
            >
              {t('iosInstallCta')}
            </button>
          </>
        );
      }
      return (
        <p className="fs-base" style={{ color: 'var(--text-muted)' }}>
          {state.reason === 'not-configured' ? t('notConfigured') : t('unsupported')}
        </p>
      );
    }

    if (state.status === 'denied') {
      // requestPermission() resolves 'denied' immediately without prompting,
      // so there is genuinely no button we could offer here.
      return <p className="fs-base" style={{ color: 'var(--text-primary)' }}>{t('blocked')}</p>;
    }

    const isOn = state.status === 'on';
    return (
      <>
        <p className="fs-base" style={{ color: 'var(--text-primary)' }}>
          {isOn ? t('onBody') : t('offBody')}
        </p>
        {!online && (
          <p className="fs-sm" style={{ color: 'var(--text-muted)', marginTop: 'var(--space-3)' }}>
            {t('offlineHint')}
          </p>
        )}
        {error && (
          <p className="field-error" role="alert" style={{ marginTop: 'var(--space-3)' }}>
            {error === 'auth' ? t('errorAuth') : t('errorGeneric')}
          </p>
        )}
        <button
          type="button"
          className={`cc-btn ${isOn ? 'cc-btn-secondary' : 'cc-btn-primary'} cc-btn-lg`}
          style={{ marginTop: 'var(--space-4)', width: '100%' }}
          // Network-mutating action — must be unavailable offline rather than
          // failing after the tap (CLAUDE.md offline posture).
          disabled={busy || !online}
          onClick={() => void (isOn ? disable() : enable())}
        >
          {busy ? t('working') : isOn ? t('turnOff') : t('turnOn')}
        </button>
      </>
    );
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')} className="max-w-lg mx-auto">
      <BottomSheetHeader className="flex items-center justify-between p-4">
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
      <BottomSheetBody className="p-5 pb-8">{body()}</BottomSheetBody>
    </BottomSheet>
  );
}
