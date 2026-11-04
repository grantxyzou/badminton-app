'use client';
import { useState } from 'react';
import { useTranslations } from 'next-intl';
import MigrateSheet from './MigrateSheet';
import { isNative } from '@/lib/native';
import { isFlagOn } from '@/lib/flags';
import { usePush } from '@/lib/usePush';
import { useOnline } from '@/lib/useOnline';
import { readStored, useClientValue } from '@/lib/useClientValue';

export const PUSH_NUDGE_KEY = 'bpm_push_nudge_dismissed';

/**
 * One-time nudge towards notifications, under the install banner on Home.
 *
 * The monthly UX report (2026-11-02): 3 of 41 members have push on, and only
 * 2 of 5 new members came back within 14 days. Push is how a member hears
 * "sign-ups are open" without opening the app, so Grant asked for a nudge:
 *
 * - **In the store app with notifications off**, it turns them on in place
 *   (`usePush().enable()`, the same call as Profile's switch).
 * - **On the web**, it points to the iPhone and Android app, through the same
 *   "Move to the app" sheet as Profile — web push reaches almost nobody (an
 *   iPhone needs the home-screen install first), and the app carries the
 *   account across with one code.
 *
 * Nothing renders for a state it cannot help: notifications already on, a
 * denied permission (JS cannot re-ask; Profile says so honestly), a probe that
 * has not answered (unknown is not "off"), or the web with the migration link
 * switched off. Dismissing it or acting on it is remembered on the device and
 * it never comes back; the same controls stay in Profile.
 *
 * Icons are `notifications` and `install_mobile`, both already in the
 * self-hosted subset — a new glyph means rebuilding the icon font.
 */
export default function PushNudge() {
  const native = useClientValue(isNative, false);
  // Server answer is "dismissed", so nothing renders until the device is read.
  const stored = useClientValue(() => readStored(PUSH_NUDGE_KEY) === '1', true);
  const [dismissed, setDismissed] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const migrateOn = isFlagOn('NEXT_PUBLIC_FLAG_NATIVE_MIGRATE');

  const remember = () => {
    setDismissed(true);
    try {
      localStorage.setItem(PUSH_NUDGE_KEY, '1');
    } catch {
      /* private mode — dismissed for this page view only */
    }
  };

  const showCard = !stored && !dismissed;

  if (native) return showCard ? <NativeNudge onDone={remember} /> : null;
  if (!migrateOn) return null;

  return (
    <>
      {showCard && (
        <WebNudge
          onDismiss={remember}
          onOpen={() => {
            // Acting on it counts as seeing it. The sheet stays mounted below,
            // so remembering here does not close it.
            remember();
            setSheetOpen(true);
          }}
        />
      )}
      <MigrateSheet open={sheetOpen} onClose={() => setSheetOpen(false)} />
    </>
  );
}

function NativeNudge({ onDone }: { onDone: () => void }) {
  const t = useTranslations('pushNudge');
  const online = useOnline();
  const { state, enable, busy } = usePush();

  if (state.status !== 'off') return null;

  return (
    <NudgeCard
      icon="notifications"
      title={t('nativeTitle')}
      body={t('nativeBody')}
      cta={t('nativeCta')}
      ctaDisabled={busy || !online}
      onCta={() => {
        onDone();
        void enable();
      }}
      onDismiss={onDone}
      dismissLabel={t('dismiss')}
    />
  );
}

function WebNudge({ onOpen, onDismiss }: { onOpen: () => void; onDismiss: () => void }) {
  const t = useTranslations('pushNudge');
  // The web card's promise is "hear when sign-ups open", and a browser that
  // already has push on hears it. Only a CONFIRMED on hides the card: holding
  // it back while the probe runs would pop it in late and shove Home for the
  // many who have push off (the loading rule, CLAUDE.md), so the few with it
  // on see the card leave instead. `usePush` only probes (`getRegistration`),
  // so this installs no worker.
  const { state } = usePush();
  if (state.status === 'on') return null;
  return (
    <NudgeCard
      icon="install_mobile"
      title={t('webTitle')}
      body={t('webBody')}
      cta={t('webCta')}
      onCta={onOpen}
      onDismiss={onDismiss}
      dismissLabel={t('dismiss')}
    />
  );
}

/** The install banner's shape, so the two nudges read as one family. */
function NudgeCard({
  icon,
  title,
  body,
  cta,
  ctaDisabled = false,
  onCta,
  onDismiss,
  dismissLabel,
}: {
  icon: string;
  title: string;
  body: string;
  cta: string;
  ctaDisabled?: boolean;
  onCta: () => void;
  onDismiss: () => void;
  dismissLabel: string;
}) {
  return (
    <div className="glass-card p-4" style={{ display: 'flex', alignItems: 'flex-start', gap: 'var(--space-4)' }}>
      <span
        aria-hidden="true"
        className="material-icons"
        style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent)', flex: '0 0 auto' }}
      >
        {icon}
      </span>
      <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
        <p style={{ margin: '0', fontSize: 'var(--fs-md)', color: 'var(--text-primary)' }}>{title}</p>
        <p style={{ margin: '0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{body}</p>
        <button
          type="button"
          onClick={onCta}
          disabled={ctaDisabled}
          style={{
            margin: '0',
            padding: '0',
            alignSelf: 'flex-start',
            background: 'none',
            border: 'none',
            fontSize: 'var(--fs-sm)',
            color: 'var(--accent)',
            fontWeight: 600,
            cursor: ctaDisabled ? 'default' : 'pointer',
            opacity: ctaDisabled ? 0.5 : 1,
          }}
        >
          {cta}
        </button>
      </div>
      <button
        type="button"
        onClick={onDismiss}
        aria-label={dismissLabel}
        className="cc-btn cc-btn-ghost"
        style={{ padding: 'var(--space-2)', flex: '0 0 auto' }}
      >
        <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-md)' }}>
          close
        </span>
      </button>
    </div>
  );
}
