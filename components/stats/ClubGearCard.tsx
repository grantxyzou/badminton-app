'use client';

import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import EmptyState from '@/components/primitives/EmptyState';
import LockedCard, { PreviewRow, useSignInLink } from './LockedCard';
import { useClubGear, type UseClubGear } from './useClubGear';
import { isMine } from '@/lib/gearSetup';
import type { PlayerGear } from '@/lib/types';

export interface ClubGearCardProps {
  /**
   * The register's tally read, when something else on screen reads it too
   * (the Set-up card's club fact). Absent, the card reads it itself — the
   * flag-off register, where it is the only reader.
   */
  club?: UseClubGear;
  /** The member's gear doc, to mark their own rows " · yours". Omitted, no
   *  row is marked — an unknown bag must never claim a row is not yours. */
  mine?: PlayerGear | null;
}

/**
 * "What the club plays" — the aggregated kit tally.
 *
 * This card reads `/api/stats/club/gear`, which is NOT the member's gear
 * document, so its own fetch is correct and stays. The single-owner rule that
 * `GearRegister` enforces is about `GET /api/equipment/gear` specifically.
 */
export default function ClubGearCard({ club, mine }: ClubGearCardProps = {}) {
  const t = useTranslations('stats.gear');
  const signInLink = useSignInLink();
  // Disabled when a shared read was handed in, so there is still exactly one
  // request per register.
  const own = useClubGear(!club);
  const { entries, status, retry } = club ?? own;

  if (status === 'loading') return <CardSkeleton height={180} />;
  // Refused (this device holds no session for the name): the card stays, as
  // its own shape with nothing in it, and Sign in carries the weight.
  if (status === 'forbidden') {
    return (
      <LockedCard icon="groups" title={t('clubTitle')} subtitle={t('clubSubtitle')} message={t.rich('clubLocked', { link: signInLink })}>
        <PreviewRow width="52%" />
        <PreviewRow width="40%" />
        <PreviewRow width="30%" />
      </LockedCard>
    );
  }

  const top = entries.slice(0, 3);
  const max = top[0]?.count ?? 0;

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="groups" title={t('clubTitle')} subtitle={t('clubSubtitle')} />
      {status === 'error' ? (
        <ErrorState
          message={t('clubError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={retry}>
              {t('retry')}
            </button>
          }
        />
      ) : top.length === 0 ? (
        <EmptyState>{t('clubEmpty')}</EmptyState>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {top.map((e) => (
            <div key={`${e.category}:${e.label}`}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  marginBottom: 'var(--space-2)',
                  gap: 'var(--space-2)',
                }}
              >
                <span style={{ fontSize: 'var(--fs-base)', color: 'var(--text-primary)', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {e.label}
                  {mine !== undefined && isMine(mine, e) && (
                    <span style={{ fontSize: 'var(--fs-xs)', color: 'var(--accent)', fontWeight: 600 }}>
                      {' · '}{t('setup.yours')}
                    </span>
                  )}
                </span>
                <span
                  style={{
                    fontFamily: 'var(--font-mono)',
                    fontSize: 'var(--fs-sm)',
                    fontWeight: 700,
                    color: 'var(--text-secondary)',
                  }}
                >
                  {e.count}
                </span>
              </div>
              <div style={{ height: 6, borderRadius: 'var(--radius-pill)', background: 'var(--inner-card-bg)' }}>
                <span
                  style={{
                    display: 'block',
                    height: 6,
                    borderRadius: 'var(--radius-pill)',
                    width: max > 0 ? `${(e.count / max) * 100}%` : '0%',
                    background: 'var(--accent)',
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
