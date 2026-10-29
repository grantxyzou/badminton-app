'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Collapse from '@/components/primitives/Collapse';
import StatusBanner from '@/components/primitives/StatusBanner';
import type { Player } from '@/lib/types';
import { GUEST_NAME_MAX } from '@/lib/plusOne';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * A plus-one on the sign-up card (docs/plans/plus-one.md).
 *
 * With a guest: who they are, whether they are in or waiting, and Remove.
 * Without one, and when the club allows it: a quiet "Bring a guest" that opens
 * a one-field form in place. The server decides everything — the switch, the
 * one-guest rule, whether there is room — and the card refetches after each
 * change, so nothing here is optimistic.
 *
 * Removing inside the club's late-cancel window answers 409 `late_cancel`, the
 * same as the host's own cancel; the row then shows the same amber warning
 * and "Remove anyway" resends with the acknowledgement.
 */
export default function PlusOneRow({
  guest,
  canAdd,
  online,
  onChanged,
}: {
  /** The host's guest row in this session, or null. */
  guest: Player | null;
  /** The club allows guests and the session still takes sign-ups. */
  canAdd: boolean;
  online: boolean;
  /** Called after the server accepted a change; the card refetches. */
  onChanged: () => void;
}) {
  const t = useTranslations('home.guest');
  const tPlayers = useTranslations('players');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lateHours, setLateHours] = useState<number | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim() || busy || !online) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: { name: name.trim() } }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(data.error === 'invalid_guest_name' ? t('invalidName') : t('addFailed'));
        return;
      }
      setName('');
      setOpen(false);
      onChanged();
    } catch {
      setError(t('addFailed'));
    } finally {
      setBusy(false);
    }
  }

  async function remove(acknowledgeLateFee = false) {
    if (busy || !online) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: true, ...(acknowledgeLateFee ? { acknowledgeLateFee: true } : {}) }),
      });
      if (res.status === 409) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; hours?: unknown };
        if (data.error === 'late_cancel' && typeof data.hours === 'number') {
          setLateHours(data.hours);
          return;
        }
      }
      if (!res.ok) {
        setError(t('removeFailed'));
        return;
      }
      setLateHours(null);
      onChanged();
    } catch {
      setError(t('removeFailed'));
    } finally {
      setBusy(false);
    }
  }

  if (guest) {
    const guestName = guest.guestName ?? guest.name;
    return (
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>person_add</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <p className="fs-md m-0" style={{ color: 'var(--text-primary)' }}>
              {guest.waitlisted ? t('waiting', { name: guestName }) : t('coming', { name: guestName })}
            </p>
            <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('note')}</p>
          </div>
          {lateHours === null && (
            <button type="button" className="link-quiet" onClick={() => void remove()} disabled={busy || !online}>
              {t('remove')}
            </button>
          )}
        </div>
        {lateHours !== null && (
          <div className="motion-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {/* Amber, never red: nothing has failed. */}
            <StatusBanner
              tone="warn"
              icon="schedule"
              title={tPlayers('lateCancelTitle', { hours: lateHours })}
              body={tPlayers('lateCancelBody')}
            />
            <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
              <button type="button" className="cc-btn cc-btn-danger" onClick={() => void remove(true)} disabled={busy || !online}>
                {t('removeAnyway')}
              </button>
              <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setLateHours(null)}>
                {tPlayers('sheetKeep')}
              </button>
            </div>
          </div>
        )}
        {error && <p className="field-error" role="alert">{error}</p>}
      </div>
    );
  }

  if (!canAdd) return null;

  return (
    <div>
      {!open && (
        <button
          type="button"
          className="link-quiet"
          style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)' }}
          onClick={() => { setError(''); setOpen(true); }}
          disabled={!online}
        >
          <span className="material-icons icon-sm" aria-hidden="true">person_add</span>
          {t('bring')}
        </button>
      )}
      <Collapse open={open}>
        <form onSubmit={add} style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
            <input
              type="text"
              value={name}
              maxLength={GUEST_NAME_MAX}
              onChange={(e) => setName(e.target.value)}
              placeholder={t('namePlaceholder')}
              aria-label={t('namePlaceholder')}
              autoComplete="off"
              style={{ flex: 1, minWidth: 0 }}
            />
            <button type="submit" className="cc-btn cc-btn-secondary" disabled={!name.trim() || busy || !online}>
              {busy ? t('adding') : t('add')}
            </button>
          </div>
          <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('note')}</p>
          <button
            type="button"
            className="link-quiet"
            style={{ alignSelf: 'flex-start' }}
            onClick={() => { setOpen(false); setName(''); setError(''); }}
          >
            {t('cancel')}
          </button>
          {error && <p className="field-error" role="alert">{error}</p>}
        </form>
      </Collapse>
    </div>
  );
}
