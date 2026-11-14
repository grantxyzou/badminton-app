'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import { parseInviteInput } from '@/lib/parseInviteInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  /** Kept for callers; joining no longer writes the local identity here. */
  sessionId?: string;
  /** Prefilled from `?join=` / `?claim=` when a link brought them here. */
  initialToken?: string | null;
  /** The name this device already goes by. */
  defaultName?: string;
  /** True when the caller is already in another club — changes the copy, not the action. */
  hasOtherGroup?: boolean;
  /** The account turned out to be in the club already. */
  onJoined?: () => void;
  /**
   * After asking (docs/plans/one-way-in.md, step 4): the no-club screen
   * reloads into its waiting card. Absent, Done goes back.
   */
  onAsked?: () => void;
  /** Kept for callers; a member here is signed in, so there is no account step. */
  authProviders?: unknown;
}

/**
 * "Join another club" for a signed-in member, as a PAGE (see `CreateGroupPage`
 * for why these stopped being bottom sheets).
 *
 * The club's LINK is the only way into a club (docs/plans/one-way-in.md, step
 * 5): paste it, or arrive with it, and the page names the club
 * (`GET /api/groups/preview`, which returns the name and nothing else). The
 * member gives the name this club will see and ASKS (`POST /api/groups/ask`);
 * an organiser lets them in and they hear it by email and push. Until step 5
 * a one-time invite or its typed code joined at once from here, and a
 * signed-out person was offered an account step; both are gone.
 *
 * Back from the club step returns to the field rather than leaving: a
 * mistyped link should not cost the screen.
 */
export default function JoinGroupPage({ onBack, initialToken, defaultName, hasOtherGroup, onJoined, onAsked }: Props) {
  const t = useTranslations('onboarding.join');
  const [entry, setEntry] = useState('');
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [found, setFound] = useState<{ name: string; token: string } | null>(null);
  /** Asked to join through a club's link; an organiser decides. */
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // A link landing resolves the club at once, so the page opens already saying
  // whose it is rather than asking for what is in the URL bar.
  useEffect(() => {
    if (!initialToken) return;
    void resolve(initialToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  async function resolve(raw: string) {
    const { token } = parseInviteInput(raw, window.location.origin);
    if (!token) {
      // A typed code named a one-time invite, retired in step 5.
      setError(t('needLink'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/preview?token=${encodeURIComponent(token)}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(res.status === 404 ? t('linkNotFound') : t('failed'));
        return;
      }
      const data = (await res.json()) as { name: string };
      setFound({ name: data.name, token });
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  async function askToJoin() {
    if (!found || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doorToken: found.token, name: rosterName.trim() }),
      });
      const data = (await res.json().catch(() => ({}))) as { alreadyIn?: boolean };
      if (res.ok && data.alreadyIn) {
        onJoined?.();
        onBack();
        return;
      }
      if (res.ok) setAsked(true);
      else if (res.status === 404) setError(t('linkNotFound'));
      else if (res.status === 409) setError(t('busy', { name: found.name }));
      else setError(t('failed'));
    } catch {
      setError(t('failed'));
    }
    setBusy(false);
  }

  /** Back steps WITHIN the flow before it leaves it. */
  function stepBack() {
    if (found && !asked) {
      setFound(null);
      setError(null);
      return;
    }
    onBack();
  }

  return (
    <div className="animate-fadeIn">
      <TopBar
        title={found ? t('foundTitle', { name: found.name }) : t('title')}
        crumb={t('crumb')}
        onBack={stepBack}
        backLabel={t('backLabel')}
      />

      <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
        {found && asked ? (
          <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)' }}>
            <p className="bpm-h3" role="status" style={{ margin: 0 }}>
              {t('askedTitle', { name: found.name })}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('askedBody')}</p>
            <button type="button" className="btn-primary" style={{ width: '100%' }} onClick={() => (onAsked ? onAsked() : onBack())}>
              {t('done')}
            </button>
          </div>
        ) : found ? (
          <>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('doorHint')}</p>
            {hasOtherGroup && (
              <p style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', margin: 0 }}>
                {t('switchNote', { name: found.name })}
              </p>
            )}

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('yourNameLabel')}</span>
              <input
                type="text"
                value={rosterName}
                onChange={(e) => {
                  setRosterName(e.target.value);
                  setError(null);
                }}
                maxLength={40}
                aria-label={t('yourNameLabel')}
                autoComplete="nickname"
              />
            </label>

            {error && <p className="field-error" role="alert">{error}</p>}

            <button
              type="button"
              onClick={() => void askToJoin()}
              disabled={busy || !rosterName.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('joining') : t('askCta', { name: found.name })}
            </button>
          </>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void resolve(entry);
            }}
            style={{ display: 'grid', gap: 'var(--space-5)' }}
          >
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('subtitle')}</p>

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('codeLabel')}</span>
              <input
                type="text"
                inputMode="url"
                value={entry}
                onChange={(e) => {
                  setEntry(e.target.value);
                  setError(null);
                }}
                placeholder={t('codePlaceholder')}
                maxLength={200}
                autoFocus
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('codeLabel')}
              />
            </label>

            {error && <p className="field-error" role="alert">{error}</p>}

            <button
              type="submit"
              disabled={busy || !entry.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('checking') : t('check')}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
