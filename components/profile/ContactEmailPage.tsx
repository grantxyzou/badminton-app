'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import { useOnline } from '@/lib/useOnline';
import { isRefused } from '@/lib/apiFetch';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "Contact email" (docs/superpowers/specs/2026-11-09-profile-reorg-design.md
 * §2, Q3 — Grant, 2026-11-11: "Q3 yes"). An address the member's club can
 * reach them at. It is NOT a way to sign in and is never verified, so the page
 * says both; the sign-in email, when there is one, is shown read-only on Edit
 * profile beside it.
 *
 * A page with one field, like "Your name" beside it. Saving writes
 * `PATCH /api/members/me { contactEmail }` with the member's own cookie, and
 * "Remove" clears it.
 */
export default function ContactEmailPage({
  name,
  current,
  clubName,
  onSaved,
  onBack,
}: {
  /** The member's name in this club (the route resolves it inside the club). */
  name: string;
  current: string | null;
  /** The club's name, when known. */
  clubName: string | null;
  onSaved: (next: string | null) => void;
  onBack: () => void;
}) {
  const t = useTranslations('profile.contactEmail');
  const online = useOnline();
  const [value, setValue] = useState(current ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = value.trim();
  const changed = trimmed.toLowerCase() !== (current ?? '');
  const canSave = online && !busy && trimmed.length > 0 && changed;
  const club = clubName ?? t('theClub');

  async function send(next: string | null) {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/members/me`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, contactEmail: next ?? '' }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'invalid_email') setError(t('invalid'));
        else if (res.status === 429) setError(t('rateLimited'));
        else if (isRefused(res)) setError(t('signedOut'));
        else setError(t('failed'));
        setBusy(false);
        return;
      }
      onSaved(typeof data.contactEmail === 'string' ? data.contactEmail : null);
      onBack();
    } catch {
      setError(t('failed'));
      setBusy(false);
    }
  }

  function save(e: React.FormEvent) {
    e.preventDefault();
    if (canSave) void send(trimmed);
  }

  return (
    // NOT a header-only wrapper: TopBar is sticky (StatsPrivacyScreen says why).
    <div className="animate-slideInRight space-y-5" data-contact-email-page>
      <TopBar title={t('title')} onBack={onBack} backLabel={t('back')} />
      <form className="glass-card p-5" onSubmit={save} style={{ display: 'grid', gap: 'var(--space-4)' }}>
        <h2 className="bpm-h3" style={{ margin: 0 }}>{t('question', { club })}</h2>
        <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('body', { club })}</p>
        <label style={{ display: 'grid', gap: 'var(--space-1)' }}>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('label')}</span>
          <input
            type="email"
            inputMode="email"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              setError(null);
            }}
            aria-label={t('label')}
            maxLength={254}
            autoComplete="email"
            autoCapitalize="none"
            spellCheck={false}
            enterKeyHint="done"
          />
          <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t('note')}</span>
        </label>
        {error && <p className="field-error" role="alert">{error}</p>}
        <button type="submit" className="btn-primary" style={{ width: '100%' }} disabled={!canSave}>
          {busy ? t('saving') : t('save')}
        </button>
        {current && (
          <button
            type="button"
            className="link-quiet"
            disabled={!online || busy}
            onClick={() => void send(null)}
          >
            {t('remove')}
          </button>
        )}
      </form>
    </div>
  );
}
