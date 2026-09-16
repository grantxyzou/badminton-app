'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useSkillText } from '@/lib/useSkillText';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { SKILLS, topStrengths, workOnNext, type Rating } from '@/lib/assessment';
import type { Band } from '@/lib/clubBands';
import type { UseCheckIn } from './useCheckIn';
import LockedCard, { PreviewMeter, useSignInLink } from './LockedCard';
import { sharedRead } from '@/lib/sharedRead';


/**
 * "Where you sit" — the member's sharpest and weakest rated skills, each shown
 * as one filled third of a three-segment bar.
 *
 * Thirds only, on purpose. In a club this size a precise rank is a
 * de-anonymising fact; "top third" is not. The server enforces both halves of
 * that (a cohort minimum, and the consent invariant) — this card renders what
 * it is given and never infers a band the API withheld.
 *
 * The card does NOT render at all below the cohort minimum. That is a
 * deliberate choice over an empty state: "not enough people yet" is not
 * interesting to be told every week, and a permanent apology card trains
 * people to ignore that slot.
 */

interface ClubBands {
  cohort: number;
  minCohort: number;
  skills: { skillKey: string; band: Band }[];
}

type Load = 'loading' | 'ready' | 'error' | 'forbidden';

export interface WhereYouSitCardProps {
  activeName: string | null;
  /**
   * True while the first-run consent sheet is open. The card must render its
   * unrevealed state then — see the note on `revealed` below.
   */
  promptOpen?: boolean;
  /** The single check-in owner — supplies this card's own ratings without a
   *  second read of the history. See the note at the call site. */
  checkIn?: UseCheckIn;
}

