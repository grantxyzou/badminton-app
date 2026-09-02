'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetBody } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { clearIdentity } from '@/lib/identity';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * "Delete my account" — the confirmation, and the only place it can be started.
 *
 * WHAT THIS SCREEN HAS TO SAY, and why each line is here rather than trimmed:
 *
 *  - What goes. Vague destructive copy ("this cannot be undone") tells someone
 *    it is serious without telling them what they lose.
 *  - What STAYS, and why. Past sessions keep an unnamed line so other people's
 *    cost splits still add up. Someone deleting an account to erase themselves
 *    deserves to know a row survives, even an anonymous one — finding out later
 *    would feel like the app kept something back.
 *  - That it does not cancel money owed. Deleting is not a way out of a
 *    balance, and letting anyone believe otherwise would be the app lying by
 *    omission about money. It also cannot be BLOCKED on a balance: App Store
 *    5.1.1(v) requires the path to work, so the honest move is to say it.
 *
 * The danger lives here, not on the row that opens it. Home spends red on
 * failure only, and a permanently red row in Settings that you scroll past
 * every visit spends the loudest colour in the system on something you almost
 * never do.
 */
export default function DeleteAccountSheet({
  open,
  onClose,
  onDeleted,
}: {
  open: boolean;
  onClose: () => void;
  /** Fired after the account is gone, so Profile can drop back to signed-out. */
  onDeleted: () => void;
}) {
  const t = useTranslations('profile.deleteAccount');
  const online = useOnline();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);

  async function handleDelete() {
    setWorking(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/members/me`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        cache: 'no-store',
      });
      if (!res.ok) {
        // Legible-fail: the sheet stays open saying so, rather than closing on
        // a failure and leaving someone to guess whether it worked.
        setError(true);
        setWorking(false);
        return;
      }
      /* The server has already cleared the cookies; this clears the localStorage
         half. Without it the device would still hold a name and a deleteToken
         for an account that no longer exists, and Home would offer to sign a
         ghost up for next week. */
      clearIdentity();
      onDeleted();
      onClose();
    } catch {
      setError(true);
      setWorking(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')} width="narrow">
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <h2 className="bpm-h3 m-0">{t('title')}</h2>
            <p className="fs-base m-0" style={{ marginTop: 'var(--space-2)', color: 'var(--text-secondary)' }}>
              {t('body')}
            </p>
            <p className="fs-sm m-0" style={{ marginTop: 'var(--space-3)', color: 'var(--text-muted)' }}>
              {t('keepsNote')}
            </p>
            {/* Money gets the warning treatment; the rest is muted body copy. */}
            <p
              className="fs-sm m-0"
              style={{ marginTop: 'var(--space-2)', color: 'var(--sev-warn)' }}
            >
              {t('debtWarning')}
            </p>
          </div>

          {error && (
            <p className="field-error" role="alert">
              {t('error')}
            </p>
          )}
          {!online && (
            <p className="fs-sm m-0" style={{ color: 'var(--text-muted)' }}>
              {t('offlineHint')}
            </p>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {/* Named for what it does. "Yes" under "Delete your account?" reads
                as "yes, cancel the deletion" to about half of people. */}
            <button
              type="button"
              onClick={handleDelete}
              disabled={!online || working}
              className="cc-btn cc-btn-danger cc-btn-lg"
            >
              {working ? t('working') : t('confirm')}
            </button>
            <button
              type="button"
              onClick={onClose}
              disabled={working}
              className="cc-btn cc-btn-ghost cc-btn-lg"
            >
              {t('cancel')}
            </button>
          </div>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
