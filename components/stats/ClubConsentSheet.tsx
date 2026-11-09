'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetBody, SheetCloseButton } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';

/**
 * First-run consent for the club comparison.
 *
 * ASKED ONCE, AND CLOSING IT IS AN ANSWER. Grant, 2026-11-02 (monthly UX
 * report: the sheet opened over the Stats tab and blocked the tab bar): "show
 * it once, then leave it only in settings." So the ✕, Escape, a swipe down and
 * the Android back button all save "Keep it private" — the same write as the
 * button, stamping `promptedAt` — and the choice lives in Profile → Stats &
 * privacy from then on. It never comes back on its own.
 *
 * The sheet used to have no way out but its two buttons, on the reasoning that
 * a dismissal would mean asking again next week. Saving the private answer on
 * close keeps "asked once" without trapping anyone: private is the default a
 * person who did not want to think about it would choose anyway, and it shows
 * nobody anything.
 *
 * Closing does nothing while offline or saving — the write cannot happen, and
 * a sheet that vanished without saving would ask again. The offline line says
 * why the buttons are dead, so nobody stares at a sheet that will not shut.
 */
export interface ClubConsentSheetProps {
  open: boolean;
  saving?: boolean;
  /** Called with the member's answer. The caller owns the write. */
  onAnswer: (clubComparison: boolean) => void;
}

export default function ClubConsentSheet({ open, saving = false, onAnswer }: ClubConsentSheetProps) {
  const t = useTranslations('stats.consent');
  const online = useOnline();
  const busy = saving || !online;
  // Every way out of the sheet is the private answer. Busy (offline, or the
  // answer already on its way) does nothing, so nothing is answered twice.
  const closePrivately = () => {
    if (!busy) onAnswer(false);
  };

  return (
    <BottomSheet open={open} onClose={closePrivately} ariaLabel={t('title')}>
      <BottomSheetBody bare>
        <div
          style={{
            padding: 'var(--space-6) var(--space-6) var(--space-7)',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            {/* --icon-lg (24), the nearest rung on the icon ladder. The
                prototype's 28 is off-scale; snapping is the house rule. */}
            <span
              className="material-icons"
              aria-hidden="true"
              style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent)' }}
            >
              groups
            </span>
            <SheetCloseButton onClose={closePrivately} label={t('close')} />
          </div>

          <h2 className="bpm-h2" style={{ margin: '0' }}>
            {t('title')}
          </h2>

          <p style={{ margin: '0', fontSize: 'var(--fs-md)', lineHeight: 1.5, color: 'var(--text-primary)' }}>
            {t('body')}
          </p>

          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-3)',
              padding: 'var(--space-5)',
              borderRadius: 'var(--radius-lg)',
              background: 'var(--inner-card-bg)',
              border: '1px solid transparent',
            }}
          >
            <Reassurance icon="check_circle">{t('bands')}</Reassurance>
            <Reassurance icon="lock">{t('private')}</Reassurance>
          </div>

          <button
            type="button"
            className="cc-btn cc-btn-primary cc-btn-lg"
            style={{ width: '100%' }}
            disabled={busy}
            onClick={() => onAnswer(true)}
          >
            {t('yes')}
          </button>
          <button
            type="button"
            className="cc-btn cc-btn-ghost cc-btn-lg"
            style={{ width: '100%' }}
            disabled={busy}
            onClick={() => onAnswer(false)}
          >
            {t('no')}
          </button>

          {!online && (
            <p style={{ margin: '0', textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {t('offline')}
            </p>
          )}

          <p style={{ margin: '0', textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
            {t('changeLater')}
          </p>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}

function Reassurance({ icon, children }: { icon: string; children: React.ReactNode }) {
  return (
    <p
      style={{
        margin: '0',
        display: 'flex',
        gap: 'var(--space-3)',
        fontSize: 'var(--fs-base)',
        lineHeight: 1.45,
        color: 'var(--text-secondary)',
      }}
    >
      <span
        className="material-icons"
        aria-hidden="true"
        style={{ fontSize: 'var(--icon-sm)', color: 'var(--accent)', flexShrink: 0 }}
      >
        {icon}
      </span>
      {children}
    </p>
  );
}
