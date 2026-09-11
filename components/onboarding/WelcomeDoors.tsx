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
 * joiners mostly arrive on a link that opens the join page directly and never
 * read this screen at all. "I already have an account" is last and quiet — the
 * returning-player path, frequent but never the FIRST thing someone does.
 *
 * ALL THREE ARE THE SAME OBJECT. They were a `.cc-btn-lg` and two glass cards,
 * which gave the primary a different radius, padding and height from its
 * neighbours, and left its label floating beside a gap (that class forces
 * `justify-content: center`, which on a grid centres the whole text block).
 * Three choices should read as three choices; accent alone says which one to
 * take. The shape lives in `globals.css` as `.onboarding-door`.
 *
 * No horizontal padding here — `<main>` already supplies the content column's
 * gutter, and adding a second one made this screen's margins disagree with
 * every other screen in the app.
 */
export default function WelcomeDoors({ onCreate, onJoin, onExisting }: Props) {
  const t = useTranslations('onboarding');

  return (
    <div style={{ display: 'grid', gap: 'var(--space-7)', paddingBlock: 'var(--space-8) var(--space-9)' }}>
      <header style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <h1 className="bpm-h1" style={{ margin: 0 }}>
          {t('welcome')}
        </h1>
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('lead')}</p>
      </header>

      <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
        <Door primary title={t('createDoor')} hint={t('createDoorHint')} onClick={onCreate} />
        <Door title={t('joinDoor')} hint={t('joinDoorHint')} onClick={onJoin} />
        <Door title={t('existingDoor')} hint={t('existingDoorHint')} onClick={onExisting} />
      </div>
    </div>
  );
}

function Door({
  title,
  hint,
  onClick,
  primary,
}: {
  title: string;
  hint: string;
  onClick: () => void;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`onboarding-door${primary ? ' onboarding-door--primary' : ''}`}
    >
      <span className="onboarding-door__title">{title}</span>
      <span className="onboarding-door__hint">{hint}</span>
    </button>
  );
}
