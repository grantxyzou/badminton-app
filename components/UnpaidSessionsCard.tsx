'use client';
import { useEffect, useState } from 'react';
import { useTranslations, useFormatter } from 'next-intl';
import ErrorState from './primitives/ErrorState';
import EmptyState from './primitives/EmptyState';
import CardHeader from './primitives/CardHeader';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';
const DAY_SHORT = { weekday: 'short', month: 'short', day: 'numeric' } as const;

interface UnpaidSession {
  sessionId: string;
  date: string;
  owedAmount: number;
}

interface StringingCharge {
  jobId: string;
  jobNo: string;
  racketLabel: string;
  amount: number;
  at: string;
}

interface UnpaidData {
  /** EVERYTHING owed — sessions plus stringing. */
  totalOwed: number;
  sessionCount: number;
  mostRecent: UnpaidSession | null;
  sessions: UnpaidSession[];
  /** Absent on a response from before stringing billing existed. */
  stringing?: StringingCharge[];
  sessionsOwed?: number;
  stringingOwed?: number;
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
  // Must sit with the other hooks: it was below an early return, which is a
  // rules-of-hooks violation and broke the component outright.
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
  const [loadError, setLoadError] = useState(false);
  // A refusal is not an unknown failure: /api/players/unpaid is owner-or-admin
  // gated, so a device whose 30-day member_session expired while
  // badminton_identity persists gets a 403. "Couldn't load — refresh to retry"
  // would be a false instruction; refreshing never fixes it.
  const [forbidden, setForbidden] = useState(false);
  const isHome = variant === 'home';

  const etransferEmail = process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || null;

  useEffect(() => {
    // name is always the signed-in identity (non-empty) when this renders.
    if (!name) return;
    let cancelled = false;
    fetch(`${BASE}/api/players/unpaid?name=${encodeURIComponent(name)}`, { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 403) return { forbidden: true as const };
        if (!r.ok) throw new Error(`unpaid fetch ${r.status}`);
        return { forbidden: false as const, data: (await r.json()) as UnpaidData };
      })
      .then((res) => {
        if (cancelled) return;
        if (res.forbidden) {
          setData(null);
          setForbidden(true);
          setLoadError(false);
        } else {
          setData(res.data);
          setForbidden(false);
          setLoadError(false);
        }
        setLoaded(true);
      })
      .catch((err) => {
        if (cancelled) return;
        console.warn('unpaid fetch failed:', err);
        setData(null);
        setForbidden(false);
        setLoaded(true);
        setLoadError(true);
      });
    return () => {
      cancelled = true;
    };
  }, [name]);

  const owesNothing = !loadError && !forbidden && (!data || data.totalOwed <= 0);

  // Profile: render nothing while loading or when nothing is owed (no clutter).
  if (!isHome && owesNothing) return null;
  // Home: avoid a "paid up" flash before the first response lands.
  if (isHome && !loaded && !loadError && !forbidden) return null;

  const showPaidUp = isHome && owesNothing;
  /* Collapsed by default when there is nothing owed. A card whose entire content
     is "you're all paid up" does not need a card's worth of Home every week; a
     card that says you owe money does. Errors stay OPEN whatever the balance —
     a collapsed error is a hidden error, the same failure as a lying empty state.

     `openOverride` is null until the user touches it, so the default keeps
     tracking the data: pay the balance off and the card closes itself. */
  const collapsible = isHome && !forbidden && !loadError;
  const open = openOverride ?? !owesNothing;
  const title = isHome ? tBal('title') : t('title');
  const titleColor = showPaidUp ? 'var(--accent)' : 'var(--sev-warn)';
  const lineItems = data?.sessions ?? [];
  const stringingItems = data?.stringing ?? [];
  /* Group headings appear only when there is something to tell apart. A player
     who has only ever owed for sessions keeps the plain list they already know;
     adding "Badminton" above a single group would be chrome that explains
     nothing. */
  const grouped = lineItems.length > 0 && stringingItems.length > 0;

  /* Routed through <CardHeader compact> rather than hand-rolled, so this and
     the stringing card beside it cannot drift again — they had already reached
     three different icon sizes, weights and colours between them while both
     claiming to "introduce themselves the same way".

     Sentence case and neutral, not an uppercase accent label: on Home the
     accent is reserved for the primary button, the one link and the active
     tab, and a label that never changes was spending it. */
  const header = (
    <CardHeader
      compact
      icon="receipt_long"
      title={title}
      /* `undefined`, not an empty span, when there is nothing to trail with:
         CardHeader treats any node as trailing content and switches to a
         space-between row for it, so an empty one would silently change the
         layout of the non-collapsible (Profile) variant. */
      badge={
        collapsible ? (
          <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
            {/* The figure only while COLLAPSED. Expanded, the Total row two
                lines below says the same number — and a card that states its
                total twice reads like it is not sure. Collapsed it is the only
                reason to open the card, so it stays. */}
            {!open && (
              <span
                className="fs-md"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: showPaidUp ? 'var(--text-secondary)' : titleColor,
                }}
              >
                {fmtMoney(data?.totalOwed ?? 0)}
              </span>
            )}
            <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              {open ? 'expand_less' : 'expand_more'}
            </span>
          </span>
        ) : undefined
      }
    />
  );

  return (
    <div
      className={`glass-card ${isHome ? "p-4" : "p-5"}`}
      style={{ display: 'flex', flexDirection: 'column', gap: 10 }}
    >
      {collapsible ? (
        <button
          type="button"
          onClick={() => setOpenOverride(!open)}
          aria-expanded={open}
          /* `block`, matching StringingCard: CardHeader owns the
             space-between row now, so a flex button around it would be a
             second layout fighting the first. */
          style={{
            display: 'block',
            width: '100%',
            padding: 0,
            margin: 0,
            background: 'none',
            border: 'none',
            font: 'inherit',
            textAlign: 'left',
            cursor: 'pointer',
          }}
        >
          {header}
        </button>
      ) : (
        header
      )}

      {(!collapsible || open) && (
      <>

      {forbidden ? (
        <ErrorState message={t('signInAgain')} />
      ) : loadError ? (
        <ErrorState message={t('loadError')} />
      ) : showPaidUp ? (
        <EmptyState icon="check_circle">{tBal('paidUp')}</EmptyState>
      ) : (
        data && (
          <>
            {/* Sessions — one line per unpaid week, no dividers between rows. */}
            {lineItems.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {grouped && (
                  <p className="fs-2xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
                    {tBal('groupSessions')}
                  </p>
                )}
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
            )}

            {/* Stringing — a racket that is finished and priced. Never a job
                still on the bench, and never a band: you cannot pay a range,
                so a line here is always an exact figure. See
                lib/stringingBilling.ts. */}
            {stringingItems.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {grouped && (
                  <p className="fs-2xs" style={{ margin: 0, color: 'var(--text-muted)' }}>
                    {tBal('groupStringing')}
                  </p>
                )}
                {stringingItems.map((j) => (
                  <div
                    key={j.jobId}
                    style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}
                  >
                    <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', minWidth: 0 }}>
                      {j.racketLabel}
                    </span>
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
                      {fmtMoney(j.amount)}
                    </span>
                  </div>
                ))}
              </div>
            )}

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
      </>
      )}
    </div>
  );
}
