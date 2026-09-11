'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import ProviderButtons, { type Provider } from '@/components/auth/ProviderButtons';
import EmailSignUpForm from '@/components/auth/EmailSignUpForm';
import EmailSignInForm from '@/components/auth/EmailSignInForm';
import { setIdentity } from '@/lib/identity';
import { isFlagOn } from '@/lib/flags';
import { clearOnboardingResume, markOnboardingResume } from '@/lib/onboardingResume';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  sessionId: string;
  /** Prefilled from `?join=` when a link brought them here. */
  initialToken?: string | null;
  /** The name this device already goes by. */
  defaultName?: string;
  /** True when the caller is already in another club — changes the copy, not the action. */
  hasOtherGroup?: boolean;
  onJoined?: () => void;
  /** Server-resolved, so the account step does not paint form-first. */
  authProviders?: Provider[];
}

/**
 * The "Join with a link or code" door, as a PAGE. See `CreateGroupPage` for why
 * these stopped being bottom sheets.
 *
 * TWO STEPS WITH REAL NAVIGATION BETWEEN THEM, which is most of the reason a
 * sheet was the wrong container. Back from the confirm step returns to the
 * entry field rather than throwing the whole flow away — a sheet's only
 * gesture is dismiss, so a mistyped code used to cost you the screen.
 *
 * IT CONFIRMS BEFORE IT JOINS, even when a link brought the person straight
 * here. Joining puts your name on somebody else's roster, and the club sees it;
 * that is not a thing to do to someone because they tapped a URL in a group
 * chat. The link resolves to a NAME first (`GET /api/groups/preview`, the one
 * unauthenticated route, which returns the club's name and nothing else), and
 * the join waits for a deliberate second tap.
 *
 * ALREADY IN ANOTHER CLUB? It joins and switches, and says so. Both memberships
 * stay; "Your groups" on Profile is the way back. Refusing would be worse —
 * people belong to two clubs, and that is the entire premise here.
 *
 * ONE INPUT FOR BOTH FORMS. A pasted link and a typed code go in the same box
 * and are told apart here, because nobody holding an invite thinks of
 * themselves as holding one of two kinds of invite.
 */
