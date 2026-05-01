'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { getIdentity, clearIdentity, type Identity } from '@/lib/identity';
import type { Release } from '@/lib/types';
import EnterCodeSheet from './EnterCodeSheet';
import CreateAccountSheet from './CreateAccountSheet';
import RecoveryPinSheet from './RecoveryPinSheet';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import PinInput from './PinInput';
// PinInput is used by the inline anonymous sign-in form below. The signed-in
// state's PIN management lives in RecoveryPinSheet now (opened via Settings).

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
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);
  const [createAccountOpen, setCreateAccountOpen] = useState(false);
  // Anonymous-state inline sign-in form. Replaces the old RecoverySheet path
  // for fresh visitors per the auth taxonomy split.
  const [signInName, setSignInName] = useState('');
  const [signInPin, setSignInPin] = useState('');
  const [signInError, setSignInError] = useState<'invalid' | 'rate_limited' | 'admin_logged_in' | 'network' | null>(null);
  const [signInSubmitting, setSignInSubmitting] = useState(false);
  // Signed-in state PIN management: tap the Settings "Recovery PIN" row to
  // open RecoveryPinSheet (set / change / remove + forgot-it handoff).
  const [recoveryPinOpen, setRecoveryPinOpen] = useState(false);
  const tRecovery = useTranslations('recovery');
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const tSettings = useTranslations('profile.settings');
  const tNav = useTranslations('nav');

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    fetch(`${BASE}/api/releases`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Release[]) => setReleases(Array.isArray(data) ? data : []))
      .catch(() => setReleases([]));
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
      .then((data: { hasPin?: boolean }) => {
        if (!cancelled) setPinIsSet(data.hasPin === true);
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

  function handleLogout() {
    clearIdentity();
    setLocalIdentity(null);
    setPinIsSet(null);
  }

  // Anonymous state — Profile is identity-only. Inline sign-in form (name +
  // PIN) sits in the glass card; "Create an account" lives below an "or"
  // divider and opens an action sheet. Session signup belongs on Home, not
  // here.
  async function submitSignIn(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = signInName.trim();
    if (!trimmed || signInPin.length !== 4) return;
    setSignInError(null);
    setSignInSubmitting(true);
    try {
      const res = await fetch(`${BASE}/api/players/recover`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, sessionId, pin: signInPin }),
      });
      if (res.status === 429) { setSignInError('rate_limited'); return; }
      if (res.status === 403) { setSignInError('admin_logged_in'); return; }
      // Distinguish 5xx (server/DB failure) from 4xx (bad credentials).
      // Without this, a Cosmos throttle or a /api/players/recover 500
      // looks identical to "wrong PIN" — user retries 5x and rate-limits
      // themselves out of recovery for an hour.
      if (res.status >= 500) { setSignInError('network'); return; }
      if (!res.ok) { setSignInError('invalid'); return; }
      const body = await res.json();
      if (!body || typeof body.deleteToken === 'undefined') {
        setSignInError('network');
        return;
      }
      const { setIdentity } = await import('@/lib/identity');
      setIdentity({ name: trimmed, token: body.deleteToken, sessionId });
      setLocalIdentity(getIdentity());
    } catch {
      // fetch threw (offline, DNS, CORS) or res.json() threw on malformed
      // response. Surface a distinct error so user knows to retry vs.
      // double-checking PIN.
      setSignInError('network');
    } finally {
      setSignInSubmitting(false);
    }
  }
  if (!identity) {
    const canSubmit = signInName.trim().length > 0 && signInPin.length === 4 && !signInSubmitting;
    return (
      <div className="animate-fadeIn flex flex-col gap-4">
        <h1 className="bpm-h1">{t('anonymousTitle')}</h1>
        <p style={{ color: 'var(--text-secondary)' }}>{t('anonymousBody')}</p>
        <div className="glass-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 12 }}>
          <form onSubmit={submitSignIn} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            <input
              type="text"
              aria-label={t('anonymousNamePlaceholder')}
              placeholder={t('anonymousNamePlaceholder')}
              value={signInName}
              onChange={(e) => { setSignInName(e.target.value); setSignInError(null); }}
              autoComplete="username"
              maxLength={50}
            />
            <PinInput
              value={signInPin}
              onChange={(v) => { setSignInPin(v); setSignInError(null); }}
              digits={4}
              label={t('anonymousPinLabel')}
              ariaInvalid={signInError === 'invalid'}
            />
            <button
              type="submit"
              disabled={!canSubmit}
              className="btn-primary"
              style={{ width: '100%' }}
            >
              {signInSubmitting ? t('anonymousSignInChecking') : t('anonymousSignInButton')}
            </button>
            {signInError === 'invalid' && (
              <p role="alert" style={{ color: 'var(--color-red, #ef4444)', fontSize: 12, margin: 0 }}>
                {t('anonymousSignInErrorInvalid')}
              </p>
            )}
            {signInError === 'rate_limited' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12, margin: 0 }}>
                {t('anonymousSignInErrorRateLimited')}
              </p>
            )}
            {signInError === 'admin_logged_in' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12, margin: 0 }}>
                {t('anonymousSignInErrorAdminLogged')}
              </p>
            )}
            {signInError === 'network' && (
              <p role="alert" style={{ color: 'var(--color-amber, #f59e0b)', fontSize: 12, margin: 0 }}>
                {t('anonymousSignInErrorNetwork')}
              </p>
            )}
          </form>
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
          <button
            type="button"
            onClick={() => setEnterCodeOpen(true)}
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--text-secondary)',
              fontSize: 12,
              textDecoration: 'underline',
              cursor: 'pointer',
              padding: '8px 12px',
              minHeight: 44,
              display: 'inline-flex',
              alignItems: 'center',
              alignSelf: 'center',
            }}
          >
            {tRecovery('haveCodeLink')}
          </button>
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
            <button type="button" onClick={onAdminTools} className="btn-primary" style={{ width: '100%' }}>
              {t('adminToolsButton')}
            </button>
          </div>
        )}
      </div>
    );
  }

  // Player (and possibly admin) state
  return (
    <div className="animate-fadeIn flex flex-col gap-4">
      <h1 className="bpm-h1">{tNav('profile')}</h1>
      <div className="glass-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="glass-card-soft" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('playerName')}</p>
          <p style={{ fontSize: 24, fontWeight: 600 }}>{identity.name}</p>
          {sessionLabel && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('playerSession')} {sessionLabel}
            </p>
          )}
        </div>

        <SettingsList
          title={tSettings('title')}
          rows={[
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
      </div>

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

function SettingsList({ title, rows }: { title: string; rows: SettingsRow[] }) {
  return (
    <div className="glass-card-soft" style={{ padding: 0, overflow: 'hidden' }}>
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
