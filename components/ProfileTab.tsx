'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isFlagOn } from '@/lib/flags';
import { getIdentity, clearIdentity, type Identity } from '@/lib/identity';
import type { Release } from '@/lib/types';
import RecoverySheet from './RecoverySheet';
import EnterCodeSheet from './EnterCodeSheet';
import ReleaseNotesSheet from './ReleaseNotesSheet';
import PinInput from './PinInput';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  sessionId: string;
  sessionLabel: string;
  isAdmin: boolean;
  onAdminTools: () => void;
}

export default function ProfileTab({ sessionId, sessionLabel, isAdmin, onAdminTools }: Props) {
  const t = useTranslations('profile');
  const tPin = useTranslations('pin');
  const recoveryFlag = isFlagOn('NEXT_PUBLIC_FLAG_RECOVERY');
  const [identity, setLocalIdentity] = useState<Identity | null>(null);
  const [pinIsSet, setPinIsSet] = useState(false);
  const [recoveryOpen, setRecoveryOpen] = useState(false);
  const [enterCodeOpen, setEnterCodeOpen] = useState(false);
  const tRecovery = useTranslations('recovery');
  const [editingPin, setEditingPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<'too_common' | 'invalid' | null>(null);
  const [pinSaved, setPinSaved] = useState(false);
  const [releaseSheetOpen, setReleaseSheetOpen] = useState(false);
  const [releases, setReleases] = useState<Release[]>([]);
  const tSettings = useTranslations('profile.settings');
  const tNav = useTranslations('nav');

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    if (id) {
      const hint = localStorage.getItem('badminton_pin_set');
      setPinIsSet(hint === 'true');
    }
    fetch(`${BASE}/api/releases`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : []))
      .then((data: Release[]) => setReleases(Array.isArray(data) ? data : []))
      .catch(() => setReleases([]));
  }, []);

  function handleLogout() {
    clearIdentity();
    localStorage.removeItem('badminton_pin_set');
    localStorage.removeItem('badminton_pin_prompted');
    setLocalIdentity(null);
    setPinIsSet(false);
  }

  async function savePin(value: string | null) {
    if (!identity) return;
    setPinError(null);
    const meRes = await fetch(`${BASE}/api/players`, { cache: 'no-store' });
    const players = (await meRes.json()) as { id: string; name: string; sessionId: string }[];
    const me = players.find(
      (p) => p.name.toLowerCase() === identity.name.toLowerCase() && p.sessionId === identity.sessionId,
    );
    if (!me) {
      setPinError('invalid');
      return;
    }
    const patchRes = await fetch(`${BASE}/api/players`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: me.id, pin: value, deleteToken: identity.token }),
    });
    if (!patchRes.ok) {
      const body = await patchRes.json().catch(() => ({}));
      setPinError(body.error === 'pin_too_common' ? 'too_common' : 'invalid');
      return;
    }
    setPinIsSet(value !== null);
    localStorage.setItem('badminton_pin_set', value !== null ? 'true' : 'false');
    setPinSaved(true);
    setEditingPin(false);
    setNewPin('');
    setConfirmPin('');
    setTimeout(() => setPinSaved(false), 2000);
  }

  // Anonymous state
  if (!identity) {
    return (
      <div className="animate-fadeIn" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
        <h2 style={{ fontSize: 30, fontWeight: 600 }}>{t('anonymousTitle')}</h2>
        <p style={{ color: 'var(--text-secondary)' }}>{t('anonymousBody')}</p>
        {recoveryFlag && (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, alignItems: 'flex-start' }}>
              <button type="button" onClick={() => setRecoveryOpen(true)} className="btn-primary">
                {t('anonymousRestoreLink')}
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
                  padding: '0 12px',
                  minHeight: 44,
                  display: 'inline-flex',
                  alignItems: 'center',
                }}
              >
                {tRecovery('haveCodeLink')}
              </button>
            </div>
            <RecoverySheet
              open={recoveryOpen}
              onClose={() => setRecoveryOpen(false)}
              sessionId={sessionId}
              onForgotPin={() => setEnterCodeOpen(true)}
            />
            <EnterCodeSheet
              open={enterCodeOpen}
              onClose={() => setEnterCodeOpen(false)}
              sessionId={sessionId}
            />
          </>
        )}
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
    <div className="animate-fadeIn" style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 16 }}>
      <h1 style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.02em', margin: 0 }}>{tNav('profile')}</h1>
      <div className="glass-card" style={{ padding: 12, display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div className="inner-card" style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('playerName')}</p>
          <p style={{ fontSize: 24, fontWeight: 600 }}>{identity.name}</p>
          {sessionLabel && (
            <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
              {t('playerSession')} {sessionLabel}
            </p>
          )}
        </div>

      {recoveryFlag && (
        <div className="inner-card" style={{ padding: 16 }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('pinSectionTitle')}</h3>
          {!editingPin ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--text-secondary)', fontSize: 13 }}>
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{ fontSize: 16, color: pinIsSet ? 'var(--color-green, #10b981)' : 'var(--text-muted)' }}
                >
                  {pinIsSet ? 'check_circle' : 'radio_button_unchecked'}
                </span>
                {pinIsSet ? t('pinIsSet') : t('pinNotSet')}
              </span>
              <div style={{ display: 'flex', gap: 8 }}>
                <button type="button" onClick={() => setEditingPin(true)} className="btn-ghost">
                  {pinIsSet ? t('pinChangeButton') : t('pinSetButton')}
                </button>
                {pinIsSet && (
                  <button type="button" onClick={() => savePin(null)} className="btn-ghost">
                    {t('pinRemoveButton')}
                  </button>
                )}
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('newLabel')}</p>
                <PinInput value={newPin} onChange={setNewPin} digits={4} label={tPin('newLabel')} autoFocus />
              </div>
              <div>
                <p style={{ fontSize: 11, color: 'var(--text-secondary)', marginBottom: 4 }}>{tPin('confirmLabel')}</p>
                <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={tPin('confirmLabel')} />
              </div>
              {pinError === 'too_common' && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>
                  {t('pinTooCommon')}
                </p>
              )}
              {pinError === 'invalid' && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>
                  {t('pinInvalid')}
                </p>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button
                  type="button"
                  className="btn-primary"
                  disabled={newPin.length !== 4 || newPin !== confirmPin}
                  onClick={() => savePin(newPin)}
                  style={{ flex: 1 }}
                >
                  {tPin('save')}
                </button>
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    setEditingPin(false);
                    setNewPin('');
                    setConfirmPin('');
                    setPinError(null);
                  }}
                  style={{ flex: 1 }}
                >
                  {tPin('cancel')}
                </button>
              </div>
              {newPin && confirmPin && newPin !== confirmPin && (
                <p role="alert" style={{ fontSize: 12, color: 'var(--color-red, #ef4444)' }}>
                  {tPin('mismatch')}
                </p>
              )}
            </div>
          )}
          {pinSaved && (
            <p style={{ fontSize: 12, color: 'var(--color-green, #10b981)', marginTop: 8 }}>
              {t('pinSaved')}
            </p>
          )}
        </div>
      )}

        <SettingsList
          title={tSettings('title')}
          rows={[
            ...(recoveryFlag
              ? [{ icon: 'key', label: tSettings('forgotPin'), onClick: () => setRecoveryOpen(true) }]
              : []),
            { icon: 'campaign', label: tSettings('releaseNotes'), onClick: () => setReleaseSheetOpen(true) },
            ...(isAdmin
              ? [{ icon: 'admin_panel_settings', label: tSettings('adminAccess'), onClick: onAdminTools }]
              : []),
            { icon: 'logout', label: tSettings('logout'), onClick: handleLogout, destructive: true },
          ]}
        />
      </div>

      {recoveryFlag && (
        <>
          <RecoverySheet
            open={recoveryOpen}
            onClose={() => setRecoveryOpen(false)}
            sessionId={sessionId}
            onForgotPin={() => setEnterCodeOpen(true)}
          />
          <EnterCodeSheet
            open={enterCodeOpen}
            onClose={() => setEnterCodeOpen(false)}
            sessionId={sessionId}
          />
        </>
      )}

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
}

function SettingsList({ title, rows }: { title: string; rows: SettingsRow[] }) {
  return (
    <div className="inner-card" style={{ padding: 0, overflow: 'hidden' }}>
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
