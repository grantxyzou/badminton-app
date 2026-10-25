'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import dynamic from 'next/dynamic';
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
import type { Tab } from '@/components/HomeShell';
import { getIdentity, setIdentity } from '@/lib/identity';
import CardSkeleton, { TabSkeleton } from '@/components/primitives/CardSkeleton';
import { RevealGroup, RevealSlot } from '@/components/primitives/Reveal';
import UnpaidSessionsCard from '@/components/UnpaidSessionsCard';
import SkillLeadCard, { SKILL_LEAD_HEIGHT } from './home/SkillLeadCard';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import InstallBanner from '@/components/InstallBanner';
import ReleaseNotesTrigger from './ReleaseNotesTrigger';
import StatusBanner from '@/components/primitives/StatusBanner';
import PageHeader from '@/components/primitives/PageHeader';
import { OFFER_PIN_KEY } from '@/lib/offerPin';
import { useTabReturn } from '@/lib/tabActivity';
import WhoElseIsIn from './home/WhoElseIsIn';
import { canViewTransition, withViewTransition } from '@/lib/viewTransition';
import { primeHaptics, tapSuccess } from '@/lib/haptics';
import ShuttleBurst, { type BurstOrigin } from './home/ShuttleBurst';
import { useOnline } from '@/lib/useOnline';
import { renderMarkdown } from '@/lib/miniMarkdown';
import { primeFetch, sharedFetch } from '@/lib/sharedRead';
import { primeMemberAvatars } from '@/lib/useMemberAvatars';
import { useEverOpened } from '@/lib/useEverOpened';

// HomeTab itself stays eager (it carries the LCP announcement), but the
// sheets it can open do not need to: each is behind a tap or a one-shot
// marker, and `GiveKudosSheet` alone drags the kudos picker and the avatar
// reader into the first payload. Each is rendered only while open, so the
// chunk is fetched on first open and never for a visitor who never taps.
const GiveKudosSheet = dynamic(() => import('@/components/stats/GiveKudosSheet'), { ssr: false });
const ReleaseNotesSheet = dynamic(() => import('./ReleaseNotesSheet'), { ssr: false });
const RecoveryPinSheet = dynamic(() => import('./RecoveryPinSheet'), { ssr: false });

/** The Home balance row (UnpaidSessionsCard, collapsed), measured at 400px. */
const BALANCE_ROW_HEIGHT = 50;

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;
const TIME_SHORT = { hour: '2-digit', minute: '2-digit' } as const;

interface HomeTabProps {
  onTabChange?: (tab: Tab) => void;
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
   * The signed-in member's name, as the server verified it before rendering
   * the app (`app/page.tsx`). The sign-up card signs up THIS person — there is
   * no name field, because the server takes the name from the account and
   * ignores anything typed (docs/plans/members-only.md). `null` only where a
   * caller has no verified name (a component test mounting the shell bare):
   * the card then names the local identity, and offers no form without one.
   */
  memberName?: string | null;
  /**
   * HomeShell has not decided the starting tab yet (it restores the last tab
   * after mount). Home holds its fetches until it has, so a restore to another
   * tab does not fire Home's five requests for a screen nobody will see.
   */
  deferFetch?: boolean;
}

