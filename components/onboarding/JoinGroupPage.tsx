'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { parseInviteInput } from '@/lib/parseInviteInput';
import { useOnline } from '@/lib/useOnline';
import AuthStage from './AuthStage';
import ClubLinkPage from './ClubLinkPage';
import { useDoorStep } from './SignInPieces';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  /** Kept for callers; joining no longer writes the local identity here. */
  sessionId?: string;
  /** From `?join=` / `?claim=` when a link brought them here. */
  initialToken?: string | null;
  /** The name this device already goes by. */
  defaultName?: string;
  /** True when the caller is already in another club — changes the copy, not the action. */
  hasOtherGroup?: boolean;
  /** The account turned out to be in the club already. */
  onJoined?: () => void;
  /**
   * After asking (docs/plans/one-way-in.md, step 4): the no-club screen
   * reloads into its waiting page. Absent, Done goes back.
   */
  onAsked?: () => void;
  /** Kept for callers; a member here is signed in, so there is no account step. */
  authProviders?: unknown;
}

/**
 * "Join another club" for someone already signed in, on the sign-in layout
 * (docs/plans/sign-in-redesign.md): scan the club's QR code (or paste its
 * link), then "What's your name?" — step 1 of 2 — and the ask; step 2 is
 * "Request sent". An organizer lets them in and they hear it by email and
 * push. The club's link is the only way in (docs/plans/one-way-in.md, step 5).
 */
export default function JoinGroupPage({ onBack, initialToken, defaultName, hasOtherGroup, onJoined, onAsked }: Props) {
  const t = useTranslations('onboarding.join');
  const ts = useTranslations('signedOut');
  const tn = useTranslations('signedOut.name');
  const tw = useTranslations('signedOut.waiting');
  const doorStep = useDoorStep();
  const online = useOnline();
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [found, setFound] = useState<{ name: string; token: string } | null>(null);
  const [asked, setAsked] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The link they arrived with did not check out. */
  const [landingError, setLandingError] = useState<string | null>(null);

  // A link landing names the club at once, so the page opens on the name step.
  useEffect(() => {
    if (!initialToken) return;
    const { token } = parseInviteInput(initialToken, window.location.origin);
    if (!token) return;
    let live = true;
    fetch(`${BASE}/api/groups/preview?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setLandingError(res.status === 404 ? t('linkNotFound') : t('failed'));
          return;
        }
        const data = (await res.json()) as { name?: string };
        if (typeof data.name === 'string') setFound({ name: data.name, token });
      })
      .catch(() => {
        if (live) setLandingError(t('failed'));
      });
    return () => {
      live = false;
    };
  }, [initialToken, t]);

  async function askToJoin() {
    if (!found || busy || !online) return;
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

  if (!found) {
    return (
      <ClubLinkPage
        key={landingError ?? 'scan'}
        landingError={landingError}
        title={t('title')}
        heading={ts('join.heading')}
        copy={ts('join.body')}
        scanAt="middle"
        onBack={onBack}
        onLink={(token, club) => setFound({ token, name: club ?? '' })}
      />
    );
  }

  const title = found.name ? ts('door.title', { club: found.name }) : ts('door.titleNoClub');

  if (asked) {
    return (
      <AuthStage
        data-page="request-sent"
        title={title}
        backLabel={ts('back')}
        step={doorStep(2, 2)}
        heading={tw('sentHeading')}
        copy={
          <>
            <p className="auth-copy" role="status">
              {tw('sentBody')}
            </p>
            <p className="auth-note">{tw('lasts')}</p>
          </>
        }
        actions={
          <button type="button" className="auth-btn auth-btn--primary" onClick={() => (onAsked ? onAsked() : onBack())}>
            {t('done')}
          </button>
        }
      />
    );
  }

  return (
    <AuthStage
      data-page="join-name"
      title={title}
      onBack={() => {
        setFound(null);
        setError(null);
      }}
      backLabel={ts('back')}
      step={doorStep(1, 2)}
      heading={tn('heading')}
      copy={hasOtherGroup ? <p className="auth-note">{t('switchNote')}</p> : undefined}
      actions={
        <>
          {error && (
            <p className="field-error" role="alert">
              {error}
            </p>
          )}
          <button
            type="button"
            className="auth-btn auth-btn--primary"
            disabled={busy || !online || !rosterName.trim()}
            onClick={() => void askToJoin()}
          >
            {busy ? tn('asking') : tn('ask')}
          </button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void askToJoin();
        }}
      >
        <input
          className="auth-field"
          type="text"
          value={rosterName}
          onChange={(e) => {
            setRosterName(e.target.value);
            setError(null);
          }}
          maxLength={40}
          placeholder={tn('label')}
          aria-label={tn('label')}
          autoComplete="nickname"
        />
      </form>
    </AuthStage>
  );
}
