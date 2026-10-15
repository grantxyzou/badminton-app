'use client';

import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { sharedFetch } from '@/lib/sharedRead';
import { recordEngagement } from '@/lib/engagement';
import { useRevealReady } from '@/components/primitives/Reveal';

/**
 * The lead's height at 400px (2026-10-14), measured with the fact line
 * wrapped to TWO lines, which most states do (the spread, the first-rating
 * and the unrated lines in both locales); the trend and plain lines fit in
 * one. The card holds this height in every state — `minHeight` below, content
 * centred — so a member's box never changes with their data and the slot's
 * placeholder is exact rather than a guess at the common case.
 */
export const SKILL_LEAD_HEIGHT = 89;

/**
 * The Home skill lead (`docs/plans/home-skill-lead.md`): one line under the
 * sign-up card that says what Stats already knows about this member, and
 * one accent line that takes them there.
 *
 * It shows for every identified member, every week, with no dismiss. The
 * card it replaced retired itself on the first rating or the first dismiss,
 * so the one thing worth showing a rated member — the change — could never
 * appear; `reach` sat at 0.47 with it on screen.
 *
 * Three states, one line each, and never a claim the read cannot back:
 *   - never rated: the club spread (everyone's, served without consent) and
 *     the ask; below the cohort floor, "fewer than N" and no medians;
 *   - rated once: the level, and that a second rating shows the change;
 *   - rated twice or more: the level and the change since the previous one.
 * A read that fails renders the plain line — no number — rather than the
 * "unrated" line, because a failed read is not evidence of anything.
 *
 * Both reads go through `sharedFetch`, so Stats, opened a tap later, pays
 * nothing extra for the same two requests. The tap stamps
 * `stats_open { source: 'home' }` so slice0 can tell a Stats open the card
 * led from one it did not.
 */
type Lead =
  | { kind: 'loading' }
  | { kind: 'spread'; cohort: number; technical: number; physical: number; mental: number }
  | { kind: 'first'; min: number }
  | { kind: 'unrated' }
  | { kind: 'once'; level: number }
  | { kind: 'trend'; level: number; delta: number; since: string }
  | { kind: 'plain' };

interface Snapshot { takenAt: string; overall: number | null }
interface Bands { cohort: number; minCohort: number; dimensionMedians: Record<'technical' | 'physical' | 'mental', number | null> }

function isNum(v: unknown): v is number { return typeof v === 'number' && Number.isFinite(v); }

/** The lead for a member whose history has been read; the bands only matter
 *  when there is none. Exported for its own test — the card is the thin part. */
export function leadFor(snapshots: Snapshot[], bands: Bands | null): Lead {
  const rated = snapshots.filter((s) => isNum(s.overall));
  if (rated.length >= 2) {
    const latest = rated[rated.length - 1];
    const previous = rated[rated.length - 2];
    return { kind: 'trend', level: latest.overall as number, delta: (latest.overall as number) - (previous.overall as number), since: previous.takenAt };
  }
  if (rated.length === 1) return { kind: 'once', level: rated[0].overall as number };
  if (snapshots.length > 0) return { kind: 'plain' }; // rated, but no overall to quote
  if (!bands) return { kind: 'unrated' };
  if (bands.cohort < bands.minCohort) return { kind: 'first', min: bands.minCohort };
  const m = bands.dimensionMedians;
  if (!isNum(m.technical) || !isNum(m.physical) || !isNum(m.mental)) return { kind: 'unrated' };
  return { kind: 'spread', cohort: bands.cohort, technical: m.technical, physical: m.physical, mental: m.mental };
}

export default function SkillLeadCard({ name, onOpen }: { name: string; onOpen: () => void }) {
  const t = useTranslations('home.skillLead');
  const locale = useLocale();
  const [lead, setLead] = useState<Lead>({ kind: 'loading' });

  useEffect(() => {
    let cancelled = false;
    const q = encodeURIComponent(name);
    (async () => {
      try {
        const res = await sharedFetch(`/api/assessments?name=${q}`);
        if (!res.ok) throw new Error(String(res.status));
        const d = (await res.json()) as { assessments?: Snapshot[] };
        const snapshots = Array.isArray(d.assessments) ? d.assessments : [];
        let bands: Bands | null = null;
        if (snapshots.length === 0) {
          // The spread is only worth a request for someone with no history.
          // A failed bands read leaves `bands` null: the unrated line makes
          // no claim about the group, so it is honest without one.
          try {
            const b = await sharedFetch(`/api/stats/club/bands?name=${q}`);
            if (b.ok) bands = (await b.json()) as Bands;
          } catch { /* unrated line, no number */ }
        }
        if (!cancelled) setLead(leadFor(snapshots, bands));
      } catch {
        if (!cancelled) setLead({ kind: 'plain' });
      }
    })();
    return () => { cancelled = true; };
  }, [name]);

  useRevealReady(lead.kind !== 'loading', false);
  if (lead.kind === 'loading') return null;

  const one = (n: number) => n.toFixed(1);
  const month = (iso: string) => new Intl.DateTimeFormat(locale, { month: 'long' }).format(new Date(iso));
  let line: string;
  let cta: string;
  switch (lead.kind) {
    case 'spread':
      line = t('spread', { cohort: lead.cohort, technical: one(lead.technical), physical: one(lead.physical), mental: one(lead.mental) });
      cta = t('ctaRate');
      break;
    case 'first':
      line = t('first', { min: lead.min });
      cta = t('ctaRate');
      break;
    case 'unrated':
      line = t('unrated');
      cta = t('ctaRate');
      break;
    case 'once':
      line = t('once', { level: one(lead.level) });
      cta = t('ctaAgain');
      break;
    case 'trend': {
      const key = Math.abs(lead.delta) < 0.05 ? 'flat' : lead.delta > 0 ? 'up' : 'down';
      line = t(key, { level: one(lead.level), delta: one(Math.abs(lead.delta)), month: month(lead.since) });
      cta = t('ctaTrend');
      break;
    }
    default:
      line = t('plain');
      cta = t('ctaStats');
  }

  const open = () => {
    void recordEngagement('stats_open', { source: 'home' });
    onOpen();
  };

  return (
    // No fade of its own: Home's RevealSlot fades it in, in order.
    <button
      type="button"
      onClick={open}
      className="glass-card skill-lead p-4"
      style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-4)', width: '100%', minHeight: SKILL_LEAD_HEIGHT, textAlign: 'left', cursor: 'pointer' }}
    >
      <span className="material-icons" aria-hidden="true" style={{ fontSize: 'var(--icon-lg)', color: 'var(--accent, #22c55e)', flexShrink: 0 }}>
        trending_up
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: 'block', fontSize: 'var(--fs-md)', color: 'var(--text-primary)', fontWeight: 600, lineHeight: 'var(--lh-snug)' }}>
          {line}
        </span>
        <span style={{ display: 'block', fontSize: 'var(--fs-base)', color: 'var(--accent, #22c55e)', marginTop: 'var(--space-05)', fontWeight: 600 }}>
          {cta} →
        </span>
      </span>
    </button>
  );
}
