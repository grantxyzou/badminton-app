import { useTranslations } from 'next-intl';

export interface CostCardProps {
  showCostBreakdown: boolean | undefined;
  perPersonCost: number | null;
  datetime: string | undefined;
}

export default function CostCard({ showCostBreakdown, perPersonCost, datetime }: CostCardProps) {
  const t = useTranslations('home.cost');
  if (!showCostBreakdown) return null;
  if (perPersonCost === null || perPersonCost <= 0) return null;
  if (!datetime) return null;

  return (
    <div className="glass-card p-5 flex items-center justify-between">
      <p className="text-xs" style={{ color: 'var(--text-muted)' }}>
        {t('label')}
      </p>
      <p className="text-sm font-bold" style={{ color: 'var(--accent)' }}>
        ${perPersonCost.toFixed(2)}
      </p>
    </div>
  );
}