export default function JoinGroupPage({
  onBack,
  sessionId,
  initialToken,
  defaultName,
  hasOtherGroup,
  onJoined,
  authProviders = [],
}: Props) {
  const t = useTranslations('onboarding.join');
  const tAuth = useTranslations('profile.auth');
  const [entry, setEntry] = useState('');
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [found, setFound] = useState<{ name: string; token?: string; code?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * THE ACCOUNT STEP, reached only by being refused.
   *
   * Joining needs an account and the PIN path is invite-list gated, so a
   * stranger following a club's link cannot get one that way. The page used to
   * say "sign up on Profile" and offer no way to Profile — accurate, and a dead
   * end, which is the same shape as a button that does nothing.
   *
   * Unlike `CreateGroupPage` this step is NOT entered up front. A join link is
   * mostly tapped by people who already have accounts, and asking all of them
   * to prove it first would tax the many for the few. The 401 is the only
   * authority on which case this is, so it decides.
   */
  const [step, setStep] = useState<'form' | 'auth'>('form');
  const [credMode, setCredMode] = useState<'signup' | 'signin'>('signup');
  const [mailNote, setMailNote] = useState<string | null>(null);
  /** Set when the person already tapped Join, so signing in resumes it. */
  const wantedToJoin = useRef(false);

  // A `?join=` landing resolves the club immediately, so the page opens already
  // saying whose it is rather than asking for what is in the URL bar.
  useEffect(() => {
    if (!initialToken) return;
    void resolve(initialToken);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialToken]);

  /**
   * A link or a code, out of one box. A link's token is the `?join=` parameter;
   * anything else is treated as a code, with separators stripped the way the
   * server strips them.
   */
  function parse(raw: string): { token?: string; code?: string } {
    const trimmed = raw.trim();
    if (!trimmed) return {};
    if (/^https?:\/\//i.test(trimmed) || trimmed.includes('?join=')) {
      try {
        const url = new URL(trimmed, window.location.origin);
        const token = url.searchParams.get('join');
        if (token) return { token };
      } catch {
        // Not a URL after all — fall through and try it as a code.
      }
    }
    if (/^[0-9a-f]{32}$/i.test(trimmed)) return { token: trimmed };
    return { code: trimmed };
  }

  async function resolve(raw: string) {
    const parsed = parse(raw);
    if (!parsed.token && !parsed.code) return;
    setBusy(true);
    setError(null);
    try {
      const query = parsed.token
        ? `token=${encodeURIComponent(parsed.token)}`
        : `code=${encodeURIComponent(parsed.code!)}`;
      const res = await fetch(`${BASE}/api/groups/preview?${query}`, { cache: 'no-store' });
      if (!res.ok) {
        setError(t('notFound'));
        return;
      }
      const data = (await res.json()) as { name: string };
      setFound({ name: data.name, ...parsed });
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  async function join() {
    if (!found || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...(found.token ? { token: found.token } : { code: found.code }),
          ...(rosterName.trim() ? { name: rosterName.trim() } : {}),
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        // Joining needs an ACCOUNT, and the PIN path is invite-list gated so a
        // stranger cannot get one that way. The token rides through the signup
        // terminals, so they do not have to come back and re-open the link.
        if (res.status === 401) {
          // Not a failure to report — a step to take. The tap they already made
          // is remembered and replayed once they have an account.
          wantedToJoin.current = true;
          setStep('auth');
          setError(null);
          setBusy(false);
          return;
        }
        if (data.error === 'roster_name_taken') setError(t('nameTaken'));
        else if (data.error === 'invite_not_found') setError(t('notFound'));
        else setError(t('failed'));
        setBusy(false);
        return;
      }
      setIdentity({ name: data.rosterName ?? rosterName.trim(), sessionId });
      onJoined?.();
      onBack();
    } catch {
      setError(t('failed'));
      setBusy(false);
    }
  }

  /** With the providers flag off this step can offer nothing — say so instead. */
  const canOfferCredential = authProviders.length > 0 || isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS');

  /**
   * Signed in here. Replays the Join they already tapped rather than making
   * them tap it twice — the account step was an interruption, not a new intent.
   */
  function signedInHere(name: string, verificationSent = true) {
    setIdentity({ name, sessionId });
    clearOnboardingResume();
    if (!verificationSent) setMailNote(tAuth('verifyMailUnsent'));
    setStep('form');
    setRosterName((n) => n || name);
    if (wantedToJoin.current) {
      wantedToJoin.current = false;
      void join();
    }
  }

  /** Back steps WITHIN the flow before it leaves it — see the header note. */
  function stepBack() {
    if (step === 'auth') {
      // Back out of the account step to the club it was for, not out of the
      // flow — they still hold an invite and may have an account after all.
      setStep('form');
      clearOnboardingResume();
      return;
    }
    if (found) {
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
        // The title keeps naming the CLUB across the account step: the goal has
        // not changed, only the obstacle.
        crumb={t('crumb')}
        onBack={stepBack}
        backLabel={t('backLabel')}
      />

      <div style={{ display: 'grid', gap: 'var(--space-5)', padding: '0 var(--space-5) var(--space-9)' }}>
        {step === 'auth' ? (
          <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>
              {t('auth.body', { name: found?.name ?? '' })}
            </p>

            {!canOfferCredential ? (
              <>
                <p className="field-error">{t('needsAccount', { name: found?.name ?? '' })}</p>
                <button type="button" onClick={onBack} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
                  {t('backLabel')}
                </button>
              </>
            ) : (
              <>
                {/* The token rides through signup, so the account lands in THIS
                    club rather than on BPM's roster with the real club added on
                    top. `onLeave` records the flow for the trip to Google. */}
                <ProviderButtons
                  mode="signin"
                  available={authProviders}
                  onLeave={() => markOnboardingResume('join', found?.token)}
                />

                {authProviders.length > 0 && (
                  <p style={{ margin: 0, textAlign: 'center', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                    {t('auth.or')}
                  </p>
                )}

                {credMode === 'signup' ? (
                  <EmailSignUpForm
                    inviteToken={found?.token}
                    onSuccess={({ name: n, verificationSent }) => signedInHere(n, verificationSent)}
                  />
                ) : (
                  <EmailSignInForm onSuccess={({ name: n }) => signedInHere(n)} />
                )}

                <button
                  type="button"
                  onClick={() => setCredMode((m) => (m === 'signup' ? 'signin' : 'signup'))}
                  className="link-quiet"
                  style={{ justifySelf: 'center' }}
                >
                  {credMode === 'signup' ? t('auth.haveAccount') : t('auth.needAccount')}
                </button>
              </>
            )}
          </div>
        ) : found ? (
          <>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('foundHint')}</p>
            {mailNote && (
              <p role="status" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {mailNote}
              </p>
            )}
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

            {error && <p className="field-error">{error}</p>}

            <button
              type="button"
              onClick={join}
              disabled={busy || !rosterName.trim()}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('joining') : t('confirm', { name: found.name })}
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
                value={entry}
                onChange={(e) => {
                  setEntry(e.target.value);
                  setError(null);
                }}
                placeholder={t('codePlaceholder')}
                maxLength={200}
                autoFocus
                autoCapitalize="characters"
                autoCorrect="off"
                spellCheck={false}
                aria-label={t('codeLabel')}
              />
            </label>

            {error && <p className="field-error">{error}</p>}

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
