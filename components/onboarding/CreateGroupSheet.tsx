'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import { setIdentity } from '@/lib/identity';
import InviteShare from './InviteShare';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  sessionId: string;
  /** The name this device already goes by, prefilled as the roster name. */
  defaultName?: string;
  onCreated?: () => void;
}

/**
 * The "Create a group" door.
 *
 * IT DOES NOT CLOSE ON SUCCESS. It swaps to a success step holding the invite
 * link, for the same reason `AdvanceSessionForm` stays on its success screen:
 * the moment a club exists is the moment its organiser wants to invite people,
 * and a sheet that vanishes sends them hunting through Admin for a link they
 * were holding a second ago. "Done" is the dismissal.
 *
 * Two fields, because they are genuinely two things: the CLUB's name, and the
 * name this person goes by ON that club's roster. The second is prefilled from
 * the identity this device already has, so the common case is one field.
 */
export default function CreateGroupSheet({ open, onClose, sessionId, defaultName, onCreated }: Props) {
  const t = useTranslations('onboarding.create');
  const [name, setName] = useState('');
  const [rosterName, setRosterName] = useState(defaultName ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<{ name: string; token: string; code: string } | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (trimmed.length < 2) {
      setError(t('nameTooShort'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: trimmed, ...(rosterName.trim() ? { rosterName: rosterName.trim() } : {}) }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (data.error === 'too_many_groups') setError(t('tooMany'));
        else if (data.error === 'invalid_name') setError(t('nameTooShort'));
        else setError(t('failed'));
        setBusy(false);
        return;
      }
      // The server re-minted both cookies for the new club; mirror the roster
      // name into localStorage so the rest of the app agrees about who this is.
      setIdentity({ name: data.rosterName ?? rosterName.trim(), sessionId });
      setCreated({
        name: data.group?.name ?? trimmed,
        token: data.invite?.token ?? '',
        code: data.invite?.code ?? '',
      });
      onCreated?.();
    } catch {
      setError(t('failed'));
    } finally {
      setBusy(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader>{created ? t('created', { name: created.name }) : t('title')}</BottomSheetHeader>
      <BottomSheetBody>
        {created ? (
          <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>
              {t('createdHint')}
            </p>
            {/* The invite the club was just given, not a link to go and find it. */}
            <InviteShare token={created.token} code={created.code} groupName={created.name} />
            <button type="button" onClick={onClose} className="cc-btn cc-btn-primary cc-btn-lg" style={{ width: '100%' }}>
              {t('done')}
            </button>
          </div>
        ) : (
          <form onSubmit={submit} style={{ display: 'grid', gap: 'var(--space-5)' }}>
            <p style={{ fontSize: 'var(--fs-md)', color: 'var(--text-secondary)', margin: 0 }}>{t('subtitle')}</p>

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('nameLabel')}</span>
              <input
                type="text"
                value={name}
                onChange={(e) => {
                  setName(e.target.value);
                  setError(null);
                }}
                placeholder={t('namePlaceholder')}
                maxLength={40}
                autoFocus
                aria-label={t('nameLabel')}
              />
            </label>

            <label style={{ display: 'grid', gap: 'var(--space-2)' }}>
              <span className="section-label">{t('yourNameLabel')}</span>
              <input
                type="text"
                value={rosterName}
                onChange={(e) => setRosterName(e.target.value)}
                maxLength={40}
                aria-label={t('yourNameLabel')}
                autoComplete="nickname"
              />
              <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('yourNameHint')}</span>
            </label>

            {error && <p className="field-error">{error}</p>}

            <button
              type="submit"
              disabled={busy || name.trim().length < 2}
              className="cc-btn cc-btn-primary cc-btn-lg"
              style={{ width: '100%' }}
            >
              {busy ? t('creating') : t('submit')}
            </button>
          </form>
        )}
      </BottomSheetBody>
    </BottomSheet>
  );
}
