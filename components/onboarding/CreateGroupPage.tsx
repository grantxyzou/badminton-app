'use client';

import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import ProviderButtons, { type Provider } from '@/components/auth/ProviderButtons';
import EmailSignUpForm from '@/components/auth/EmailSignUpForm';
import EmailSignInForm from '@/components/auth/EmailSignInForm';
import { getIdentity, setIdentity, IDENTITY_EVENT } from '@/lib/identity';
import { isFlagOn } from '@/lib/flags';
import { clearOnboardingResume, markOnboardingResume } from '@/lib/onboardingResume';
import InviteShare from './InviteShare';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  onDone: () => void;
  sessionId: string;
  /** The name this device already goes by, prefilled as the roster name. */
  defaultName?: string;
  onCreated?: () => void;
  /**
   * FIRST PAINT ONLY — a `useState` initializer, never a controlled value. A
   * later resolution must not yank the step out from under someone already
   * typing; the probe below is the only thing allowed to move it.
   */
  startAtAuth?: boolean;
  /**
   * Resolved on the SERVER (`app/page.tsx`) and threaded through HomeShell, so
   * the auth step does not paint form-first and then shove everything down when
   * a client probe answers. Same reason the prop exists on `ProviderButtons`.
   */
  authProviders?: Provider[];
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
export default function CreateGroupPage({
  onBack,
  onDone,
  sessionId,
  defaultName,
  onCreated,
  startAtAuth,
  authProviders = [],
}: Props) {
  const t = useTranslations('onboarding.create');
  const tAuth = useTranslations('profile.auth');
  const [name, setName] = useState('');
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string; code: string } | null>(null);
  const [step, setStep] = useState<'auth' | 'form'>(startAtAuth ? 'auth' : 'form');
  const [credMode, setCredMode] = useState<'signup' | 'signin'>('signup');
  const [mailNote, setMailNote] = useState<string | null>(null);
  /** False once anything has been typed — a demote must never discard work. */
  const pristine = useRef(true);

  /**
   * A CLUB NEEDS AN OWNER, so this flow needs an account before it needs a name.
   *
   * `hasIdentity` cannot answer whether one exists: localStorage identity is
   * also written by an anonymous session sign-up, and a live 30-day
   * `member_session` outlives a cleared localStorage. `/api/auth/me` is the only
   * authority and is cheap — an in-process signature check, no database read.
   *
   * It corrects in BOTH directions but acts on KNOWN answers only.
   * `signedIn: null` is throttled, a 404 is the providers flag being off, and a
   * network failure is a network failure: all three are unknown, and unknown is
   * neither known-true nor known-false, so none of them moves the step.
   */
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/auth/me`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { signedIn?: boolean | null } | null) => {
        if (cancelled || !d) return;
        if (d.signedIn === true) setStep((s) => (s === 'auth' ? 'form' : s));
        if (d.signedIn === false) setStep((s) => (s === 'form' && pristine.current ? 'auth' : s));
      })
      .catch(() => {
        /* Unknown. The app-wide offline banner owns this story. */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  /**
   * The INSTALLED-PWA return, where the document never died.
   *
   * The system-browser sheet closes, HomeShell's collector claims the parked
   * sign-in and calls `setIdentity` — and this component was never unmounted,
   * so nothing in HomeShell's param effect ever ran and no resume was armed.
   * The event IS the signal here. Deliberately separate from that mechanism:
   * one runs when this component still exists, the other when it does not, and
   * they cannot be collapsed.
   */
  useEffect(() => {
    const onIdentity = () => {
      if (getIdentity() === null) return; // a sign-out, not a sign-in
      clearOnboardingResume();
      setStep((s) => (s === 'auth' ? 'form' : s));
      seedRosterName();
    };
    window.addEventListener(IDENTITY_EVENT, onIdentity);
    return () => window.removeEventListener(IDENTITY_EVENT, onIdentity);
  }, []);

  /**
   * `defaultName` is read at HomeShell's render time and is `undefined` on both
   * arrival paths into this step, so without this the "Your name in this group"
   * field is empty for everyone who came through it. `|| n` first: never
   * overwrite something already typed.
   */
  function seedRosterName() {
    setRosterName((n) => n || getIdentity()?.name || '');
  }

  function signedInHere(name: string, verificationSent = true) {
    setIdentity({ name, sessionId });
    clearOnboardingResume();
    if (!verificationSent) setMailNote(tAuth('verifyMailUnsent'));
    setStep('form');
    setRosterName((n) => n || name);
  }

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
        // 401 means no account, and the server is the only fully authoritative
        // answer about that. Land them on the step that FIXES it rather than on
        // a sentence describing it — this used to render "go to Profile and
        // come back", which is a detour on the most important path in the app.
        if (res.status === 401) {
          setStep('auth');
          setError(null);
          setBusy(false);
          return;
        }
        if (data.error === 'too_many_groups') setError(t('tooMany'));
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

  /**
   * Back LEAVES the flow on both steps — this is not a stack.
   *
   * `JoinGroupPage.stepBack` does the opposite and is right to: its first step
   * is an invite field you might have mistyped, so back-to-edit is what you
   * want. An account step you have already PASSED is not re-enterable — going
   * back to it would show a sign-up form to someone who just signed up, and the
   * probe would bounce them forward again. Keeping both steps identical also
   * keeps Escape and the edge swipe-back honest: `TopBar` binds both to
   * `onBack`, and a gesture that means two different things depending on an
   * invisible step is worse than one that always leaves.
   */
  function handleBack() {
    if (step === 'auth') clearOnboardingResume(); // a deliberate abandonment
    onBack();
  }

  /**
   * With the providers flag off this step can offer NOTHING: `authProviders` is
   * empty and both signup routes 404. Rendering an email form guaranteed to
   * fail is the lying-empty-state rule applied to a capability, so say the true
   * thing instead — which is exactly what shipped before this step existed.
   */
  const canOfferCredential = authProviders.length > 0 || isFlagOn('NEXT_PUBLIC_FLAG_AUTH_PROVIDERS');

  return (
    <div className="animate-fadeIn">
      <TopBar
        /* The TITLE does not change between steps. The person's goal has not
           changed, and a title that renames itself mid-task reads as two tasks;
           the step-specific line lives in the body copy. */
        title={created ? t('created', { name: created.name }) : t('title')}
        crumb={t('crumb')}
        // No way back once the club exists — there is nothing to go back TO,
        // and the only remaining action is to finish.
        onBack={created ? undefined : handleBack}
        backLabel={t('backLabel')}
      />

      <div style={{ display: 'grid', gap: 'var(--space-5)', padding: '0 var(--space-5) var(--space-9)' }}>
        {!created && step === 'auth' ? (
          <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>
              {t('auth.body')}
            </p>

            {!canOfferCredential ? (
              <>
                <p className="field-error">{t('needsAccount')}</p>
                <button type="button" onClick={handleBack} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
                  {t('backLabel')}
                </button>
              </>
            ) : (
              <>
                {/* `onLeave` records the intent SYNCHRONOUSLY at the tap. The
                    OAuth callback builds its return URL from scratch, so this
                    record is the only thing that comes back with them. */}
                <ProviderButtons
                  mode="signin"
                  available={authProviders}
                  onLeave={() => markOnboardingResume('create')}
                />

                {authProviders.length > 0 && (
                  /* A divider with nothing above it is just a line. */
                  <p
                    style={{
                      margin: 0,
                      textAlign: 'center',
                      fontSize: 'var(--fs-sm)',
                      color: 'var(--text-muted)',
                    }}
                  >
                    {t('auth.or')}
                  </p>
                )}

                {credMode === 'signup' ? (
                  <EmailSignUpForm
                    noGroup
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
        ) : created ? (
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

            {/* "Real account, no mail" — carried from the signup step, because
                a page has nowhere to dismiss the note TO. */}
            {mailNote && (
              <p role="status" style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {mailNote}
              </p>
            )}

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('nameLabel')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  pristine.current = false;
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
                onChange={(e) => {
                  pristine.current = false;
                  setRosterName(e.target.value);
                }}
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
