import { useTranslations } from 'next-intl';
import { fmtDate } from '@/lib/formatters';

export interface PrevPaymentReminderProps {
  showCostBreakdown: boolean | undefined;
  prevCostPerPerson: number | undefined;
  prevSessionDate: string | undefined;
  hasIdentity: boolean;
  etransferEmail: string | null;
}

export default function PrevPaymentReminder({
  showCostBreakdown,
  prevCostPerPerson,
  prevSessionDate,
  hasIdentity,
  etransferEmail,
}: PrevPaymentReminderProps) {
  const t = useTranslations('home.payment');

  if (!showCostBreakdown) return null;
  if (!hasIdentity) return null;
  if ((prevCostPerPerson ?? 0) <= 0) return null;

  return (
    <div className="mt-3 text-center">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {t('reminder', {
          date: prevSessionDate ? fmtDate(prevSessionDate) : '—',
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
