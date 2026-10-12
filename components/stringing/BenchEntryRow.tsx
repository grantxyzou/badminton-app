'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import ListRow from '@/components/primitives/ListRow';
import { benchSignals, type BenchRow } from '@/lib/useAdminNeedsYou';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The admin's way onto the bench from the Stringing tab
 * (docs/plans/bench-redesign.md). Before it, the bench was Profile → Admin
 * tools → Stringing bench, with Profile lit in the nav, while Stringing sat in
 * the nav as a tab of its own.
 *
 * Rendered ONLY for an admin; the parent decides, so a player never makes the
 * jobs read (it would 401 on every mount). The count is `benchSignals`, the
 * same arithmetic as the Command Center's row, so the two cannot disagree.
 * The subtitle line is always there, so the row does not grow when the count
 * lands; a failed read says what the bench holds rather than "0 waiting".
 */
export default function BenchEntryRow({ onOpen }: { onOpen: () => void }) {
  const t = useTranslations('home.stringing.bench');
  const [count, setCount] = useState<{ waiting: number; late: number } | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/jobs`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d: { jobs?: BenchRow[] }) => {
        if (cancelled) return;
        if (Array.isArray(d?.jobs)) setCount(benchSignals(d.jobs));
        else setFailed(true);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const busy = count !== null && count.waiting + count.late > 0;
  const subtitle = failed
    ? t('subtitle')
    : count === null
      ? ' '
      : busy
        ? [count.waiting > 0 ? t('waiting', { count: count.waiting }) : null, count.late > 0 ? t('late', { count: count.late }) : null]
            .filter(Boolean)
            .join(' · ')
        : t('clear');

  return (
    <ListRow
      onClick={onOpen}
      leading={<span className="material-icons icon-md" aria-hidden="true" style={{ color: 'var(--accent)' }}>sports_tennis</span>}
      title={<span className="fs-md" style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{t('title')}</span>}
      subtitle={
        <span style={{ color: count && count.late > 0 ? 'var(--sev-warn)' : undefined }}>{subtitle}</span>
      }
      trailing={<span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>chevron_right</span>}
    />
  );
}
