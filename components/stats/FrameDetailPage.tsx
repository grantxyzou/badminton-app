'use client';

import { useEffect, useId, useMemo, useState, type ReactNode } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import TopBar from '@/components/primitives/TopBar';
import ErrorState from '@/components/primitives/ErrorState';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import { recordEngagement } from '@/lib/engagement';
import { racketSrc } from '@/lib/racketLook';
import { bandPosition, closeToFrame, frameHistory, specCells, type SpecCell } from '@/lib/frameDetail';
import { MAX_LB, MIN_LB } from '@/lib/tension';
import type { ClubTensionBand } from '@/lib/clubTension';
import type { FitFacts } from '@/lib/fitVerdict';
import type { CatalogItem, GearItem } from '@/lib/types';
import type { UseGear } from './useGear';
import { useCatalog } from './useCatalog';
import { useClubTension } from './useClubTension';
import { useFitVerdict } from './useFitVerdict';
import { useStatsTakeover } from './statsTakeover';

export interface FrameDetailPageProps {
  activeName: string | null;
  gear: UseGear;
  frameId: string;
  onBack: () => void;
  /** Another frame's page, from "Close to this one". */
  onOpenFrame: (frameId: string) => void;
  onOpenFit: () => void;
  /** The share sheet, offered only for the racket in play. */
  onShare?: () => void;
  /** The 3D view: the member's own racket when they own this model, else the catalog row. */
  onView3d: (owned: GearItem | null, row: CatalogItem) => void;
}

type Section = 'verdict' | 'tension' | 'strings' | 'close';

/** Axis labels under the chart: the fixed 20–30 lb scale in two-pound steps. */
const AXIS = Array.from({ length: (MAX_LB - MIN_LB) / 2 + 1 }, (_, i) => MIN_LB + i * 2);

/**
 * A racket's own page (design "Equipment redesign", Turn 3, 3d): what the
 * frame is, what it typically costs, and the four things this app knows that a
 * retailer does not. One layout for everyone; only the rows about the member
 * change with ownership, and a row with nothing honest to say is not drawn
 * (Strings, for a racket you do not own).
 *
 * The spec card paints from the catalog before any member read lands; only the
 * row summaries wait, each as a one-line skeleton.
 */
