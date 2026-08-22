'use client';

import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';

/**
 * First-run consent for the club comparison.
 *
 * THE ONE SHEET IN THE APP THAT MUST BE ANSWERED. There is no close button, the
 * backdrop is not tappable (BottomSheet's already isn't), and Escape is
 * disabled via `closeOnEscape={false}`. The alternative to answering is being
 * asked again next week, which is worse than a single unavoidable question —
 * "asked once" is the entire design.
 *
 * Both buttons write. `Keep it private` is a real answer, not a dismissal, and
 * it stamps `promptedAt` exactly like `Show me where I sit` does.
 *
 * Accessibility note: because dismissal is disabled, the two buttons are the
 * ONLY exit from the focus trap. They must always render and must never both
 * be disabled — which is why the offline state disables them but shows a line
 * explaining why, rather than leaving a trapped user staring at dead controls.
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

  return (
    <BottomSheet
      open={open}
      // Required by the props contract, but unreachable: no close affordance
      // renders, the backdrop is inert, and Escape is off. Answering is the
      // only way out, and answering goes through onAnswer.
      onClose={() => {}}
      closeOnEscape={false}
      ariaLabel={t('title')}
      maxHeight="75vh"
    >
      <BottomSheetBody bare>
        <div
          style={{
            padding: '18px 20px 28px',
            display: 'flex',
            flexDirection: 'column',
            gap: 'var(--space-5)',
          }}
        >
          {/* --icon-lg (24), the nearest rung on the icon ladder. The
              prototype's 28 is off-scale; snapping is the house rule. */}
          <span
            className="material-icons"
            aria-hidden="true"
            style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent)' }}
          >
            groups
          </span>

          <h2 className="bpm-h2" style={{ margin: 0 }}>
            {t('title')}
          </h2>

          <p style={{ margin: 0, fontSize: 'var(--fs-md)', lineHeight: 1.5, color: 'var(--text-primary)' }}>
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
              border: '1px solid var(--inner-card-border)',
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
            <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
              {t('offline')}
            </p>
          )}

          <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
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
        margin: 0,
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
