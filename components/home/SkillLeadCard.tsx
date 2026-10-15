'use client';

import { useEffect, useId, useState, type ReactNode } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { sharedFetch } from '@/lib/sharedRead';
import { recordEngagement } from '@/lib/engagement';
import { useRevealReady } from '@/components/primitives/Reveal';

/**
 * The lead's height at 400px, measured 2026-10-15 on the tallest state (the
 * club spread: a two-line headline, the three bars and the two-line ask, 160;
 * the trend and rated-once states measure 150, the plain one 90). The
 * card holds this height in every state — `min-height` on `.skill-lead`,
 * content centred — so a member's box never changes with their data and the
 * slot's placeholder is exact rather than a guess at the common case.
 */
export const SKILL_LEAD_HEIGHT = 160;

/** A self-rating is 1–5: every skill has five anchors (`lib/assessment.ts`),
 *  and the overall and dimension scores are averages of those ratings. */
const LEVEL_MAX = 5;

/** The trend line draws at most this many check-ins; more is a smear at 124px. */
const SPARK_POINTS = 6;

/**
 * The Home skill lead (`docs/plans/home-skill-lead.md`): a compact card under
 * the sign-up card that says what Stats already knows about this member, and
 * sells what is inside it.
 *
 * Rebuilt 2026-10-15 as an upsell (Grant, on the one-line version: "this
 * does not make sense, I would be like huh? … like an actual upsell"; then
 * "too tall … a quarter or half"). Every state is one tappable card in three
 * rows at most: a headline in words, the number with its picture, and either
 * the chips naming what Stats holds or the ask.
 *
 * Its states, and never a claim the read cannot back:
 *   - never rated: the club's average levels as bars, and "Add yours";
 *     below the cohort floor, "fewer than N" and no bars;
 *   - rated once: the level out of 5 and a dotted line to the next check-in;
 *   - rated twice or more: the level, the change since the previous one, and
 *     a line through the recent check-ins.
 * A read that fails renders the plain state — no number — rather than the
 * unrated one, because a failed read is not evidence of anything.
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
  | { kind: 'once'; level: number; at: string }
  | { kind: 'trend'; level: number; delta: number; since: string; points: number[] }
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
    return {
      kind: 'trend',
      level: latest.overall as number,
      delta: (latest.overall as number) - (previous.overall as number),
      since: previous.takenAt,
      points: rated.slice(-SPARK_POINTS).map((s) => s.overall as number),
    };
  }
  if (rated.length === 1) return { kind: 'once', level: rated[0].overall as number, at: rated[0].takenAt };
  if (snapshots.length > 0) return { kind: 'plain' }; // rated, but no overall to quote
  if (!bands) return { kind: 'unrated' };
  if (bands.cohort < bands.minCohort) return { kind: 'first', min: bands.minCohort };
  const m = bands.dimensionMedians;
  if (!isNum(m.technical) || !isNum(m.physical) || !isNum(m.mental)) return { kind: 'unrated' };
  return { kind: 'spread', cohort: bands.cohort, technical: m.technical, physical: m.physical, mental: m.mental };
}

/** Where each check-in sits in the 124×44 trend box. The vertical range is the
 *  points' own spread plus a margin, never the full 1–5 scale: a 0.3 move on a
 *  four-point axis is a flat line, and the line is there to show the move. */
export function sparkPoints(values: number[]): { x: number; y: number }[] {
  const W = 124, H = 44, PAD = 6;
  const lo = Math.min(...values), hi = Math.max(...values);
  const span = Math.max(hi - lo, 0.5);
  const mid = (lo + hi) / 2;
  const step = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  return values.map((v, i) => ({
    x: PAD + i * step,
    y: H / 2 - ((v - mid) / span) * (H - PAD * 2),
  }));
}

function Chevron() {
  return <span className="material-icons skill-lead-chevron" aria-hidden="true">chevron_right</span>;
}

function Chips({ t }: { t: ReturnType<typeof useTranslations> }) {
  return (
    <span className="skill-lead-chips">
      <span className="skill-lead-chip"><span className="material-icons" aria-hidden="true">fitness_center</span>{t('chipDrill')}</span>
      <span className="skill-lead-chip"><span className="material-icons" aria-hidden="true">bar_chart</span>{t('chipRecord')}</span>
      <span className="skill-lead-chip"><span className="material-icons" aria-hidden="true">sports_tennis</span>{t('chipRacket')}</span>
    </span>
  );
}