export default function FrameDetailPage({ activeName, gear, frameId, onBack, onOpenFrame, onOpenFit, onShare, onView3d }: FrameDetailPageProps) {
  const t = useTranslations('stats.gear.framePage');
  useStatsTakeover(true);
  const rackets = useCatalog('racket');
  const row = rackets.items.find((r) => r.id === frameId) ?? null;

  const known = gear.loaded && !gear.loadError;
  const history = useMemo(() => frameHistory(known ? gear.gear : null, frameId), [known, gear.gear, frameId]);
  const verdict = useFitVerdict(activeName, known ? gear.gear : null, known, frameId);
  const club = useClubTension(frameId);
  const close = useMemo(() => (row ? closeToFrame(row, rackets.items) : []), [row, rackets.items]);
  const [open, setOpen] = useState<Section | null>(null);

  useEffect(() => {
    // Keyed by the register per frame, so a new frame is a fresh page: nothing to reset here.
    window.scrollTo?.(0, 0);
    void recordEngagement('frame_page_opened', { catalogId: frameId });
  }, [frameId]);

  function toggle(section: Section) {
    setOpen((cur) => (cur === section ? null : section));
    if (open !== section) void recordEngagement('frame_section_expanded', { catalogId: frameId });
  }

  if (!row) {
    return (
      <div className="animate-slideInRight fit-page">
        <TopBar title="" onBack={onBack} backLabel={t('back')} />
        {rackets.loadError ? <ErrorState message={t('verdictError')} /> : <CardSkeleton height={320} />}
      </div>
    );
  }

  const owned = history.owned;

  return (
    <div className="animate-slideInRight fit-page">
      <TopBar title={row.model} onBack={onBack} backLabel={t('back')} />

      <div className="glass-card p-5 frame-identity-card">
        <div className="frame-identity">
          <button type="button" className="frame-tile" onClick={() => onView3d(owned, row)} aria-label={t('view3d')}>
            {/* eslint-disable-next-line @next/next/no-img-element -- a pre-rendered local WebP of the 3D model. */}
            <img src={racketSrc(row.id)} alt="" />
          </button>
          <div className="frame-identity-text">
            <h2 className="frame-name">{row.model}</h2>
            <p className="frame-brand">{[row.brand, row.attributes?.unlisted ? t('noLongerSold') : null].filter(Boolean).join(' · ')}</p>
            <div className="frame-identity-actions">
              {owned && <span className="frame-pill">{t('inYourBag')}</span>}
              <button type="button" className="setup-link" onClick={() => onView3d(owned, row)}>{t('view3d')}</button>
              {history.inPlay && onShare && <button type="button" className="setup-link" onClick={onShare}>{t('share')}</button>}
            </div>
          </div>
        </div>
        <SpecGrid cells={specCells(row)} />
        {row.attributes?.priceMinUSD !== undefined && <p className="fit-caption">{t('priceCaption')}</p>}
      </div>

      <div className="glass-card frame-rows">
        <Disclosure section="verdict" open={open} onToggle={toggle} title={t('row_verdict')}
          summary={<VerdictSummary facts={verdict.data?.facts ?? null} error={verdict.error} known={known} owned={!!owned} />}
          tone={verdict.data && (verdict.data.facts.state === 'fighting' || verdict.data.facts.state === 'fighting_slightly') ? 'warn' : undefined}>
          <VerdictDetail facts={verdict.data?.facts ?? null} onOpenFit={onOpenFit} />
        </Disclosure>

        <Disclosure section="tension" open={open} onToggle={toggle} title={t('row_tension')}
          summary={<TensionSummary band={club.band} status={club.status} you={history.inPlay ? history.currentString?.tensionLbs ?? null : null} known={known} />}>
          <TensionDetail band={club.band} status={club.status} you={history.inPlay ? history.currentString?.tensionLbs ?? null : null}
            lastFour={history.lastFour} onSeeLog={owned ? () => setOpen('strings') : undefined} />
        </Disclosure>

        {owned && (
          <Disclosure section="strings" open={open} onToggle={toggle} title={t('row_strings')}
            summary={history.currentString
              ? t('strings_summary', { string: history.currentString.label, n: history.restrings.length })
              : history.restrings.length > 0 ? t('strings_summary', { string: history.restrings[0].stringLabel ?? t('stringUnknown'), n: history.restrings.length }) : t('strings_nothing')}>
            <StringsDetail history={history} />
          </Disclosure>
        )}

        <Disclosure section="close" open={open} onToggle={toggle} title={t('row_close')}
          summary={close.length ? close.map((c) => c.model).join(', ') : t('close_none')}>
          <div className="fit-ranked">
            {close.map((c) => (
              <button key={c.id} type="button" className="fit-rank-row frame-close-row" onClick={() => onOpenFrame(c.id)}>
                <span className="fit-rank-thumb" aria-hidden="true">
                  {/* eslint-disable-next-line @next/next/no-img-element -- a pre-rendered local WebP; next/image adds nothing at 24px. */}
                  <img src={racketSrc(c.id)} alt="" />
                </span>
                <span className="fit-rank-text">
                  <span className="fit-rank-name">{c.model}</span>
                  <span className="fit-caption">{[c.brand, c.attributes?.balance, c.attributes?.flex].filter(Boolean).join(' · ')}</span>
                </span>
                <span className="material-icons frame-row-chevron" aria-hidden="true">chevron_right</span>
              </button>
            ))}
          </div>
        </Disclosure>
      </div>

      <p className="fit-footnote">{t('footnote')}</p>
    </div>
  );
}

