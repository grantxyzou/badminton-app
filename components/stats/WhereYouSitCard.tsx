'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { SKILLS, topStrengths, workOnNext, type Rating } from '@/lib/assessment';
import type { Band } from '@/lib/clubBands';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

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

interface Snapshot {
  takenAt: string;
  ratings: Rating[];
}

type Load = 'loading' | 'ready' | 'error';

const SKILL_LABEL = new Map(SKILLS.map((s) => [s.key, s.label]));

export interface WhereYouSitCardProps {
  activeName: string | null;
  /**
   * True while the first-run consent sheet is open. The card must render its
   * unrevealed state then — see the note on `revealed` below.
   */
  promptOpen?: boolean;
}

export default function WhereYouSitCard({ activeName, promptOpen = false }: WhereYouSitCardProps) {
  const t = useTranslations('stats.club');
  const [bands, setBands] = useState<ClubBands | null>(null);
  const [ratings, setRatings] = useState<Rating[]>([]);
  const [status, setStatus] = useState<Load>('loading');

  useEffect(() => {
    if (!activeName) return;
    const n = encodeURIComponent(activeName);
    let live = true;
    const get = (url: string) =>
      fetch(`${BASE}${url}`, { cache: 'no-store' }).then((r) =>
        r.ok ? r.json() : Promise.reject(new Error(String(r.status))),
      );

    Promise.all([get(`/api/stats/club/bands?name=${n}`), get(`/api/assessments?name=${n}`)])
      .then(([b, a]) => {
        if (!live) return;
        setBands(b as ClubBands);
        const snaps = (a?.assessments ?? []) as Snapshot[];
        setRatings(snaps[snaps.length - 1]?.ratings ?? []);
        setStatus('ready');
      })
      .catch(() => live && setStatus('error'));

    return () => {
      live = false;
    };
  }, [activeName]);

  if (!activeName) return null;
  if (status === 'loading') return <CardSkeleton height={180} />;
  if (status === 'error') {
    // A failed read is NOT the same as "too few people" — say so out loud
    // rather than silently vanishing, which would look identical to the
    // legitimate below-cohort case.
    return (
      <div className="glass-card p-5">
        <ErrorState message={t('error')} />
      </div>
    );
  }

  // Below the cohort minimum the card is absent entirely, not empty.
  if (!bands || bands.cohort < bands.minCohort) return null;

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
    <div className="glass-card p-5 space-y-3">
      <CardHeader
        icon="groups"
        title={t('title')}
        badge={
          revealed ? undefined : (
            <span
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: 5,
                borderRadius: 'var(--radius-pill)',
                fontSize: 'var(--fs-2xs)',
                padding: '3px 9px',
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
        <p style={{ margin: 0, fontSize: 'var(--fs-md)', lineHeight: 1.5, color: 'var(--text-primary)' }}>
          {picked.length === 1
            ? t.rich('ledeOne', {
                band: bandLabel(bandOf.get(picked[0]) as Band),
                skill: SKILL_LABEL.get(picked[0]) ?? picked[0],
                hi: emphasis,
              })
            : t.rich('ledeTwo', {
                band1: bandLabel(bandOf.get(picked[0]) as Band),
                skill1: SKILL_LABEL.get(picked[0]) ?? picked[0],
                band2: bandLabel(bandOf.get(picked[1]) as Band),
                skill2: SKILL_LABEL.get(picked[1]) ?? picked[1],
                hi: emphasis,
              })}
        </p>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
        {picked.map((key) => (
          <div key={key}>
            <p style={{ margin: '0 0 5px', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
              {SKILL_LABEL.get(key) ?? key}
            </p>
            <BandBar band={revealed ? (bandOf.get(key) as Band) : null} />
          </div>
        ))}
      </div>

      <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)' }}>
        {revealed ? t('footnote') : t('footnotePrivate')}
      </p>
    </div>
  );
}

/** Three segments; `null` fills none — the unrevealed / club-spread state. */
function BandBar({ band }: { band: Band | null }) {
  const cells: Band[] = ['bottom', 'middle', 'top'];
  return (
    <div style={{ display: 'flex', gap: 3, height: 10 }}>
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
