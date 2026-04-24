import { memo } from 'react';
import { useTranslations, useFormatter } from 'next-intl';

const DAY_LONG = { weekday: 'long', month: 'long', day: 'numeric' } as const;

export interface PrevPaymentReminderProps {
  showCostBreakdown: boolean | undefined;
  prevCostPerPerson: number | undefined;
  prevSessionDate: string | undefined;
  hasIdentity: boolean;
  etransferEmail: string | null;
}

// Memoized — props are derived from the session snapshot and change rarely.
function PrevPaymentReminder({
  showCostBreakdown,
  prevCostPerPerson,
  prevSessionDate,
  hasIdentity,
  etransferEmail,
}: PrevPaymentReminderProps) {
  const t = useTranslations('home.payment');
  const format = useFormatter();

  if (!showCostBreakdown) return null;
  if (!hasIdentity) return null;
  if ((prevCostPerPerson ?? 0) <= 0) return null;

  return (
    <div className="mt-3 text-center">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {t('reminder', {
          date: prevSessionDate ? format.dateTime(new Date(prevSessionDate), DAY_LONG) : '—',
          amount: `$${prevCostPerPerson!.toFixed(2)}`,
        })}
      </p>
      {etransferEmail && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          {t('etransfer', { email: etransferEmail })}
        </p>
      )}
    </div>
  );
}

export default memo(PrevPaymentReminder);
