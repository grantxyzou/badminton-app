'use client';

import { useState, useEffect, useCallback } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import type { Session, Player, Announcement, Release } from '@/lib/types';
import type { DevOverrides } from '@/components/DevPanel';
import { getIdentity, setIdentity, clearIdentity, resolveStaleIdentity } from '@/lib/identity';
import { TabSkeleton } from '@/components/primitives/CardSkeleton';
import UnpaidSessionsCard from '@/components/UnpaidSessionsCard';
import InstallBanner from '@/components/InstallBanner';
import ReleaseNotesTrigger from './ReleaseNotesTrigger';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import WelcomeCard from './WelcomeCard';
import StatusBanner from '@/components/primitives/StatusBanner';
import PageHeader from '@/components/primitives/PageHeader';
import EnterCodeSheet from './EnterCodeSheet';
import PinInput from './PinInput';
import NameAutocompleteInput from './home/NameAutocompleteInput';
import SkillDiscoveryCard from './home/SkillDiscoveryCard';
import { useMemberProbe } from '@/lib/useHasPin';
import { useOnline } from '@/lib/useOnline';
import { renderMarkdown } from '@/lib/miniMarkdown';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;
const TIME_SHORT = { hour: '2-digit', minute: '2-digit' } as const;

interface HomeTabProps {
  onTabChange?: (tab: 'home' | 'players' | 'skills' | 'admin') => void;
  onTitleTap?: () => void;
  devOverrides?: DevOverrides;
  /**
   * Server-rendered initial announcement, plumbed through from
   * `app/page.tsx` via `<HomeShell>`. Used as the seed value for
   * the announcement state so the LCP element is in the initial HTML
   * payload — the loadData useEffect still re-fetches in the
   * background to keep things fresh on long-lived tabs.
   */
  initialAnnouncement?: Announcement | null;
}

