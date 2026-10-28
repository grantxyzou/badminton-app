'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import StatusBadge from '@/components/primitives/StatusBadge';
import ErrorState from '@/components/primitives/ErrorState';
import { useOnline } from '@/lib/useOnline';
import { useStringingShop } from '@/lib/useStringingShop';
import { takeStringingIntent } from '@/lib/stringingIntent';
import { useTabActive, useTabReturn } from '@/lib/tabActivity';
import { restringDueWeeks } from '@/lib/restring';
import RequestStringingSheet from './RequestStringingSheet';
import { useGear } from '@/components/stats/useGear';
import { useActiveName } from '@/lib/useActiveName';
import ConfirmChangeSheet from './ConfirmChangeSheet';
import RacketProgressCard from './RacketProgressCard';
import type { PlayerStringingJob } from '@/lib/types';
import { isRefused } from '@/lib/apiFetch';
import { useRevealReady } from '@/components/primitives/Reveal';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { STRINGING_HEIGHTS } from '@/components/TabFallbacks';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/** Stages this card has copy for. See the guard in the render. */
const KNOWN_STAGES = ['awaiting_dropoff', 'with_stringer', 'being_strung', 'ready_for_you', 'done'];

interface Props {
  /** Whether anyone is signed in. A request has to belong to somebody. */
  hasIdentity: boolean;
  /** Switches the Stringing tab to its Strings register, where every price
   *  is (docs/plans/stringing-tabs.md). No link without it. */
  onShowStrings?: () => void;
}

