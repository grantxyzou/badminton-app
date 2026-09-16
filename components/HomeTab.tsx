'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { useReportFetchFailure } from '@/lib/useOnline';
import { isFlagOn } from '@/lib/flags';
import { useCurrentGroup } from '@/lib/useCurrentGroup';
import { APP_NAME } from '@/lib/brand';
import type { Session, Player, Announcement, Release } from '@/lib/types';
import { defaultMaxPlayers } from '@/lib/defaults';
import type { DevOverrides } from '@/components/DevPanel';
import { getIdentity, setIdentity, clearIdentity, resolveStaleIdentity } from '@/lib/identity';
import { TabSkeleton } from '@/components/primitives/CardSkeleton';
import UnpaidSessionsCard from '@/components/UnpaidSessionsCard';
import StringingCard from '@/components/stringing/StringingCard';
import StringerJobsCard from './stringing/StringerJobsCard';
import InstallBanner from '@/components/InstallBanner';
import ReleaseNotesTrigger from './ReleaseNotesTrigger';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import StatusBanner from '@/components/primitives/StatusBanner';
import PageHeader from '@/components/primitives/PageHeader';
import EnterCodeSheet from './EnterCodeSheet';
import AskAccessSheet from './AskAccessSheet';
import { OFFER_PIN_KEY } from '@/lib/offerPin';
import RecoveryPinSheet from './RecoveryPinSheet';
import PinInput from './PinInput';
import NameAutocompleteInput from './home/NameAutocompleteInput';
import WhoElseIsIn from './home/WhoElseIsIn';
import { canViewTransition, withViewTransition } from '@/lib/viewTransition';
import { tapSuccess } from '@/lib/haptics';
import { useMemberProbe } from '@/lib/useHasPin';
import { useOnline } from '@/lib/useOnline';
import { renderMarkdown } from '@/lib/miniMarkdown';
import Collapse from './primitives/Collapse';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;
const TIME_SHORT = { hour: '2-digit', minute: '2-digit' } as const;

interface HomeTabProps {
  onTabChange?: (tab: 'home' | 'players' | 'skills' | 'admin' | 'profile') => void;
  /**
   * Whether this person runs the club. Used only to decide whose job it is to
   * fix an empty week: the organiser gets the action, a player gets told one is
   * coming rather than a control they cannot use.
   */
  isAdmin?: boolean;
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
  /**
   * MEMBERS ONLY: the signed-in member's name, as the server verified it. When
   * set, the sign-up card signs up THIS person — no name field, no PIN field,
   * no probe — because the server takes the name from the account and ignores
   * anything typed (docs/plans/members-only.md). `null` with the flag off.
   */
  memberName?: string | null;
}

