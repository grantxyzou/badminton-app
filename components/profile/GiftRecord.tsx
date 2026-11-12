'use client';

import { useTranslations } from 'next-intl';
import { fmtCents } from './GiftCardsPage';
import type { MyGiftCard } from './GiveGiftPage';

export interface GiftPerson { memberId: string; name: string | null }
export interface GiftUse { at: string; amountCents: number; note: string; kind: string; reversed: boolean }

/**
 * A code's record, opened under its row: made, redeemed, used and left, then
 * each draw on it. "Left" is the share of the redeemer's credit this code still
 * accounts for (oldest source first, `lib/creditAttribution.ts`), not a second
 * balance.
 */
export default function GiftRecord({
  card: c,
  day,
  who,
}: {
  card: MyGiftCard;
  day: (iso: string) => string;
  who: (p: GiftPerson | null | undefined) => string;
}) {
  const t = useTranslations('profile.giveGift.record');
  const known = c.redeemedBy !== undefined;
  return (
    <div className="gift-record">
      <dl className="gift-record__facts">
        <dt>{t('made')}</dt>
        <dd>{known ? t('on', { date: day(c.createdAt), name: who(c.createdBy) }) : day(c.createdAt)}</dd>
        <dt>{t('redeemed')}</dt>
        <dd>
          {!c.redeemedAt
            ? t('notYet')
            : known
              ? t('on', { date: day(c.redeemedAt), name: who(c.redeemedBy) })
              : day(c.redeemedAt)}
        </dd>
        {c.redeemedAt && typeof c.usedCents === 'number' && typeof c.remainingCents === 'number' && (
          <>
            <dt>{t('used')}</dt>
            <dd>{t('usedOf', { used: fmtCents(c.usedCents), amount: fmtCents(c.amountCents), left: fmtCents(c.remainingCents) })}</dd>
          </>
        )}
        {c.redeemedAt && known && c.usedCents === null && (
          <>
            <dt>{t('used')}</dt>
            <dd>{t('noRecord')}</dd>
          </>
        )}
      </dl>
      {c.uses && c.uses.length > 0 && (
        <ul className="gift-record__uses" aria-label={t('usesLabel')}>
          {c.uses.map((u, i) => (
            <li key={`${u.at}-${i}`} className={u.reversed ? 'gift-record__use--reversed' : undefined}>
              <span>{[day(u.at), u.note || (u.kind === 'credit_grant' ? t('takenBack') : t('spent')), u.reversed ? t('refunded') : null].filter(Boolean).join(' · ')}</span>
              <span className="gift-record__amount">−{fmtCents(u.amountCents)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
