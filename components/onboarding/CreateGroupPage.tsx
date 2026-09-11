'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import { setIdentity } from '@/lib/identity';
import InviteShare from './InviteShare';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  onDone: () => void;
  sessionId: string;
  /** The name this device already goes by, prefilled as the roster name. */
  defaultName?: string;
  onCreated?: () => void;
}

/**
 * The "Create a group" door, as a PAGE.
 *
 * It was a bottom sheet and that was wrong. A sheet is a quick action taken
 * inside a context you are already in and will return to — change a PIN, give
 * a kudos. Creating your club is the opposite: it is the first-run task, there
 * is no context behind it worth preserving, and the half-height sheet left the
 * most important screen in the app peering out from under a scrim.
 *
 * So: full screen, `TopBar`, and a back chevron to the doors. That header also
 * brings Escape-to-close and the edge swipe-back gesture, which a sheet's drag
 * handle only approximates.
 *
 * IT DOES NOT LEAVE ON SUCCESS. It swaps to a success step holding the invite
 * link, the same argument `AdvanceSessionForm`'s success screen makes: the
 * moment a club exists is the moment its organiser wants to invite people, and
 * a screen that vanishes sends them hunting through Admin for a link they were
 * holding a second ago. The back affordance becomes "Done".
 */
export default function CreateGroupPage({ onBack, onDone, sessionId, defaultName, onCreated }: Props) {
  const t = useTranslations('onboarding.create');
  const [name, setName] = useState('');
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string; code: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t('nameTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, ...(rosterName.trim() ? { rosterName: rosterName.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // 401 is the door's real gap, not a server problem: creating a club
        // needs an ACCOUNT, and an anonymous session sign-up is not one.
        if (res.status === 401) setError(t('needsAccount'));
        else if (data.error === 'too_many_groups') setError(t('tooMany'));
        else if (data.error === 'invalid_name') setError(t('nameTooShort'));
        else setError(t('failed'));
        setBusy(false);
        return;
      }
      // The server re-minted both cookies for the new club; mirror the roster
      // name into localStorage so the rest of the app agrees about who this is.
      setIdentity({ name: data.rosterName ?? rosterName.trim(), sessionId });
      setCreated({
        name: data.group?.name ?? trimmed,
        token: data.invite?.token ?? '',
        code: data.invite?.code ?? '',
      });
      onCreated?.();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="animate-fadeIn">
      <TopBar
        title={created ? t('created', { name: created.name }) : t('title')}
        crumb={t('crumb')}
        // No way back once the club exists — there is nothing to go back TO,
        // and the only remaining action is to finish.
        onBack={created ? undefined : onBack}
        backLabel={t('backLabel')}
      />

      <div style={{ display: 'grid', gap: 'var(--space-5)', padding: '0 var(--space-5) var(--space-9)' }}>
        {created ? (
          <>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('createdHint')}</p>
            <InviteShare token={created.token} code={created.code} groupName={created.name} />
            <button type="button" onClick={onDone} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
              {t('done')}
            </button>
          </>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('subtitle')}</p>

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('nameLabel')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder={t('namePlaceholder')}
                maxLength={40}
                autoFocus
                aria-label={t('nameLabel')}
              />
            </label>

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('yourNameLabel')}</span>
              <input
                type="text"
                value={rosterName}
                onChange={(e) => setRosterName(e.target.value)}
                maxLength={40}
                aria-label={t('yourNameLabel')}
                autoComplete="nickname"
              />
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('yourNameHint')}</span>
            </label>

            {error && <p className="field-error">{error}</p>}

            <button
              type="submit"
              disabled={busy || name.trim().length < 2}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('creating') : t('submit')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
