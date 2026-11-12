'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ListRow from '@/components/primitives/ListRow';
import { walkUpEmailInFlight, walkUpEmailOf, walkUpJobClosed } from '@/lib/stringing';
import { useOnline } from '@/lib/useOnline';
import type { StringingJob } from '@/lib/types';
import StringingReceiptSheet from './StringingReceiptSheet';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  job: StringingJob;
  /** The job as the server answered a "Send again", so the page shows it. */
  onJobChange: (job: StringingJob) => void;
}

/** "3:04 PM" today, "Nov 12, 3:04 PM" otherwise, in the club's own zone. */
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
 * "Send to {name}" — a walk-up's job page card (docs/plans/stringing-walk-ups.md,
 * canvas frame "Job page, walk-up", 2026-11-12).
 *
 * Two rows. "Emailed automatically" appears only when the contact is an email
 * address (`walkUpEmailOf`, the routes' own test): it says the spec went, with
 * the time, or "Not sent" with a "Send again" when the send failed or never
 * ran. "Share the receipt" is always there — for a phone number it is the only
 * way, and for an email it is a copy to hand over at the counter.
 */
export default function StringingWalkUpSendCard({ job, onJobChange }: Props) {
  const t = useTranslations('admin.stringing');
  const locale = useLocale();
  const online = useOnline();
  const [receiptOpen, setReceiptOpen] = useState(false);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState(false);

  const email = walkUpEmailOf(job);
  const spec = job.walkUpEmails?.spec;
  const ready = job.walkUpEmails?.ready;
  // Another tap (or the save itself) is sending it now: say so, offer nothing.
  const specInFlight = walkUpEmailInFlight(spec);
  // A job that is over gets no more email, so there is nothing to send again.
  const closed = walkUpJobClosed(job);

  async function sendAgain() {
    if (sending || !online) return;
    setSending(true);
    setSendError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: job.memberId, resendSpecEmail: true }),
      });
      const data = (await res.json().catch(() => null)) as { job?: StringingJob; error?: string } | null;
      // A 409 carries the job as it now stands: the email may have gone, or be
      // going, from another tap — show that, not a failure.
      if (data?.job) onJobChange(data.job);
      if (!res.ok && !(res.status === 409 && data?.job)) throw new Error(`resend ${res.status}`);
      const after = data?.job?.walkUpEmails?.spec;
      if (after?.ok !== true && !walkUpEmailInFlight(after)) setSendError(true);
    } catch {
      setSendError(true);
    } finally {
      setSending(false);
    }
  }

  const specTrailing = spec?.ok ? (
    <span
      className="fs-sm"
      data-testid="walkup-email-sent"
      style={{ display: 'inline-flex', alignItems: 'center', gap: 'var(--space-1)', color: 'var(--accent)', fontWeight: 600, whiteSpace: 'nowrap' }}
    >
      <span className="material-icons icon-sm" aria-hidden="true">check</span>
      {t('walkUp.sentAt', { time: sentTime(spec.at, locale) })}
    </span>
  ) : specInFlight && !sending ? (
    <span className="fs-sm" data-testid="walkup-email-sending" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
      {t('walkUp.sending')}
    </span>
  ) : (
    <span style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 'var(--space-1)' }}>
      <span className="fs-sm" data-testid="walkup-email-not-sent" style={{ color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>
        {t('walkUp.notSent')}
      </span>
      {!closed && <button
        type="button"
        className="cc-btn cc-btn-secondary"
        disabled={sending || !online}
        onClick={() => void sendAgain()}
      >
        {sending ? t('walkUp.sending') : t('walkUp.sendAgain')}
      </button>}
    </span>
  );

  return (
    <div className="glass-card p-5 space-y-3" data-testid="walkup-send-card">
      <CardHeader
        icon="ios_share"
        title={t('walkUp.sendTitle', { name: job.memberName })}
        subtitle={email ? t('walkUp.sendHint') : t('walkUp.sendHintNoEmail')}
      />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        {email && (
          <ListRow
            leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>send</span>}
            title={<span className="fs-md" style={{ fontWeight: 600 }}>{t('walkUp.emailed')}</span>}
            subtitle={
              <span style={{ overflowWrap: 'anywhere' }}>
                {t('walkUp.emailedSub', { email })}
                {ready && !walkUpEmailInFlight(ready) && (
                  <>
                    <br />
                    {ready.ok
                      ? t('walkUp.readySent', { time: sentTime(ready.at, locale) })
                      : t('walkUp.readyNotSent')}
                  </>
                )}
              </span>
            }
            trailing={specTrailing}
          />
        )}
        {sendError && <p role="alert" className="field-error" style={{ margin: '0' }}>{t('walkUp.sendAgainError')}</p>}
        <ListRow
          onClick={() => setReceiptOpen(true)}
          leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>receipt_long</span>}
          title={<span className="fs-md" style={{ fontWeight: 600 }}>{t('walkUp.shareReceipt')}</span>}
          subtitle={t('walkUp.shareReceiptSub')}
          trailing={<span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
        />
      </div>
      <StringingReceiptSheet open={receiptOpen} onClose={() => setReceiptOpen(false)} job={job} />
    </div>
  );
}