function SpecGrid({ cells }: { cells: SpecCell[] }) {
  const t = useTranslations('stats.gear.framePage');
  if (cells.length === 0) return null;
  return (
    <dl className="frame-specs">
      {cells.map((c, i) => (
        // An odd last cell spans both columns, or the 1px-gap hairline grid
        // would show a divider-coloured hole where a sixth cell should be.
        <div key={c.key} className={`frame-spec${cells.length % 2 === 1 && i === cells.length - 1 ? ' frame-spec--wide' : ''}`}>
          <dt>{t(`spec_${c.key}`)}</dt>
          <dd>{c.key === 'rated' ? ratedText(c, t) : c.value}</dd>
        </div>
      ))}
    </dl>
  );
}

function ratedText(c: SpecCell, t: (k: string, v?: Record<string, number>) => string): string {
  const [lo, hi] = c.bounds ?? [null, null];
  if (lo !== null && hi !== null) return t('ratedRange', { low: lo, high: hi });
  if (hi !== null) return t('ratedUpTo', { high: hi });
  return t('ratedFrom', { low: lo ?? 0 });
}

function Disclosure({ section, open, onToggle, title, summary, tone, children }: {
  section: Section; open: Section | null; onToggle: (s: Section) => void; title: string; summary: ReactNode; tone?: 'warn'; children: ReactNode;
}) {
  const id = useId();
  const isOpen = open === section;
  return (
    <div className={`frame-row${isOpen ? ' frame-row--open' : ''}`}>
      <button type="button" className="frame-row-head" aria-expanded={isOpen} aria-controls={id} onClick={() => onToggle(section)}>
        <span className="frame-row-text">
          <span className="frame-row-title">{title}</span>
          <span className={`frame-row-summary${tone === 'warn' ? ' frame-row-summary--warn' : ''}`}>{summary}</span>
        </span>
        <span className="material-icons frame-row-chevron" aria-hidden="true">{isOpen ? 'expand_less' : 'expand_more'}</span>
      </button>
      {/* Always mounted and collapsed by CSS (grid rows 0fr → 1fr), so the
          height and opacity transition goes through the global reduced-motion
          rule, as the handoff asks. `inert` keeps a closed row out of the tab order. */}
      <div id={id} className="frame-row-body" inert={!isOpen} aria-hidden={!isOpen}>
        <div className="frame-row-inner">{children}</div>
      </div>
    </div>
  );
}

function range(facts: FitFacts, t: (k: string, v?: Record<string, string | number>) => string): string {
  return facts.tensionRange ? t('ratedRange', { low: facts.tensionRange[0], high: facts.tensionRange[1] }) : '';
}

function VerdictSummary({ facts, error, known, owned }: { facts: FitFacts | null; error: boolean; known: boolean; owned: boolean }) {
  const t = useTranslations('stats.gear.framePage');
  if (!facts) {
    if (error) return <>{t('verdictError')}</>;
    void known;
    return <span className="shimmer-line frame-summary-skeleton" />;
  }
  if (facts.state === 'insufficient') return <>{t('verdict_insufficient')}</>;
  // "Would suit you" is for a racket you don't have. A spare in your bag is
  // judged the same way (it isn't strung in play, so no current tension), but
  // it is yours, and "would" under an "In your bag" pill reads as a mistake.
  const key = facts.prospective && !owned ? `verdictProspective_${facts.state}` : `verdict_${facts.state}`;
  return <>{t(key, { range: range(facts, t) })}</>;
}

function VerdictDetail({ facts, onOpenFit }: { facts: FitFacts | null; onOpenFit: () => void }) {
  const tFit = useTranslations('stats.gear.fitPage');
  const t = useTranslations('stats.gear.framePage');
  return (
    <>
      {facts && facts.state !== 'insufficient' && facts.reasons.length > 0 && (
        <ul className="fit-reasons">
          {facts.reasons.map((r) => (
            <li key={r.key} className={`fit-reason fit-reason--${r.polarity}`}>
              <span className="material-icons" aria-hidden="true">{r.polarity === 'plus' ? 'add' : 'remove'}</span>
              <span>{tFit(`reason_${r.key}`)}</span>
            </li>
          ))}
        </ul>
      )}
      {facts?.tensionRange && facts.state !== 'insufficient' && (
        <div className="fit-callout">
          <span className="fit-callout-label">{tFit('stringItAt')}</span>
          <span className="fit-callout-value">{range(facts, t)}</span>
        </div>
      )}
      <button type="button" className="setup-link" style={{ alignSelf: 'flex-start' }} onClick={onOpenFit}>{t('openFit')}</button>
    </>
  );
}