export default function HomeTab({ onTabChange, onTitleTap, devOverrides, initialAnnouncement = null }: HomeTabProps) {
  const t = useTranslations('home');
  const tStates = useTranslations('home.states');
  const format = useFormatter();
  const online = useOnline();
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(initialAnnouncement);
  const [currentUser, setCurrentUser] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Unified sign-up form auth state. PIN inputs reveal inline based on
  // the member probe — no separate sign-in card, no Create Account sheet
  // on Home. (Per Figma 138 + 139, supersedes #89.)
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const memberProbe = useMemberProbe(name);
  const authMode: 'anon' | 'sign-in' | 'create' =
    // Trusted device: the PIN was already proven here (member_session cookie),
    // so render one-tap sign-up (no PIN field) and POST { name } — the server
    // accepts the cookie as identity proof. Same form shape as anon.
    memberProbe?.hasPin && memberProbe?.authed ? 'anon'
    : memberProbe?.hasPin ? 'sign-in'
    : memberProbe?.exists ? 'create'
    : 'anon';
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [hasIdentity, setHasIdentity] = useState(false);
  // Sign up = session signup only (auth taxonomy split). PIN is no longer
  // collected here — it's an opt-in identity primitive, set via Profile →
  // Create account / Set PIN. Returning players who already have a PIN can
  // tap "Already a player? Sign in →" to authenticate via RecoverySheet.
  const [onboardingDismissed, setOnboardingDismissed] = useState(() => {
    if (typeof window === 'undefined') return true;
    return localStorage.getItem('badminton_onboarding_dismissed') === 'true';
  });
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  // True only for the render right after a successful sign-up, so the success
  // banner pops once on the *act* of signing up — not on every Home revisit
  // (it resets to false when the tab remounts). Delight on a rare moment.
  const [justSignedUp, setJustSignedUp] = useState(false);
  // Forgot-PIN handoff from the inline sign-in form opens this code-entry sheet.
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);

  const maxPlayers = parseInt(process.env.NEXT_PUBLIC_MAX_PLAYERS ?? '12');

  const loadData = useCallback(async () => {
    setLoading(true);
    try {
      const [sRes, pRes, aRes, mRes, rRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }).catch(() => null),
        fetch(`${BASE}/api/releases`, { cache: 'no-store' }).catch(() => null),
      ]);
      if (sRes.ok) {
        const s: Session = await sRes.json();
        setSession(s);
        const stored = getIdentity();
        if (stored && stored.sessionId && stored.sessionId !== s.id) {
          // Stale identity. Probe /api/members/me to learn if this name is
          // a PIN-protected member (auth survives session boundaries) or
          // anonymous (deleteToken bound to old session, both stale).
          let hasPin = false;
          try {
            const meRes = await fetch(
              `${BASE}/api/members/me?name=${encodeURIComponent(stored.name)}`,
              { cache: 'no-store' },
            );
            if (meRes.ok) {
              const me = (await meRes.json()) as { hasPin?: boolean };
              hasPin = me.hasPin === true;
            }
          } catch {
            // Network failure → resolveStaleIdentity falls through to clear.
          }
          const decision = resolveStaleIdentity(stored, s.id, hasPin);
          if (decision.action === 'preserve') {
            setIdentity(decision.identity);
            setCurrentUser(decision.identity.name);
            setHasIdentity(true);
          } else if (decision.action === 'clear') {
            clearIdentity();
            setCurrentUser(null);
            setHasIdentity(false);
          }
        }
      }
      if (pRes.ok) setPlayers(await pRes.json());
      if (aRes.ok) {
        const list: Announcement[] = await aRes.json();
        setAnnouncement(list.length > 0 ? list[0] : null);
      }
      if (mRes?.ok) {
        const memberList: { name: string; active: boolean }[] = await mRes.json();
        setMemberNames(memberList.filter(m => m.active).map(m => m.name));
      }
      if (rRes && rRes.ok) setReleases(await rRes.json());
    } catch (e) {
      console.error('Load error:', e);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const id = getIdentity();
    setHasIdentity(id !== null);
    if (id) {
      setCurrentUser(id.name);
      // Seed the sign-up name from the logged-in identity so a returning member
      // isn't treated like an anonymous typist. This fires `useMemberProbe`
      // for their name → a trusted device (member_session cookie) resolves to
      // `authMode: 'anon'`, rendering one-tap sign-up with no PIN field. The
      // field stays editable (e.g. to sign up a friend on a shared device).
      setName(id.name);
    }
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (hasIdentity && !onboardingDismissed) {
      localStorage.setItem('badminton_onboarding_dismissed', 'true');
      setOnboardingDismissed(true);
    }
  }, [hasIdentity, onboardingDismissed]);

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  const isSignedUp = currentUser
    ? activePlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isWaitlisted = currentUser
    ? waitlistPlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isFull = activePlayers.length >= (session?.maxPlayers ?? maxPlayers);
  const suggestions = name.trim().length > 0
    ? memberNames.filter(n => n.toLowerCase().includes(name.toLowerCase().trim()))
    : [];
  const spotsTotal = session?.maxPlayers ?? maxPlayers;
  const isDeadlinePast = session ? new Date() > new Date(session.deadline) : false;
  const isSessionFinished = session?.endDatetime ? new Date() > new Date(session.endDatetime) : false;
  const isSignupClosed = session ? session.signupOpen === false : false;

  const isDeadlineApproaching = session?.deadline
    ? (() => { const diff = new Date(session.deadline).getTime() - Date.now(); return diff > 0 && diff <= 24 * 60 * 60 * 1000; })()
    : false;

  const waitlistPosition = isWaitlisted && currentUser
    ? waitlistPlayers.findIndex(p => p.name.toLowerCase() === currentUser.toLowerCase()) + 1
    : 0;

  const dv = devOverrides;

  // Dev overrides for announcement visibility and signed-up state
  const effectiveAnnouncement = dv?.hasAnnouncement === false ? null
    : dv?.hasAnnouncement === true && !announcement ? { id: 'dev', text: 'Dev mode announcement — testing cost visibility.', time: new Date().toISOString(), sessionId: '' } as Announcement
    : announcement;
  const effectiveIsSignedUp = dv?.isSignedUp !== undefined ? dv.isSignedUp : isSignedUp;

  // Stable identities so memoized children (WelcomeCard / ReleaseNotesTrigger)
  // don't re-render when HomeTab's frequently-changing state ticks (e.g. name
  // input keystrokes). Setters from useState are already stable.
  const dismissOnboarding = useCallback(() => {
    localStorage.setItem('badminton_onboarding_dismissed', 'true');
    setOnboardingDismissed(true);
  }, []);
  const openReleaseSheet = useCallback(() => setReleaseSheetOpen(true), []);

  // Unified sign-up + waitlist submit. `waitlist` adds `waitlist: true` to the
  // POST body and tunes the failure copy — otherwise the auth flow (anon /
  // sign-in PIN / create PIN) is identical, so a PIN-protected member can join
  // the waitlist with the same inline PIN field the open-signup form uses.
  async function performSignup(waitlist: boolean) {
    // Legible-fail: refuse the mutation with a clear reason instead of
    // firing a fetch that throws and leaves the form in limbo.
    if (!online) { setError(t('signup.offline')); return; }
    const trimmed = name.trim();
    if (!trimmed) { setError(t('signup.nameRequired')); return; }

    // Per-mode pre-flight validation. The probe drives form shape but the
    // server-side check is still authoritative — the modes here just save
    // round-trips when the client already knows what's missing.
    if (authMode === 'sign-in' && pin.length !== 4) {
      setError(t('signup.nameRequired'));
      return;
    }
    if (authMode === 'create') {
      if (pin.length !== 4 || confirmPin.length !== 4) {
        setError(t('signup.nameRequired'));
        return;
      }
      if (pin !== confirmPin) {
        setError(t('signup.pinMismatch'));
        return;
      }
    }

    setIsSubmitting(true);
    setError('');
    try {
      if (authMode === 'sign-in') {
        // Step 1: verify PIN via /recover (returns identity, no session player).
        const recRes = await fetch(`${BASE}/api/players/recover`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, sessionId: session?.id ?? '', pin }),
        });
        if (!recRes.ok) {
          if (recRes.status === 429) setError(t('signup.networkError'));
          else if (recRes.status >= 500) setError(t('signup.networkError'));
          else setError(t('signup.pinIncorrect'));
          return;
        }
        // Step 2: register for this week's session. Re-send the PIN so the
        // /api/players anti-impersonation guard accepts the request — without
        // it, the route sees a PIN'd member + no PIN + no admin cookie and
        // returns 401 pin_required. /recover doesn't grant any auth cookie,
        // so each call needs its own credential.
        const signupRes = await fetch(`${BASE}/api/players`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name: trimmed, pin, ...(waitlist ? { waitlist: true } : {}) }),
        });
        const signupData = await signupRes.json();
        if (!signupRes.ok) {
          setError(signupData.error ?? (waitlist ? t('signup.waitlistFailure') : t('signup.genericFailure')));
          if (signupRes.status === 409) loadData();
          return;
        }
        if (!session?.id) { setError(t('signup.networkError')); return; }
        setIdentity({ name: trimmed, token: signupData.deleteToken ?? '', sessionId: session.id });
        setCurrentUser(trimmed);
        setHasIdentity(true);
        if (!waitlist) setJustSignedUp(true);
        await loadData();
      } else {
        // 'anon' and 'create' both go through POST /api/players. The only
        // difference is whether `pin` is included. The server validates
        // (e.g. rejects 'pin_too_common', enforces invite list).
        const body: Record<string, unknown> = { name: trimmed };
        if (authMode === 'create') body.pin = pin;
        if (waitlist) body.waitlist = true;
        const res = await fetch(`${BASE}/api/players`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        });
        const data = await res.json();
        if (!res.ok) {
          if (data.error === 'invite_list_not_found') {
            setError(t('signup.inviteError', { name: trimmed }));
          } else if (data.error === 'pin_required') {
            // Server insists on PIN — probe may have been stale.
            setError(t('signup.pinRequired'));
          } else if (data.error === 'pin_too_common' || data.error === 'Invalid PIN format') {
            setError(t('signup.pinTooCommon'));
          } else {
            setError(data.error ?? (waitlist ? t('signup.waitlistFailure') : t('signup.genericFailure')));
          }
          if (res.status === 409) loadData();
          return;
        }
        if (!session?.id) { setError(t('signup.networkError')); return; }
        setIdentity({ name: trimmed, token: data.deleteToken ?? '', sessionId: session.id });
        setCurrentUser(trimmed);
        setHasIdentity(true);
        if (!waitlist) setJustSignedUp(true);
        await loadData();
      }
    } catch {
      setError(t('signup.networkError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    await performSignup(false);
  }

  async function handleJoinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    await performSignup(true);
  }

  if (loading) {
    // Render the REAL header (its slot is static text, no data) and skeleton
    // only the data cards below it — same pattern as PlayersTab — so the page
    // keeps its exact shape and fills in top-to-bottom instead of flashing a
    // generic block then snapping the layout in.
    return (
      <div className="space-y-5">
        <PageHeader>BPM Badminton</PageHeader>
        <TabSkeleton />
      </div>
    );
  }

  const mapsUrl = session?.locationAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(session.locationAddress)}`
    : null;

  return (
    <div className="space-y-5">
      {!hasIdentity && !onboardingDismissed && (
        <WelcomeCard onDismiss={dismissOnboarding} />
      )}

      {/* PageHeader must be a DIRECT child of this space-y-5 scroll root so its
          position:sticky containing block is the full tab. Wrapping it (with the
          release trigger) in a short <div> made the containing block ~43px tall,
          so the "BPM Badminton" bar un-stuck instantly and scrolled off instead
          of condensing like every other tab. The version stamp stays tight under
          the title via inline marginTop (beats the space-y-5 gap).
          The easter-egg `onTitleTap` lives on the inner span so PageHeader owns
          the scroll-condense. */}
      <PageHeader>
        <span
          role="button"
          tabIndex={0}
          onClick={onTitleTap}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTitleTap?.(); }
          }}
          style={{ cursor: 'default', userSelect: 'none' }}
        >
          BPM Badminton
        </span>
      </PageHeader>
      <div style={{ marginTop: 4 }}>
        <ReleaseNotesTrigger
          releases={releases}
          onOpen={openReleaseSheet}
        />
      </div>

      {/* Reveal the data cards together on load. Wrapping below the sticky
          PageHeader keeps the header out of the transform (containing-block
          trap) while the card stack fades in once when data lands. */}
      <div className="space-y-5 animate-fadeIn">
      {/* One-time nudge to install to the home screen (mobile browser only). */}
      <InstallBanner />
      {/* Tile row: Location | Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        {/* Location tile */}
        <div className="glass-card p-4 space-y-2">
          <p className="section-label mb-1">{t('location.label')}</p>
          {session?.locationName && (
            <p className="text-lg font-semibold text-gray-200 leading-snug line-clamp-2">
              {session.locationName}
            </p>
          )}
          {session?.locationAddress ? (
            mapsUrl ? (
              <a
                href={mapsUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="fs-sm text-gray-300 underline underline-offset-2 decoration-dotted line-clamp-2 block"
              >
                {session.locationAddress}
              </a>
            ) : (
              <p className="fs-sm text-gray-300 line-clamp-2">{session.locationAddress}</p>
            )
          ) : null}
        </div>

        {/* Date & Time tile */}
        <div className="glass-card p-4 space-y-2">
          <p className="section-label mb-1">{t('session.date')}</p>
          <p className="text-lg font-semibold text-gray-200 leading-snug">
            {session ? format.dateTime(new Date(session.datetime), DAY_LONG) : '—'}
          </p>
          <p className="text-lg font-semibold text-gray-200 leading-snug">
            {session ? format.dateTime(new Date(session.datetime), TIME_SHORT) : '—'}
          </p>
        </div>
      </div>

      {/* What the signed-in player still owes — across every past session they
          weren't marked paid (frozen amount where settled, computed share where
          not). Replaces the old per-person cost estimate. Same data as the
          Profile card (shared /api/players/unpaid), so the two always agree. */}
      {currentUser && <UnpaidSessionsCard name={currentUser} variant="home" />}

      {/* Announcement card — pure club communications surface. */}
      {effectiveAnnouncement && (
        <div className="glass-card p-5 space-y-2">
          <p className="section-label">{t('announcement.label')}</p>
          <div className="announcement-body fs-md text-gray-200 leading-relaxed">
            {renderMarkdown(effectiveAnnouncement.text)}
          </div>
        </div>
      )}

      {/* Sign-Up Card — placed at the bottom so the submit button / payment
          action / "I paid" button sit in the thumb zone for one-handed use. */}
      <div className="glass-card p-5">
        {isSessionFinished ? (
          /* ── State: Session finished ── */
          <div className="space-y-4">
            <p className="bpm-h2">{t('signup.heading')}</p>
            <StatusBanner tone="success" icon="celebration" title={tStates('finishedTitle')} body={tStates('finishedBody')} />
          </div>
        ) : isSignupClosed && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Sign-ups opening soon ── */
          <div className="space-y-4">
            <p className="bpm-h2">{t('signup.heading')}</p>
            <StatusBanner tone="warn" icon="watch_later" title={tStates('openingSoonTitle')} body={tStates('openingSoonBody')} />
          </div>
        ) : isDeadlinePast && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Deadline passed ── */
          <div className="space-y-4">
            <p className="bpm-h2">{t('signup.heading')}</p>
            <StatusBanner
              tone="warn"
              icon="lock_clock"
              title={tStates('closedTitle')}
              body={t('signup.closedPreviously', { date: format.dateTime(new Date(session!.deadline), DAY_LONG) })}
            />
          </div>
        ) : effectiveIsSignedUp ? (
          /* ── State 1: Active sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <p key={spotsTotal - activePlayers.length} className="fs-md text-gray-400 animate-count-tick">{t('signup.spotsRemaining', { remaining: spotsTotal - activePlayers.length, total: spotsTotal })}</p>
            </div>
            <StatusBanner
              tone="success"
              icon="check_circle"
              title={currentUser ? tStates('signedUpTitle', { name: currentUser }) : tStates('signedUpTitleGeneric')}
              body={tStates('signedUpBody')}
              celebrate={justSignedUp}
            />
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              {t('signup.viewList')}
            </button>
          </div>
        ) : isWaitlisted ? (
          /* ── State 2: On waitlist ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <div className="text-right">
                <p className="fs-sm text-gray-400">{tStates('waitlistLabel')}</p>
                <p className="text-2xl font-bold text-amber-400 leading-none mt-0.5">
                  #{waitlistPosition}
                </p>
              </div>
            </div>
            <StatusBanner
              tone="warn"
              icon="schedule"
              title={tStates('waitlistTitle')}
              body={`${tStates('waitlistPositionLabel', { position: waitlistPosition, total: waitlistPlayers.length })} · ${t('signup.confirmed', { name: currentUser ?? '' })}`}
            />
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              {t('signup.viewList')}
            </button>
          </div>
        ) : isFull && !isDeadlinePast ? (
          /* ── State 3: Full — join waitlist form ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <p key={activePlayers.length} className="fs-md text-gray-400 animate-count-tick">{t('signup.spotsFull', { count: activePlayers.length })}</p>
            </div>
            <StatusBanner tone="warn" icon="lock" title={t('signup.full')} body={t('signup.allSpotsTaken', { total: spotsTotal })} />
            <form onSubmit={handleJoinWaitlist} className="space-y-3">
              <NameAutocompleteInput
                id="waitlist-name"
                value={name}
                onValueChange={(v) => { setName(v); setError(''); }}
                suggestions={suggestions}
                placeholder={t('signup.namePlaceholder')}
                ariaLabel={t('signup.nameAriaLabel')}
                errorId={error ? 'signup-error' : undefined}
              />
              {/* PIN inputs — same adaptive reveal as the open-signup form, so a
                  PIN-protected member can authenticate while joining the waitlist
                  (the server enforces the PIN on waitlist sign-ups too). */}
              {authMode === 'sign-in' && (
                <PinInput
                  value={pin}
                  onChange={(v) => { setPin(v); setError(''); }}
                  digits={4}
                  label={t('signup.pinLabel')}
                  ariaInvalid={!!error}
                />
              )}
              {authMode === 'create' && (
                <>
                  <PinInput
                    value={pin}
                    onChange={(v) => { setPin(v); setError(''); }}
                    digits={4}
                    label={t('signup.pinCreateLabel')}
                    ariaInvalid={!!error}
                  />
                  <PinInput
                    value={confirmPin}
                    onChange={(v) => { setConfirmPin(v); setError(''); }}
                    digits={4}
                    label={t('signup.pinConfirmLabel')}
                    ariaInvalid={!!error}
                  />
                </>
              )}
              {error && <p id="signup-error" role="alert" className="field-error">{error}</p>}
              <button
                type="submit"
                disabled={
                  isSubmitting || !name.trim() || !online
                  || (authMode === 'sign-in' && pin.length !== 4)
                  || (authMode === 'create' && (pin.length !== 4 || confirmPin.length !== 4))
                }
                className="cc-btn cc-btn-primary cc-btn-lg"
              >
                {isSubmitting ? t('signup.joining') : t('signup.waitlist')}
              </button>
              {authMode === 'sign-in' && (
                <button
                  type="button"
                  onClick={() => setEnterCodeOpen(true)}
                  className="fs-sm underline mx-auto"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 12px', minHeight: 44 }}
                >
                  {t('signup.forgotPin')}
                </button>
              )}
            </form>
          </div>
        ) : (
          /* ── State 4: Open — normal sign-up ── */
          <div className="space-y-4">
            <div className="flex items-start justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <p key={spotsTotal - activePlayers.length} className="fs-md text-gray-400 animate-count-tick">{t('signup.spotsRemaining', { remaining: spotsTotal - activePlayers.length, total: spotsTotal })}</p>
            </div>
            <form onSubmit={handleSignUp} className="space-y-3">
              <NameAutocompleteInput
                id="signup-name"
                value={name}
                onValueChange={(v) => { setName(v); setError(''); }}
                suggestions={suggestions}
                placeholder={t('signup.namePlaceholder')}
                ariaLabel={t('signup.nameAriaLabel')}
                errorId={error ? 'signup-error' : undefined}
              />
              {/* PIN inputs — revealed inline based on the member probe.
                  sign-in: single PIN field.
                  create:  PIN + Confirm PIN.
                  anon:    nothing (default, just name + button). */}
              {authMode === 'sign-in' && (
                <PinInput
                  value={pin}
                  onChange={(v) => { setPin(v); setError(''); }}
                  digits={4}
                  label={t('signup.pinLabel')}
                  ariaInvalid={!!error}
                />
              )}
              {authMode === 'create' && (
                <>
                  <PinInput
                    value={pin}
                    onChange={(v) => { setPin(v); setError(''); }}
                    digits={4}
                    label={t('signup.pinCreateLabel')}
                    ariaInvalid={!!error}
                  />
                  <PinInput
                    value={confirmPin}
                    onChange={(v) => { setConfirmPin(v); setError(''); }}
                    digits={4}
                    label={t('signup.pinConfirmLabel')}
                    ariaInvalid={!!error}
                  />
                </>
              )}
              {error && <p id="signup-error" role="alert" className="field-error">{error}</p>}
              <button
                type="submit"
                disabled={
                  isSubmitting || !name.trim() || !online
                  || (authMode === 'sign-in' && pin.length !== 4)
                  || (authMode === 'create' && (pin.length !== 4 || confirmPin.length !== 4))
                }
                className="cc-btn cc-btn-primary cc-btn-lg"
              >
                {!isSubmitting && <span className="material-icons icon-sm" aria-hidden="true">how_to_reg</span>}
                {isSubmitting ? t('signup.submitting') : t('signup.button')}
              </button>
              {authMode === 'sign-in' && (
                <button
                  type="button"
                  onClick={() => setEnterCodeOpen(true)}
                  className="fs-sm underline mx-auto"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: '8px 12px', minHeight: 44 }}
                >
                  {t('signup.forgotPin')}
                </button>
              )}
              {session?.deadline && authMode === 'anon' && (
                <p className={`text-center fs-sm font-medium ${isDeadlineApproaching ? 'text-red-400' : 'text-gray-400'}`}>
                  {t('signup.closesOn', { date: format.dateTime(new Date(session.deadline), DAY_LONG) })}
                </p>
              )}
            </form>
          </div>
        )}
      </div>

      {/* Discovery hook for skill rating — surfaces at the sign-up touchpoint,
          self-retires once the player rates or dismisses it. */}
      <SkillDiscoveryCard
        name={currentUser}
        signedUp={effectiveIsSignedUp}
        onOpen={() => onTabChange?.('skills')}
      />

      <EnterCodeSheet
        open={enterCodeOpen}
        onClose={() => {
          setEnterCodeOpen(false);
          const fresh = getIdentity();
          if (fresh) {
            setHasIdentity(true);
            setCurrentUser(fresh.name);
          }
        }}
        sessionId={session?.id ?? ''}
      />
      </div>
      <ReleaseNotesSheet
        open={releaseSheetOpen}
        releases={releases}
        onClose={() => setReleaseSheetOpen(false)}
      />
    </div>
  );
}