export default function WhereYouSitCard({ activeName, promptOpen = false, checkIn }: WhereYouSitCardProps) {
  const t = useTranslations('stats.club');
  const signInLink = useSignInLink();
  const [bands, setBands] = useState<ClubBands | null>(null);
  const tStats = useTranslations('stats');
  const skillText = useSkillText();
  const [status, setStatus] = useState<Load>('loading');
  const [attempt, setAttempt] = useState(0);

  /**
   * The member's own ratings come from the single owner, not from a second
   * read of `/api/assessments`. This card used to fetch it alongside the bands
   * in one `Promise.all`; `OverviewStrip` and `SkillTrendCard` each fetched it
   * too, so one visit to Stats read the same history three times and the cards
   * could disagree mid-flight. Pinned by `StatsCheckInOwner.test.tsx`.
   *
   * The BANDS read stays here — it is this card's own data, it is consent-gated
   * server-side, and it has to re-run when the member answers that prompt.
   *
   * TWO SOURCES, SO TWO STATUSES, AND THE CARD MUST GATE ON BOTH. `status`
   * below tracks the bands read ONLY. When the ratings lived in the same
   * `Promise.all` that was the whole story; since they moved onto the owner it
   * has not been, and reading `latest?.ratings ?? []` collapses "the history
   * failed" into "no ratings" — which reaches `picked.length === 0` and returns
   * `null`, the exact silent vanish the error branch below exists to prevent.
   * The same collapse on the loading side let the card mount empty and pop in
   * when the history landed. An ABSENT owner still reads as ready: a caller
   * that passes no `checkIn` has no history to wait for, and that caller's
   * empty-ratings render is the pre-existing behaviour.
   */
  const ratings: Rating[] = (checkIn?.latest?.ratings ?? []) as Rating[];
  const historyStatus: Load = checkIn?.status ?? 'ready';

  useEffect(() => {
    if (!activeName) return;
    const n = encodeURIComponent(activeName);
    let live = true;
    // Bands are shared with `SkillTrendCard` — same URL, same screen.
    const get = (url: string) => sharedRead(url);

    get(`/api/stats/club/bands?name=${n}`)
      .then((b) => {
        if (!live) return;
        setBands(b as ClubBands);
        setStatus('ready');
      })
      .catch((e: Error) => live && setStatus(e?.message === '403' ? 'forbidden' : 'error'));

    return () => {
      live = false;
    };
  }, [activeName, attempt]);

  if (!activeName) return null;
  // Refused (this device holds no session for the name): the card stays, as
  // its own shape with nothing in it, and Sign in carries the weight.
  if (status === 'forbidden' || historyStatus === 'forbidden') {
    return (
      <LockedCard icon="groups" title={t('title')} message={t.rich('locked', { link: signInLink })}>
        {SKILLS.slice(0, 2).map((s) => <PreviewMeter key={s.key} label={skillText.label(s.key)} />)}
      </LockedCard>
    );
  }
  if (status === 'loading' || historyStatus === 'loading') return <CardSkeleton height={180} />;
  if (status === 'error' || historyStatus === 'error') {
    // A failed read is NOT the same as "too few people" — say so out loud
    // rather than silently vanishing, which would look identical to the
    // legitimate below-cohort case. EITHER read failing lands here: without
    // ratings there is no skill to name and without bands no third to place it
    // in, so a half-loaded card has nothing honest to draw.
    // Standalone, not a card holding only an error (the state rule).
    return (
      <ErrorState
        message={t('error')}
        action={
          <button
            type="button"
            className="cc-btn cc-btn-ghost"
            onClick={() => {
              if (status === 'error') { setStatus('loading'); setAttempt((n) => n + 1); }
              if (historyStatus === 'error') checkIn?.reload();
            }}
          >
            {tStats('retry')}
          </button>
        }
      />
    );
  }

  /**
   * Below the cohort minimum the card is absent entirely, not empty.
   *
   * The shape check is not paranoia. A 200 carrying an unexpected body used to
   * reach the `bands.skills.length` read below and throw, taking the whole
   * register down with it — and `undefined < undefined` is false, so a missing
   * `cohort` sailed through this guard rather than being caught by it. Unknown
   * is not known-false: a payload we cannot read is treated as "no comparison
   * available", which is what the card already renders for a small club.
   */
  if (!bands || !Array.isArray(bands.skills)) return null;
  if (typeof bands.cohort !== 'number' || typeof bands.minCohort !== 'number') return null;
  if (bands.cohort < bands.minCohort) return null;

  /**
   * THE CONSENT INVARIANT, client side.
   *
   * The server already withholds `skills` unless the preference is on AND the
   * prompt has been answered, so an empty array is the authoritative "not
   * revealed". `promptOpen` is the belt to that braces: while the sheet is
   * open the card sits behind a translucent backdrop, so it must not paint a
   * band even if a previous answer is still cached in this component's state.
   */
  const revealed = !promptOpen && bands.skills.length > 0;

  const bandOf = new Map(bands.skills.map((s) => [s.skillKey, s.band]));
  // Sharpest and weakest RATED skills — reuse the same helpers the trend card
  // and the drills engine use, so all three agree on what "weakest" means.
  const best = topStrengths(ratings)[0]?.skillKey;
  const worst = workOnNext(ratings)[0]?.skillKey;

  const picked: string[] = [];
  for (const key of [best, worst]) {
    if (!key || picked.includes(key)) continue; // one rated skill = one band
    // When revealed we can only show a skill the server actually banded. When
    // NOT revealed there are no bands at all, but the member is still entitled
    // to see their own sharpest/weakest skills with the bars left empty — that
    // is the opted-out state from the design, and returning null instead would
    // make "Keep it private" silently delete the card.
    if (revealed && !bandOf.has(key)) continue;
    picked.push(key);
  }
  if (picked.length === 0) return null;

  const bandLabel = (b: Band) =>
    b === 'top' ? t('bandTop') : b === 'middle' ? t('bandMiddle') : t('bandBottom');

  const emphasis = (chunks: ReactNode) => (
    <b style={{ color: 'var(--accent)', fontWeight: 600 }}>{chunks}</b>
  );

  return (
    /* Not revealed => the design's `locked` material, which drops backdrop-filter
       entirely. That flatness is the point: a blurred card still looks like it
       has something behind it, so a merely-dimmed card reads as "loading" or
       "disabled" rather than "private". Inert is the honest signal here, and it
       matches the lock pill and unfilled bands already in this branch.
       Applies unconditionally since the fields flag retired 2026-09-10. */
    /* flex+gap, not space-y-3: every <p> in here carries an inline
       `margin: '0'` to kill the UA paragraph margin, and an inline style beats
       the utility's `> * + * { margin-top }` -- so the card's rhythm was being
       cancelled by its own children and the footnote sat 0px under the bands.
       A flex `gap` cannot be overridden by a child's margin. */
    <div className={`glass-card p-5 flex flex-col gap-3${revealed ? '' : ' is-locked'}`}>
      <CardHeader
        icon="groups"
        title={t('title')}
        badge={
          revealed ? undefined : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 'var(--space-2)',
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--fs-2xs)',
                padding: 'var(--space-1) var(--space-3)',
                border: '1px solid var(--inner-card-border)',
                color: 'var(--text-muted)',
                fontWeight: 600,
                letterSpacing: '0.04em',
                textTransform: 'uppercase',
                whiteSpace: 'nowrap',
              }}
            >
              <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-xs)' }}>
                lock
              </span>
              {t('private')}
            </span>
          )
        }
      />

      {revealed && (
        <p style={{ margin: '0', fontSize: 'var(--fs-md)', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          {picked.length === 1
            ? t.rich('ledeOne', {
                band: bandLabel(bandOf.get(picked[0]) as Band),
                skill: skillText.label(picked[0]),
                hi: emphasis,
              })
            : t.rich('ledeTwo', {
                band1: bandLabel(bandOf.get(picked[0]) as Band),
                skill1: skillText.label(picked[0]),
                band2: bandLabel(bandOf.get(picked[1]) as Band),
                skill2: skillText.label(picked[1]),
                hi: emphasis,
              })}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {picked.map((key) => (
          <div key={key}>
            <p style={{ margin: '0 0 var(--space-2)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
              {skillText.label(key)}
            </p>
            <BandBar band={revealed ? (bandOf.get(key) as Band) : null} />
          </div>
        ))}
      </div>

      <p style={{ margin: '0', fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        {revealed ? t('footnote') : t('footnotePrivate')}
      </p>
    </div>
  );
}

/** Three segments; `null` fills none — the unrevealed / club-spread state. */
function BandBar({ band }: { band: Band | null }) {
  const cells: Band[] = ['bottom', 'middle', 'top'];
  return (
    <div style={{ display: 'flex', gap: 'var(--space-1)', height: 10 }}>
      {cells.map((cell, i) => {
        const filled = band === cell;
        return (
          <span
            key={cell}
            style={{
              flex: 1,
              // Only the top third gets the accent. Middle and bottom fill in a
              // neutral tone: this is a position, not a score, and colouring a
              // bottom third red would make an honest self-rating feel punished.
              background: filled
                ? cell === 'top'
                  ? 'var(--accent)'
                  : 'color-mix(in srgb, var(--text-primary) 35%, transparent)'
                : 'var(--inner-card-bg)',
              borderTopLeftRadius: i === 0 ? 'var(--radius-pill)' : undefined,
              borderBottomLeftRadius: i === 0 ? 'var(--radius-pill)' : undefined,
              borderTopRightRadius: i === cells.length - 1 ? 'var(--radius-pill)' : undefined,
              borderBottomRightRadius: i === cells.length - 1 ? 'var(--radius-pill)' : undefined,
            }}
          />
        );
      })}
    </div>
  );
}
