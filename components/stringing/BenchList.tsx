'use client';

import { useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { StringingJob } from '@/lib/types';
import { benchGroups } from '@/lib/benchGroups';
import Collapse from '@/components/primitives/Collapse';

/**
 * The live bench as ONE card of rows, grouped by where the racket is
 * (docs/plans/stringing-jobs-list.md; Grant's canvas, Option A): Received,
 * Strung, Ready for pickup, Requested, each "<status> · n", and Picked up
 * folded at the foot behind a chevron. The order inside a group is the
 * bench's own (`benchOrder`: pinned first, then by due), kept as it came.
 */
export default function BenchList({
  jobs,
  renderRow,
}: {
  jobs: readonly StringingJob[];
  renderRow: (job: StringingJob) => ReactNode;
}) {
  const t = useTranslations('admin.stringing');
  const [pickedUpOpen, setPickedUpOpen] = useState(false);
  const { open, pickedUp } = benchGroups(jobs);

  return (
    <div className="glass-card bench-list" data-testid="bench-list">
      {open.map((g) => (
        <section key={g.status} className="bench-group" aria-label={t(`bench.group.${g.status}`)}>
          <h3 className="section-label bench-group-label">
            {t(`bench.group.${g.status}`)} · {g.jobs.length}
          </h3>
          {g.jobs.map((job) => renderRow(job))}
        </section>
      ))}
      {pickedUp.length > 0 && (
        <section className="bench-group">
          <button
            type="button"
            className="bench-fold"
            aria-expanded={pickedUpOpen}
            onClick={() => setPickedUpOpen((v) => !v)}
          >
            <span className="section-label" style={{ flex: 1 }}>
              {t('bench.group.picked_up')} · {pickedUp.length}
            </span>
            <span className="material-icons icon-md motion-chevron" aria-hidden="true">
              expand_more
            </span>
          </button>
          <Collapse open={pickedUpOpen}>{pickedUp.map((job) => renderRow(job))}</Collapse>
        </section>
      )}
    </div>
  );
}
