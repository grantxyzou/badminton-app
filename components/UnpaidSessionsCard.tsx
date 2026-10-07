'use client';
import { useEffect, useState } from 'react';
import { BALANCE_EVENT } from '@/lib/balanceRefresh';
import { useTranslations, useFormatter } from 'next-intl';
import ErrorState from './primitives/ErrorState';
import EmptyState from './primitives/EmptyState';
import CardHeader from './primitives/CardHeader';
import { isFlagOn } from '@/lib/flags';
import { useOnline } from '@/lib/useOnline';
import Collapse from './primitives/Collapse';
import { useRevealReady } from './primitives/Reveal';

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
  /** Where to send it — the club's recipient, only on a response that owes. */
  payTo?: { name: string; email: string } | null;
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
  /**
   * Where "Sign in" goes when this device has no session for the name. Home
   * passes a jump to Profile; Profile, which IS where you sign in, passes
   * nothing and keeps the sentence alone.
   */
  onSignIn?: () => void;
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
export default function UnpaidSessionsCard({ name, variant = 'profile', onSignIn }: Props) {
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
  const [refreshNonce, setRefreshNonce] = useState(0);
  const isHome = variant === 'home';

  const online = useOnline();
  // "I've sent it" (docs/plans/payments.md): a claim, not a payment — the
  // e-transfer itself is what the inbox marks paid. Remembered per mount only;
  // the admin sees the tag on their side.
  const [sent, setSent] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const canSayPaid = isFlagOn('NEXT_PUBLIC_FLAG_PAYMENTS_AUTO');

  // Store credit (docs/plans/payments.md): the balance, and "Pay with
  // credit", which pays the oldest lines it covers IN FULL. Shown only when
  // there is credit — a "$0 credit" line would be clutter on every Home.
  const tCredit = useTranslations('home.credit');
  const creditOn = isFlagOn('NEXT_PUBLIC_FLAG_STORE_CREDIT');
  const [creditCents, setCreditCents] = useState<number | null>(null);
  const [spend, setSpend] = useState<'idle' | 'busy' | 'notEnough' | 'error'>('idle');
  useEffect(() => {
    if (!creditOn || !name) return;
    let cancelled = false;
    fetch(`${BASE}/api/credit`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { balanceCents?: number } | null) => {
        // A failed read shows no credit line — the balance card's job is what
        // is OWED, and that has its own error state above.
        if (!cancelled) setCreditCents(typeof d?.balanceCents === 'number' ? d.balanceCents : null);
      })
      .catch(() => {
        if (!cancelled) setCreditCents(null);
      });
    return () => {
      cancelled = true;
    };
  }, [creditOn, name, refreshNonce]);
  async function payWithCredit() {
    setSpend('busy');
    try {
      const res = await fetch(`${BASE}/api/credit/spend`, { method: 'POST' });
      if (res.status === 409) {
        setSpend('notEnough');
        return;
      }
      if (!res.ok) throw new Error(String(res.status));
      setSpend('idle');
      setRefreshNonce((n) => n + 1);
    } catch {
      setSpend('error');
    }
  }
  const hasCredit = creditOn && (creditCents ?? 0) > 0;
  async function sayPaid() {
    setSent('busy');
    try {
      const res = await fetch(`${BASE}/api/payments/self-report`, { method: 'POST' });
      setSent(res.ok ? 'done' : 'error');
    } catch {
      setSent('error');
    }
  }

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
  }, [name, refreshNonce]);

  /* Re-read when something else in the app has changed what is owed — today
     that is a player accepting a stringing price. Without it, accepting $34
     leaves this card showing $30 until a manual refresh, and the two halves of
     the same screen disagree about the same racket. */
  useEffect(() => {
    const onChanged = () => setRefreshNonce((n) => n + 1);
    window.addEventListener(BALANCE_EVENT, onChanged);
    return () => window.removeEventListener(BALANCE_EVENT, onChanged);
  }, []);

  const owesNothing = !loadError && !forbidden && (!data || data.totalOwed <= 0);

  // On Home a RevealSlot holds this card's place with a skeleton and reveals
  // it in order (loading cascade). Profile has no slot; this is a no-op there.
  useRevealReady(loaded || loadError || forbidden);

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
                className="fs-md motion-fade"
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontWeight: 600,
                  color: showPaidUp ? 'var(--text-secondary)' : titleColor,
                }}
              >
                {fmtMoney(data?.totalOwed ?? 0)}
              </span>
            )}
            {/* One glyph that turns, not two that swap. */}
            <span
              className="material-icons icon-sm motion-chevron"
              data-open={open ? 'true' : 'false'}
              aria-hidden="true"
              style={{ color: 'var(--text-muted)' }}
            >
              expand_more
            </span>
          </span>
        ) : undefined
      }
    />
  );

  // Closed means absent (Collapse unmounts it), so nothing inside is
  // mounted while the card is shut.
  const body = (
    <>

    {/* Signed out is not a failure, so it is not red: nothing went wrong, this
        device just is not allowed to ask. Muted copy and a ghost button to
        where you sign in. A real load failure keeps the red — and gets a
        button, because "refresh to retry" was an instruction with no
        control attached. */}
    {forbidden ? (
      <EmptyState
        action={onSignIn ? (
          <button type="button" className="cc-btn cc-btn-ghost" onClick={onSignIn}>
            {tBal('signIn')}
          </button>
        ) : undefined}
      >
        {onSignIn ? tBal('signedOut') : t('signInAgain')}
      </EmptyState>
    ) : loadError ? (
      <ErrorState
        message={t('loadError')}
        action={
          <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setRefreshNonce((n) => n + 1)}>
            {tBal('retry')}
          </button>
        }
      />
    ) : showPaidUp ? (
      <>
        <EmptyState icon="check_circle">{tBal('paidUp')}</EmptyState>
        {hasCredit && (
          <p className="fs-sm" style={{ margin: '0', color: 'var(--text-secondary)', textAlign: 'center' }}>
            {tCredit('balance', { amount: fmtMoney((creditCents ?? 0) / 100) })}
          </p>
        )}
      </>
    ) : (
      data && (
        <>
          {/* Sessions — one line per unpaid week, no dividers between rows. */}
          {lineItems.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {grouped && (
                <p className="fs-2xs" style={{ margin: '0', color: 'var(--text-muted)' }}>
                  {tBal('groupSessions')}
                </p>
              )}
              {lineItems.map((s) => (
                <div
                  key={s.sessionId}
                  style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}
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
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {grouped && (
                <p className="fs-2xs" style={{ margin: '0', color: 'var(--text-muted)' }}>
                  {tBal('groupStringing')}
                </p>
              )}
              {stringingItems.map((j) => (
                <div
                  key={j.jobId}
                  style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}
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
              paddingTop: 'var(--space-4)',
              display: 'flex',
              alignItems: 'baseline',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
            }}
          >
            <span style={{ fontSize: 'var(--fs-md, 14px)', fontWeight: 600, color: 'var(--text-primary)' }}>
              {(isHome ? tBal : t)('total')}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontWeight: 700, fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)', whiteSpace: 'nowrap' }}>
              {fmtMoney(data.totalOwed)}
            </span>
          </div>

          {(() => {
            // The server's answer first; the build-time env only for a
            // response from before `payTo` existed.
            const email = data.payTo?.email ?? (data.payTo === undefined ? process.env.NEXT_PUBLIC_ETRANSFER_EMAIL || null : null);
            return email ? (
              <p style={{ margin: '0', fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
                {tPay('etransfer', { email })}
              </p>
            ) : null;
          })()}
          {hasCredit && data.totalOwed > 0 && (
            <div className="flex flex-col gap-2">
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>{tCredit('label')}</span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-md, 14px)', color: 'var(--text-primary)' }}>
                  {fmtMoney((creditCents ?? 0) / 100)}
                </span>
              </div>
              <button type="button" className="btn-ghost" disabled={!online || spend === 'busy'} onClick={() => void payWithCredit()}>
                {tCredit('pay')}
              </button>
              {spend === 'notEnough' && (
                <p className="fs-sm" role="status" style={{ margin: '0', color: 'var(--text-muted)' }}>{tCredit('notEnough')}</p>
              )}
              {spend === 'error' && <p className="field-error" role="alert">{tCredit('error')}</p>}
            </div>
          )}
          {canSayPaid && data.totalOwed > 0 && (
            sent === 'done' ? (
              <p className="fs-sm motion-fade" role="status" style={{ margin: '0', color: 'var(--text-secondary)' }}>
                {tPay('sentItDone')}
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  className="btn-ghost"
                  disabled={!online || sent === 'busy'}
                  onClick={() => void sayPaid()}
                >
                  {tPay('sentIt')}
                </button>
                {sent === 'error' && <p className="field-error" role="alert">{tPay('sentItError')}</p>}
              </div>
            )
          )}
        </>
      )
    )}
    </>
  );

  return (
    <div
      // Profile renders nothing until the balance lands, so the card fades in
      // there. On Home the RevealSlot around it does the fade, in order.
      className={`glass-card ${isHome ? "p-4" : "motion-fade p-5"}`}
      // Collapsible: the gap lives INSIDE the collapse (as its top padding),
      // so a closing body does not leave a gap behind that snaps on unmount.
      style={{ display: 'flex', flexDirection: 'column', gap: collapsible ? undefined : 'var(--space-4)' }}
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
            padding: '0',
            margin: '0',
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

      {collapsible ? (
        <Collapse open={open} spaceAbove="var(--space-4)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            {body}
          </div>
        </Collapse>
      ) : (
        body
      )}
    </div>
  );
}
