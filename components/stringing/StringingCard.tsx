'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';
import { useOnline } from '@/lib/useOnline';
import RequestStringingSheet from './RequestStringingSheet';
import StringingSteps, { stepForStage } from './StringingSteps';
import { formatServicePrice, type ServicePrice } from '@/lib/stringingPricing';
import type { PlayerStage } from '@/lib/stringing';
import type { PlayerStringingJob } from '@/lib/types';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Stages this card has copy for. See the guard in the render. */
const KNOWN_STAGES = ['with_stringer', 'being_strung', 'ready_for_you', 'done'];

interface Props {
  /** Whether anyone is signed in. A request has to belong to somebody. */
  hasIdentity: boolean;
}

/**
 * The stringing card on Home.
 *
 * THREE STATES, AND "COMING SOON" IS STILL ONE OF THEM.
 *
 *   - shop OPEN and signed in  → live: request a restring, and see the one you
 *                                already have
 *   - shop open, signed out    → live copy, but the CTA explains it needs a name
 *   - anything else            → the original "Coming soon" card, untouched
 *
 * The third case covers more than a closed shop, and that is deliberate. An
 * UNKNOWN answer — a throttled or failed probe — also lands there. "Coming
 * soon" is the safe thing to render when we cannot tell: it was true yesterday,
 * it promises nothing, and it never offers a button that would fail. Rendering
 * the live card on a guess would have someone tap into a 409.
 *
 * This is the lying-empty-state rule pointed at a capability rather than at
 * data, and the same shape as `ProviderButtons`: unknown renders the modest
 * thing, never the confident one.
 */
export default function StringingCard({ hasIdentity }: Props) {
  const t = useTranslations('home.stringing');
  const online = useOnline();
  const [open, setOpen] = useState<boolean | null>(null);
  const [jobs, setJobs] = useState<PlayerStringingJob[] | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [pricingOpen, setPricingOpen] = useState(false);
  // null = unknown/unread. `[]` means nothing posted — the expander says so
  // rather than showing a blank panel.
  const [pricing, setPricing] = useState<ServicePrice[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/shop`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled) setOpen(d && typeof d.open === 'boolean' ? d.open : null);
      })
      .catch(() => {
        /* stays null — unknown, which renders "Coming soon" */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const loadJobs = useCallback(() => {
    if (!hasIdentity) return;
    // `view=player` explicitly: an ADMIN calling this without it gets the
    // bench projection — every member's jobs, shaped with `status` instead of
    // `stage`. This is a player surface regardless of who is looking.
    fetch(`${BASE}/api/stringing/jobs?view=player`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (d && Array.isArray(d.jobs)) setJobs(d.jobs as PlayerStringingJob[]);
      })
      .catch(() => {
        // Left null rather than []: "you have no rackets with Grant" and "we
        // could not ask" must not render the same, and here the difference is
        // whether someone thinks their racket was never received.
      });
  }, [hasIdentity]);

  useEffect(() => {
    if (open === true) loadJobs();
  }, [open, loadJobs]);

  // Fetched only when the expander is first opened. A rate card nobody has
  // asked to see is not worth a request on every Home render.
  useEffect(() => {
    if (!pricingOpen || pricing !== null) return;
    let cancelled = false;
    fetch(`${BASE}/api/stringing/pricing`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && Array.isArray(d.services)) setPricing(d.services);
      })
      .catch(() => {
        /* stays null — the panel says it could not load */
      });
    return () => {
      cancelled = true;
    };
  }, [pricingOpen, pricing]);

  // Anything that is not a confirmed open shop keeps the original card.
  if (open !== true) {
    return (
      <div className="glass-card p-5 space-y-3">
        <CardHeader
          icon="science"
          title={t('title')}
          subtitle={t('subtitle')}
          badge={<StatusBadge variant="muted">{t('soon')}</StatusBadge>}
        />
      </div>
    );
  }

  // Guarded on `stage` being a known value, not merely on the job existing.
  // A row without one cannot be rendered — `t()` THROWS on a missing key
  // rather than falling back — so an unexpected shape must drop out here
  // instead of taking the whole Home tab down with it.
  const active =
    jobs?.find(
      (j) => KNOWN_STAGES.includes(j?.stage as string) && j.stage !== 'done',
    ) ?? null;

  return (
    <>
      <div className="glass-card p-5 space-y-3">
        {/* No subtitle: the step strip below explains the process better than a
            sentence did, and repeating it in prose was just noise above it. */}
        <CardHeader
          icon="science"
          title={t('title')}
          badge={<StatusBadge variant="accent">{t('openBadge')}</StatusBadge>}
        />

        <StringingSteps current={stepForStage((active?.stage as PlayerStage) ?? null)} />

        {active && (
          <div
            className="cc-mini-card"
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 'var(--space-3)',
              padding: 'var(--space-4)',
              borderRadius: 'var(--radius-lg)',
            }}
          >
            <span className="material-icons icon-sm" style={{ color: 'var(--accent)' }}>
              sports_tennis
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fs-md" style={{ fontWeight: 600 }}>{active.racketLabel}</div>
              <div className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                {t(`stage.${active.stage}`)}
                {/* A band if it has been quoted; silence if not. Never a
                    figure, and never a zero standing in for "not decided". */}
                {active.priceRange ? ` · ${active.priceRange}` : ''}
              </div>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={!hasIdentity || !online}
          className="cc-btn cc-btn-secondary cc-btn-lg"
          style={{ width: '100%' }}
        >
          {t('requestCta')}
        </button>

        {/* Pricing is a disclosure, not an action — hence a quiet row rather
            than a third button competing with the one that matters. */}
        <button
          type="button"
          onClick={() => setPricingOpen((v) => !v)}
          aria-expanded={pricingOpen}
          className="link-quiet"
          style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}
        >
          <span className="material-icons icon-sm" aria-hidden="true">
            {pricingOpen ? 'expand_less' : 'expand_more'}
          </span>
          {t('viewPricing')}
        </button>

        {pricingOpen && (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {pricing === null && (
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {t('pricingUnavailable')}
              </p>
            )}
            {pricing !== null && pricing.length === 0 && (
              <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
                {t('pricingEmpty')}
              </p>
            )}
            {(pricing ?? []).map((svc) => (
              <div
                key={svc.label}
                style={{ display: 'flex', justifyContent: 'space-between', gap: 'var(--space-3)' }}
              >
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{svc.label}</span>
                <span className="fs-md" style={{ fontWeight: 600, fontFamily: 'var(--font-mono)' }}>
                  {/* "Ask" rather than $0.00 — a null price means there is no
                      fixed one, which is a different thing from free. */}
                  {formatServicePrice(svc.priceCents) ?? t('pricingAsk')}
                </span>
              </div>
            ))}
          </div>
        )}
        {!hasIdentity && (
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {t('needName')}
          </p>
        )}
      </div>

      <RequestStringingSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onRequested={loadJobs}
      />
    </>
  );
}
