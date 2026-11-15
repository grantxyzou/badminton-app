'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '@/components/BottomSheet';
import StringingReceiptSheet from '@/components/admin/CommandCenter/StringingReceiptSheet';
import { useOnline } from '@/lib/useOnline';
import { fmtMoney } from '@/lib/fmt';
import type { InvoiceView } from '@/lib/stringingInvoiceView';
import type { StringingJob } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** What the route answers about who heard. */
export interface InvoiceDelivered {
  push: number;
  email: boolean;
  reached: boolean;
}

export interface InvoiceSent {
  invoice: InvoiceView;
  delivered: InvoiceDelivered;
  /** The job as the route answered: the full job for an organiser, the stringer's view otherwise. */
  job: unknown;
}

interface Props {
  /** Enough of the job to address the send and draw the picture. */
  job: Pick<StringingJob, 'id' | 'memberId' | 'memberName' | 'jobNo' | 'racketLabel'> & { walkUp?: boolean };
  view: InvoiceView;
  /** The job to draw as the invoice picture (the stringer's view is rebuilt into one). */
  receiptJob: StringingJob;
  onSent: (sent: InvoiceSent) => void;
  /** Inside another card (a stringer's job): no card of its own. */
  bare?: boolean;
}

const REFUSALS = new Set(['job_paid', 'not_finished', 'not_priced', 'cancelled', 'sending']);

/** "3:04 PM" today, "Nov 12, 3:04 PM" otherwise, in the club's zone. */
function sentTime(iso: string, locale: string): string {
  try {
    const d = new Date(iso);
    const zone = 'America/Vancouver';
    const day = (x: Date) => x.toLocaleDateString('en-CA', { timeZone: zone });
    const sameDay = day(d) === day(new Date());
    return d.toLocaleString(locale, {
      timeZone: zone,
      ...(sameDay ? {} : { month: 'short', day: 'numeric' }),
      hour: 'numeric',
      minute: '2-digit',
    });
  } catch {
    return iso.slice(0, 16).replace('T', ' ');
  }
}

/**
 * A restring's INVOICE (docs/plans/stringing-invoice.md): where the stringer
 * or an organiser sends it, sees that it went, sends it again, and shares it
 * as a picture. On the bench's job page and on a stringer's own card.
 *
 * Sending opens a sheet first, the last look at the figure before it goes;
 * the button is in the sheet's footer (the sheet-footer rule). When nothing
 * reached the person (no notifications, no email), the picture opens at once,
 * because sharing it by hand is then the only way it gets to them.
 */
