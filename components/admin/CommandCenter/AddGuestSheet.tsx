'use client';

import { useEffect, useState } from 'react';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { GUEST_NAME_MAX } from '@/lib/plusOne';
import { useOnline } from '@/lib/useOnline';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

export interface GuestHost {
  memberId: string;
  name: string;
  /** Guests this member already has in the session. */
  guests: number;
}

/**
 * "Add a guest" for an organiser (docs/plans/six-feathers-guests.md, Q4): the
 * pilot's bridge while some members still text "+1 Jenny" to the organiser.
 * Pick whose guest, type the first name, and the server applies the member's
 * own rules — the club's number, the members-first window, a name already on
 * the list — with the host named by `hostMemberId`.
 *
 * English only, like every admin screen (CLAUDE.md, Q10).
 */
export default function AddGuestSheet({
  open,
  onClose,
  hosts,
  cap,
  onAdded,
}: {
  open: boolean;
  onClose: () => void;
  /** Members on this session's list, in or waiting, who may bring a guest. */
  hosts: GuestHost[];
  /** Guests each member may bring. */
  cap: number;
  onAdded: () => void;
}) {
  const online = useOnline();
  const [hostId, setHostId] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!open) {
      setHostId('');
      setName('');
      setError('');
    }
  }, [open]);

  const host = hosts.find((h) => h.memberId === hostId);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const guestName = name.trim();
    if (!host || !guestName || busy || !online) return;
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${BASE}/api/players`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ guest: { name: guestName }, hostMemberId: host.memberId }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        setError(
          data.error === 'guest_on_roster'
            ? `${guestName} is on the club’s list already — they can sign up themselves.`
            : data.error === 'guest_exists'
              ? `${host.name} already has as many guests as the club allows, or one called ${guestName}.`
              : data.error === 'invalid_guest_name'
                ? 'Use a first name, up to 20 letters, without brackets.'
                : data.error === 'host_not_signed_up'
                  ? `${host.name} is no longer on this week’s list.`
                  : data.error === 'host_held'
                    ? `${host.name} is held for unpaid sessions, so their guest can’t be added yet.`
                    : 'Couldn’t add the guest. Try again.',
        );
        return;
      }
      onAdded();
      onClose();
    } catch {
      setError('Couldn’t add the guest. Try again.');
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...hosts].sort((a, b) => a.name.localeCompare(b.name));

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel="Add a guest">
      <BottomSheetHeader onClose={onClose} closeLabel="Close">
        <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600 }}>Add a guest</span>
      </BottomSheetHeader>
      <BottomSheetBody>
        <form onSubmit={submit} className="flex flex-col gap-4 motion-fade">
          <p className="fs-md" style={{ margin: 0, color: 'var(--text-primary)' }}>
            For a member who asked you instead of adding them in the app. The guest shows as “Jenny (Josh)” and
            leaves if their member cancels.
          </p>
          <label className="flex flex-col gap-2">
            <span className="section-label-muted">Whose guest</span>
            <select className="fs-md" value={hostId} onChange={(e) => { setHostId(e.target.value); setError(''); }}>
              <option value="">Choose a member…</option>
              {sorted.map((h) => (
                <option key={h.memberId} value={h.memberId} disabled={h.guests >= cap}>
                  {h.guests >= cap ? `${h.name} (has ${h.guests})` : h.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-2">
            <span className="section-label-muted">Guest’s first name</span>
            <input
              type="text"
              value={name}
              maxLength={GUEST_NAME_MAX}
              onChange={(e) => { setName(e.target.value); setError(''); }}
              autoComplete="off"
            />
          </label>
          {error && <p className="field-error" role="alert">{error}</p>}
          <button
            type="submit"
            className="cc-btn cc-btn-primary cc-btn-lg"
            disabled={!host || !name.trim() || busy || !online}
          >
            {busy ? 'Adding…' : host ? `Add ${host.name}’s guest` : 'Add guest'}
          </button>
        </form>
      </BottomSheetBody>
    </BottomSheet>
  );
}
