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
  if (!showCostBreakdown) return null;
  if (!hasIdentity) return null;
  if ((prevCostPerPerson ?? 0) <= 0) return null;

  return (
    <div className="mt-3 text-center">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        Last session ({prevSessionDate ? fmtDate(prevSessionDate) : '—'}) · ${prevCostPerPerson!.toFixed(2)}/person
      </p>
      {etransferEmail && (
        <p className="text-xs mt-0.5" style={{ color: 'var(--text-muted)' }}>
          E-transfer to {etransferEmail}
        </p>
      )}
    </div>
  );
}