/**
 * The Stringing tab's Submit request register: the service card, then one
 * card per racket the player has in (docs/plans/stringing-canvas-redesign.md).
 *
 * The service card has three states and none of them guesses:
 *
 *   - the shop's answer still out → a skeleton the size of the card;
 *   - it could not be read        → says so, with Try again;
 *   - closed                      → "Closed", and nothing to tap;
 *   - open                        → "Submit a request" and the pricing link.
 *
 * Unknown is never shown as open: rendering the button on a guess would have
 * someone tap into a 409. The lying-empty-state rule pointed at a capability.
 *
 * Each racket's progress is its own `RacketProgressCard`, in the server's
 * order (pinned first, then newest). They used to be rows inside this card,
 * collapsed by default under one step strip for the newest racket (Grant:
 * "Does not need collapseing", "this and the bottom card is redudant").
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
  // The string a string's page sent us here with ("Restring with this string").
  const [prefillString, setPrefillString] = useState<string | null>(null);
  // Above every early return — this component has several, and a hook
  // after one of them is a Rules-of-Hooks violation that only shows up when
  // the branch flips (here: the shop opening). The id of the racket whose
  // change is being answered.
  // A SNAPSHOT of the job, not an id: once answered (or found stale, a 409)
  // the reload drops its pendingEdit, and a sheet looked up by id would vanish
  // before the player read why.
  const [confirmingJob, setConfirmingJob] = useState<PlayerStringingJob | null>(null);
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

  /** The player calls off a request whose racket is still in the bag.
   *  Re-reads on success (the card leaves); a refusal — the stringer took the
   *  racket meanwhile — re-reads too, so the card shows where it really is. */
  const cancelRequest = useCallback(async (id: string): Promise<boolean> => {
    try {
      const res = await fetch(`${BASE}/api/stringing/jobs/${id}/cancel`, { method: 'POST' });
      if (res.ok || res.status === 409) loadJobs();
      return res.ok;
    } catch {
      return false;
    }
  }, [loadJobs]);

  // Arrived from Stats' "Get it strung at 24 lb", or from a string's page
  // ("Restring with this string"): open the form at that number, or with that
  // string picked. Waits for the shop's answer and for the identity, which the tab
  // reads after mount (a child's effect runs before its parent's, so the first
  // pass can see `false` for a signed-in member). A closed shop consumes the
  // marker without opening anything, so it cannot open a form on a later visit.
  // Asked again on each arrival: the tab is kept, so the card is usually
  // mounted before the link is tapped (lib/tabActivity.ts).
  const onScreen = useTabActive();
  useEffect(() => {
    if (!onScreen || open === null || !hasIdentity) return;
    const intent = takeStringingIntent();
    if (intent === null || open !== true) return;
    setPrefillTension(typeof intent === 'number' ? intent : null);
    setPrefillString(typeof intent === 'object' ? intent.string : null);
    setSheetOpen(true);
  }, [onScreen, open, hasIdentity]);

  // Back on this tab after a while: the stringer may have moved a racket on.
  // Re-read quietly; the list stays on screen while it does.
  useTabReturn(() => {
    if (open === true) loadJobs();
  });

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

  // A confirmed closed shop: the same header, the badge saying so, and
  // nothing to tap.
  if (open !== true) {
    return (
      <div className="glass-card p-5">
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

  // Guarded on `stage` being a known value, not merely on the job existing:
  // an unexpected shape drops out here instead of rendering a raw key.
  /* EVERY open job, in the server's order (pinned first, then newest) — a
     player with three in sees three (audit 2026-10-11, finding 01). */
  const openJobs = (jobs ?? []).filter(
    (j) => KNOWN_STAGES.includes(j?.stage as string) && j.stage !== 'done',
  );

  /* THE RESTRING REMINDER. Only for someone the shop has strung for, only once
     it has been two months (`RESTRING_AFTER_WEEKS`), and only with no racket
     in — a racket on the bench is already the answer. No date renders nothing;
     "you're due" on a guess is the lying-empty-state rule in reverse.
     `jobs !== null` waits for the read, so the line cannot flash in and then
     vanish when an active job arrives. */
  const restringWeeks =
    jobs !== null && openJobs.length === 0 ? restringDueWeeks(shopStrungAt, new Date()) : null;

  return (
    <>
      <div className="flex flex-col gap-3">
        <div className="glass-card p-5 space-y-3">
          {/* Muted badge: the label carries the state, and accent on this card
              belongs to the request button. */}
          <CardHeader
            compact
            icon="grid_4x4"
            title={t('title')}
            badge={<StatusBadge variant="muted">{t('openBadge')}</StatusBadge>}
          />

          {/* Secondary ink, never red and never accent. No inline margin: a
              non-first direct child of `space-y-3` (the WhereYouSitCard bug). */}
          {restringWeeks !== null && (
            <p className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
              {t('restringDue', { weeks: restringWeeks })}
            </p>
          )}

          {/* Refused renders nothing here: the request button below is
              disabled, which is this card's half of "sign in". */}
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

          {/* The tab's one way in, so a real button now (Grant: "This is not
              Request anymore. Its the next action."). It was a text row while
              this card sat on Home under the week's sign-up; on its own tab
              nothing competes with it. The tinted `cc-btn-primary`, not the
              filled `.btn-primary`, which stays the sign-up's. */}
          <button
            type="button"
            onClick={() => { setPrefillTension(null); setPrefillString(null); setSheetOpen(true); }}
            // Refused means the request would be refused too — no button that fails.
            disabled={!hasIdentity || !online || jobsProblem === 'refused'}
            className="cc-btn cc-btn-primary cc-btn-lg"
            style={{ width: '100%', justifyContent: 'space-between' }}
          >
            <span>{t('requestCta')}</span>
            <span className="material-icons icon-md" aria-hidden="true">arrow_forward</span>
          </button>

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

        {openJobs.map((j) => (
          <RacketProgressCard key={j.id} job={j} onReview={() => setConfirmingJob(j)} onCancel={() => cancelRequest(j.id)} />
        ))}
      </div>

      <RequestStringingSheet
        open={sheetOpen}
        onClose={() => setSheetOpen(false)}
        onRequested={loadJobs}
        gear={activeName.name ? gear : null}
        initialTension={prefillTension}
        initialString={prefillString}
      />

      {confirmingJob && (
        <ConfirmChangeSheet
          job={confirmingJob}
          open
          onClose={() => setConfirmingJob(null)}
          onAnswered={loadJobs}
        />
      )}
    </>
  );
}