function TensionSummary({ band, status, you, known }: { band: ClubTensionBand | null; status: string; you: number | null; known: boolean }) {
  const t = useTranslations('stats.gear.framePage');
  if (status === 'loading' || !known) return <span className="shimmer-line frame-summary-skeleton" />;
  if (status === 'error') return <>{you !== null ? t('tension_you', { you }) : t('tensionError')}</>;
  if (band && you !== null) return <>{t('tension_bandYou', { low: band.low, high: band.high, you })}</>;
  if (band) return <>{t('tension_band', { low: band.low, high: band.high })}</>;
  if (you !== null) return <>{t('tension_you', { you })}</>;
  return <>{t('tension_none')}</>;
}

function TensionDetail({ band, status, you, lastFour, onSeeLog }: {
  band: ClubTensionBand | null; status: string; you: number | null; lastFour: number[]; onSeeLog?: () => void;
}) {
  const t = useTranslations('stats.gear.framePage');
  return (
    <>
      <TensionBandChart band={band} you={you} />
      <p className="fit-caption">
        {status === 'error' ? t('tensionError') : band ? t('bandExplainer', { n: band.sampleSize }) : t('bandExplainerNone')}
      </p>
      {lastFour.length > 0 && (
        <div className="frame-last-four">
          <span>{t('lastFour')}</span>
          <span className="fit-mono">{lastFour.join(' → ')}</span>
        </div>
      )}
      {onSeeLog && <button type="button" className="setup-link" style={{ alignSelf: 'flex-start' }} onClick={onSeeLog}>{t('seeFullLog')}</button>}
    </>
  );
}

/**
 * The club's band and the member's line on a FIXED 20–30 lb scale. Fixed on
 * purpose: a scale that fitted itself to the data would make every band look
 * equally wide. The band only draws from three members up (the aggregate
 * returns null below that).
 */
export function TensionBandChart({ band, you }: { band: ClubTensionBand | null; you: number | null }) {
  const t = useTranslations('stats.gear.framePage');
  const pct = (lbs: number) => `${(bandPosition(lbs) * 100).toFixed(2)}%`;
  return (
    <div className="frame-chart" role="img" aria-label={t('chartLabel')}>
      <div className="frame-chart-track">
        {band && (
          <span className="frame-chart-band" data-testid="club-band"
            style={{ left: pct(band.low), width: `${((bandPosition(band.high) - bandPosition(band.low)) * 100).toFixed(2)}%` }} />
        )}
        {you !== null && (
          <span className="frame-chart-you" data-testid="your-line" style={{ left: pct(you) }}>
            <span className="frame-chart-you-label">{t('chartYou', { you })}</span>
          </span>
        )}
      </div>
      <div className="frame-chart-axis" aria-hidden="true">
        {AXIS.map((lb) => <span key={lb}>{lb}</span>)}
      </div>
    </div>
  );
}

function StringsDetail({ history }: { history: ReturnType<typeof frameHistory> }) {
  const t = useTranslations('stats.gear.framePage');
  const format = useFormatter();
  if (history.restrings.length === 0) return <p className="fit-caption">{t('strings_empty')}</p>;
  return (
    <ul className="frame-log">
      {history.restrings.map((e, i) => {
        const date = format.dateTime(new Date(e.at), { month: 'short', day: 'numeric', year: 'numeric' });
        const string = e.stringLabel ?? t('stringUnknown');
        return (
          <li key={`${e.at}-${i}`}>
            {typeof e.tensionLbs === 'number' ? t('stringsEntryLbs', { date, string, lbs: e.tensionLbs }) : t('stringsEntry', { date, string })}
          </li>
        );
      })}
    </ul>
  );
}
