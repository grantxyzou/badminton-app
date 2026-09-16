'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import TopBar from '@/components/primitives/TopBar';
import SettingsList from './SettingsList';
import type { GroupListEntry } from '@/lib/useCurrentGroup';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  onBack: () => void;
  groups: GroupListEntry[];
  loadError?: boolean;
  /** Ask again after a failed load — a sub-page has no pull-to-refresh. */
  onRetry?: () => void;
  /** Remount the tabs so every card refetches under the new club's cookies. */
  onSwitched: () => void;
  onJoinAnother: () => void;
  onCreateAnother: () => void;
}

/**
 * "Your groups" — the switcher.
 *
 * A PAGE, not a sheet, and deliberately NOT part of HomeShell's onboarding
 * stack. That stack exists to hide the bottom nav, because its screens belong
 * to a club the person has no relationship with yet. This one is reached from
 * Profile and returns to Profile, so the nav stays — which is why it lives in
 * `ProfileTab`'s own `view` router beside `StatsPrivacyScreen`, the screen it
 * copies in every structural respect.
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
export default function GroupsPage({
  onBack,
  groups,
  loadError,
  onRetry,
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
    } catch {
      setError(t('switchFailed'));
      setBusyId(null);
    }
  }

  const roleLabel = (role: GroupListEntry['role']) =>
    role === 'owner' ? t('roleOwner') : role === 'admin' ? t('roleAdmin') : t('roleMember');

  return (
    // NOT wrapped in an element containing only the header — TopBar is
    // `position: sticky`, and a header-only wrapper shrinks the sticky
    // containing block so the bar scrolls away instead of condensing.
    <div className="animate-slideInRight space-y-5">
      <TopBar title={t('yourGroups')} crumb={t('crumb')} onBack={onBack} backLabel={t('crumb')} />

      <p style={{ margin: 0, fontSize: 'var(--fs-md)', color: 'var(--text-secondary)' }}>{t('yourGroupsHint')}</p>

      {loadError ? (
        <ErrorState
          message={t('loadFailed')}
          action={onRetry ? (
            <button type="button" className="cc-btn cc-btn-ghost" onClick={onRetry}>
              {t('retry')}
            </button>
          ) : undefined}
        />
      ) : (
        // The same card and rows as Profile's settings lists, which is where
        // this page is opened from — the first cut borrowed admin's
        // `.cc-mini-card`, which at page level takes the 30px card radius and
        // no padding, so each club read as a pill with its text on the rim.
        <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div className="glass-card is-flush" style={{ overflow: 'hidden' }}>
            <ul style={{ listStyle: 'none', margin: '0', padding: '0' }}>
              {groups.map((g, idx) => (
                <li key={g.id} style={{ borderTop: idx === 0 ? 'none' : '1px solid var(--divider)' }}>
                  <button
                    type="button"
                    className="group-row"
                    onClick={() => !g.current && switchTo(g.id)}
                    disabled={g.current || busyId !== null}
                    aria-current={g.current ? 'true' : undefined}
                    data-busy={busyId === g.id ? 'true' : undefined}
                    aria-label={g.current ? g.name : t('switchTo', { name: g.name })}
                  >
                    <span className="group-monogram" aria-hidden="true">
                      {Array.from(g.name.trim())[0]?.toUpperCase() ?? '?'}
                    </span>
                    <span style={{ flex: 1, minWidth: 0, display: 'grid', gap: 'var(--space-hair)' }}>
                      <span style={{ fontSize: 'var(--fs-lg)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {g.name}
                      </span>
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {roleLabel(g.role)} · {g.rosterName}
                      </span>
                    </span>
                    {g.current ? (
                      // A tick, the way a picker marks its selection. Accent
                      // is the one thing on the page that says "this one".
                      <span
                        className="material-icons"
                        role="img"
                        aria-label={t('current')}
                        style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent)', flexShrink: 0 }}
                      >
                        check
                      </span>
                    ) : busyId === g.id ? (
                      <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', flexShrink: 0 }}>
                        {t('switching')}
                      </span>
                    ) : (
                      <span
                        className="material-icons"
                        aria-hidden="true"
                        style={{ fontSize: 'var(--icon-md)', color: 'var(--text-secondary)', flexShrink: 0 }}
                      >
                        chevron_right
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </div>

          {groups.length <= 1 && (
            <p style={{ margin: 0, padding: '0 var(--space-5)', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {t('onlyOne')}
            </p>
          )}
        </div>
      )}

      {error && <p className="field-error">{error}</p>}

      {/* Rows, not two full-width buttons: a secondary and a ghost button
          stacked read as "one real action and one disabled one". Both are
          equal ways onward, so they get equal rows. */}
      <SettingsList
        rows={[
          { icon: 'group_add', label: t('joinAnother'), onClick: onJoinAnother },
          { icon: 'add', label: t('createAnother'), onClick: onCreateAnother },
        ]}
      />
    </div>
  );
}