export default function StringingInvoiceCard({ job, view, receiptJob, onSent, bare = false }: Props) {
  const t = useTranslations('home.stringing.invoice');
  const locale = useLocale();
  const online = useOnline();
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [outcome, setOutcome] = useState<InvoiceDelivered | null>(null);
  const [pictureOpen, setPictureOpen] = useState(false);

  const amount = view.amount !== null ? fmtMoney(view.amount) : null;
  const sent = view.sentAt !== null;

  async function send() {
    if (sending || !online) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}/invoice`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId }),
      });
      const data = (await res.json().catch(() => null)) as (InvoiceSent & { error?: string }) | null;
      if (!res.ok || !data?.invoice) {
        const code = data?.error ?? '';
        setError(REFUSALS.has(code) ? code : 'failed');
        return;
      }
      setConfirming(false);
      setOutcome(data.delivered);
      onSent(data);
      if (!data.delivered.reached) setPictureOpen(true);
    } catch {
      setError('failed');
    } finally {
      setSending(false);
    }
  }

  const subtitle = view.paid
    ? t('paid')
    : sent
      ? view.sends > 1
        ? t('sentAgainAt', { time: sentTime(view.lastSentAt ?? view.sentAt!, locale), count: view.sends })
        : t('sentAt', { time: sentTime(view.sentAt!, locale) })
      : view.billOn === 'invoice'
        ? t('notSentOwesNothing', { name: job.memberName })
        : t('notSent');

  return (
    <div
      className={bare ? undefined : 'glass-card p-5'}
      style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', ...(bare ? { paddingTop: 'var(--space-3)' } : {}) }}
      data-testid="invoice-card"
      data-sent={sent ? 'true' : 'false'}
    >
      {bare ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-05)' }}>
          <span className="fs-md" style={{ fontWeight: 600, display: 'inline-flex', alignItems: 'center', gap: 'var(--space-2)' }}>
            <span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>receipt_long</span>
            {t('title', { no: view.no })}
          </span>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{subtitle}</span>
        </div>
      ) : (
        <CardHeader icon="receipt_long" title={t('title', { no: view.no })} subtitle={subtitle} />
      )}

      {amount && (
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
          <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('amountDue')}</span>
          <span className="fs-stat" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }} data-testid="invoice-amount">
            {amount}
          </span>
        </div>
      )}

      {view.priceChanged && view.sentAmount !== null && amount && (
        <p className="field-warn" style={{ margin: '0' }} data-testid="invoice-price-changed">
          {t('priceChanged', { from: fmtMoney(view.sentAmount), to: amount, name: job.memberName })}
        </p>
      )}

      {outcome && (
        <p className="fs-sm" role="status" style={{ margin: '0', color: outcome.reached ? 'var(--accent)' : 'var(--text-secondary)' }} data-testid="invoice-outcome">
          {outcome.reached
            ? outcome.email
              ? t('reachedEmail', { name: job.memberName })
              : t('reachedPush', { name: job.memberName })
            : t('notReached', { name: job.memberName })}
        </p>
      )}

      {(view.canSend || amount) && (
        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          {view.canSend && (
            <button
              type="button"
              className={sent ? 'cc-btn cc-btn-secondary' : 'cc-btn cc-btn-primary'}
              style={{ flex: 1 }}
              disabled={!online || sending}
              onClick={() => {
                setError(null);
                setConfirming(true);
              }}
              data-testid="invoice-send"
            >
              {sent ? t('sendAgain') : t('send')}
            </button>
          )}
          {amount && (
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => setPictureOpen(true)} data-testid="invoice-share">
              {t('sharePicture')}
            </button>
          )}
        </div>
      )}

      <BottomSheet open={confirming} onClose={() => setConfirming(false)} ariaLabel={t('confirmTitle', { name: job.memberName })}>
        <BottomSheetHeader onClose={() => setConfirming(false)} closeLabel={t('close')}>
          {t('confirmTitle', { name: job.memberName })}
        </BottomSheetHeader>
        <BottomSheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <div className="cc-mini-card" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {[
                [t('rowInvoice'), view.no],
                [t('rowRacket'), job.racketLabel],
                [t('rowFor'), job.memberName],
              ].map(([k, v]) => (
                <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                  <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{k}</span>
                  <span className="fs-md" style={{ fontWeight: 600, textAlign: 'right', minWidth: 0, overflowWrap: 'anywhere' }}>{v}</span>
                </div>
              ))}
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)', paddingTop: 'var(--space-2)' }}>
                <span className="fs-md" style={{ fontWeight: 600 }}>{t('amountDue')}</span>
                <span className="fs-stat" style={{ fontFamily: 'var(--font-mono)', fontWeight: 700 }}>{amount}</span>
              </div>
            </div>
            <p className="fs-md" style={{ margin: '0', color: 'var(--text-secondary)' }}>
              {job.walkUp ? t('howWalkUp', { name: job.memberName }) : t('howMember', { name: job.memberName })}
            </p>
            {view.billOn === 'invoice' && !sent && (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>{t('startsOwing', { name: job.memberName })}</p>
            )}
          </div>
        </BottomSheetBody>
        <BottomSheetFooter>
          {error && (
            <p role="alert" className={error === 'failed' ? 'field-error' : 'field-warn'} style={{ margin: '0' }}>
              {t(`error.${error}`)}
            </p>
          )}
          <button
            type="button"
            className="btn-primary"
            style={{ width: '100%' }}
            disabled={!online || sending}
            onClick={() => void send()}
            data-testid="invoice-confirm"
          >
            <span className="material-icons icon-md" aria-hidden="true">send</span>
            {sending ? t('sending') : sent ? t('sendAgainTo', { name: job.memberName }) : t('sendTo', { name: job.memberName })}
          </button>
        </BottomSheetFooter>
      </BottomSheet>

      <StringingReceiptSheet open={pictureOpen} onClose={() => setPictureOpen(false)} job={receiptJob} asInvoice />
    </div>
  );
}
