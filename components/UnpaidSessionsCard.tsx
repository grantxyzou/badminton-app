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
   * used to hold, so it shows a positive "all paid up" state instead of a gap,
   * and pads tighter so it sits smaller than the sign-up card below it.
   */
  variant?: 'profile' | 'home';
}

/**
 * "What do I still owe" surface, shared by Profile and Home so the two can
 * never disagree. Reads like a short invoice: one line per unpaid session
 * (date + amount), a total, and where to send it. Settled sessions use their
 * frozen amount; unsettled past sessions use a computed share (see
 * /api/players/unpaid). Legible-fail: a load error shows an explicit pill,
 * never a silent "you owe nothing". On `home`, a brief pre-load gap is
 * preferred over flashing "paid up" before the first response.
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
  const titleColor = showPaidUp ? 'var(--accent)' : 'var(--sev-warn)';
  const lineItems = data?.sessions ?? [];

  return (
    <div
      className="glass-card"
      style={{ padding: isHome ? 16 : 20, display: 'flex', flexDirection: 'column', gap: 10 }}
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
            {/* Line items — one per unpaid session, no dividers between rows. */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {lineItems.map((s) => (
                <div
                  key={s.sessionId}
                  style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
                >
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                    {format.dateTime(new Date(s.date), DAY_SHORT)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                    {fmtMoney(s.owedAmount)}
                  </span>
                </div>
              ))}
            </div>

            {/* Total — single hairline rule above, invoice-style. */}
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
              <span style={{ fontSize: 'var(--fs-md, 14px)', fontWeight: 600, color: 'var(--text-primary)' }}>
                {(isHome ? tBal : t)('total')}
              </span>
              <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                {fmtMoney(data.totalOwed)}
              </span>
            </div>

            {etransferEmail && (
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {tPay('etransfer', { email: etransferEmail })}
              </p>
            )}
          </>
        )
      )}
    </div>
  );
}
