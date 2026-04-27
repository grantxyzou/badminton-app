'use client';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { isFlagOn } from '@/lib/flags';
import { getIdentity, type Identity } from '@/lib/identity';
import RecoverySheet from './RecoverySheet';
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
  const [editingPin, setEditingPin] = useState(false);
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [pinError, setPinError] = useState<'too_common' | 'invalid' | null>(null);
  const [pinSaved, setPinSaved] = useState(false);

  useEffect(() => {
    const id = getIdentity();
    setLocalIdentity(id);
    if (id) {
      const hint = localStorage.getItem('badminton_pin_set');
      setPinIsSet(hint === 'true');
    }
  }, []);

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
            <p>
              <button type="button" onClick={() => setRecoveryOpen(true)} className="btn-ghost">
                {t('anonymousRestoreLink')}
              </button>
            </p>
            <RecoverySheet open={recoveryOpen} onClose={() => setRecoveryOpen(false)} sessionId={sessionId} />
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
      <div className="glass-card p-5" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>{t('playerName')}</p>
        <p style={{ fontSize: 24, fontWeight: 600 }}>{identity.name}</p>
        {sessionLabel && (
          <p style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
            {t('playerSession')} {sessionLabel}
          </p>
        )}
      </div>

      {recoveryFlag && (
        <div className="glass-card p-5">
          <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12 }}>{t('pinSectionTitle')}</h3>
          {!editingPin ? (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={{ color: 'var(--text-secondary)' }}>
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
              <PinInput value={newPin} onChange={setNewPin} digits={4} label={tPin('newLabel')} autoFocus />
              <PinInput value={confirmPin} onChange={setConfirmPin} digits={4} label={tPin('confirmLabel')} />
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
