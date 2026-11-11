'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import { useOnline } from '@/lib/useOnline';
import { hardReload } from '@/lib/reload';
import { ROSTER_NAME_MAX } from '@/lib/nameLimits';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "What should the club call you?" (docs/plans/profile-nickname.md).
 *
 * The one name the club knows a member by — on the sign-up list, kudos and
 * receipts — set by the member. Not a second name: the app keeps one name per
 * club, and this changes it (Grant, 2026-11-08, choosing this over a separate
 * username). The pattern is Cash App's "What name do you prefer to go by?":
 * one question, one field, the reason underneath.
 *
 * A page, like Stats & privacy beside it. Saving reloads, because the name is
 * the server's answer to "who is signed in" (the page gate reads it from the
 * club's roster) and every tab already holds the old one.
 */
export default function NicknamePage({
  currentName,
  clubName,
  onBack,
}: {
  currentName: string;
  /** The club's name, when known. */
  clubName: string | null;
  onBack: () => void;
}) {
  const t = useTranslations('profile.nickname');
  const online = useOnline();
  const [name, setName] = useState(currentName);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim().replace(/\s+/g, ' ');
  const changed = trimmed !== currentName;
  const canSave = online && !busy && trimmed.length > 0 && changed;
  const club = clubName ?? t('theClub');

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!canSave) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/members/me/name`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'name_taken') setError(t('taken', { name: trimmed, club }));
        else if (data.error === 'invalid_name') setError(t('invalid'));
        else if (res.status === 429) setError(t('rateLimited'));
        else if (res.status === 401) setError(t('signedOut'));
        else setError(t('failed'));
        setBusy(false);
        return;
      }
      // The server is the source of "who is signed in": ask it again.
      hardReload();
    } catch {
      setError(t('failed'));
      setBusy(false);
    }
  }

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight space-y-5" data-nickname-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />
      <form className="glass-card p-5" onSubmit={save} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <h2 className="bpm-h3" style={{ margin: 0 }}>{t('question', { club })}</h2>
        <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('body')}</p>
        <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('label')}</span>
          <input
            type="text"
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              setError(null);
            }}
            aria-label={t('label')}
            maxLength={ROSTER_NAME_MAX}
            autoComplete="nickname"
            enterKeyHint="done"
          />
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('note', { club })}</span>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!canSave}>
          {busy ? t('saving') : t('save')}
        </button>
      </form>
    </div>
  );
}
