'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity, clearIdentity, IDENTITY_EVENT, type Identity } from '@/lib/identity';
import type { Release } from '@/lib/types';
import EnterCodeSheet from './EnterCodeSheet';
import CreateAccountSheet from './CreateAccountSheet';
import RecoveryPinSheet from './RecoveryPinSheet';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import SignInForm from './SignInForm';
import PageHeader from './primitives/PageHeader';
import AdminConsoleHero from './admin/CommandCenter/AdminConsoleHero';
import { isFlagOn } from '@/lib/flags';
import { avatarColors as profileAvaColors } from '@/lib/avatar';
import { normalizeBirdUsages, totalBirdCost } from '@/lib/birdUsages';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  sessionId: string;
  sessionLabel: string;
  isAdmin: boolean;
  onAdminTools: () => void;
}

export default function ProfileTab({
  sessionId,
  sessionLabel,
  isAdmin,
  onAdminTools,
}: Props) {
  const t = useTranslations('profile');
  const [identity, setLocalIdentity] = useState<Identity | null>(null);
  // null = unknown/loading or fetch failed. Used to avoid the bug where a
  // 5xx on /api/members/me silently rendered "Recovery PIN: Not set" and
  // pushed users into a re-create loop that 409'd on `account_exists`.
  const [pinIsSet, setPinIsSet] = useState<boolean | null>(null);
  const [memberCreatedAt, setMemberCreatedAt] = useState<string | null>(null);
  const [isSignedUp, setIsSignedUp] = useState<boolean>(false);
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  // Signed-in state PIN management: tap the Settings "Recovery PIN" row to
  // open RecoveryPinSheet (set / change / remove + forgot-it handoff).
  const [recoveryPinOpen, setRecoveryPinOpen] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [releases, setReleases] = useState<Release[] | null>([]);
  const tSettings = useTranslations('profile.settings');
  const tNav = useTranslations('nav');

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    fetch(`${BASE}/api/releases`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`releases fetch ${r.status}`);
        return r.json();
      })
      .then((data: Release[]) => setReleases(Array.isArray(data) ? data : null))
      .catch(() => setReleases(null));
  }, []);

  // Listen for identity mutations from any other component (e.g. EnterCodeSheet
  // completing the recovery-code flow, RecoverySheet finishing PIN sign-in).
  // Without this, ProfileTab's local `identity` state stays stale after a
  // recovery and the downstream `hasPin` fetch never refires — leaving users
  // stuck in 3-field "Update PIN" mode after a code redemption that should
  // have cleared their PIN.
  useEffect(() => {
    function refresh() { setLocalIdentity(getIdentity()); }
    window.addEventListener(IDENTITY_EVENT, refresh);
    return () => window.removeEventListener(IDENTITY_EVENT, refresh);
  }, []);

  // Reflect server-side pin status whenever identity changes (mount, sign-in,
  // logout). Source of truth is `members.pinHash` mirrored from the player
  // record — `/api/members/me` returns `hasPin` as a derived boolean. Avoids
  // the previous localStorage-flag approach which de-synced after sign-in
  // and was the bug behind "Recovery PIN: Not set" until refresh.
  useEffect(() => {
    if (!identity) {
      setPinIsSet(null);
      return;
    }
    let cancelled = false;
    setPinIsSet(null); // mark unknown while fetching
    fetch(`${BASE}/api/members/me?name=${encodeURIComponent(identity.name)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`hasPin fetch ${r.status}`);
        return r.json();
      })
      .then((data: { hasPin?: boolean; createdAt?: string | null }) => {
        if (cancelled) return;
        setPinIsSet(data.hasPin === true);
        setMemberCreatedAt(typeof data.createdAt === 'string' ? data.createdAt : null);
      })
      .then(() => fetch(`${BASE}/api/players`, { cache: 'no-store' }))
      .then(async (r) => {
        if (!r || !r.ok) return null;
        return r.json() as Promise<Array<{ name?: string; removed?: boolean; waitlisted?: boolean }>>;
      })
      .then((players) => {
        if (cancelled || !Array.isArray(players)) return;
        const here = players.find(
          (p) => !p.removed && !p.waitlisted && typeof p.name === 'string' && p.name.toLowerCase() === identity.name.toLowerCase(),
        );
        setIsSignedUp(!!here);
      })
      .catch((err) => {
        if (cancelled) return;
        // Keep status unknown rather than asserting "Not set". The audit
        // (H4) found this default-to-false flip was pushing users into
        // recreate-account loops on transient backend failures.
        console.warn('hasPin fetch failed:', err);
        setPinIsSet(null);
      });
    return () => {
      cancelled = true;
    };
  }, [identity]);

  // Cost-to-pay summary for the identity card. Mirrors HomeTab's CostCard calc:
  // per-person = (court + bird totals) / active count, shown only when the
  // admin has made the breakdown public (showCostBreakdown). `paid` comes from
  // the viewer's own player record; `prevOwe` is the frozen last-session snapshot.
  const [oweThisWeek, setOweThisWeek] = useState<number | null>(null);
  const [paidThisWeek, setPaidThisWeek] = useState(false);
  const [prevOwe, setPrevOwe] = useState<number | null>(null);

  useEffect(() => {
    if (!identity) {
      setOweThisWeek(null);
      setPaidThisWeek(false);
      setPrevOwe(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const [sRes, pRes] = await Promise.all([
          fetch(`${BASE}/api/session`, { cache: 'no-store' }),
          fetch(`${BASE}/api/players`, { cache: 'no-store' }),
        ]);
        if (cancelled || !sRes.ok || !pRes.ok) return;
        const session = await sRes.json();
        const players = (await pRes.json()) as Array<{ name?: string; removed?: boolean; waitlisted?: boolean; paid?: boolean }>;
        if (cancelled) return;
        const active = players.filter((p) => !p.removed && !p.waitlisted);
        const me = active.find((p) => typeof p.name === 'string' && p.name.toLowerCase() === identity.name.toLowerCase());
        const courtTotal = (session.costPerCourt ?? 0) * (session.courts ?? 0);
        const birdTotal = session.showCostBreakdown ? totalBirdCost(normalizeBirdUsages(session)) : 0;
        const total = courtTotal + birdTotal;
        const per = session.showCostBreakdown && total > 0 && active.length > 0 ? total / active.length : null;
        setOweThisWeek(me ? per : null);
        setPaidThisWeek(!!me?.paid);
        setPrevOwe(
          session.showCostBreakdown && typeof session.prevCostPerPerson === 'number' && session.prevCostPerPerson > 0
            ? session.prevCostPerPerson
            : null,
        );
      } catch {
        /* leave nulls — the cost row just won't render */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [identity]);

  async function handleLogout() {
    // Single-identity model: logging out as a player also revokes admin
    // status. Otherwise the admin cookie outlived the player session and
    // leaked admin powers to whoever signed in next on the same browser.
    clearIdentity();
    setLocalIdentity(null);
    setPinIsSet(null);
    try {
      const res = await fetch(`${BASE}/api/admin`, { method: 'DELETE' });
      if (!res.ok) {
        // Cookie clear is the difference between "fully logged out" and
        // "next person on this browser inherits admin powers" — log so a
        // future bug investigation can find it. Local identity is already
        // cleared so the user-facing state is consistent.
        console.warn('Admin cookie clear failed:', res.status);
      }
    } catch (err) {
      console.warn('Admin cookie clear failed (network):', err);
    }
  }

  // Anonymous state — Profile is identity-only. Inline sign-in form (name +
  // PIN) sits in the glass card; "Create an account" lives below an "or"
  // divider and opens an action sheet. Session signup belongs on Home, not
  // here. The form itself is shared with HomeTab via <SignInForm>.
  async function handleSignInSuccess({ name, token }: { name: string; token?: string }) {
    const { setIdentity } = await import('@/lib/identity');
    setIdentity({ name, token, sessionId });
    setLocalIdentity(getIdentity());
  }
  if (!identity) {
    return (
      <div className="animate-fadeIn flex flex-col gap-4">
        <PageHeader>{t('anonymousTitle')}</PageHeader>
        <p style={{ color: 'var(--text-secondary)' }}>{t('anonymousBody')}</p>
        <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <SignInForm
            sessionId={sessionId}
            onSuccess={handleSignInSuccess}
            onForgotPin={() => setEnterCodeOpen(true)}
          />
          <div
            aria-hidden="true"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              color: 'var(--text-muted)',
              fontSize: 11,
              textTransform: 'uppercase',
              letterSpacing: '0.1em',
            }}
          >
            <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
            <span>{t('anonymousOrDivider')}</span>
            <span style={{ flex: 1, height: 1, background: 'var(--glass-border)' }} />
          </div>
          <button
            type="button"
            onClick={() => setCreateAccountOpen(true)}
            className="btn-ghost"
            style={{ width: '100%' }}
          >
            {t('anonymousCreateCta')}
          </button>
          {/* Standalone "Have a recovery code" link removed — the SignInForm's
              "Forgot your PIN?" link is the single entry to EnterCodeSheet now. #93 */}
        </div>
        <CreateAccountSheet
          open={createAccountOpen}
          onClose={() => {
            setCreateAccountOpen(false);
            // Refresh identity if the sheet set it.
            setLocalIdentity(getIdentity());
          }}
          sessionId={sessionId}
        />
        <EnterCodeSheet
          open={enterCodeOpen}
          onClose={() => setEnterCodeOpen(false)}
          sessionId={sessionId}
        />
        {isAdmin && (
          <div className="glass-card p-5">
            <button type="button" onClick={onAdminTools} className="cc-btn cc-btn-primary cc-btn-lg">
              {t('adminToolsButton')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Player (and possibly admin) state
  const showAdminHero = isAdmin && isFlagOn('NEXT_PUBLIC_FLAG_COMMAND_CENTER');
  return (
    <div className="animate-fadeIn flex flex-col gap-4">
      <PageHeader>{tNav('profile')}</PageHeader>

      <ProfileIdentityCard
        name={identity.name}
        memberCreatedAt={memberCreatedAt}
        isSignedUp={isSignedUp}
        isAdmin={isAdmin}
        nameLabel={t('playerName')}
        oweThisWeek={oweThisWeek}
        paidThisWeek={paidThisWeek}
        prevOwe={prevOwe}
      />

      {showAdminHero && (
        <>
          <ProfileEyebrow>Admin</ProfileEyebrow>
          <AdminConsoleHero onOpenAdmin={onAdminTools} />
        </>
      )}

      <ProfileEyebrow>{tSettings('title')}</ProfileEyebrow>
      <SettingsList
        rows={[
            // Batch B (expanded): PIN management is now member-scoped via
            // PATCH /api/members/me — works regardless of whether the user
            // has a session player. The previous "Sign up for a session
            // first" gate is no longer needed.
            {
              icon: 'key',
              // pinIsSet === null means we couldn't load status. Show the
              // generic section title rather than asserting "New PIN" (which
              // would suggest "you don't have one yet" — false on transient
              // backend failures).
              label: pinIsSet === null
                ? t('pinSectionTitle')
                : pinIsSet
                ? tSettings('updatePin')
                : tSettings('newPin'),
              onClick: () => setRecoveryPinOpen(true),
            },
            {
              icon: 'help_outline',
              label: tSettings('recoveryCode'),
              onClick: () => setEnterCodeOpen(true),
            },
            { icon: 'campaign', label: tSettings('releaseNotes'), onClick: () => setReleaseSheetOpen(true) },
            ...(isAdmin
              ? [{ icon: 'admin_panel_settings', label: tSettings('adminAccess'), onClick: onAdminTools }]
              : []),
            { icon: 'logout', label: tSettings('logout'), onClick: handleLogout, destructive: true },
          ]}
        />

      <RecoveryPinSheet
        open={recoveryPinOpen}
        onClose={() => setRecoveryPinOpen(false)}
        identity={identity}
        hasPin={pinIsSet === true}
        onSaved={(newHasPin) => setPinIsSet(newHasPin)}
      />
      <EnterCodeSheet
        open={enterCodeOpen}
        onClose={() => setEnterCodeOpen(false)}
        sessionId={sessionId}
      />

      <ReleaseNotesSheet
        open={releaseSheetOpen}
        releases={releases}
        onClose={() => setReleaseSheetOpen(false)}
      />
    </div>
  );
}

interface SettingsRow {
  icon: string;
  label: string;
  onClick: () => void;
  destructive?: boolean;
  /** Right-aligned status text shown before the chevron (e.g. "Set" / "Not set"). */
  meta?: string;
}

function SettingsList({ title, rows }: { title?: string; rows: SettingsRow[] }) {
  return (
    <div className="glass-card-soft" style={{ padding: 0, overflow: 'hidden' }}>
      {title && (
        <p
          style={{
            padding: '14px 16px 8px',
            fontSize: 11,
            fontWeight: 600,
            letterSpacing: '0.08em',
            textTransform: 'uppercase',
            color: 'var(--text-secondary)',
          }}
        >
          {title}
        </p>
      )}
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((row, idx) => (
          <li key={row.label} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--divider)' }}>
            <button
              type="button"
              onClick={row.onClick}
              style={{
                width: '100%',
                display: 'flex',
                alignItems: 'center',
                gap: 12,
                padding: '14px 16px',
                background: 'transparent',
                border: 'none',
                cursor: 'pointer',
                color: row.destructive ? 'var(--color-amber, #f59e0b)' : 'var(--text-primary)',
                fontSize: 15,
                textAlign: 'left',
              }}
            >
              <span
                className="material-icons"
                aria-hidden="true"
                style={{ fontSize: 20, color: 'var(--text-secondary)' }}
              >
                {row.icon}
              </span>
              <span style={{ flex: 1 }}>{row.label}</span>
              {row.meta && (
                <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>{row.meta}</span>
              )}
              <span
                className="material-icons"
                aria-hidden="true"
                style={{ fontSize: 18, color: 'var(--text-secondary)' }}
              >
                chevron_right
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ── Identity card (avatar + name + member-since + In/Admin pills) ── */

function fmtMemberSince(iso: string | null): string | null {
  if (!iso) return null;
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', year: 'numeric' });
  } catch {
    return null;
  }
}

interface ProfileIdentityCardProps {
  name: string;
  memberCreatedAt: string | null;
  isSignedUp: boolean;
  isAdmin: boolean;
  nameLabel: string;
  /** Per-person cost for the active session if the viewer is signed up and the
   *  breakdown is public; null otherwise (no cost row). */
  oweThisWeek: number | null;
  /** Whether the viewer's player record is marked paid for the active session. */
  paidThisWeek: boolean;
  /** Frozen last-session per-person snapshot, if public; null otherwise. */
  prevOwe: number | null;
}

function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

function ProfileIdentityCard({ name, memberCreatedAt, isSignedUp, isAdmin, nameLabel, oweThisWeek, paidThisWeek, prevOwe }: ProfileIdentityCardProps) {
  const ava = profileAvaColors(name);
  const memberSince = fmtMemberSince(memberCreatedAt);
  const showCostRow = oweThisWeek !== null || prevOwe !== null;

  return (
    <div
      className="glass-card-soft"
      style={{
        padding: 16,
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
      }}
    >
      <p
        style={{
          fontFamily: 'var(--font-display, "Space Grotesk")',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--ink-faint, rgba(255,255,255,0.42))',
          margin: 0,
        }}
      >
        {nameLabel}
      </p>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
        <span
          aria-hidden="true"
          style={{
            width: 48,
            height: 48,
            borderRadius: '50%',
            background: ava.bg,
            color: ava.fg,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontFamily: 'var(--font-display, "Space Grotesk")',
            fontWeight: 600,
            fontSize: 20,
            flexShrink: 0,
            border: '1px solid rgba(255,255,255,0.10)',
          }}
        >
          {name.slice(0, 1).toUpperCase()}
        </span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p
            style={{
              fontFamily: 'var(--font-display, "Space Grotesk")',
              fontSize: 22,
              fontWeight: 700,
              letterSpacing: '-0.02em',
              margin: 0,
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {name}
          </p>
          {memberSince && (
            <p style={{ fontSize: 12.5, color: 'var(--text-secondary)', marginTop: 2 }}>
              Member since {memberSince}
            </p>
          )}
        </div>
        <div style={{ display: 'inline-flex', flexDirection: 'column', gap: 4, alignItems: 'flex-end', flexShrink: 0 }}>
          {isSignedUp && (
            <span
              className="pill-paid"
              style={{ whiteSpace: 'nowrap' }}
            >
              In
            </span>
          )}
          {isAdmin && (
            <span
              style={{
                whiteSpace: 'nowrap',
                background: 'rgba(167,139,250,0.13)',
                color: '#a78bfa',
                border: '1px solid rgba(167,139,250,0.28)',
                padding: '3px 10px',
                borderRadius: 999,
                fontSize: 10.5,
                fontFamily: 'var(--font-display, "Space Grotesk")',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
              }}
            >
              Admin
            </span>
          )}
        </div>
      </div>

      {showCostRow && (
        <div
          style={{
            borderTop: '1px solid var(--inner-card-border)',
            paddingTop: 12,
            display: 'flex',
            flexDirection: 'column',
            gap: 6,
          }}
        >
          {oweThisWeek !== null && (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>This week</span>
              {paidThisWeek ? (
                <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--accent, #22c55e)' }}>Paid ✓</span>
              ) : (
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>
                  You owe {fmtMoney(oweThisWeek)}
                </span>
              )}
            </div>
          )}
          {prevOwe !== null && (
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Last session</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, color: 'var(--text-muted)' }}>
                {fmtMoney(prevOwe)}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* Section eyebrow — uppercase label that sits OUTSIDE a card,
   above the content it labels. Matches the design's 'ADMIN' /
   'ACCOUNT' pattern. */
function ProfileEyebrow({ children }: { children: React.ReactNode }) {
  return (
    <p
      style={{
        fontFamily: 'var(--font-display, "Space Grotesk")',
        fontSize: 11,
        fontWeight: 700,
        letterSpacing: '0.16em',
        textTransform: 'uppercase',
        color: 'var(--ink-faint, rgba(255,255,255,0.42))',
        margin: '8px 4px -2px',
      }}
    >
      {children}
    </p>
  );
}
