'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import StatusBanner from '@/components/primitives/StatusBanner';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';
import Collapse from '@/components/primitives/Collapse';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { useStringingShop } from '@/lib/useStringingShop';
import { takeStringingIntent } from '@/lib/stringingIntent';
import { restringDueWeeks } from '@/lib/restring';
import RequestStringingSheet from './RequestStringingSheet';
import { useGear } from '@/components/stats/useGear';
import { useActiveName } from '@/lib/useActiveName';
import ConfirmChangeSheet from './ConfirmChangeSheet';
import StringingSteps, { stepForStage } from './StringingSteps';
import type { PlayerStage } from '@/lib/stringing';
import type { PlayerStringingJob } from '@/lib/types';
import { isRefused } from '@/lib/apiFetch';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { STRINGING_HEIGHTS } from '@/components/TabFallbacks';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Stages this card has copy for. See the guard in the render. */
const KNOWN_STAGES = ['awaiting_dropoff', 'with_stringer', 'being_strung', 'ready_for_you', 'done'];

/** Matches the balance card's formatting, so the same number looks the same
 *  in both places on one screen. */
function fmtMoney(n: number): string {
  return Number.isInteger(n) ? `$${n}` : `$${n.toFixed(2)}`;
}

interface Props {
  /** Whether anyone is signed in. A request has to belong to somebody. */
  hasIdentity: boolean;
  /** Switches the Stringing tab to its Strings register, where every price
   *  is (docs/plans/stringing-tabs.md). No link without it. */
  onShowStrings?: () => void;
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
export default function StringingCard({ hasIdentity, onShowStrings }: Props) {
  /* The kit's ONE owner in this tree, handed to the request sheet as a prop.
     `useGear` is single-owner by rule — four components once read the gear
     endpoint independently and raced each other's responses. `useActiveName`
     is likewise the single owner of "who is this", so the name comes from
     there rather than from a second read of identity. */
  const activeName = useActiveName();
  const gear = useGear(activeName.name ?? '');
  const t = useTranslations('home.stringing');
  const online = useOnline();
  const shop = useStringingShop();
  const open = shop.open;
  const [jobs, setJobs] = useState<PlayerStringingJob[] | null>(null);
  // The shop's half of "when were these strung" — null until read, and when
  // they have never used it.
  const [shopStrungAt, setShopStrungAt] = useState<string | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  // The tension the String tension card sent us here with (lib/stringingIntent.ts).
  const [prefillTension, setPrefillTension] = useState<number | null>(null);
  // Above every early return — this component has several, and a hook
  // after one of them is a Rules-of-Hooks violation that only shows up when
  // the branch flips (here: the shop opening).
  const [confirming, setConfirming] = useState(false);
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
  /* Why the racket list is absent, when it is. `refused` is a device with no
     session for this name (the server answers 401/403) — not a failure, and
     not "no rackets" either. `failed` is a read that went wrong. Both used to
     leave `jobs` null and render exactly like an empty bench. */
  const [jobsProblem, setJobsProblem] = useState<'refused' | 'failed' | null>(null);

  const loadJobs = useCallback(() => {
    if (!hasIdentity) return;
    // `view=player` explicitly: an ADMIN calling this without it gets the
    // bench projection — every member's jobs, shaped with `status` instead of
    // `stage`. This is a player surface regardless of who is looking.
    setJobsProblem(null);
    fetch(`${BASE}/api/stringing/jobs?view=player`, { cache: 'no-store' })
      .then((r) => {
        if (isRefused(r)) return 'refused' as const;
        if (!r.ok) throw new Error(`player jobs ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (d === 'refused') { setJobsProblem('refused'); return; }
        if (d && Array.isArray(d.jobs)) {
          setJobs(d.jobs as PlayerStringingJob[]);
          setShopStrungAt(typeof d.lastStrungAt === 'string' ? d.lastStrungAt : null);
        }
        else setJobsProblem('failed');
      })
      .catch(() => {
        // Left null rather than []: "you have no rackets with Grant" and "we
        // could not ask" must not render the same, and here the difference is
        // whether someone thinks their racket was never received.
        setJobsProblem('failed');
      });
  }, [hasIdentity]);

  useEffect(() => {
    if (open === true) loadJobs();
  }, [open, loadJobs]);

  // Arrived from Stats' "Get it strung at 24 lb": open the form at that
  // number. Waits for the shop's answer and for the identity, which the tab
  // reads after mount (a child's effect runs before its parent's, so the first
  // pass can see `false` for a signed-in member). A closed shop consumes the
  // marker without opening anything, so it cannot open a form on a later visit.
  useEffect(() => {
    if (open === null || !hasIdentity) return;
    const lbs = takeStringingIntent();
    if (lbs === null || open !== true) return;
    setPrefillTension(lbs);
    setSheetOpen(true);
  }, [open, hasIdentity]);

  // The Stringing tab's RevealSlot holds this place until the card can draw its
  // final shape: the shop has answered and, when it is open for a signed-in
  // player, so have their rackets (or the read has failed or been refused).
  // Revealing on the shop alone let the banners, the step strip and the rows
  // pop in afterwards and grow the card.
  const jobsAnswered = !hasIdentity || open !== true || jobs !== null || jobsProblem !== null;
  useRevealReady(shop.status === 'error' || (shop.status !== 'loading' && jobsAnswered));

  // Unknown is not closed. Before the shop answers this is a skeleton the size
  // of the card; if it cannot be read, it says so. "Coming soon" is only for a
  // shop the server says is closed — it used to stand in for all three.
  if (shop.status === 'loading') return <CardSkeleton height={STRINGING_HEIGHTS.service} />;
  if (shop.status === 'error') {
    return (
      <div className="glass-card p-5 space-y-3">
        <CardHeader compact icon="grid_4x4" title={t('title')} subtitle={t('subtitle')} />
        <ErrorState
          message={t('shopUnavailable')}
          action={
            <button type="button" className="cc-btn cc-btn-ghost" onClick={shop.retry}>
              {t('retry')}
            </button>
          }
        />
      </div>
    );
  }

  // A confirmed closed shop keeps the original card.
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
  /* EVERY open job, in the server's order (pinned first, then newest). It was
     `jobs.find(...)` — one racket — and a player with three in saw the newest
     only, while the cap error told them to collect rackets they could not see
     (audit 2026-10-11, finding 01). */
  const openJobs = (jobs ?? []).filter(
    (j) => KNOWN_STAGES.includes(j?.stage as string) && j.stage !== 'done',
  );
  /* The racket the strip talks about. ONE strip, not one per row: the strip is
     the glance answer and the rows are the detail. */
  const lead = openJobs[0] ?? null;
  /* The banners attach to the JOB that has something to say, which is not
     necessarily the newest — an older racket can be the one that is ready, or
     the one with a price waiting on an answer. */
  const pendingJob = openJobs.find((j) => j.pendingEdit) ?? null;
  const readyJobs = openJobs.filter((j) => j.stage === 'ready_for_you');

  /**
   * COLLAPSIBLE ONLY WHEN THERE IS A RACKET.
   *
   * With nothing in, the card is already two rows — a chevron would offer to
   * hide "Submit a request", which is the only reason the card is there. With
   * a racket in, the rail is the glance answer and the detail is the thing
   * worth folding away, so the card opens collapsed and expands to the racket.
   */
  const collapsible = lead !== null;

  /* THE RESTRING REMINDER. Only for someone the shop has strung for, only once
     it has been two months (`RESTRING_AFTER_WEEKS`), and only with no racket
     in — a racket on the bench is already the answer. No date renders nothing;
     "you're due" on a guess is the lying-empty-state rule in reverse.
     `jobs !== null` waits for the read, so the line cannot flash in and then
     vanish when an active job arrives. */
  const restringWeeks =
    jobs !== null && lead === null ? restringDueWeeks(shopStrungAt, new Date()) : null;
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
          {/* Muted, like "Coming soon" when it is closed: the label carries the
              state, and accent on this tab belongs to the request link. */}
          <StatusBadge variant="muted">{t('openBadge')}</StatusBadge>
          {collapsible && (
            <span
              className="material-icons icon-sm motion-chevron"
              data-open={expanded ? 'true' : 'false'}
              aria-hidden="true"
              style={{ color: 'var(--text-muted)' }}
            >
              expand_more
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
              // 362×25 measured in the browser (audit 2026-10-11, A3): the
              // tab's most-used control, one pixel over the 24 floor. The
              // 44 tap floor, as every sheet close button already carries.
              minHeight: 44,
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
        {/* A change the stringer has asked about and this player has not
            answered. Sits ABOVE the ready banner because it is a question
            rather than a status, and an unanswered question outranks news.

            Tapping opens the sheet; the banner alone never accepts anything —
            agreeing to a price is exactly the wrong thing to do by mis-tap. */}
        {pendingJob && (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            style={{ width: '100%', textAlign: 'left' }}
          >
            <StatusBanner
              tone="warn"
              icon="request_quote"
              title={t('confirm.banner')}
              body={t('confirm.intro', { racket: pendingJob.racketLabel })}
            />
          </button>
        )}

        {readyJobs.map((j) => (
          <StatusBanner
            key={j.id}
            tone="success"
            icon="check_circle"
            title={t('ready.title')}
            body={t('ready.body', { racket: j.racketLabel, jobNo: j.jobNo })}
          />
        ))}

        {/* THE RAIL WAITS UNTIL THERE IS A JOB, and then it is what the
            COLLAPSED card shows — four steps and ~90px describing a process
            nobody had started was an explanation charged against a card with
            nothing to report. Extra headroom because collapsed it is the
            card's whole content and sat too close to the title. */}
        {lead && (
          <div
            style={{
              paddingTop: expanded ? 0 : 'var(--space-4)',
              // The headroom closes with the row opening beneath it.
              transition: 'padding-top var(--duration-sheet) var(--ease-sheet)',
            }}
          >
            <StringingSteps current={stepForStage((lead.stage as PlayerStage) ?? null)} />
          </div>
        )}

        {lead && (
          <Collapse open={expanded} spaceAbove="var(--space-3)">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {openJobs.map((j) => (
          <div
            key={j.id}
            className="glass-card-soft"
            style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', padding: 'var(--space-4)' }}
          >
            {/* Muted: an icon beside a label is part of the label, and accent
                here is spent on the one way in, "Submit a request". */}
            <span className="material-icons icon-sm" aria-hidden="true" style={{ color: 'var(--text-muted)' }}>
              sports_tennis
            </span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div className="fs-md" style={{ fontWeight: 600 }}>{j.racketLabel}</div>
              <div className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
                {t(`stage.${j.stage}`)}
                {/* The BILL if there is one, else the quote, else silence.
                    Showing the band once an exact amount is owed had this card
                    reading "$28–32" directly above a balance line saying "$30"
                    for the same racket. */}
                {j.amountDue !== null && j.amountDue !== undefined ? (
                  <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{fmtMoney(j.amountDue)}</span></>
                ) : j.priceRange ? (
                  <> · <span style={{ fontFamily: 'var(--font-mono)' }}>{j.priceRange}</span></>
                ) : null}
              </div>
            </div>
          </div>
          ))}
          </div>
          </Collapse>
        )}

        {/* Refused renders nothing here: the Balance card directly above already
            says "Sign in", and two stacked sign-in prompts read as two problems.
            The request CTA below is disabled, which is this card's half of it. */}
        {jobsProblem === 'failed' && (
          <ErrorState
            message={t('jobsError')}
            action={
              <button type="button" className="cc-btn cc-btn-ghost" onClick={loadJobs}>
                {t('retry')}
              </button>
            }
          />
        )}

        {/* The CTA and the prices link stay in BOTH states — only the RACKET folds away.
            Hiding them when collapsed also produced a visible jump: `active` is
            null until the jobs fetch lands, so the card rendered expanded and
            then snapped shut the moment data arrived. Keeping them put removes
            the flash and is what was actually asked for — collapsed shows the
            progress, expanded shows the racket. */}
        {/* A TEXT ROW, not a filled block.
            As a full-width button this outweighed the sign-up button — the
            week's actual decision — from inside the group below it. Demoted to
            a link with an arrow, it still reads as the way in without
            competing for the one primary slot on the screen. */}
        {/* Secondary ink, never red and never accent: the CTA right below
            stays the card's one way in. No inline margin: this is a non-first
            direct child of a `space-y-3` card, and `margin: 0` would cancel the
            gap above it (the WhereYouSitCard footnote bug). */}
        {restringWeeks !== null && (
          <p className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
            {t('restringDue', { weeks: restringWeeks })}
          </p>
        )}

        <button
          type="button"
          onClick={() => { setPrefillTension(null); setSheetOpen(true); }}
          // Refused means the request would be refused too — no button that fails.
          disabled={!hasIdentity || !online || jobsProblem === 'refused'}
          className="bpm-row-link"
        >
          <span className="fs-md" style={{ fontWeight: 600 }}>{t('requestCta')}</span>
          <span className="material-icons icon-sm" aria-hidden="true">arrow_forward</span>
        </button>

        {/* Every price is on the Strings tab now (docs/plans/stringing-tabs.md):
            the "View pricing" expander listed each string's price a second
            time, above the shelf that already showed them. A quiet ROW, the
            same shape as "Submit a request" above it and secondary ink, so it
            never competes with the card's one way in. */}
        {onShowStrings && (
          <button
            type="button"
            onClick={onShowStrings}
            className="bpm-row-link"
            style={{ color: 'var(--text-secondary)' }}
          >
            <span className="fs-sm">{t('seeStrings')}</span>
            <span className="material-icons icon-sm" aria-hidden="true">chevron_right</span>
          </button>
        )}
        {!hasIdentity && (
          <p className="fs-sm" style={{ color: 'var(--text-muted)' }}>
            {t('needName')}
          </p>
        )}
      </div>

      <RequestStringingSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onRequested={loadJobs}
        gear={activeName.name ? gear : null}
        initialTension={prefillTension}
      />

      {pendingJob && (
        <ConfirmChangeSheet
          job={pendingJob}
          open={confirming}
          onClose={() => setConfirming(false)}
          onAnswered={loadJobs}
        />
      )}
    </>
  );
}
