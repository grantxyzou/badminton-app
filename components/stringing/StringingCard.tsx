'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import StatusBanner from '@/components/primitives/StatusBanner';
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

/** Matches the balance card's formatting, so the same number looks the same
 *  in both places on one screen. */
function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

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
  /**
   * Collapsed/expanded, and null means "the player has not chosen".
   *
   * Null rather than a boolean so the DEFAULT keeps tracking the data: with a
   * racket in, the card opens collapsed — the rail already answers the only
   * question a glance is asking — and it reverts to that on its own once the
   * job finishes. A boolean initialised to `false` would freeze whichever
   * state happened to be right when the component first mounted.
   */
  const [openOverride, setOpenOverride] = useState<boolean | null>(null);
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
        {/* Same treatment as the live card — the title should not change size
            when the shop opens. */}
        <CardHeader
          compact
          icon="grid_4x4"
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

  /**
   * COLLAPSIBLE ONLY WHEN THERE IS A RACKET.
   *
   * With nothing in, the card is already two rows — a chevron would offer to
   * hide "Submit a request", which is the only reason the card is there. With
   * a racket in, the rail is the glance answer and the detail is the thing
   * worth folding away, so the card opens collapsed and expands to the racket.
   */
  const collapsible = active !== null;
  const expanded = !collapsible || (openOverride ?? false);

  const header = (
    <CardHeader
      compact
      /* `grid_4x4`, not `science` (a flask says laboratory) and not
         `sports_tennis` (the racket already appears on the row below, and
         repeating it makes the card look like it is about rackets rather than
         about what is done to them). A string bed IS a grid of mains and
         crosses — the mesh is the thing being sold. Added to the subsetted
         glyph list in app/layout.tsx; a missing glyph renders as raw text. */
      icon="grid_4x4"
      title={t('title')}
      badge={
        <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
          <StatusBadge variant="accent">{t('openBadge')}</StatusBadge>
          {collapsible && (
            <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              {expanded ? 'expand_less' : 'expand_more'}
            </span>
          )}
        </span>
      }
    />
  );

  return (
    <>
      <div className="glass-card p-5 space-y-3">
        {/* No subtitle: the step strip below explains the process better than a
            sentence did, and repeating it in prose was just noise above it.
            Neutral icon and title — this card sits in the ACCOUNT group, below
            the week's one real action, and dressing it in accent made it
            compete with the thing above it. */}
        {collapsible ? (
          <button
            type="button"
            onClick={() => setOpenOverride(!expanded)}
            aria-expanded={expanded}
            style={{
              display: 'block',
              width: '100%',
              padding: '0',
              background: 'none',
              border: 'none',
              font: 'inherit',
              textAlign: 'left',
              cursor: 'pointer',
            }}
          >
            {header}
          </button>
        ) : (
          header
        )}

        {/* THE ONE STAGE WORTH ANNOUNCING.
            `ready_for_you` is the only player stage that asks for an action —
            come and collect it — and until now it was a two-word line inside a
            card that is COLLAPSED by default, so a finished racket looked
            exactly like one still on the bench. This is the in-app half of the
            notification seam (lib/stringingNotify.ts): the email interrupts
            people who have an address, and this is what reaches everyone else,
            in their own locale, without any delivery at all.

            Deliberately NOT dismissible. It is not an alert about an event, it
            is the current state of the racket — it should stay until the job
            leaves `ready_for_you`, which happens when they pick it up. */}
        {active?.stage === 'ready_for_you' && (
          <StatusBanner
            tone="success"
            icon="check_circle"
            title={t('ready.title')}
            body={t('ready.body', { racket: active.racketLabel, jobNo: active.jobNo })}
          />
        )}

        {/* THE RAIL WAITS UNTIL THERE IS A JOB, and then it is what the
            COLLAPSED card shows — four steps and ~90px describing a process
            nobody had started was an explanation charged against a card with
            nothing to report. Extra headroom because collapsed it is the
            card's whole content and sat too close to the title. */}
        {active && (
          <div style={{ paddingTop: expanded ? 0 : 'var(--space-4)' }}>
            <StringingSteps current={stepForStage((active.stage as PlayerStage) ?? null)} />
          </div>
        )}

        {active && expanded && (
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
                {/* The BILL if there is one, else the quote, else silence.
                    Showing the band once an exact amount is owed had this card
                    reading "$28–32" directly above a balance line saying "$30"
                    for the same racket. */}
                {active.amountDue !== null && active.amountDue !== undefined
                  ? ` · ${fmtMoney(active.amountDue)}`
                  : active.priceRange
                    ? ` · ${active.priceRange}`
                    : ''}
              </div>
            </div>
          </div>
        )}

        {/* The CTA and pricing stay in BOTH states — only the RACKET folds away.
            Hiding them when collapsed also produced a visible jump: `active` is
            null until the jobs fetch lands, so the card rendered expanded and
            then snapped shut the moment data arrived. Keeping them put removes
            the flash and is what was actually asked for — collapsed shows the
            progress, expanded shows the racket. */}
        {/* A TEXT ROW, not a filled block.
            As a full-width button this outweighed "I'm in this week" — the
            week's actual decision — from inside the group below it. Demoted to
            a link with an arrow, it still reads as the way in without
            competing for the one primary slot on the screen. */}
        <button
          type="button"
          onClick={() => setSheetOpen(true)}
          disabled={!hasIdentity || !online}
          className="bpm-row-link"
        >
          <span className="fs-md" style={{ fontWeight: 600 }}>{t('requestCta')}</span>
          <span className="material-icons icon-sm" aria-hidden="true">arrow_forward</span>
        </button>

        {/* Pricing is a disclosure, not an action — hence a quiet row rather
            than a third button competing with the one that matters. */}
        {/* A ROW, matching "Submit a request" above it — label left, affordance
            right, full width. It was a left-huddled underlined link with a
            chevron in front of the text: a third geometry on a card that
            already had two, and the chevron read as a bullet rather than as
            "this opens". Quieter than the CTA because it is a disclosure, but
            the same shape, so the card has one way of presenting a row. */}
        <button
          type="button"
          onClick={() => setPricingOpen((v) => !v)}
          aria-expanded={pricingOpen}
          className="bpm-row-link"
          style={{ color: 'var(--text-secondary)' }}
        >
          <span className="fs-sm">{t('viewPricing')}</span>
          <span className="material-icons icon-sm" aria-hidden="true">
            {pricingOpen ? 'expand_less' : 'expand_more'}
          </span>
        </button>

        {pricingOpen && (
          <div style={{ display: 'grid', gap: 'var(--space-3)' }}>
            {pricing === null && (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
                {t('pricingUnavailable')}
              </p>
            )}
            {pricing !== null && pricing.length === 0 && (
              <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
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
          <p className="fs-sm" style={{ margin: '0', color: 'var(--text-muted)' }}>
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
