'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '@/components/BottomSheet';
import type { GroupListEntry } from '@/lib/useCurrentGroup';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  open: boolean;
  onClose: () => void;
  groups: GroupListEntry[];
  loadError?: boolean;
  /** Remount the tabs so every card refetches under the new club's cookies. */
  onSwitched: () => void;
  onJoinAnother: () => void;
  onCreateAnother: () => void;
}

/**
 * "Your groups" — the switcher.
 *
 * A SWITCH IS A SIGN-IN, not a preference. The server re-mints both cookies for
 * the new club (`POST /api/groups/switch`), which is also what drops an admin
 * session when you run one club and merely play in another. Nothing about the
 * current club is kept client-side, so there is no local state here to get out
 * of step with the server.
 *
 * On success it calls `onSwitched`, which bumps `HomeShell`'s `refreshNonce` —
 * the same mechanism pull-to-refresh uses. Every tab is keyed on that nonce, so
 * they remount and refetch under the new cookies. Without it the roster, the
 * session and the balance would all still be the old club's, which is the most
 * confusing possible outcome of tapping a club's name.
 *
 * A LOAD FAILURE IS NOT AN EMPTY LIST. "You're only in one group" rendered over
 * a failed fetch tells someone their club is gone.
 */
export default function GroupsSheet({
  open,
  onClose,
  groups,
  loadError,
  onSwitched,
  onJoinAnother,
  onCreateAnother,
}: Props) {
  const t = useTranslations('groups');
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function switchTo(groupId: string) {
    if (busyId) return;
    setBusyId(groupId);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/groups/switch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ groupId }),
      });
      if (!res.ok) {
        setError(t('switchFailed'));
        setBusyId(null);
        return;
      }
      onSwitched();
      onClose();
    } catch {
      setError(t('switchFailed'));
      setBusyId(null);
    }
  }

  const roleLabel = (role: GroupListEntry['role']) =>
    role === 'owner' ? t('roleOwner') : role === 'admin' ? t('roleAdmin') : t('roleMember');

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('yourGroups')}>
      <BottomSheetHeader>{t('yourGroups')}</BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'grid', gap: 'var(--space-5)' }}>
          <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('yourGroupsHint')}</p>

          {loadError ? (
            <p className="field-error">{t('loadFailed')}</p>
          ) : (
            <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
              {groups.map((g) => (
                <button
                  key={g.id}
                  type="button"
                  onClick={() => !g.current && switchTo(g.id)}
                  disabled={g.current || busyId !== null}
                  aria-label={g.current ? g.name : t('switchTo', { name: g.name })}
                  className="cc-mini-card"
                  style={{
                    width: '100%',
                    textAlign: 'left',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 'var(--space-3)',
                    // The current club is not a disabled control, it is where
                    // you already are — so it stays fully legible rather than
                    // taking `.cc-btn:disabled`'s dimming.
                    opacity: busyId && busyId !== g.id ? 0.5 : 1,
                    cursor: g.current ? 'default' : 'pointer',
                  }}
                >
                  <span style={{ display: 'grid', gap: 'var(--space-hair)' }}>
                    <span style={{ fontSize: 'var(--fs-md)', color: 'var(--text-primary)', fontWeight: 600 }}>
                      {g.name}
                    </span>
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                      {roleLabel(g.role)} · {g.rosterName}
                    </span>
                  </span>
                  {g.current ? (
                    <span className="pill-admin" style={{ flexShrink: 0 }}>
                      {t('current')}
                    </span>
                  ) : busyId === g.id ? (
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>
                      {t('switching')}
                    </span>
                  ) : null}
                </button>
              ))}

              {groups.length <= 1 && (
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t('onlyOne')}</p>
              )}
            </div>
          )}

          {error && <p className="field-error">{error}</p>}

          <div style={{ display: 'grid', gap: 'var(--space-2)' }}>
            <button type="button" onClick={onJoinAnother} className="cc-btn cc-btn-secondary" style={{ width: '100%' }}>
              {t('joinAnother')}
            </button>
            <button type="button" onClick={onCreateAnother} className="cc-btn cc-btn-ghost" style={{ width: '100%' }}>
              {t('createAnother')}
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
