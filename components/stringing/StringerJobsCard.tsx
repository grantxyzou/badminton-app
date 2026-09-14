'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { STRINGING_FLOW } from '@/lib/stringing';
import type { StringerJob } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The bench, for the person actually holding the racket.
 *
 * Until now, stringing for the club required being an admin — `stringerId` was
 * whichever admin tapped "Take this one" — so the only way to let somebody
 * restring was to hand them payments, the roster and everyone's data. This is
 * the other half of splitting those: a member flagged `canString` sees the jobs
 * assigned to them, and nothing else.
 *
 * NO MONEY. The server projection (`toStringerJob`) has no `priceCents` and no
 * `paidAt` at all, so there is nothing here to leak — what the club charges is
 * not the business of the person putting string on the racket. The strip is on
 * the server precisely so this component cannot be the thing that gets it
 * wrong.
 *
 * They CAN advance the status, because the person doing the work is the one
 * who knows it is strung. Making them message an admin to record that is the
 * same support-burden shape the access-request flow exists to remove.
 *
 * Renders nothing when there is no work — but renders its ERROR loudly, since
 * "we could not ask" and "nothing to string" look identical and only one means
 * somebody's racket is sitting unstrung.
 */
export default function StringerJobsCard({ hasIdentity }: { hasIdentity: boolean }) {
  const t = useTranslations('home.stringing');
  const online = useOnline();
  const [jobs, setJobs] = useState<StringerJob[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  // Refused, not failed: a device with no session for this name (most
  // name-only regulars) is answered 401/403. That says nothing about whether
  // they string rackets — and someone who does has signed in — so it renders
  // nothing, the same as an empty bench. It used to fall into the load-error
  // branch and put a red "couldn't load your jobs" card in front of players
  // who have never strung anything.
  const [refused, setRefused] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [saveError, setSaveError] = useState(false);

  const load = useCallback(async () => {
    if (!hasIdentity) return;
    setLoadError(false);
    setRefused(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs?view=stringer`, { cache: 'no-store' });
      if (res.status === 401 || res.status === 403) {
        setJobs(null);
        setRefused(true);
        return;
      }
      if (!res.ok) throw new Error(`stringer jobs ${res.status}`);
      const data = await res.json();
      setJobs(Array.isArray(data.jobs) ? data.jobs : []);
    } catch {
      setJobs(null);
      setLoadError(true);
    }
  }, [hasIdentity]);

  useEffect(() => { void load(); }, [load]);

  async function advance(job: StringerJob, status: string) {
    if (busy || !online) return;
    setBusy(job.id);
    setSaveError(false);
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${job.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        // `memberId` is the partition key — the player the racket belongs to,
        // not the stringer. It is on the projection for exactly this call.
        body: JSON.stringify({ memberId: job.memberId, status }),
      });
      if (!res.ok) throw new Error(`advance ${res.status}`);
      await load();
    } catch {
      setSaveError(true);
    } finally {
      setBusy(null);
    }
  }

  if (!hasIdentity || refused) return null;
  /* `compact`, like Balance and Stringing service beside it: on Home a card
     NAMES its subject in the section-label style with a muted icon. The
     default header — an 18px heading and an accent-green glyph — is the Stats
     treatment, and here it spent Home's accent on a label. */
  if (loadError) {
    return (
      <section className="glass-card p-5 space-y-3" aria-label="Rackets to string">
        <CardHeader compact icon="sports_tennis" title={t('stringerTitle')} />
        <ErrorState
          message={t('stringerError')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={() => void load()}>
              {t('stringerRetry')}
            </button>
          }
        />
      </section>
    );
  }
  // No work is the normal state for most people and deserves no card at all —
  // including everyone who is not a stringer, who gets an empty list.
  if (!jobs || jobs.length === 0) return null;

  return (
    <section className="glass-card p-5 space-y-3" aria-label="Rackets to string">
      <CardHeader
        compact
        icon="sports_tennis"
        title={t('stringerTitle')}
        subtitle={t('stringerSubtitle')}
      />
      {saveError && <p className="field-error" role="alert">{t('stringerSaveError')}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
        {jobs.map((job) => {
          const idx = STRINGING_FLOW.indexOf(job.status);
          const nextStatus = idx >= 0 && idx < STRINGING_FLOW.length - 1
            ? STRINGING_FLOW[idx + 1]
            : null;
          return (
            <div
              key={job.id}
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
                padding: 'var(--space-4)',
                borderRadius: 'var(--radius-lg)',
                background: 'var(--inner-card-bg)',
                border: '1px solid var(--inner-card-border)',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <span className="fs-md" style={{ fontWeight: 600, minWidth: 0 }}>
                  {job.racketLabel}
                </span>
                <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--text-muted)' }}>
                  {job.jobNo}
                </span>
              </div>
              {/* The spec, which is the whole reason they opened this. */}
              <span className="fs-sm" style={{ fontFamily: 'var(--font-mono)', color: 'var(--ink-faint)' }}>
                {job.stringLabel} · {job.tensionMains}/{job.tensionCrosses}
                {' · '}
                {t('stringerFor', { name: job.memberName })}
              </span>
              {nextStatus && (
                <button
                  type="button"
                  className="cc-btn cc-btn-secondary"
                  disabled={busy !== null || !online}
                  onClick={() => void advance(job, nextStatus)}
                >
                  {t('stringerAdvance', { status: nextStatus.replace('_', ' ') })}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </section>
  );
}