export default function HomeTab({ onTabChange, onTitleTap, devOverrides, initialAnnouncement = null, isAdmin = false, memberName = null, deferFetch = false }: HomeTabProps) {
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
  /** Who the sign-up card signs up: the verified member, else the local identity. */
  const signupName = memberName ?? currentUser;
  const [isSubmitting, setIsSubmitting] = useState(false);
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
  const [releases, setReleases] = useState<Release[]>([]);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  // How the confirmation arrives, set only by the act of signing up, never on a
  // Home revisit (it resets when the tab remounts). 'morph': the button becomes
  // the confirmation through a View Transition. 'pop': the banner's own
  // entrance, where the browser has no transitions or motion is reduced. Never
  // both, which would move the same thing twice.
  const [signupEntrance, setSignupEntrance] = useState<'none' | 'pop' | 'morph'>('none');
  // The shuttle burst (docs/plans/signup-shuttle-burst.md): set once per
  // CONFIRMED sign-up from the submit button's viewport rect, cleared by the
  // layer itself when the last piece lands.
  const [burst, setBurst] = useState<BurstOrigin | null>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const clearBurst = useCallback(() => setBurst(null), []);
  /* Cancelling a spot and giving kudos lived on the Sign-Ups tab until it left
     the nav (2026-09-16). The card is the sign-up list now, so both live here.
     ONE confirmation sheet for both lists: coming off a waitlist is not the same
     event as giving up a confirmed spot, and `isWaitlisted` picks the wording. */
  const tPlayers = useTranslations('players');
  const tClose = useTranslations('recovery');
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  const [cancelError, setCancelError] = useState('');
  // The club's late-cancellation window, set only when the server answered
  // 409 `late_cancel` (docs/plans/late-cancel-fee.md): the sheet then shows the
  // fee warning and "Cancel anyway" resends with the acknowledgement.
  const [lateCancelHours, setLateCancelHours] = useState<number | null>(null);
  const closeCancel = () => { setConfirmingCancel(false); setLateCancelHours(null); };
  const [kudosFor, setKudosFor] = useState<string | null>(null);
  // The lazily loaded sheets mount on first open and stay (see
  // `useEverOpened`): no chunk for a visitor who never taps, no cut-short
  // close animation for one who does.
  const kudosEver = useEverOpened(kudosFor !== null);
  const releaseEver = useEverOpened(releaseSheetOpen);
  /* The first-PIN sheet, for a member signed in with nothing to sign in with
     next time (the card below, or straight after an admin let them in). */
  const [setPinOpen, setSetPinOpen] = useState(false);
  const [recoveredName, setRecoveredName] = useState('');
  /**
   * Does the verified member have any way to sign in again —
   * a PIN, a password or a linked provider? Tri-state: `null` is unknown and
   * shows nothing. A member let in by an admin (an access request) is signed in
   * with a 30-day session and no credential at all, and would be locked out
   * again when it lapses (2026-09-13 flow audit).
   */
  const [hasCredential, setHasCredential] = useState<boolean | null>(null);
  /** The credential probe has finished, whatever it found — what orders the banner's slot. */
  const [credentialChecked, setCredentialChecked] = useState(false);

  const maxPlayers = defaultMaxPlayers();

  const loadData = useCallback(async () => {
    // The skeleton is for the FIRST load only. A refetch after a sign-up used
    // to drop all of Home back to a skeleton and replay its entrance — the
    // one confirmation this screen exists to give, hidden behind a blink.
    // Once a week has loaded, the content stays while it refreshes; a refetch
    // that fails still sets weekLoadError below, which replaces the week with
    // the error, so stale data never stands in for a failure.
    if (!weekLoadedRef.current) {
      setLoading(true);
      // The balance and skill cards mount only once the week below has
      // landed; start their reads NOW, beside it, so they are not a second
      // wave behind it (lib/sharedRead.ts `primeFetch`). First load only — a
      // refetch finds the cards mounted and reading for themselves.
      if (memberName) {
        const q = encodeURIComponent(memberName);
        primeFetch(`/api/players/unpaid?name=${q}`);
        if (isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT')) primeFetch('/api/credit');
        primeFetch(`/api/assessments?name=${q}`);
      }
    }
    setWeekLoadError(false);
    setSessionMissing(false);
    try {
      // `/api/session` and `/api/members` are also read by the shell and the
      // avatar store on the same mount; `sharedFetch` makes that one request
      // each while it is in flight (lib/sharedRead.ts).
      const [sRes, pRes, aRes, mRes, rRes] = await Promise.all([
        sharedFetch('/api/session'),
        fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        fetch(`${BASE}/api/announcements`, { cache: 'no-store' }),
        sharedFetch('/api/members').catch(() => null),
        fetch(`${BASE}/api/releases`, { cache: 'no-store' }).catch(() => null),
      ]);
      // The players list is half of the sign-up card (spots left, are you
      // in), so it failing is the week failing too.
      if (sRes.status === 404) setSessionMissing(true);
      else if (!sRes.ok || !pRes.ok) setWeekLoadError(true);
      weekLoadedRef.current = sRes.ok && pRes.ok;
      if (sRes.ok) {
        setSession(await sRes.json() as Session);
      }
      if (pRes.ok) setPlayers(await pRes.json());
      if (aRes.ok) {
        const list: Announcement[] = await aRes.json();
        setAnnouncement(list.length > 0 ? list[0] : null);
      }
      if (mRes?.ok) {
        // The roster's avatars come from this read; the store used to fetch
        // it again when the first face rendered.
        primeMemberAvatars(await mRes.json());
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
  }, [reportFetchFailure, memberName]);

  useEffect(() => {
    // The server-verified member IS the user, and the state above was
    // initialised from it. localStorage may not have caught up yet —
    // HomeShell reconciles it, but its effect runs after this child's — so it
    // is read only when there is no verified name.
    if (deferFetch) return;
    if (!memberName) {
      const id = getIdentity();
      if (id) setCurrentUser(id.name);
    }
    loadData();
  }, [loadData, memberName, deferFetch]);

  // Back on Home after a while: someone may have signed up, an announcement
  // may be new. Re-read quietly — the week stays on screen while it does
  // (`weekLoadedRef` above), so a return never blinks to a skeleton.
  useTabReturn(() => {
    if (!deferFetch) void loadData();
  });

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
      } finally {
        if (!cancelled) setCredentialChecked(true);
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
  // Waitlisted by the unpaid soft hold rather than a full session
  // (docs/plans/payments.md) — the banner says why, and how it ends.
  const heldForUnpaid = currentUser
    ? waitlistPlayers.some((p) => p.name.toLowerCase() === currentUser.toLowerCase() && p.heldForUnpaid === true)
    : false;

  const isFull = activePlayers.length >= (session?.maxPlayers ?? maxPlayers);
  const needsCredential = !!memberName && hasCredential === false;
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
    // Where the row actually LANDED, not what was asked for: the server can
    // put a "give me a spot" on the list (a capacity race, or the unpaid soft
    // hold), and nothing should fly for a spot that was not given.
    const onList = waitlist || joined?.waitlisted === true;
    const morph = !onList && joined !== null && canViewTransition();
    const commit = () => {
      setCurrentUser(trimmed);
      if (joined) setPlayers((prev) => [...prev.filter((p) => p.id !== joined.id), joined]);
      if (!onList) setSignupEntrance(morph ? 'morph' : 'pop');
    };
    // The burst radiates from the button, whose rect has to be read BEFORE
    // the commit replaces it with the banner. A waitlist join gets none:
    // nothing landed yet. It is FIRED only once the morph has finished:
    // Safari paints a View Transition from static snapshots, so a burst
    // started in the same commit played behind a frozen picture and was
    // gone before the picture came down — invisible on every iPhone.
    //
    // The tap is felt in the SAME callback that launches the shuttles, so
    // the buzz and the pop are one moment. It used to fire as the server
    // answered, a whole morph (~250 ms) before anything flew — felt, then
    // seen, which reads as two events. Native shell only; a no-op anywhere
    // it cannot be felt. Reduced motion has no burst and no morph, so the
    // tap still lands straight after the commit, with the banner.
    const rect = !onList ? submitRef.current?.getBoundingClientRect() : undefined;
    const launch = () => {
      if (onList) return;
      tapSuccess();
      if (rect) setBurst({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2, key: Date.now() });
    };
    if (morph) {
      withViewTransition(commit, 'vt-signup', launch);
    } else {
      commit();
      launch();
    }
    void loadData();
  }

  /**
   * Give up your spot, or leave the waitlist. Moved from the Sign-Ups tab.
   *
   * Cancelling is NOT signing out (CLAUDE.md, auth taxonomy): the identity
   * stays so a re-sign-up is one tap. Its `deleteToken` is cleared because the
   * server consumed it. The row leaves the roster at once; the refetch
   * confirms. A failure keeps the sheet open and says so.
   */
  async function handleCancel(acknowledgeLateFee = false) {
    if (!currentUser || !online) return;
    const id = getIdentity();
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: currentUser,
          deleteToken: id?.token,
          ...(acknowledgeLateFee ? { acknowledgeLateFee: true } : {}),
        }),
      });
      if (res.status === 409) {
        // Not a failure: the server wants the late-fee warning seen first.
        const data = await res.json().catch(() => ({})) as { error?: string; hours?: unknown };
        if (data.error === 'late_cancel' && typeof data.hours === 'number') {
          setCancelError('');
          setLateCancelHours(data.hours);
          return;
        }
      }
      if (!res.ok) {
        setCancelError(tPlayers('cancelFailure'));
        return;
      }
      if (id) setIdentity({ ...id, token: '' });
      const me = currentUser.toLowerCase();
      setPlayers((prev) => prev.filter((p) => p.name.toLowerCase() !== me));
      setSignupEntrance('none');
      setCancelError('');
      closeCancel();
      void loadData();
    } catch {
      setCancelError(tPlayers('cancelFailure'));
    }
  }

  // Sign-up and waitlist share one submit; `waitlist` adds `waitlist: true`
  // to the POST body and tunes the failure copy. The server signs up the
  // account behind the cookie, so the name sent is the one the card shows.
  async function performSignup(waitlist: boolean) {
    // Legible-fail: refuse the mutation with a clear reason instead of
    // firing a fetch that throws and leaves the form in limbo.
    if (!online) { setError(t('signup.offline')); return; }
    const trimmed = (signupName ?? '').trim();
    if (!trimmed) { setError(t('signup.nameRequired')); return; }

    setIsSubmitting(true);
    setError('');
    try {
      const body: Record<string, unknown> = { name: trimmed };
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
        } else {
          setError(data.error ?? (waitlist ? t('signup.waitlistFailure') : t('signup.genericFailure')));
        }
        if (res.status === 409) void loadData();
        return;
      }
      if (!session?.id) { setError(t('signup.networkError')); return; }
      applySignup(trimmed, data, session.id, waitlist);
    } catch {
      setError(t('signup.networkError'));
    } finally {
      setIsSubmitting(false);
    }
  }

  async function handleSignUp(e: React.FormEvent) {
    e.preventDefault();
    // Fetch the haptics code while the server works, so the tap is ready the
    // instant the shuttles launch (see applySignup). A no-op off the shell.
    primeHaptics();
    await performSignup(false);
  }

  async function handleJoinWaitlist(e: React.FormEvent) {
    e.preventDefault();
    await performSignup(true);
  }

  /* Who is signing up — the account, never a typed name. */
  const signingUpAs = (
    <p className="fs-md" style={{ margin: 0, color: 'var(--text-secondary)' }}>
      {t('signup.signingUpAs', { name: signupName ?? '' })}
    </p>
  );

  const sessionWhen = session
    ? `${format.dateTime(new Date(session.datetime), DAY_LONG)}, ${format.dateTime(new Date(session.datetime), TIME_SHORT)}`
    : undefined;
  const sessionWhenWhere = sessionWhen && session?.locationName
    ? tStates('signedUpWhenWhere', { when: sessionWhen, place: session.locationName })
    : sessionWhen;

  const announcementCard = (a: Announcement) => (
    <div className="glass-card p-5 space-y-2">
      <p className="section-label">{t('announcement.label')}</p>
      <div className="announcement-body fs-md text-gray-200 leading-relaxed">
        {renderMarkdown(a.text)}
      </div>
    </div>
  );

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
          the scroll-condense.
          Same 30px title as every other tab (Grant, 2026-10-15: "this header
          size is off from the other page"). The 2026-08-27 hierarchy pass had
          made it a 16px `compact` variant; that variant also GREW on scroll,
          to the shared 18px condensed size, so it is gone, not just unused. */}
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
          {clubName}
        </span>
      </PageHeader>
      {!loading && (
        <div style={{ marginTop: 'var(--space-1)' }}>
          <ReleaseNotesTrigger
            releases={releases}
            onOpen={openReleaseSheet}
          />
        </div>
      )}

      {/* Reveal the data cards together on load. Wrapping below the sticky
          PageHeader keeps the header out of the transform (containing-block
          trap) while the card stack fades in once when data lands. */}
      {/* TWO GROUPS, NOT FIVE CARDS.
          Tight inside a group, loose between them: proximity is what says
          "these belong together" without adding a heading to each. The first
          group is this week's session — where, when, and are you in. The
          second is your account — what you owe and what you have with the
          stringer. Five evenly-spaced cards read as five unrelated errands. */}
      {/* LOADING CASCADE (docs/plans/loading-cascade.md). One group, filling top
          to bottom: the week (one gate — its five reads land together), then
          the skill prompt, the credential banner and the balance, each held
          in order however the network answers. The week's skeleton draws the
          SERVER-RENDERED announcement for real — it is the LCP element, and
          hiding it behind a shimmer threw away the reason it is fetched on the
          server — and reserves no announcement slot when the server says there
          is none. */}
      <RevealGroup>
      <RevealSlot
        ready={!loading}
        placeholder={<TabSkeleton announcement={initialAnnouncement ? announcementCard(initialAnnouncement) : null} />}
      >
      {!loading && (
      <div className="bpm-home-stack">
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
      {effectiveAnnouncement && announcementCard(effectiveAnnouncement)}

      {/* Sign-Up Card — the submit button / payment action / "I paid" button
          sit in the thumb zone for one-handed use. */}
      <div className="glass-card p-5 vt-signup-card">
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
            {/* baseline, not items-start: the count is 14px beside a 20px heading,
                so aligning the TOPS leaves it floating above the title's baseline.
                Same alignment YourRecordCard's header already uses. All four
                sign-up states share this header, so all four move together. */}
            <div className="flex items-baseline justify-between">
              <p className="bpm-h2">{t('signup.heading')}</p>
              <p key={spotsTotal - activePlayers.length} className="fs-md text-gray-400 animate-count-tick">{t('signup.spotsRemaining', { remaining: spotsTotal - activePlayers.length, total: spotsTotal })}</p>
            </div>
            {/* Shares `vt-signup-confirm` with the submit button, so under a
                View Transition the button becomes this banner in place. */}
            <div className="vt-signup-confirm" data-entrance={signupEntrance}>
              <StatusBanner
                tone="success"
                icon="check_circle"
                title={currentUser ? tStates('signedUpTitle', { name: currentUser }) : tStates('signedUpTitleGeneric')}
                /* The plan itself, not "see you soon": the line people
                   paste into the group chat is when and where. */
                body={sessionWhenWhere}
                celebrate={signupEntrance === 'pop'}
              />
            </div>
            <WhoElseIsIn active={activePlayers.map((p) => p.name)} waitlist={waitlistPlayers.map((p) => p.name)} me={currentUser} onKudos={setKudosFor} />
            <button
              type="button"
              className="link-quiet"
              style={{ display: 'flex', marginInline: 'auto' }}
              onClick={() => { setCancelError(''); setLateCancelHours(null); setConfirmingCancel(true); }}
              disabled={!online}
            >
              {t('signup.cantMakeIt')}
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
              title={heldForUnpaid ? tStates('heldTitle') : tStates('waitlistTitle')}
              body={
                heldForUnpaid
                  ? tStates('heldBody')
                  : `${tStates('waitlistPositionLabel', { position: waitlistPosition, total: waitlistPlayers.length })} · ${t('signup.confirmed', { name: currentUser ?? '' })}`
              }
            />
            <WhoElseIsIn active={activePlayers.map((p) => p.name)} waitlist={waitlistPlayers.map((p) => p.name)} me={currentUser} />
            <button
              type="button"
              className="link-quiet"
              style={{ display: 'flex', marginInline: 'auto' }}
              onClick={() => { setCancelError(''); setLateCancelHours(null); setConfirmingCancel(true); }}
              disabled={!online}
            >
              {t('signup.leaveWaitlist')}
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
            <WhoElseIsIn active={activePlayers.map((p) => p.name)} waitlist={waitlistPlayers.map((p) => p.name)} me={currentUser} />
            {signupName && (
            <form onSubmit={handleJoinWaitlist} className="space-y-3">
              {signingUpAs}
              {error && <p id="signup-error" role="alert" className="field-error">{error}</p>}
              <button
                type="submit"
                disabled={isSubmitting || !online}
                className="cc-btn cc-btn-primary cc-btn-lg"
              >
                {isSubmitting ? t('signup.joining') : t('signup.waitlist')}
              </button>
            </form>
            )}
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
                {/* No slash. "12/12" reads as a score or a full battery — taken
                    out of total — so an EMPTY session looked full (Grant,
                    2026-10-06). The big number is the spots still open; the
                    total follows in words. */}
                <span className="bpm-count">
                  {spotsTotal - activePlayers.length}
                </span>
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>
                  {t('signup.spotsLeftSuffix', { remaining: spotsTotal - activePlayers.length, total: spotsTotal })}
                </span>
              </p>
            </div>
            <WhoElseIsIn active={activePlayers.map((p) => p.name)} waitlist={waitlistPlayers.map((p) => p.name)} me={currentUser} />
            {signupName && (
            <form onSubmit={handleSignUp} className="space-y-3">
              {signingUpAs}
              {error && <p id="signup-error" role="alert" className="field-error">{error}</p>}
              <button
                ref={submitRef}
                type="submit"
                disabled={isSubmitting || !online}
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
              {session?.deadline && (
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
            )}
          </div>
        )}
      </div>

      {/* The skill lead (docs/plans/home-skill-lead.md): a compact card under the
          sign-up card, for every identified member, every week — the club
          spread and the ask, or the member's own level and how it moved. It
          replaced the self-retiring discovery hook on 2026-10-14, because a
          card that retired on the first rating could never show a change.
          It always renders something once it has read, so its slot holds
          the card's measured height rather than being space-less. */}
      {currentUser && (
        <RevealSlot placeholder={<CardSkeleton height={SKILL_LEAD_HEIGHT} />}>
          <SkillLeadCard name={currentUser} club={clubName} onOpen={() => onTabChange?.('skills')} />
        </RevealSlot>
      )}

      </section>
      )}

      <section className="bpm-home-group vt-home-account" aria-label={t('groups.account')}>
      {/* Signed in, but nothing to sign in WITH next time — the state an
          admin-approved access request leaves. One tap to a PIN. */}
      {memberName && (
      <RevealSlot ready={credentialChecked} empty={!needsCredential} placeholder={null}>
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
      </RevealSlot>
      )}
      {/* Your balance — what you owe, across sessions and stringing. Sits in
          the ACCOUNT group rather than above sign-up: as a one-line row
          carrying its own figure it no longer needs the top slot to be read,
          and most weeks it says $0. */}
      {currentUser && (
        <RevealSlot placeholder={<CardSkeleton height={BALANCE_ROW_HEIGHT} />}>
          <UnpaidSessionsCard name={currentUser} variant="home" onSignIn={() => onTabChange?.('profile')} />
        </RevealSlot>
      )}

      {/* Stringing moved to its own tab (components/StringingTab.tsx) when
          it took the nav slot Sign-Ups held. */}
      </section>


      <BottomSheet
        open={confirmingCancel}
        onClose={closeCancel}
        ariaLabel={isWaitlisted ? tPlayers('leaveSheetTitle') : tPlayers('cancelConfirm')}
      >
        <BottomSheetHeader onClose={closeCancel} closeLabel={tClose('close')}>
          <h2 className="bpm-h3 m-0">
            {isWaitlisted ? tPlayers('leaveSheetTitle') : tPlayers('cancelConfirm')}
          </h2>
        </BottomSheetHeader>
        <BottomSheetBody>
          {/* Two states of one sheet. Keyed so the swap to the late-fee warning
              replays `.motion-fade` (the Appear recipe): content arriving into a
              surface already on screen fades, it does not rise. */}
          {lateCancelHours === null ? (
            <div key="cancel" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              <p className="fs-base m-0" style={{ color: 'var(--text-secondary)' }}>
                {isWaitlisted ? tPlayers('leaveSheetBody') : tPlayers('cancelSheetBody')}
              </p>
              {cancelError && <p className="field-error" role="alert">{cancelError}</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                {/* The destructive action leads and is named for what it does. */}
                <button type="button" onClick={() => void handleCancel()} disabled={!online} className="cc-btn cc-btn-danger cc-btn-lg">
                  {isWaitlisted ? tPlayers('leaveSheetConfirm') : tPlayers('cancelSheetConfirm')}
                </button>
                <button type="button" onClick={closeCancel} className="cc-btn cc-btn-ghost cc-btn-lg">
                  {tPlayers('sheetKeep')}
                </button>
              </div>
            </div>
          ) : (
            <div key="late" className="motion-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
              {/* Amber, never red: red on Home means something failed, and nothing has. */}
              <StatusBanner
                tone="warn"
                icon="schedule"
                title={tPlayers('lateCancelTitle', { hours: lateCancelHours })}
                body={tPlayers('lateCancelBody')}
              />
              {cancelError && <p className="field-error" role="alert">{cancelError}</p>}
              <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                <button type="button" onClick={() => void handleCancel(true)} disabled={!online} className="cc-btn cc-btn-danger cc-btn-lg">
                  {tPlayers('lateCancelConfirm')}
                </button>
                <button type="button" onClick={closeCancel} className="cc-btn cc-btn-ghost cc-btn-lg">
                  {tPlayers('sheetKeep')}
                </button>
              </div>
            </div>
          )}
        </BottomSheetBody>
      </BottomSheet>
      {/* Opened on a specific person from the roster, so the sheet skips its
          picker. Same sheet as Stats: one flow, two entry points. */}
      {kudosEver && (
        <GiveKudosSheet open={kudosFor !== null} onClose={() => setKudosFor(null)} recipient={kudosFor} />
      )}

      {/* Only mounted once we have a name — `identity` is required, and a
          sheet that cannot say who it is setting a PIN for should not exist. */}
      {recoveredName !== '' && (
      <RecoveryPinSheet
        open={setPinOpen}
        onClose={() => setSetPinOpen(false)}
        identity={{ name: recoveredName, sessionId: session?.id ?? '' }}
        /* Always the two-field first-set shape: it opens only when the
           account has no PIN. */
        hasPin={false}
        /* Signed in with a live member_session, so the first-set guard is
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
      )}
      </RevealSlot>
      </RevealGroup>
      {releaseEver && (
        <ReleaseNotesSheet
          open={releaseSheetOpen}
          releases={releases}
          onClose={() => setReleaseSheetOpen(false)}
        />
      )}
      <ShuttleBurst origin={burst} onDone={clearBurst} />
    </div>
  );
}
