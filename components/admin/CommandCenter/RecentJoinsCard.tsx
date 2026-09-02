'use client';

import { useEffect, useState } from 'react';
import CardHeader from '@/components/primitives/CardHeader';
import { EmptyState } from '@/components/primitives/EmptyState';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Row { id: string; name: string; createdAt?: string }

/** Members who joined in the last 30 days, newest first. */
export default function RecentJoinsCard() {
  const [rows, setRows] = useState<Row[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/members`, { cache: 'no-store' })
      .then((r) => r.json())
      .then((d: Row[]) => {
        if (cancelled) return;
        const cutoff = Date.now() - 30 * 86_400_000;
        setRows(d.filter((m) => m.createdAt && Date.parse(m.createdAt) > cutoff));
      })
      .catch(() => {
        if (!cancelled) setRows([]);
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  return (
    <section className="glass-card p-5 space-y-3" aria-label="Recent joins">
      <CardHeader icon="person_add" title="New this month" />
      {loaded && rows.length === 0 && <EmptyState>No one new this month.</EmptyState>}
      <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
        {rows.map((m) => (
          <li key={m.id} style={{ padding: 'var(--space-2) 0', fontSize: 'var(--fs-base)' }}>{m.name}</li>
        ))}
      </ul>
    </section>
  );
}