function TrendLine({ values }: { values: number[] }) {
  const gid = useId();
  const pts = sparkPoints(values);
  const last = pts[pts.length - 1];
  const line = pts.map((p) => `${p.x},${p.y}`).join(' ');
  const area = `M${pts[0].x},44 ${pts.map((p) => `L${p.x},${p.y}`).join(' ')} L${last.x},44 Z`;
  return (
    <svg className="skill-lead-spark" width="124" height="44" viewBox="0 0 124 44" aria-hidden="true">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" className="skill-lead-spark-stop" stopOpacity="0.32" />
          <stop offset="1" className="skill-lead-spark-stop" stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${gid})`} />
      <polyline points={line} className="skill-lead-spark-line" />
      {pts.slice(0, -1).map((p, i) => <circle key={i} cx={p.x} cy={p.y} r="3" className="skill-lead-spark-dot" />)}
      <circle cx={last.x} cy={last.y} r="7" className="skill-lead-spark-halo" />
      <circle cx={last.x} cy={last.y} r="3.75" className="skill-lead-spark-now" />
    </svg>
  );
}

function NextLine() {
  return (
    <svg className="skill-lead-spark" width="124" height="44" viewBox="0 0 124 44" aria-hidden="true">
      <line x1="10" y1="22" x2="106" y2="22" className="skill-lead-spark-next" />
      <circle cx="9" cy="22" r="7" className="skill-lead-spark-halo" />
      <circle cx="9" cy="22" r="3.75" className="skill-lead-spark-now" />
      <circle cx="114" cy="22" r="7" className="skill-lead-spark-open" />
      <path d="M111 22h6M114 19v6" className="skill-lead-spark-plus" />
    </svg>
  );
}

export default function SkillLeadCard({ name, club, onOpen }: { name: string; club: string; onOpen: () => void }) {
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
          // A failed bands read leaves `bands` null: the unrated state makes
          // no claim about the group, so it is honest without one.
          try {
            const b = await sharedFetch(`/api/stats/club/bands?name=${q}`);
            if (b.ok) bands = (await b.json()) as Bands;
          } catch { /* unrated state, no number */ }
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
  const addYours = t.rich('addYours', { b: (chunks) => <span className="skill-lead-strong">{chunks}</span> });

  const header = (title: string) => (
    <span className="skill-lead-head">
      <span className="skill-lead-title">{title}</span>
      <Chevron />
    </span>
  );
  const level = (value: number, sub: ReactNode, picture: ReactNode) => (
    <span className="skill-lead-body">
      <span className="skill-lead-figure">
        <span className="skill-lead-level-row">
          <span className="skill-lead-level">{one(value)}</span>
          <span className="skill-lead-outof">{t('outOf', { max: LEVEL_MAX })}</span>
        </span>
        {sub}
      </span>
      {picture}
    </span>
  );

  let content: ReactNode;
  switch (lead.kind) {
    case 'spread': {
      const dims = [
        { key: 'technical', label: t('dimTechnical'), value: lead.technical },
        { key: 'physical', label: t('dimPhysical'), value: lead.physical },
        { key: 'mental', label: t('dimMental'), value: lead.mental },
      ];
      content = (
        <>
          {header(t('spreadTitle', { club }))}
          <span className="skill-lead-dims">
            {dims.map((d) => (
              <span key={d.key} className="skill-lead-dim">
                <span className="skill-lead-dim-row">
                  <span className="skill-lead-dim-label">{d.label}</span>
                  <span className="skill-lead-dim-value">{one(d.value)}</span>
                </span>
                <span className="skill-lead-track">
                  <span className="skill-lead-fill" style={{ width: `${Math.min(100, Math.max(0, (d.value / LEVEL_MAX) * 100))}%` }} />
                </span>
              </span>
            ))}
          </span>
          <span className="skill-lead-foot">{addYours}</span>
        </>
      );
      break;
    }
    case 'first':
      content = (
        <>
          {header(t('firstTitle', { club, min: lead.min }))}
          <span className="skill-lead-foot">{addYours}</span>
        </>
      );
      break;
    case 'unrated':
      content = (
        <>
          {header(t('unratedTitle'))}
          <span className="skill-lead-foot">{addYours}</span>
        </>
      );
      break;
    case 'once':
      content = (
        <>
          {header(t('onceTitle'))}
          {level(lead.level, <span className="skill-lead-delta">{t('onceSub', { month: month(lead.at) })}</span>, <NextLine />)}
          <Chips t={t} />
        </>
      );
      break;
    case 'trend': {
      const dir = Math.abs(lead.delta) < 0.05 ? 'flat' : lead.delta > 0 ? 'up' : 'down';
      const delta = one(Math.abs(lead.delta));
      const since = month(lead.since);
      const title = dir === 'up' ? t('upTitle') : dir === 'down' ? t('downTitle') : t('flatTitle');
      const sub = dir === 'up' ? t('deltaUp', { delta, month: since })
        : dir === 'down' ? t('deltaDown', { delta, month: since })
          : t('deltaFlat', { month: since });
      content = (
        <>
          {header(title)}
          {level(lead.level, <span className={dir === 'up' ? 'skill-lead-delta is-up' : 'skill-lead-delta'}>{sub}</span>, <TrendLine values={lead.points} />)}
          <Chips t={t} />
        </>
      );
      break;
    }
    default:
      content = (
        <>
          {header(t('plainTitle'))}
          <Chips t={t} />
        </>
      );
  }

  const open = () => {
    void recordEngagement('stats_open', { source: 'home' });
    onOpen();
  };

  return (
    // No fade of its own: Home's RevealSlot fades it in, in order.
    <button type="button" onClick={open} className="glass-card skill-lead">
      {content}
    </button>
  );
}