export default function HomeTab({ onTabChange, onTitleTap, devOverrides, initialAnnouncement = null, isAdmin = false, memberName = null }: HomeTabProps) {
  const t = useTranslations('home');
  const groupsOn = isFlagOn('NEXT_PUBLIC_FLAG_MULTI_GROUP');
  /**
   * THE CLUB'S OWN NAME IN ITS OWN HEADER.
   *
   * It was a hardcoded club name, which is simply wrong the moment a second
   * club exists — you finish creating "Thursday Badminton" and the first screen
   * you land on is titled someone else's club.
   *
   * `useCurrentGroup` resolves `null` with the flag off and while signed out,
   * and the fallback is the PRODUCT's name rather than any particular club's:
   * if we cannot say whose club this is, naming one would be a guess, while
   * naming the app is true. Flag off that reads exactly as it always has.
   */
  const { group: currentGroup } = useCurrentGroup();
  const clubName = currentGroup?.name || APP_NAME;
  const tStates = useTranslations('home.states');
  const format = useFormatter();
  const online = useOnline();
  const [session, setSession] = useState<Session | null>(null);
  const [players, setPlayers] = useState<Player[]>([]);
  const [announcement, setAnnouncement] = useState<Announcement | null>(initialAnnouncement);
  const [currentUser, setCurrentUser] = useState<string | null>(memberName);
  const [name, setName] = useState(memberName ?? '');
  const [isSubmitting, setIsSubmitting] = useState(false);
  // Unified sign-up form auth state. PIN inputs reveal inline based on
  // the member probe — no separate sign-in card, no Create Account sheet
  // on Home. (Per Figma 138 + 139, supersedes #89.)
  const [pin, setPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  // An empty name makes the probe a no-op: with the name LOCKED to the account
  // there is nothing to find out about it, and asking would only publish it.
  const memberProbe = useMemberProbe(memberName ? '' : name);
  const authMode: 'anon' | 'sign-in' | 'create' =
    memberName ? 'anon' :
    // Trusted device: the PIN was already proven here (member_session cookie),
    // so render one-tap sign-up (no PIN field) and POST { name } — the server
    // accepts the cookie as identity proof. Same form shape as anon.
    memberProbe?.hasPin && memberProbe?.authed ? 'anon'
    : memberProbe?.hasPin ? 'sign-in'
    // A member with NO PIN on a device that cannot prove it is theirs signs up
    // by NAME, as the server has always allowed. 'create' used to be shown
    // here, and the PIN it collected was then refused as
    // `account_claim_needs_approval` (first-PIN set needs a session) — so the
    // name-only sign-up regulars rely on failed on every new phone (2026-09-13
    // flow audit). The pre-flip warning below then tells them to set up a
    // sign-in. 'create' stays for a device that holds their session, where
    // choosing a PIN actually succeeds.
    : memberProbe?.exists ? (memberProbe.authed ? 'create' : 'anon')
    : 'anon';
  const [pinMode, setPinMode] = useState<'sign-in' | 'create'>('sign-in');
  if (authMode !== 'anon' && authMode !== pinMode) setPinMode(authMode);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const weekLoadedRef = useRef(false);
  /* The week could not be read — distinct from a club that has no week yet
     (`sessionMissing`, a 404). Before this, every failure was a console.error
     and Home rendered "—" tiles and "12 of 12 spots left" for a session that
     never arrived: a confident sign-up card over nothing. */
  const [weekLoadError, setWeekLoadError] = useState(false);
  const [sessionMissing, setSessionMissing] = useState(false);
  const reportFetchFailure = useReportFetchFailure();
  const [memberNames, setMemberNames] = useState<string[]>([]);
  const [hasIdentity, setHasIdentity] = useState(!!memberName);
  // Sign up = session signup only (auth taxonomy split). PIN is no longer
  // collected here — it's an opt-in identity primitive, set via Profile →
  // Create account / Set PIN. Returning players who already have a PIN can
  // tap "Already a player? Sign in →" to authenticate via RecoverySheet.
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  // How the confirmation arrives, set only by the act of signing up, never on a
  // Home revisit (it resets when the tab remounts). 'morph': the button becomes
  // the confirmation through a View Transition. 'pop': the banner's own
  // entrance, where the browser has no transitions or motion is reduced. Never
  // both, which would move the same thing twice.
  const [signupEntrance, setSignupEntrance] = useState<'none' | 'pop' | 'morph'>('none');
  // Forgot-PIN handoff from the inline sign-in form opens this code-entry sheet.
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);
  const [askAccessOpen, setAskAccessOpen] = useState(false);
  /* Opened straight after a recovery-code redemption: that path deliberately
     CLEARS the old PIN server-side, so leaving the user here without offering
     a replacement is how they ended up PIN-less without being told. */
  const [setPinOpen, setSetPinOpen] = useState(false);
  const [recoveredName, setRecoveredName] = useState('');
  /**
   * MEMBERS ONLY: does the verified member have any way to sign in again —
   * a PIN, a password or a linked provider? Tri-state: `null` is unknown and
   * shows nothing. A member let in by an admin (an access request) is signed in
   * with a 30-day session and no credential at all, and would be locked out
   * again when it lapses (2026-09-13 flow audit).
   */
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);

  const maxPlayers = defaultMaxPlayers();

  const loadData = useCallback(async () => {
    // The skeleton is for the FIRST load only. A refetch after a sign-up used
    // to drop all of Home back to a skeleton and replay its entrance — the
    // one confirmation this screen exists to give, hidden behind a blink.
    // Once a week has loaded, the content stays while it refreshes; a refetch
    // that fails still sets weekLoadError below, which replaces the week with
    // the error, so stale data never stands in for a failure.
    if (!weekLoadedRef.current) setLoading(true);
    setWeekLoadError(false);
    setSessionMissing(false);
    try {
      const [sRes, pRes, aRes, mRes, rRes] = await Promise.all([
        fetch(`${BASE}/api/session`, { cache: 'no-store' }),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
        fetch(`${BASE}/api/members`, { cache: 'no-store' }).catch(() => null),
        fetch(`${BASE}/api/releases`, { cache: 'no-store' }).catch(() => null),
      ]);
      // The players list is half of the sign-up card (spots left, are you
      // in), so it failing is the week failing too.
      if (sRes.status === 404) setSessionMissing(true);
      else if (!sRes.ok || !pRes.ok) setWeekLoadError(true);
      weekLoadedRef.current = sRes.ok && pRes.ok;
      if (sRes.ok) {
        const s: Session = await sRes.json();
        setSession(s);
        const stored = getIdentity();
        // Members only: the server verified who this is before rendering the
        // app, so a stale LOCAL record is not evidence about anyone — and on a
        // shared phone it can name the previous person, whose probe would fail
        // and wrongly sign this one out. HomeShell reconciles the record.
        if (!memberName && stored && stored.sessionId && stored.sessionId !== s.id) {
          // Stale identity. Probe /api/members/me to learn if this name is
          // a PIN-protected member (auth survives session boundaries) or
          // anonymous (deleteToken bound to old session, both stale).
          // A PIN is not the only durable credential. `authed` means this
          // device holds a live `member_session`, which is true for email,
          // Google and Apple members — all of whom used to be cleared here the
          // moment the session id moved, and who now move it themselves every
          // time they join or switch a club.
          let durable = false;
          try {
            const meRes = await fetch(
              `${BASE}/api/members/me?name=${encodeURIComponent(stored.name)}`,
              { cache: 'no-store' },
            );
            if (meRes.ok) {
              const me = (await meRes.json()) as { hasPin?: boolean; authed?: boolean };
              durable = me.hasPin === true || me.authed === true;
            }
          } catch {
            // Network failure → resolveStaleIdentity falls through to clear.
          }
          const decision = resolveStaleIdentity(stored, s.id, durable);
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
      weekLoadedRef.current = false;
      setWeekLoadError(true);
      reportFetchFailure();
    } finally {
      setLoading(false);
    }
  }, [memberName, reportFetchFailure]);

  useEffect(() => {
    // Members only: the server-verified member IS the user, and the state above
    // was initialised from it. localStorage may not have caught up yet —
    // HomeShell reconciles it, but its effect runs after this child's — so it
    // must not be allowed to override that here.
    if (memberName) {
      loadData();
      return;
    }
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
  }, [loadData, memberName]);

  // Ask the server what the verified member can sign in with. `auth/methods`
  // answers for the cookie's own member (PIN, password, providers); where that
  // route is off, `members/me` for the member's own name still knows the PIN.
  useEffect(() => {
    if (!memberName) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${BASE}/api/auth/methods`, { cache: 'no-store' });
        if (res.ok) {
          const m = (await res.json()) as { hasPin?: boolean; hasPassword?: boolean; linked?: string[] };
          if (cancelled) return;
          const has = m.hasPin === true || m.hasPassword === true || (Array.isArray(m.linked) && m.linked.length > 0);
          setHasCredential(has);
          return;
        }
        const me = await fetch(`${BASE}/api/members/me?name=${encodeURIComponent(memberName)}`, { cache: 'no-store' });
        if (!me.ok || cancelled) return;
        const d = (await me.json()) as { hasPin?: boolean; createdAt?: string | null };
        if (typeof d.createdAt === 'string' && !cancelled) setHasCredential(d.hasPin === true);
      } catch {
        /* unknown — show nothing */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [memberName]);

  // Straight after an admin let this member in, open the PIN sheet rather than
  // only showing the card: the approval is the moment they are thinking about
  // how they got in. SignedOutShell leaves the one-shot marker before reloading.
  useEffect(() => {
    if (!memberName || hasCredential !== false) return;
    let offer = false;
    try {
      offer = window.sessionStorage.getItem(OFFER_PIN_KEY) === '1';
      window.sessionStorage.removeItem(OFFER_PIN_KEY);
    } catch {
      /* storage unavailable — the card still shows */
    }
    if (!offer) return;
    setRecoveredName(memberName);
    setSetPinOpen(true);
  }, [memberName, hasCredential]);

  const activePlayers = players.filter(p => !p.waitlisted);
  const waitlistPlayers = players.filter(p => p.waitlisted);

  const isSignedUp = currentUser
    ? activePlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isWaitlisted = currentUser
    ? waitlistPlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase())
    : false;

  const isFull = activePlayers.length >= (session?.maxPlayers ?? maxPlayers);
  const needsCredential = !!memberName && hasCredential === false;
  /* MEMBERS ONLY, THE WARNING BEFORE THE FLIP (docs/plans/members-only.md).
     Grant's decision was "warn first, then request access": once members only
     is on, a name with no PIN, password or Google reaches the welcome screen
     with no way past it. True only BEFORE the flip (no verified `memberName`)
     and only for the name this device is signed in as, when the probe knows it
     has no PIN and this device holds no live session. An email or Google
     member whose cookie lapsed would match too — the probe cannot see a
     password — so the banner's last line says where they go instead. Shown in
     the sign-up card, where the player is already looking. */
  const needsSignInSetup =
    !memberName &&
    !!currentUser &&
    name.trim().toLowerCase() === currentUser.toLowerCase() &&
    memberProbe?.exists === true &&
    !memberProbe.hasPin &&
    !memberProbe.authed;
  /* The warning's body, shared by both places it can stand in the sign-up
     card. The action gets its own row: `.link-quiet` keeps a 44px tap target,
     and set inline it stretched one line of the paragraph taller than the
     rest. */
  const signInSetupBody = (body: string) => (
    <span style={{ display: 'grid', gap: 'var(--space-1)', justifyItems: 'start' }}>
      <span>{body}</span>
      <button
        type="button"
        className="link-quiet"
        style={{ paddingInline: 0, fontWeight: 600 }}
        onClick={() => setAskAccessOpen(true)}
      >
        {t('signInSetup.action')}
      </button>
      <span>{t('signInSetup.haveOne')}</span>
    </span>
  );
  /* Every sign-up state that is not "signed up" carries the same warning: a
     regular who hits a closed, full or finished week (or joins the waitlist)
     is as locked out after the flip as one who signs up. */
  const signInSetupBanner = needsSignInSetup ? (
    <StatusBanner
      tone="warn"
      icon="key"
      title={t('signInSetup.title')}
      body={signInSetupBody(t('signInSetup.body'))}
    />
  ) : null;
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

  const openReleaseSheet = useCallback(() => setReleaseSheetOpen(true), []);

  /**
   * The server has confirmed the sign-up; show it.
   *
   * The POST answers with the new roster row, so the card can flip to "you're
   * in" from that alone instead of waiting on a refetch of five endpoints. The
   * refetch still runs and replaces the row with the server's list; once a week
   * has loaded it no longer shows the skeleton (`weekLoadedRef`).
   * Nothing here is optimistic: this runs only after a 201.
   *
   * `deleteToken` goes to the identity record and is kept out of `players`,
   * the same rule every roster response follows.
   */
  function applySignup(trimmed: string, created: Record<string, unknown>, sessionId: string, waitlist: boolean) {
    setIdentity({ name: trimmed, token: typeof created.deleteToken === 'string' ? created.deleteToken : '', sessionId });
    const { deleteToken: _dt, ...row } = created;
    const joined = typeof row.id === 'string' && typeof row.name === 'string' ? (row as unknown as Player) : null;
    const morph = !waitlist && joined !== null && joined.waitlisted !== true && canViewTransition();
    const commit = () => {
      setCurrentUser(trimmed);
      setHasIdentity(true);
      if (joined) setPlayers((prev) => [...prev.filter((p) => p.id !== joined.id), joined]);
      if (!waitlist) setSignupEntrance(morph ? 'morph' : 'pop');
    };
    // Felt at the same instant it is seen. Native shell only; a no-op anywhere
    // it cannot be felt, including a shell built before the plugin was added.
    if (!waitlist) tapSuccess();
    if (morph) withViewTransition(commit, 'vt-signup');
    else commit();
    void loadData();
  }

  // Unified sign-up + waitlist submit. `waitlist` adds `waitlist: true` to the
  // POST body and tunes the failure copy — otherwise the auth flow (anon /
  // sign-in PIN / create PIN) is identical, so a PIN-protected member can join
  // the waitlist with the same inline PIN field the open-signup form uses.
  async function performSignup(waitlist: boolean) {
    // Legible-fail: refuse the mutation with a clear reason instead of
    // firing a fetch that throws and leaves the form in limbo.
    if (!online) { setError(t('signup.offline')); return; }
    const trimmed = (memberName ?? name).trim();
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
          if (signupRes.status === 409) void loadData();
          return;
        }
        if (!session?.id) { setError(t('signup.networkError')); return; }
        applySignup(trimmed, signupData, session.id, waitlist);
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
          if (data.error === 'account_claim_needs_approval') {
            /* Someone is setting a FIRST PIN on an existing member from a
               device that cannot prove it is theirs. Usually the real owner on
               a new phone — so the answer is a way in, not a refusal. Straight
               into the ask flow with the name already filled. */
            setAskAccessOpen(true);
            return;
          }
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
          if (res.status === 409) void loadData();
          return;
        }
        if (!session?.id) { setError(t('signup.networkError')); return; }
        applySignup(trimmed, data, session.id, waitlist);
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

  // The PIN fields arrive when the debounced name probe resolves — under a
  // thumb that is already heading for the button. They open instead of
  // appearing, so the button travels rather than jumps. `pinMode` holds the
  // last non-anon mode so a CLOSING reveal keeps showing what it showed.
  const pinReveal = (
    <Collapse open={authMode !== 'anon'} spaceAbove="var(--space-3)">
      {pinMode === 'sign-in' ? (
        <PinInput
          value={pin}
          onChange={(v) => { setPin(v); setError(''); }}
          digits={4}
          label={t('signup.pinLabel')}
          ariaInvalid={!!error}
        />
      ) : (
        <div className="space-y-3">
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
        </div>
      )}
    </Collapse>
  );

  if (loading) {
    // Render the REAL header (its slot is static text, no data) and skeleton
    // only the data cards below it — same pattern as PlayersTab — so the page
    // keeps its exact shape and fills in top-to-bottom instead of flashing a
    // generic block then snapping the layout in.
    return (
      <div className="space-y-5">
        <PageHeader>{clubName}</PageHeader>
        <TabSkeleton />
      </div>
    );
  }

  const sessionWhen = session
    ? `${format.dateTime(new Date(session.datetime), DAY_LONG)}, ${format.dateTime(new Date(session.datetime), TIME_SHORT)}`
    : undefined;
  const sessionWhenWhere = sessionWhen && session?.locationName
    ? tStates('signedUpWhenWhere', { when: sessionWhen, place: session.locationName })
    : sessionWhen;

  const mapsUrl = session?.locationAddress
    ? `https://maps.google.com/?q=${encodeURIComponent(session.locationAddress)}`
    : null;

  return (
    <div className="space-y-5">
      {/* PageHeader must be a DIRECT child of this space-y-5 scroll root so its
          position:sticky containing block is the full tab. Wrapping it (with the
          release trigger) in a short <div> made the containing block ~43px tall,
          so the club-name bar un-stuck instantly and scrolled off instead
          of condensing like every other tab. The version stamp stays tight under
          the title via inline marginTop (beats the space-y-5 gap).
          The easter-egg `onTitleTap` lives on the inner span so PageHeader owns
          the scroll-condense. */}
      <PageHeader compact>
        <span
          role="button"
          tabIndex={0}
          onClick={onTitleTap}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onTitleTap?.(); }
          }}
          style={{ cursor: 'default', userSelect: 'none' }}
        >
          {clubName}
        </span>
      </PageHeader>
      <div style={{ marginTop: 'var(--space-1)' }}>
        <ReleaseNotesTrigger
          releases={releases}
          onOpen={openReleaseSheet}
        />
      </div>

      {/* Reveal the data cards together on load. Wrapping below the sticky
          PageHeader keeps the header out of the transform (containing-block
          trap) while the card stack fades in once when data lands. */}
      {/* TWO GROUPS, NOT FIVE CARDS.
          Tight inside a group, loose between them: proximity is what says
          "these belong together" without adding a heading to each. The first
          group is this week's session — where, when, and are you in. The
          second is your account — what you owe and what you have with the
          stringer. Five evenly-spaced cards read as five unrelated errands. */}
      <div className="bpm-home-stack motion-fade">
      {/* One-time nudge to install to the home screen (mobile browser only). */}
      <InstallBanner />

      {/* A CLUB WITH NO SESSION YET.
          `GET /api/session` answers 404 for a group with no pointer, which is
          every club on the day it is created. Rendering the ordinary week
          against a null session gave a date tile reading "—", two blank
          location tiles and a sign-up card for nothing: an empty room, as the
          first thing a new organiser sees after making their club.
          Flag-gated, because with one club this state means the pointer is
          MISSING, and the old layout is the honest report of that. */}
      {weekLoadError ? (
        /* Page-level fallback: standalone, 48/24, no card (CLAUDE.md spacing
           ladder) — the card it replaces would have held nothing true. */
        <section className="bpm-home-group" aria-label={t('groups.session')} style={{ padding: 'var(--space-9) var(--space-7)' }}>
          <ErrorState
            message={t('weekLoadError')}
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void loadData()}>
                {t('retry')}
              </button>
            }
          />
        </section>
      ) : groupsOn && sessionMissing ? (
        <section className="bpm-home-group" aria-label={t('groups.session')}>
          <div className="glass-card p-5 space-y-3">
            <CardHeader
              compact
              icon="event"
              title={t('firstSession.title')}
              subtitle={isAdmin ? t('firstSession.adminHint') : t('firstSession.playerHint')}
            />
            {isAdmin && (
              <button
                type="button"
                onClick={() => onTabChange?.('admin')}
                className="btn-primary"
                style={{ width: '100%' }}
              >
                {t('firstSession.cta')}
              </button>
            )}
          </div>
        </section>
      ) : (
      <section className="bpm-home-group" aria-label={t('groups.session')}>
      {/* Tile row: Location | Date & Time */}
      <div className="grid grid-cols-2 gap-3">
        {/* Location tile */}
        <div className="glass-card p-4 space-y-2">
          {/* Neutral, and no icon. Accent is currency: spending it on a label
              that never changes leaves nothing to mark the one thing worth
              tapping. Green now appears exactly three times on this screen —
              the primary button, the one link, the active tab. */}
          <p className="section-label-muted mb-1">{t('location.label')}</p>
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
                className="fs-md text-gray-300 underline underline-offset-2 decoration-dotted line-clamp-2 block"
              >
                {session.locationAddress}
              </a>
            ) : (
              <p className="fs-md text-gray-300 line-clamp-2">{session.locationAddress}</p>
            )
          ) : null}
        </div>

        {/* Date & Time tile */}
        <div className="glass-card p-4 space-y-2">
          <p className="section-label-muted mb-1">{t('session.date')}</p>
          <p className="text-lg font-semibold text-gray-200 leading-snug">
            {session ? format.dateTime(new Date(session.datetime), DAY_LONG) : '—'}
          </p>
          {/* The time drops to secondary so the DATE reads as one unit. Two
              lines at equal weight made "Saturday, August 29" and "02:16 AM"
              compete, and the date is what people are checking. */}
          <p className="fs-md" style={{ color: 'var(--text-secondary)' }}>
            {session ? format.dateTime(new Date(session.datetime), TIME_SHORT) : '—'}
          </p>
        </div>
      </div>


      {/* Announcement card — pure club communications surface. */}
      {effectiveAnnouncement && (
        <div className="glass-card p-5 space-y-2">
          <p className="section-label">{t('announcement.label')}</p>
          <div className="announcement-body fs-md text-gray-200 leading-relaxed">
            {renderMarkdown(effectiveAnnouncement.text)}
          </div>
        </div>
      )}

      {/* Sign-Up Card — the submit button / payment action / "I paid" button
          sit in the thumb zone for one-handed use. */}
      <div className="glass-card p-5 vt-signup-card">
        {isSessionFinished ? (
          /* ── State: Session finished ── */
          <div className="space-y-4">
            <p className="bpm-h2">{t('signup.heading')}</p>
            <StatusBanner tone="success" icon="celebration" title={tStates('finishedTitle')} body={tStates('finishedBody')} />
            {signInSetupBanner}
          </div>
        ) : isSignupClosed && !effectiveIsSignedUp && !isWaitlisted ? (
          /* ── State: Sign-ups opening soon ── */
          <div className="space-y-4">
            <p className="bpm-h2">{t('signup.heading')}</p>
            <StatusBanner tone="warn" icon="watch_later" title={tStates('openingSoonTitle')} body={tStates('openingSoonBody')} />
            {signInSetupBanner}
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
            {signInSetupBanner}
          </div>
        ) : effectiveIsSignedUp ? (
          /* ── State 1: Active sign-up ── */
          <div className="space-y-4">
            {/* baseline, not items-start: the count is 14px beside a 20px heading,
                so aligning the TOPS leaves it floating above the title's baseline.
                Same alignment YourRecordCard's header already uses. All four
                sign-up states share this header, so all four move together. */}
            <div className="flex items-baseline justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <p key={spotsTotal - activePlayers.length} className="fs-md text-gray-400 animate-count-tick">{t('signup.spotsRemaining', { remaining: spotsTotal - activePlayers.length, total: spotsTotal })}</p>
            </div>
            {/* MEMBERS ONLY, THE WARNING BEFORE THE FLIP: a name with no PIN,
                password or Google is in THIS week, but will reach a welcome
                screen with no way past it once members only is on. The
                confirmation itself says so, in amber, rather than a green
                "see you soon" with the catch in a separate card below. */}
            {/* Shares `vt-signup-confirm` with the submit button, so under a
                View Transition the button becomes this banner in place. The
                banners are keyed: both sit in the same slot, so without a key
                React reuses the node and the swap from amber to green happens
                with no entrance at all. */}
            <div className="vt-signup-confirm" data-entrance={signupEntrance}>
              {needsSignInSetup ? (
                <StatusBanner
                  key="signed-up-setup"
                  tone="warn"
                  icon="key"
                  title={t('signInSetup.signedUpTitle', { name: currentUser ?? '' })}
                  body={signInSetupBody(t('signInSetup.signedUpBody'))}
                />
              ) : (
                <StatusBanner
                  key="signed-up"
                  tone="success"
                  icon="check_circle"
                  title={currentUser ? tStates('signedUpTitle', { name: currentUser }) : tStates('signedUpTitleGeneric')}
                  /* The plan itself, not "see you soon": the line people
                     paste into the group chat is when and where. */
                  body={sessionWhenWhere}
                  celebrate={signupEntrance === 'pop'}
                />
              )}
            </div>
            <WhoElseIsIn names={activePlayers.map((p) => p.name)} me={currentUser} />
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              {t('signup.viewList')}
            </button>
          </div>
        ) : isWaitlisted ? (
          /* ── State 2: On waitlist ── */
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <div className="text-right">
                <p className="fs-sm text-gray-400">{tStates('waitlistLabel')}</p>
                <p key={waitlistPosition} className="text-2xl font-bold text-amber-400 leading-none mt-0.5 animate-count-tick">
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
            {signInSetupBanner}
            <button type="button" onClick={() => onTabChange?.('players')} className="btn-ghost w-full">
              {t('signup.viewList')}
            </button>
          </div>
        ) : isFull && !isDeadlinePast ? (
          /* ── State 3: Full — join waitlist form ── */
          <div className="space-y-4">
            <div className="flex items-baseline justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <p key={activePlayers.length} className="fs-md text-gray-400 animate-count-tick">{t('signup.spotsFull', { count: activePlayers.length })}</p>
            </div>
            <StatusBanner tone="warn" icon="lock" title={t('signup.full')} body={t('signup.allSpotsTaken', { total: spotsTotal })} />
            {signInSetupBanner}
            <form onSubmit={handleJoinWaitlist} className="space-y-3">
              {memberName ? (
                <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
                  {t('signup.signingUpAs', { name: memberName })}
                </p>
              ) : (
                <NameAutocompleteInput
                  id="waitlist-name"
                  value={name}
                  onValueChange={(v) => { setName(v); setError(''); }}
                  suggestions={suggestions}
                  placeholder={t('signup.namePlaceholder')}
                  ariaLabel={t('signup.nameAriaLabel')}
                  errorId={error ? 'signup-error' : undefined}
                />
              )}
              {/* PIN inputs — same adaptive reveal as the open-signup form, so a
                  PIN-protected member can authenticate while joining the waitlist
                  (the server enforces the PIN on waitlist sign-ups too). */}
              {pinReveal}
              {error && <p id="signup-error" role="alert" className="field-error">{error}</p>}
              <button
                type="submit"
                disabled={
                  isSubmitting || !(memberName ?? name).trim() || !online
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
                  className="fs-sm underline mx-auto motion-fade"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 'var(--space-3) var(--space-4)', minHeight: 44 }}
                >
                  {t('signup.forgotPin')}
                </button>
              )}
            </form>
          </div>
        ) : (
          /* ── State 4: Open — normal sign-up ── */
          <div className="space-y-4">
            {/* The COUNT is the headline, not the word "Sign up".
                It is the number that decides whether you tap, and it was 13px
                muted at the far right while a heading that never changes took
                the weight. Swapped: the heading becomes a section label, the
                count becomes the largest thing on the screen. */}
            <div>
              <p className="section-label-muted">{t('signup.heading')}</p>
              <p
                key={spotsTotal - activePlayers.length}
                className="animate-count-tick"
                style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', marginTop: 'var(--space-2)' }}
              >
                <span className="bpm-count">
                  {spotsTotal - activePlayers.length}/{spotsTotal}
                </span>
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>
                  {t('signup.spotsLeftSuffix')}
                </span>
              </p>
            </div>
            <WhoElseIsIn names={activePlayers.map((p) => p.name)} me={currentUser} />
            <form onSubmit={handleSignUp} className="space-y-3">
              {memberName ? (
                <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
                  {t('signup.signingUpAs', { name: memberName })}
                </p>
              ) : (
                <NameAutocompleteInput
                  id="signup-name"
                  value={name}
                  onValueChange={(v) => { setName(v); setError(''); }}
                  suggestions={suggestions}
                  placeholder={t('signup.namePlaceholder')}
                  ariaLabel={t('signup.nameAriaLabel')}
                  errorId={error ? 'signup-error' : undefined}
                />
              )}
              {/* PIN inputs — revealed inline based on the member probe.
                  sign-in: single PIN field.
                  create:  PIN + Confirm PIN.
                  anon:    nothing (default, just name + button). */}
              {pinReveal}
              {error && <p id="signup-error" role="alert" className="field-error">{error}</p>}
              <button
                type="submit"
                disabled={
                  isSubmitting || !(memberName ?? name).trim() || !online
                  || (authMode === 'sign-in' && pin.length !== 4)
                  || (authMode === 'create' && (pin.length !== 4 || confirmPin.length !== 4))
                }
                /* `.btn-primary`, not `.cc-btn-primary`. The latter is the
                   tinted ADMIN action (18% green fill, green text) — a compact
                   secondary weight. This is the app's most prominent CTA and
                   takes the filled gradient, which is also what makes the one
                   green thing on the screen unmistakable. */
                className="btn-primary w-full flex items-center justify-center gap-2 vt-signup-confirm"
              >
                {!isSubmitting && <span className="material-icons icon-sm" aria-hidden="true">how_to_reg</span>}
                {isSubmitting ? t('signup.submitting') : t('signup.button')}
              </button>
              {authMode === 'sign-in' && (
                <button
                  type="button"
                  onClick={() => setEnterCodeOpen(true)}
                  className="fs-sm underline mx-auto motion-fade"
                  style={{ color: 'var(--text-secondary)', background: 'transparent', border: 'none', cursor: 'pointer', padding: 'var(--space-3) var(--space-4)', minHeight: 44 }}
                >
                  {t('signup.forgotPin')}
                </button>
              )}
              {session?.deadline && authMode === 'anon' && (
                /* A close date is INFORMATION, not an error. Red here spent
                   the failure colour on a fact that is true every week, so a
                   real error had nothing louder to reach for. Amber inside the
                   last 24 hours still escalates; the rest is a footnote. */
                <p
                  className="text-center fs-sm motion-fade"
                  style={{ color: isDeadlineApproaching ? 'var(--sev-warn)' : 'var(--text-muted)' }}
                >
                  {t('signup.closesOn', { date: format.dateTime(new Date(session.deadline), DAY_LONG) })}
                </p>
              )}
            </form>
            {/* Not signed up yet: the same warning, under the button it is
                about. Signing up swaps it for the amber confirmation above. */}
            {signInSetupBanner}
          </div>
        )}
      </div>

      </section>
      )}

      <section className="bpm-home-group vt-home-account" aria-label={t('groups.account')}>
      {/* MEMBERS ONLY: signed in, but nothing to sign in WITH next time — the
          state an admin-approved access request leaves. One tap to a PIN. */}
      {needsCredential && (
        <StatusBanner
          tone="warn"
          icon="key"
          title={t('signInSetup.noneTitle')}
          body={
            <span style={{ display: 'grid', gap: 'var(--space-1)', justifyItems: 'start' }}>
              <span>{t('signInSetup.noneBody')}</span>
              <button
                type="button"
                className="link-quiet"
                style={{ paddingInline: 0, fontWeight: 600 }}
                onClick={() => {
                  setRecoveredName(memberName ?? '');
                  setSetPinOpen(true);
                }}
              >
                {t('signInSetup.noneAction')}
              </button>
            </span>
          }
        />
      )}
      {/* Your balance — what you owe, across sessions and stringing. Sits in
          the ACCOUNT group rather than above sign-up: as a one-line row
          carrying its own figure it no longer needs the top slot to be read,
          and most weeks it says $0. */}
      {currentUser && <UnpaidSessionsCard name={currentUser} variant="home" onSignIn={() => onTabChange?.('profile')} />}

      {/* Stringing service. Still "Coming soon" by default — the card only goes
          live once an admin has opened the shop, and an UNKNOWN answer keeps
          the modest version too. See StringingCard for why unknown is not
          treated as closed-but-shown. */}
      <StringingCard hasIdentity={hasIdentity} />
      {/* Only renders for someone with work assigned — which is nobody, for
          everyone who is not a stringer. Sits under the player's own card
          because doing the stringing is the rarer role, and the person's own
          racket is still the thing they came to check. */}
      <StringerJobsCard hasIdentity={hasIdentity} />
      </section>


      <AskAccessSheet
        open={askAccessOpen}
        onClose={() => setAskAccessOpen(false)}
        sessionId={session?.id ?? ''}
        initialName={name}
        onSignedIn={({ name: signedIn, hasPin }) => {
          setAskAccessOpen(false);
          setHasIdentity(true);
          setCurrentUser(signedIn);
          if (!hasPin) {
            setRecoveredName(signedIn);
            setSetPinOpen(true);
          }
          void loadData();
        }}
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
        /* Redeeming a code CLEARS `pinHash` server-side — the whole point is
           that they could not remember it. Without this the user was dropped
           back on Home silently PIN-less, and only found out next time the
           sign-up card put them in "create a PIN" mode with no explanation.
           ProfileTab has always passed this; Home never did. */
        onRecovered={(name) => {
          setEnterCodeOpen(false);
          setHasIdentity(true);
          setCurrentUser(name);
          setRecoveredName(name);
          setSetPinOpen(true);
        }}
      />
      {/* Only mounted once we have a name — `identity` is required, and a
          sheet that cannot say who it is setting a PIN for should not exist. */}
      {recoveredName !== '' && (
      <RecoveryPinSheet
        open={setPinOpen}
        onClose={() => setSetPinOpen(false)}
        identity={{ name: recoveredName, sessionId: session?.id ?? '' }}
        /* Always the two-field first-set shape: redeeming the code is what
           removed the old PIN, so there is no current one to ask for. */
        hasPin={false}
        /* The redemption minted a member_session, so the first-set guard is
           satisfied — `true`, not the tri-state unknown. */
        authed
        onSaved={() => {
          setSetPinOpen(false);
          // A PIN now exists; the "no way back in" card has nothing left to say.
          if (memberName) setHasCredential(true);
        }}
      />
      )}
      </div>
      <ReleaseNotesSheet
        open={releaseSheetOpen}
        releases={releases}
        onClose={() => setReleaseSheetOpen(false)}
      />
    </div>
  );
}
