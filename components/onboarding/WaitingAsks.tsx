'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { useClientValue } from '@/lib/useClientValue';
import { consumeJustAsked } from '@/lib/justAsked';
import AuthStage from './AuthStage';
import { useDoorStep } from './SignInPieces';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const POLL_MS = 20_000;

export interface Ask {
  groupId: string;
  club: string;
  name: string | null;
  state: 'waiting' | 'in' | 'closed';
}

interface Props {
  asks: Ask[];
  /** Let in: the cookie is moved to the club and the page reloads into it. */
  onIn: () => void;
  /** "Join another club". */
  onJoin: () => void;
  /** "Use a different account". */
  onSignOut: () => void;
}

/* Read once per page load, then remembered, so a re-render does not lose it
   and the server's render (which cannot know) is what hydration matches. */
let justAsked: string | null | undefined;
const readJustAsked = () => {
  if (justAsked === undefined) justAsked = consumeJustAsked();
  return justAsked;
};

/**
 * ONE WAITING PAGE (docs/plans/sign-in-redesign.md, merge 3): an account that
 * asked to join through a club's link and is in no club yet. Three states of
 * the same page, so the title and the button never move between them:
 *
 *   - "Request sent", step 3 of 3 — the first time, straight after asking;
 *   - "Your request is still pending" — every time after;
 *   - "Not this time" — declined, or no answer before it closed. The app
 *     treats both as `closed`, and so does the page.
 *
 * A request stays open for three days (`ACCOUNT_ASK_TTL_MS`; Grant: "Request
 * shouldn't be a long wait time"), and the page says so. The yes arrives by
 * email, so nothing here has to stay open; while it IS open it checks back
 * every twenty seconds and when the app comes to the front, and moves straight
 * into the club once let in. Only the person's own asks, so saying "not this
 * time" tells them nothing about anyone else.
 */
export default function WaitingAsks({ asks: initial, onIn, onJoin, onSignOut }: Props) {
  const t = useTranslations('signedOut');
  const tw = useTranslations('signedOut.waiting');
  const doorStep = useDoorStep();
  const [asks, setAsks] = useState<Ask[]>(initial);
  const moving = useRef(false);
  const justAskedClub = useClientValue(readJustAsked, null);

  const enter = useCallback(
    async (groupId: string) => {
      if (moving.current) return;
      moving.current = true;
      try {
        await fetch(`${BASE}/api/groups/switch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ groupId }),
        });
      } catch {
        /* the reload still shows the club in their list */
      }
      onIn();
    },
    [onIn],
  );

  const check = useCallback(async () => {
    try {
      const res = await fetch(`${BASE}/api/groups/ask`, { cache: 'no-store' });
      if (!res.ok) return;
      const body = (await res.json()) as { asks?: Ask[] };
      if (!Array.isArray(body.asks)) return;
      const inNow = body.asks.find((a) => a.state === 'in' && asks.some((w) => w.groupId === a.groupId));
      if (inNow) {
        void enter(inNow.groupId);
        return;
      }
      setAsks(body.asks.filter((a) => a.state !== 'in'));
    } catch {
      /* a missed check is retried on the next tick */
    }
  }, [asks, enter]);

  const waiting = asks.some((a) => a.state === 'waiting');
  useEffect(() => {
    if (!waiting) return;
    const tick = () => {
      if (document.visibilityState === 'visible') void check();
    };
    const timer = window.setInterval(tick, POLL_MS);
    document.addEventListener('visibilitychange', tick);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', tick);
    };
  }, [waiting, check]);

  // The page speaks for one request: the one still waiting, else the latest
  // answer. Any others are named under it.
  const main = asks.find((a) => a.state === 'waiting') ?? asks[0];
  if (!main) return null;
  const others = asks.filter((a) => a !== main);
  const sent = main.state === 'waiting' && justAskedClub !== null;

  const joinAnother = (
    <button type="button" className="auth-btn auth-btn--neutral" onClick={onJoin}>
      {tw('joinAnother')}
    </button>
  );
  // On every state: someone in no club has no Profile tab, so this page is
  // the only way to end the session (a shared phone, the wrong Apple or
  // Google account).
  const signOut = (
    <button type="button" className="link-quiet" onClick={onSignOut}>
      {tw('otherAccount')}
    </button>
  );
  const alsoLines = others.map((a) => (
    <p key={a.groupId} className="auth-note">
      {a.state === 'waiting' ? tw('alsoWaiting', { club: a.club }) : tw('alsoClosed', { club: a.club })}
    </p>
  ));

  if (main.state === 'closed') {
    return (
      <AuthStage
        data-page="not-this-time"
        title={tw('pageTitle')}
        backLabel={t('back')}
        heading={tw('closedHeading')}
        copy={
          <>
            <p className="auth-copy" role="status">
              {tw('closedBody')}
            </p>
            {alsoLines}
          </>
        }
        actions={joinAnother}
        links={signOut}
      />
    );
  }

  return (
    <AuthStage
      data-page={sent ? 'request-sent' : 'still-pending'}
      title={tw('pageTitle')}
      backLabel={t('back')}
      step={sent ? doorStep(3) : undefined}
      heading={sent ? tw('sentHeading') : tw('pendingHeading')}
      copy={
        <>
          <p className="auth-copy" role="status">
            {sent ? tw('sentBody') : tw('pendingBody')}
          </p>
          <p className="auth-note">{tw('lasts')}</p>
          {alsoLines}
        </>
      }
      actions={
        <>
          {joinAnother}
          {!sent && (
            /* Drawn greyed out on the canvas (Grant, 2026-11-19: "Create a club
               below join another. Disable it"). */
            <button type="button" className="auth-btn auth-btn--neutral" disabled>
              {tw('startClub')}
            </button>
          )}
        </>
      }
      links={signOut}
    />
  );
}
