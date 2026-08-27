'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import AdminBackHeader from '../AdminBackHeader';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { formatReadyBy } from '@/lib/stringingDue';
import { STRINGING_FLOW, formatPriceExact, playerStageFor } from '@/lib/stringing';
import type { StringingStatus } from '@/lib/stringing';
import type { StringingJob } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

interface Props {
  job: StringingJob;
  onBack: () => void;
  onChanged: () => void;
}

/**
 * One job — screen 2b.
 *
 * The stepper is TAPPABLE IN BOTH DIRECTIONS, matching `canTransition`. A
 * racket gets handed back before it is paid for and rows get tapped by
 * mistake; refusing to go backwards would make the app wrong about the shelf
 * and offer no way to say so. The append-only history is what keeps that safe.
 *
 * The footnote showing what the PLAYER currently sees is not decoration. Every
 * price on this screen is exact, and the whole feature rests on the player
 * never seeing that figure — so the one screen where the exact number lives is
 * the right place to show, continuously, what the other side is reading.
 */
export default function StringingJobDetail({ job, onBack, onChanged }: Props) {
  const t = useTranslations('admin.stringing');
  const online = useOnline();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  const [local, setLocal] = useState(job);

  async function patch(body: Record<string, unknown>) {
    if (busy || !online) return;
    setBusy(true);
    setError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${local.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ memberId: local.memberId, ...body }),
      });
      if (!res.ok) throw new Error(`patch ${res.status}`);
      const data = await res.json();
      setLocal(data.job);
      onChanged();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  const specRows: [string, string][] = [
    [t('spec.racket'), local.racketLabel],
    [t('spec.string'), local.stringLabel],
    [t('spec.tension'), `${local.tensionMains} / ${local.tensionCrosses} lb`],
    [t('spec.method'), local.method],
  ];

  return (
    <div>
      <AdminBackHeader onBack={onBack} title={local.memberName} />
      <div className="flex flex-col gap-4 px-4 pb-6">
        <p className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)', margin: 0 }}>
          {local.jobNo} · {t(`status.${local.status}`)}
        </p>

        {error && <ErrorState message={t('saveError')} />}

        <div className="glass-card p-5 space-y-3">
          <CardHeader icon="sports_tennis" title={t('spec.title')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
            {specRows.map(([k, v]) => (
              <div key={k} style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-4)' }}>
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{k}</span>
                <span className="fs-md" style={{ fontWeight: 600, textAlign: 'right' }}>{v}</span>
              </div>
            ))}
          </div>
        </div>

        <div
          className="glass-card p-5 space-y-3"
          style={{ background: 'var(--banner-green-bg)', borderColor: 'var(--banner-green-border)' }}
        >
          <CardHeader icon="request_quote" title={t('quoted')} />
          <div className="fs-stat-lg" style={{ fontWeight: 700, fontFamily: 'var(--font-mono)' }}>
            {formatPriceExact(local.priceCents) ?? t('unpriced')}
          </div>
          {local.readyBy && (
            <div className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
              {/* Formatted when it is a date; shown verbatim when it is not.
                  Rows written before readyBy became a date still hold free
                  text like "Sunday", and echoing that back beats relabelling
                  it "Invalid Date". */}
              {t('readyBy', { date: formatReadyBy(local.readyBy) ?? local.readyBy })}
            </div>
          )}
          {/* What the other side is reading, right now. */}
          <div
            className="fs-sm"
            style={{
              paddingTop: 'var(--space-4)',
              borderTop: '1px solid var(--banner-green-border)',
              color: 'var(--text-secondary)',
              display: 'flex',
              justifyContent: 'space-between',
              gap: 'var(--space-3)',
            }}
          >
            <span>{t('playerSees', { name: local.memberName })}</span>
            <span style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
              {t(`playerStage.${playerStageFor(local.status)}`)}
            </span>
          </div>
        </div>

        <div className="glass-card p-5 space-y-3">
          <CardHeader icon="fact_check" title={t('statusTitle')} />
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            {STRINGING_FLOW.map((step: StringingStatus) => {
              const idx = STRINGING_FLOW.indexOf(step);
              const current = STRINGING_FLOW.indexOf(local.status);
              const on = idx <= current;
              return (
                <button
                  key={step}
                  type="button"
                  disabled={busy || !online}
                  onClick={() => patch({ status: step })}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 'var(--space-3)',
                    padding: 'var(--space-4)',
                    borderRadius: 'var(--radius-lg)',
                    textAlign: 'left',
                    background: on ? 'var(--banner-green-bg)' : 'var(--inner-card-bg)',
                    border: `1px solid ${on ? 'var(--banner-green-border)' : 'var(--inner-card-border)'}`,
                    ...(busy || !online ? { opacity: 0.5, pointerEvents: 'none' as const } : {}),
                  }}
                >
                  <span
                    className="material-icons icon-sm"
                    style={{ color: on ? 'var(--accent)' : 'var(--text-muted)' }}
                  >
                    {on ? 'check_circle' : 'radio_button_unchecked'}
                  </span>
                  <span
                    className="fs-md"
                    style={{ flex: 1, fontWeight: 600, color: on ? 'var(--accent)' : 'var(--text-muted)' }}
                  >
                    {t(`status.${step}`)}
                  </span>
                  {idx === current && (
                    <span className="fs-2xs" style={{ color: 'var(--text-muted)' }}>{t('now')}</span>
                  )}
                </button>
              );
            })}
          </div>
        </div>

        <p className="fs-sm" style={{ color: 'var(--text-muted)', margin: 0 }}>
          {local.stringerName ? t('heldBy', { name: local.stringerName }) : t('unclaimed')}
        </p>

        <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
          <button
            type="button"
            disabled={busy || !online}
            onClick={() => patch({ paid: local.paidAt === null })}
            className="cc-btn cc-btn-secondary"
            style={{ flex: 1 }}
          >
            {local.paidAt ? t('markUnpaid') : t('markPaid')}
          </button>
          <button
            type="button"
            // Previously `!local.stringerId`, which disabled the button on
            // exactly the jobs worth claiming — the unclaimed ones — and left
            // it live on the ones already yours. No ownership guard at all is
            // the right answer rather than the inverse one: this screen cannot
            // know which admin is looking without another round trip, taking
            // over someone else's job is legitimate, and re-claiming your own
            // is a harmless no-op. Who holds it is shown below instead.
            disabled={busy || !online}
            onClick={() => patch({ claim: true })}
            className="cc-btn cc-btn-secondary"
            style={{ flex: 1 }}
          >
            {t('claim')}
          </button>
        </div>
      </div>
    </div>
  );
}
