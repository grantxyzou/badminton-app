'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import { useOnline } from '@/lib/useOnline';
import { clearIdentity } from '@/lib/identity';
import { clearDeviceTraces } from '@/lib/clearDeviceTraces';

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
  // `close` lives in the recovery namespace; every sheet reuses it.
  const tClose = useTranslations('recovery');
  const online = useOnline();
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(false);
  /** The server refused because they still owe: the amount and the club, so the sheet can say where. */
  const [owed, setOwed] = useState<{ amount: string; club: string } | null>(null);

  async function handleDelete() {
    setWorking(true);
    setError(false);
    setOwed(null);
    try {
      const res = await fetch(`${BASE}/api/members/me`, {
        method: 'DELETE',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ confirm: true }),
        cache: 'no-store',
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string; cents?: number; clubs?: { name: string; cents: number }[] };
        if (data.error === 'balance_outstanding') {
          // Not a failure: a balance stands in the way (docs/plans/money-audit.md, gap 4).
          const club = data.clubs?.[0];
          setOwed({ amount: `$${((club?.cents ?? data.cents ?? 0) / 100).toFixed(2)}`, club: club?.name ?? '' });
          setWorking(false);
          return;
        }
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
      // And what the phone shows OUTSIDE the app — the icon badge, the
      // long-press menu, the widgets' pass — as signing out does (audit,
      // 2026-11-05). Bounded by its own timeout, so it never holds the sheet.
      await clearDeviceTraces();
      onDeleted();
      onClose();
    } catch {
      setError(true);
      setWorking(false);
    }
  }

  return (
    <BottomSheet open={open} onClose={onClose} ariaLabel={t('title')}>
      <BottomSheetHeader onClose={onClose} closeLabel={tClose('close')}>
        <h2 className="bpm-h3 m-0">{t('title')}</h2>
      </BottomSheetHeader>
      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div>
            <p className="fs-base m-0" style={{ color: 'var(--text-secondary)' }}>
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
        </div>
      </BottomSheetBody>
      {/* The answer, pinned to the bottom of the screen, with the error about
          it just above. */}
      <BottomSheetFooter>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {owed && (
            <p className="field-warn" role="alert">
              {t('balanceOutstanding', { amount: owed.amount, club: owed.club })}
            </p>
          )}
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
      </BottomSheetFooter>
    </BottomSheet>
  );
}
