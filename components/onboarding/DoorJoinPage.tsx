'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useTagline } from '@/components/onboarding/TaglineContext';
import type { Provider } from '@/components/auth/ProviderButtons';
import { useEmailCode } from '@/components/auth/useEmailCode';
import { markOnboardingResume } from '@/lib/onboardingResume';
import { setIdentity } from '@/lib/identity';
import { markJustAsked } from '@/lib/justAsked';
import AuthStage from './AuthStage';
import NameStep from './NameStep';
import { CheckEmailPage, EmailCodeChoices, useDoorStep } from './SignInPieces';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  /** The club's link, from `/bpm/j/<token>` or `?claim=`. */
  token: string;
  authProviders: Provider[];
  onBack: () => void;
  /** Back from Google or Apple with a new sign-in: straight to the name. */
  startAtName?: boolean;
  /** The native shell's name step hands its return code back to the app. */
  onReturnCode?: (code: string) => void;
}

/**
 * Joining a club through its link, signed out (docs/plans/one-way-in.md,
 * step 4; drawn in docs/plans/sign-in-redesign.md). Three steps, each a page
 * on the sign-in layout:
 *
 *   1. Sign in — Apple, Google or an email code ("Check your email").
 *   2. "What's your name?" — the shared `NameStep`, which asks.
 *   3. "Request sent" — on the far side of the reload signing in causes, as
 *      the no-club waiting page (`lib/justAsked.ts` tells it this is the
 *      first time it is shown).
 *
 * An address that already has an account is signed in by its code and asks
 * at once, under the name it already goes by. Someone on the list who never
 * signed in comes in the same way, and the organizer links the two at
 * approval (step 4b).
 */
export default function DoorJoinPage({ token, authProviders, onBack, startAtName, onReturnCode }: Props) {
  const t = useTranslations('signedOut');
  const td = useTranslations('signedOut.door');
  const tagline = useTagline();
  const doorStep = useDoorStep();
  const [club, setClub] = useState<string | null>(null);
  const [linkDead, setLinkDead] = useState(false);
  const [naming, setNaming] = useState(!!startAtName);
  /** An existing account signed in, and its ask did not go through. */
  const [askFailed, setAskFailed] = useState<{ name: string; message: string } | null>(null);
  const [asking, setAsking] = useState(false);

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
  const title = club ? td('title', { club }) : td('titleNoClub');

  /** Asked: sign the phone in, which reloads into the waiting page. */
  function asked(name: string) {
    markJustAsked(clubName);
    setIdentity({ name, sessionId: '' });
  }

  async function askSignedIn(accountName: string) {
    // An existing account proved its address: it is signed in now, so it
    // asks as itself, under the name it already goes by.
    setAsking(true);
    setAskFailed(null);
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
      if (res.ok) {
        asked(accountName);
        return;
      }
      setAskFailed({ name: accountName, message: res.status === 409 ? td('busy', { club: clubName }) : td('failed') });
    } catch {
      setAskFailed({ name: accountName, message: td('failed') });
    }
    setAsking(false);
  }

  const code = useEmailCode({
    doorToken: token,
    onNewAccount: () => setNaming(true),
    onSuccess: ({ name }) => void askSignedIn(name),
  });

  if (linkDead) {
    return (
      <AuthStage
        data-page="link-dead"
        title={td('titleNoClub')}
        onBack={onBack}
        backLabel={t('back')}
        heading={td('deadHeading')}
        copy={<p className="auth-copy">{td('deadBody')}</p>}
        actions={
          <button type="button" className="auth-btn auth-btn--neutral" onClick={onBack}>
            {td('back')}
          </button>
        }
      />
    );
  }

  if (askFailed) {
    return (
      <AuthStage
        data-page="ask-failed"
        title={title}
        backLabel={t('back')}
        heading={td('askFailedHeading')}
        copy={
          <p className="field-error" role="alert">
            {askFailed.message}
          </p>
        }
        actions={
          <button
            type="button"
            className="auth-btn auth-btn--primary"
            disabled={asking}
            onClick={() => void askSignedIn(askFailed.name)}
          >
            {asking ? td('asking') : td('tryAgain')}
          </button>
        }
      />
    );
  }

  if (naming) {
    return (
      <NameStep
        title={title}
        onBack={() => {
          setNaming(false);
          code.restart();
        }}
        step={doorStep(2)}
        inviteToken={token}
        club={club}
        prefill={!!startAtName}
        onMade={asked}
        onReturnCode={onReturnCode}
      />
    );
  }

  if (code.step === 'code') {
    return <CheckEmailPage code={code} title={title} step={doorStep(1)} definite />;
  }

  return (
    <AuthStage data-page="door" title={title} onBack={onBack} backLabel={t('back')} logoTagline={tagline}>
      {/* The link must survive the trip to Google or Apple: the callback
          builds its return URL from scratch, so the resume is the only thing
          that comes back. It rides as an invite token, which
          `signupGroupFor` reads as the club's link. */}
      <EmailCodeChoices code={code} authProviders={authProviders} onLeave={() => markOnboardingResume('join', token)} />
      {asking && (
        <p role="status" className="auth-note" style={{ textAlign: 'center' }}>
          {td('asking')}
        </p>
      )}
    </AuthStage>
  );
}
