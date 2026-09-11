'use client';

import { useTranslations } from 'next-intl';

interface Props {
  onCreate: () => void;
  onJoin: () => void;
  onExisting: () => void;
}

/**
 * First launch, no identity: the three doors.
 *
 * This is what a stranger who downloads the app from a store sees before
 * anything else exists for them — no session, no roster, no club. The whole job
 * is to make the next tap obvious, so it is three destinations and nothing
 * else: no marketing, no feature tour, no sign-in form competing for the same
 * screen.
 *
 * ORDER IS A PRODUCT CLAIM. "Create a group" is first because the app is for
 * the person who organises; they are the one who brings everybody else, and the
 * joiners mostly arrive on a link that opens the join sheet directly and never
 * read this screen at all. "I already have an account" is last and quiet — it
 * is the returning-player path, which is frequent but never the FIRST thing
 * someone does.
 *
 * ACCENT IS SPENT ONCE. The Home hierarchy rule says green marks the one thing
 * worth tapping, so the primary door is filled and the other two are plain
 * cards. Three equally loud buttons is the same as none.
 */
export default function WelcomeDoors({ onCreate, onJoin, onExisting }: Props) {
  const t = useTranslations('onboarding');

  return (
    <div style={{ display: 'grid', gap: 'var(--space-7)', padding: 'var(--space-9) var(--space-7)' }}>
      <header style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <h1 className="bpm-h1" style={{ margin: 0 }}>
          {t('welcome')}
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('lead')}</p>
      </header>

      <div style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <button
          type="button"
          onClick={onCreate}
          className="cc-btn cc-btn-primary cc-btn-lg"
          style={{ width: '100%', display: 'grid', gap: 'var(--space-hair)', textAlign: 'left' }}
        >
          <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600 }}>{t('createDoor')}</span>
          <span style={{ fontSize: 'var(--fs-sm)', opacity: 0.8 }}>{t('createDoorHint')}</span>
        </button>

        <Door title={t('joinDoor')} hint={t('joinDoorHint')} onClick={onJoin} />
        <Door title={t('existingDoor')} hint={t('existingDoorHint')} onClick={onExisting} />
      </div>
    </div>
  );
}

/** A secondary door: a card that is a button, not a button dressed as a card. */
function Door({ title, hint, onClick }: { title: string; hint: string; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="glass-card"
      style={{
        width: '100%',
        textAlign: 'left',
        padding: 'var(--space-5)',
        display: 'grid',
        gap: 'var(--space-hair)',
        cursor: 'pointer',
        border: 'none',
      }}
    >
      <span style={{ fontSize: 'var(--fs-md)', fontWeight: 600, color: 'var(--text-primary)' }}>{title}</span>
      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{hint}</span>
    </button>
  );
}
