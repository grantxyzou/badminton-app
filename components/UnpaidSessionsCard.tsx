'use client';
import { useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import ErrorState from './primitives/ErrorState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DAY_SHORT = { weekday: 'short', month: 'short', day: 'numeric' } as const;

interface UnpaidSession {
  sessionId: string;
  date: string;
  owedAmount: number;
}

interface UnpaidData {
  totalOwed: number;
  sessionCount: number;
  mostRecent: UnpaidSession | null;
  sessions: UnpaidSession[];
}

function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

interface Props {
  name: string;
  /**
   * `profile` (default): renders nothing when the player owes nothing — keeps
   * the Profile tab uncluttered. `home`: occupies the slot the cost estimate
   * used to hold, so it shows a positive "all paid up" state instead of a gap.
   */
  variant?: 'profile' | 'home';
}

/**
 * "What do I still owe" surface, shared by Profile and Home so the two can
 * never disagree. Fetches the player's unpaid sessions (settled frozen amounts
 * + computed shares for unsettled past sessions) and shows the total
 * outstanding + most recent unpaid session + a "verify with your e-transfer
 * statement" note. Legible-fail: a load error renders an explicit pill, never a
 * silent "you owe nothing". On `home`, a brief pre-load gap is preferred over
 * flashing "paid up" before the first response (unknown ≠ known-false).
 */
export default function UnpaidSessionsCard({ name, variant = 'profile' }: Props) {
  const t = useTranslations('profile.unpaid');
  const tBal = useTranslations('home.balance');
  const tPay = useTranslations('home.payment');
  const format = useFormatter();
  const [data, setData] = useState<UnpaidData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const isHome = variant === 'home';

  const etransferEmail = process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || null;

  useEffect(() => {
    // name is always the signed-in identity (non-empty) when this renders.
    if (!name) return;
    let cancelled = false;
    fetch(`${BASE}/api/players/unpaid?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (!r.ok) throw new Error(`unpaid fetch ${r.status}`);
        return r.json() as Promise<UnpaidData>;
      })
      .then((d) => {
        if (cancelled) return;
        setData(d);
        setLoaded(true);
        setLoadError(false);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('unpaid fetch failed:', err);
        setData(null);
        setLoaded(true);
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const owesNothing = !loadError && (!data || data.totalOwed <= 0);

  // Profile: render nothing while loading or when nothing is owed (no clutter).
  if (!isHome && owesNothing) return null;
  // Home: avoid a "paid up" flash before the first response lands.
  if (isHome && !loaded && !loadError) return null;

  const showPaidUp = isHome && owesNothing;
  const title = isHome ? tBal('title') : t('title');
  const titleColor = showPaidUp ? 'var(--accent)' : 'var(--sev-warn, #f59e0b)';

  return (
    <div
      className="glass-card"
      style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}
    >
      <p className="section-label" style={{ margin: 0, color: titleColor }}>
        {title}
      </p>

      {loadError ? (
        <ErrorState message={t('loadError')} />
      ) : showPaidUp ? (
        <p style={{ margin: 0, fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)' }}>
          {tBal('paidUp')}
        </p>
      ) : (
        data && (
          <>
            <p style={{ margin: 0, fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)' }}>
              {(isHome ? tBal : t).rich('outstanding', {
                amount: () => (
                  <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>
                    {fmtMoney(data.totalOwed)}
                  </span>
                ),
              })}
            </p>
            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('sessionsCount', { count: data.sessionCount })}
            </p>

            {data.mostRecent && (
              <div
                style={{
                  borderTop: '1px solid var(--inner-card-border)',
                  paddingTop: 10,
                  display: 'flex',
                  alignItems: 'baseline',
                  justifyContent: 'space-between',
                  gap: 8,
                }}
              >
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  {t('mostRecent', {
                    date: format.dateTime(new Date(data.mostRecent.date), DAY_SHORT),
                  })}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                  {fmtMoney(data.mostRecent.owedAmount)}
                </span>
              </div>
            )}

            <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
              {t('verify')}
            </p>
            {etransferEmail && (
              <p style={{ margin: 0, fontSize: 12, color: 'var(--text-muted)' }}>
                {tPay('etransfer', { email: etransferEmail })}
              </p>
            )}
          </>
        )
      )}
    </div>
  );
}
