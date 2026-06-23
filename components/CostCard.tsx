import { memo } from 'react';
import { useTranslations } from 'next-intl';

export interface CostCardProps {
  showCostBreakdown: boolean | undefined;
  perPersonCost: number | null;
  datetime: string | undefined;
  /** Whether the active session has been settled (cost frozen). When false the
   *  per-person figure is a live estimate that drops as more people sign up —
   *  so we say so explicitly. */
  finalized?: boolean;
}

// Memoized: props only change on session edits; avoids re-render on parent
// state tick (e.g. name input keystrokes in HomeTab).
function CostCard({ showCostBreakdown, perPersonCost, datetime, finalized }: CostCardProps) {
  const t = useTranslations('home.cost');
  if (!showCostBreakdown) return null;
  if (perPersonCost === null || perPersonCost <= 0) return null;
  if (!datetime) return null;

  return (
    <div className="glass-card p-5 flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <p className="text-sm font-semibold text-gray-200">
          {t('label')}
        </p>
        <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
          {finalized ? '' : '~'}${perPersonCost.toFixed(2)}
        </p>
      </div>
      {!finalized && (
        <p style={{ fontSize: 'var(--fs-xs, 11px)', color: 'var(--text-muted)', margin: 0 }}>
          {t('notFinalized')}
        </p>
      )}
    </div>
  );
}

export default memo(CostCard);
