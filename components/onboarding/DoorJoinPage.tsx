'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import ProviderButtons, { type Provider } from '@/components/auth/ProviderButtons';
import EmailCodeSignInForm from '@/components/auth/EmailCodeSignInForm';
import { markOnboardingResume } from '@/lib/onboardingResume';
import { setIdentity } from '@/lib/identity';
import { isFullName } from '@/lib/fullName';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /** The club's link, from `/bpm/j/<token>` or `?claim=`. */
  token: string;
  authProviders: Provider[];
  onBack: () => void;
}

type Stage = 'start' | 'name' | 'asked';

/**
 * Joining a club through its link, signed out (docs/plans/one-way-in.md,
 * step 4). Sign in first, with Apple, Google or an email code; then the name
 * the club will see; then the ask. The account exists before anyone says yes,
 * so there is nothing to keep open: the organiser lets them in, and they hear
 * it by email.
 *
 * Three ways through:
 *  - Google or Apple: the provider's round trip carries the link in the
 *    onboarding resume, the name step is the existing name sheet, and the
 *    sign-up sends the link as its invite (`signupGroupFor` reads it).
 *  - An email code for a NEW address: `verify` parks the address, this page
 *    asks for the name and makes the account (`complete-signup`), which asks.
 *  - An email code for an address that already has an account: signed in,
 *    then asked with `POST /api/groups/ask` under the account's name.
 *
 * Someone already on the list who has never signed in comes in the same way,
 * under the name the club knows; the organiser links the two at approval
 * (step 4b). The name-only claim that used to sit under this page went in
 * step 4d.
 *
 * The identity is written only when they leave the "asked" screen, because
 * writing it reloads this page into the app (or the waiting screen).
 */
export default function DoorJoinPage({ token, authProviders, onBack }: Props) {
  const t = useTranslations('signedOut');
  const online = useOnline();
  const [club, setClub] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);
  const [stage, setStage] = useState<Stage>('start');
  const [name, setName] = useState('');
  const [hinted, setHinted] = useState<string | null>(null);
  const [signedInAs, setSignedInAs] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    fetch(`${BASE}/api/groups/preview?token=${encodeURIComponent(token)}`, { cache: 'no-store' })
      .then(async (res) => {
        if (!live) return;
        if (!res.ok) {
          setLinkDead(res.status === 404);
          return;
        }
        const body = (await res.json().catch(() => null)) as { name?: string } | null;
        if (typeof body?.name === 'string') setClub(body.name);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [token]);

  const clubName = club ?? '';

  async function askSignedIn(accountName: string) {
    // An existing account proved its address: it is signed in now, so ask
    // as itself, under the name it already goes by.
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/ask`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ doorToken: token, name: accountName }),
      });
      const body = (await res.json().catch(() => ({}))) as { alreadyIn?: boolean };
      if (res.ok && body.alreadyIn) {
        setIdentity({ name: accountName, sessionId: '' });
        return;
      }
      if (!res.ok) {
        setError(res.status === 409 ? t('door.busy', { club: clubName }) : t('door.failed'));
        setSignedInAs(accountName);
        setBusy(false);
        return;
      }
      setSignedInAs(accountName);
      setStage('asked');
    } catch {
      setError(t('door.failed'));
    }
    setBusy(false);
  }

  async function makeAccountAndAsk() {
    const trimmed = name.trim();
    if (!trimmed || busy || !online) return;
    // A first and last name helps the organiser know who is asking, but a
    // club may know someone by one name: a hint once, then it goes.
    if (!isFullName(trimmed) && hinted !== trimmed) {
      setHinted(trimmed);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/auth/complete-signup`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, inviteToken: token }),
      });
      if (res.status === 201) {
        setSignedInAs(trimmed);
        setStage('asked');
      } else if (res.status === 409) {
        setError(t('door.emailTaken'));
      } else if (res.status === 404) {
        setError(t('signup.linkNotFound'));
      } else {
        setError(t('door.failed'));
      }
    } catch {
      setError(t('door.failed'));
    }
    setBusy(false);
  }

  const title = club ? t('door.title', { club }) : t('door.titleNoClub');

  if (linkDead) {
    return (
      <div className="animate-fadeIn">
        <TopBar title={t('door.titleNoClub')} onBack={onBack} backLabel={t('back')} />
        <p className="field-error" role="alert">{t('signup.linkNotFound')}</p>
      </div>
    );
  }

  if (stage === 'asked') {
    return (
      <div className="animate-fadeIn">
        <TopBar title={title} backLabel={t('back')} />
        <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
          <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)' }}>
            <p className="bpm-h3" style={{ margin: 0 }} role="status">
              {t('door.askedTitle', { club: clubName })}
            </p>
            <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('door.askedBody')}</p>
            <button
              type="button"
              className="btn-primary"
              style={{ width: '100%' }}
              onClick={() => setIdentity({ name: signedInAs ?? name.trim(), sessionId: '' })}
            >
              {t('door.done')}
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (stage === 'name') {
    const oneWord = name.trim().length > 0 && !isFullName(name.trim());
    return (
      <div className="animate-fadeIn">
        <TopBar title={title} onBack={() => setStage('start')} backLabel={t('back')} />
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void makeAccountAndAsk();
          }}
          style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}
        >
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('door.nameBody')}</p>
          <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-3)', padding: 'var(--space-5)' }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('door.nameLabel')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                aria-label={t('door.nameLabel')}
                autoComplete="name"
                maxLength={50}
                autoFocus
              />
              {hinted !== null && oneWord && (
                <span className="field-warn" role="status">{t('door.nameHint')}</span>
              )}
            </label>
            {error && <p className="field-error" role="alert">{error}</p>}
            <button
              type="submit"
              className="btn-primary"
              style={{ width: '100%' }}
              disabled={busy || !online || !name.trim()}
            >
              {busy ? t('door.asking') : t('door.askCta')}
            </button>
          </div>
        </form>
      </div>
    );
  }

  return (
    <div className="animate-fadeIn">
      <TopBar title={title} onBack={onBack} backLabel={t('back')} />
      <div style={{ display: 'grid', gap: 'var(--space-5)', paddingBlock: '0 var(--space-9)' }}>
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('door.body')}</p>
        <div className="glass-card" style={{ display: 'grid', gap: 'var(--space-4)', padding: 'var(--space-5)' }}>
          {authProviders.length > 0 && (
            <>
              {/* The link must survive the trip to Google or Apple: the
                  callback builds its return URL from scratch, so the resume
                  is the only thing that comes back. It rides as an invite
                  token, which `signupGroupFor` reads as the club's link. */}
              <ProviderButtons mode="signin" available={authProviders} onLeave={() => markOnboardingResume('join', token)} />
              <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {t('signup.or')}
              </p>
            </>
          )}
          <EmailCodeSignInForm
            doorToken={token}
            onNewAccount={() => setStage('name')}
            onSuccess={({ name: accountName }) => void askSignedIn(accountName)}
          />
          {busy && <p role="status" className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{t('door.asking')}</p>}
          {error && <p className="field-error" role="alert">{error}</p>}
        </div>
      </div>
    </div>
  );
}
