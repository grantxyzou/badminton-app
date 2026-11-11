'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import Collapse from '@/components/primitives/Collapse';
import StatusBanner from '@/components/primitives/StatusBanner';
import type { Player } from '@/lib/types';
import { GUEST_NAME_MAX } from '@/lib/plusOne';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * Guests on the sign-up card (docs/plans/plus-one.md,
 * docs/plans/six-feathers-guests.md).
 *
 * One line per guest the member brought — who they are, whether they are in
 * or waiting, and Remove — then, while the club allows another, a quiet
 * "Bring a guest" ("Bring another guest" once there is one) that opens a
 * one-field form in place. The server decides everything — the club's number,
 * whether there is room, a name already on the club's list — and the card
 * refetches after each change, so nothing here is optimistic.
 *
 * Removing inside the club's late-cancel window answers 409 `late_cancel`, the
 * same as the host's own cancel; that guest's line then shows the same amber
 * warning and "Remove anyway" resends with the acknowledgement.
 */
export default function PlusOneRow({
  guests,
  canAdd,
  online,
  onChanged,
  windowEnd = null,
  showShare = true,
}: {
  /** The host's guest rows in this session, oldest first. */
  guests: Player[];
  /** The club allows another guest and the session still takes sign-ups. */
  canAdd: boolean;
  online: boolean;
  /** Called after the server accepted a change; the card refetches. */
  onChanged: () => void;
  /** When the club's members-first window ends ("Mon 11:59 PM"), while it runs. */
  windowEnd?: string | null;
  /** Whether a guest's share lands on the member's balance: not in a club that keeps its money outside the app. */
  showShare?: boolean;
}) {
  const t = useTranslations('home.guest');
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function add(e: React.FormEvent) {
    e.preventDefault();
    const guestName = name.trim();
    if (!guestName || busy || !online) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: { name: guestName } }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === 'invalid_guest_name'
            ? t('invalidName')
            : data.error === 'guest_on_roster'
              ? t('onRoster', { name: guestName })
              : t('addFailed'),
        );
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

  if (guests.length === 0 && !canAdd) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      {guests.map((g) => (
        <GuestLine key={g.id} guest={g} online={online} onChanged={onChanged} windowEnd={windowEnd} showShare={showShare} />
      ))}
      {canAdd && (
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
              {guests.length === 0 ? t('bring') : t('bringAnother')}
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
              {showShare && <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('note')}</p>}
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
      )}
    </div>
  );
}

/** One guest: in or waiting, and Remove — with the late-cancel warning in place when it applies. */
function GuestLine({
  guest,
  online,
  onChanged,
  windowEnd,
  showShare,
}: {
  guest: Player;
  online: boolean;
  onChanged: () => void;
  windowEnd: string | null;
  showShare: boolean;
}) {
  const t = useTranslations('home.guest');
  const tPlayers = useTranslations('players');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lateHours, setLateHours] = useState<number | null>(null);
  const guestName = guest.guestName ?? guest.name;

  async function remove(acknowledgeLateFee = false) {
    if (busy || !online) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: true, guestId: guest.id, ...(acknowledgeLateFee ? { acknowledgeLateFee: true } : {}) }),
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

  return (
    <div className="motion-fade" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
        <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>person_add</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <p className="fs-md m-0" style={{ color: 'var(--text-primary)' }}>
            {guest.waitlisted && guest.waitingForMembers && windowEnd
              ? t('waitingForMembers', { name: guestName, when: windowEnd })
              : guest.waitlisted
                ? t('waiting', { name: guestName })
                : t('coming', { name: guestName })}
          </p>
          {showShare && <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>{t('note')}</p>}
        </div>
        {lateHours === null && (
          <button
            type="button"
            className="link-quiet"
            onClick={() => void remove()}
            disabled={busy || !online}
            aria-label={t('removeNamed', { name: guestName })}
          >
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
