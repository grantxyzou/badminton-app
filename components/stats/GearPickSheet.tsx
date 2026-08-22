'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import StatusBadge from '@/components/primitives/StatusBadge';
import { isFlagOn } from '@/lib/flags';
import { BottomSheet, BottomSheetHeader, BottomSheetBody } from '../BottomSheet';
import type { GearPick } from './GearPickCard';
import type { UseGear } from './useGear';
import type { CatalogItem, EquipmentCategory } from '@/lib/types';

export interface GearPickSheetProps {
  open: boolean;
  onClose: () => void;
  category: EquipmentCategory;
  /** The rail card's resolved recommendation — LIVE, not frozen at open time,
   *  because the format/budget controls below are supposed to change it. Null
   *  means the pick stopped resolving while the sheet was open; the sheet
   *  renders an error rather than unmounting itself. */
  pick: GearPick | null;
  /** True when the pick is already in the member's kit — the Add action is
   *  replaced by the IN YOUR KIT badge rather than offered and then refused. */
  owned: boolean;
  /** The register's single `UseGear`. Adding goes through the SAME owner as
   *  every other gear surface, which is why the rail card flips to IN YOUR KIT
   *  and the kit row fills in without a reload. */
  gear: UseGear;
}

/**
 * The spec sheet: the attributes a member checks before buying, each with a
 * label.
 *
 * This used to be `Object.values(attrs).join(' · ')` — every field the catalog
 * carries, unlabelled, in key order. On a racket that was merely dense. On a
 * string it printed twenty-eight values including bare sub-ratings
 * ("· 8 · 8 · 7 · 7 ·"), the reel length, the colour list, and the maintenance
 * fields `ratingSource` and `lastVerified`. A spec sheet nobody can read is
 * not a spec sheet, and the stated job of this half of the sheet is to be
 * "what they check afterwards".
 *
 * Curated per category rather than blocklisted, so a new catalog field is
 * invisible here until someone decides it belongs — the safe direction. A
 * category with no list falls back to the old dump.
 */
const SPEC_ROWS: Partial<Record<EquipmentCategory, Array<{ labelKey: string; render: (a: Record<string, string | number>) => string | null }>>> = {
  racket: [
    { labelKey: 'specWeight', render: (a) => (a.weight ? String(a.weight) : null) },
    { labelKey: 'specBalance', render: (a) => (a.balance ? String(a.balance) : null) },
    { labelKey: 'specFlex', render: (a) => (a.flex ? String(a.flex) : null) },
    { labelKey: 'specStyle', render: (a) => (a.playStyle ? String(a.playStyle) : null) },
    { labelKey: 'specTension', render: (a) => tensionRange(a) },
  ],
  string: [
    { labelKey: 'specGauge', render: (a) => (typeof a.gaugeMm === 'number' ? `${a.gaugeMm.toFixed(2)}mm` : null) },
    { labelKey: 'specType', render: (a) => (a.stringType ? String(a.stringType) : null) },
    { labelKey: 'specFeel', render: (a) => (a.feel ? String(a.feel) : null) },
    { labelKey: 'specTension', render: (a) => tensionRange(a) },
    { labelKey: 'specRepulsion', render: (a) => (typeof a.repulsion === 'number' ? `${a.repulsion}/10` : null) },
    { labelKey: 'specDurability', render: (a) => (typeof a.durability === 'number' ? `${a.durability}/10` : null) },
    { labelKey: 'specLevel', render: (a) => (a.skillLevel ? String(a.skillLevel) : null) },
  ],
};

function tensionRange(a: Record<string, string | number>): string | null {
  const lo = a.tensionMinLbs;
  const hi = a.tensionMaxLbs;
  if (typeof lo !== 'number' || typeof hi !== 'number') return null;
  return `${lo}–${hi} lb`;
}

/** Fallback for a category with no curated list — the old behaviour. */
function specLine(item: CatalogItem): string {
  const attrs = item.attributes ?? {};
  return Object.values(attrs).map(String).filter(Boolean).join(' · ');
}

/**
 * "Take our pick" — the detail behind one rail card, and one action.
 *
 * The sibling `GearSheet` is "choose your own": the whole catalog for a
 * category. Two doors, two rooms. This sheet never browses; it explains a
 * single recommendation and offers to add it.
 *
 * Order is plain language first, spec sheet second: the reason we picked it is
 * what a member can act on, and the attribute string is what they check
 * afterwards. Warnings are never collapsed away — a safety flag that needs a
 * tap to reveal is a safety flag that does not exist.
 */
export default function GearPickSheet({ open, onClose, category, pick, owned, gear }: GearPickSheetProps) {
  const t = useTranslations('stats.gear');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const [addError, setAddError] = useState<string | null>(null);
  const [prefError, setPrefError] = useState(false);

  // The rail keeps this sheet MOUNTED for the whole register's life (it is the
  // one sheet for every card), so a refusal from one visit would still be on
  // screen at the next unless it is cleared on the way out. Every exit route —
  // the close button, Escape via BottomSheet, and a successful add — goes
  // through here.
  function close() {
    setAddError(null);
    setPrefError(false);
    onClose();
  }

  const item = pick?.item ?? null;
  const heading = item ? `${item.brand} ${item.model}` : t('pickSheetWeRecommend');

  // The engine's headline reason IS the plain-language line (it's the same
  // string `/api/recommend` returns as `reason`), so the WHY THIS block lists
  // what's left rather than repeating it back one line lower.
  const reasons = pick?.reasons ?? [];
  const headline = reasons[0] ?? null;
  const rest = reasons.slice(1);
  const warnings = pick?.warnings ?? [];
  const hasWhy = rest.length > 0 || warnings.length > 0;

  // The two preferences the scoring engine actually reads. They live here, next
  // to the recommendation they tune — putting configuration above the answer
  // made the old surface open on settings instead of on its own question.
  // Only the skill-scored engine consumes them, so the controls follow its flag
  // rather than the sheet's.
  const recommenderOn = isFlagOn('NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER');
  const playFormat = gear.gear?.playFormat ?? 'both';
  const budgetMaxCad = gear.gear?.budgetMaxCad ?? null;

  async function setPref(prefs: { playFormat?: 'singles' | 'doubles' | 'both'; budgetMaxCad?: number | null }) {
    setPrefError(false);
    const res = await gear.setPrefs(prefs);
    if (!res.ok) setPrefError(true);
  }

  async function add() {
    if (!item || gear.busy) return;
    setAddError(null);
    const res = await gear.add(item);
    if (res.ok) {
      close();
      return;
    }
    // `duplicate_racket` is unreachable from here (an owned pick shows the
    // badge, not the button) but is still mapped rather than flattened, so a
    // bag that fills some other way says so instead of reading as a crash.
    if (res.reason === 'bag_full') setAddError(t('pickSheetBagFull'));
    else if (res.reason === 'duplicate_racket') setAddError(t('pickSheetDuplicate'));
    else setAddError(t('pickSheetAddError'));
  }

  const header = (
    <BottomSheetHeader>
      <span
        className="fs-2xs"
        style={{ color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}
      >
        {t('pickSheetWeRecommend')}
      </span>
      <button
        type="button"
        onClick={close}
        aria-label={tRecovery('close')}
        style={{
          background: 'transparent',
          border: 'none',
          cursor: 'pointer',
          minWidth: 44,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
        }}
      >
        <span className="material-icons" style={{ fontSize: 'var(--fs-stat)' }}>close</span>
      </button>
    </BottomSheetHeader>
  );

  // Rendered BELOW the action, not above it: these tune the NEXT pick, and
  // putting them first would make the sheet open on settings instead of on the
  // answer to its own question.
  //
  // Extracted so the error branch below can render them too. They are what
  // changes the gear doc, so they are also what can make the pick stop
  // resolving — dropping them exactly then would persist a new budget and
  // leave no surface anywhere to change it back (the rail card behind this
  // sheet is a non-interactive div in its error state).
  const controls = recommenderOn && category === 'racket' ? (
    <>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p className="section-label" style={{ margin: 0 }}>{t('formatLabel')}</p>
        <div className="segment-control flex" role="tablist" aria-label={t('formatLabel')}>
          {(['doubles', 'singles', 'both'] as const).map((f) => (
            <button
              key={f}
              type="button"
              role="tab"
              aria-selected={playFormat === f}
              disabled={gear.busy}
              className={`flex-1 flex items-center justify-center fs-sm ${playFormat === f ? 'segment-tab-active' : 'segment-tab-inactive'}`}
              onClick={() => setPref({ playFormat: f })}
            >
              {t(`format_${f}`)}
            </button>
          ))}
        </div>
      </section>

      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p className="section-label" style={{ margin: 0 }}>{t('budgetLabel')}</p>
        <div className="segment-control flex" role="tablist" aria-label={t('budgetLabel')}>
          {([
            [100, 'budget_100'],
            [200, 'budget_200'],
            [350, 'budget_350'],
            [null, 'budget_none'],
          ] as const).map(([band, key]) => (
            <button
              key={key}
              type="button"
              role="tab"
              aria-selected={budgetMaxCad === band}
              disabled={gear.busy}
              className={`flex-1 flex items-center justify-center fs-sm ${budgetMaxCad === band ? 'segment-tab-active' : 'segment-tab-inactive'}`}
              onClick={() => setPref({ budgetMaxCad: band })}
            >
              {t(key)}
            </button>
          ))}
        </div>
      </section>

      {prefError && <ErrorState message={t('pickSheetAddError')} />}
    </>
  ) : null;

  // The pick this sheet was opened for is no longer resolvable — a refetch
  // triggered by the controls came back empty, throttled or failed. The sheet
  // stays mounted and says so. Unmounting instead would make it vanish under
  // the member's finger with no explanation, which is the sheet-shaped version
  // of the lying empty state.
  if (!item) {
    return (
      <BottomSheet open={open} onClose={close} ariaLabel={heading} maxHeight="88dvh">
        {header}
        <BottomSheetBody>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
            <ErrorState message={t('pickSheetLoadError')} />
            {controls}
          </div>
        </BottomSheetBody>
      </BottomSheet>
    );
  }

  return (
    <BottomSheet open={open} onClose={close} ariaLabel={heading} maxHeight="88dvh">
      {header}

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-1)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span
                style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 'var(--fs-stat)',
                  fontWeight: 600,
                  lineHeight: 'var(--lh-snug)',
                  color: 'var(--text-primary)',
                }}
              >
                {item.model}
              </span>
              {owned && <StatusBadge variant="accent">{t('railInKit')}</StatusBadge>}
            </span>
            <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>
              {item.brand}
              {typeof item.msrp === 'number' && item.msrp > 0 && (
                <>
                  {' · '}
                  <span style={{ fontFamily: 'var(--font-mono)' }}>${item.msrp}</span>
                </>
              )}
            </span>
          </div>

          {/* Plain language first. */}
          {headline && (
            <p style={{ margin: 0, fontSize: 'var(--fs-md)', lineHeight: 'var(--lh-normal)', color: 'var(--text-primary)' }}>
              {headline}
            </p>
          )}

          {/* Spec sheet second. */}
          {(() => {
            const rows = (SPEC_ROWS[item.category] ?? [])
              .map((r) => ({ labelKey: r.labelKey, value: r.render(item.attributes ?? {}) }))
              .filter((r): r is { labelKey: string; value: string } => Boolean(r.value));

            if (rows.length === 0) {
              return specLine(item) ? (
                <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{specLine(item)}</p>
              ) : null;
            }

            return (
              <dl
                style={{
                  margin: 0,
                  display: 'grid',
                  gridTemplateColumns: 'auto 1fr',
                  columnGap: 'var(--space-4)',
                  rowGap: 'var(--space-1)',
                }}
              >
                {rows.map((r) => (
                  <Fragment key={r.labelKey}>
                    <dt style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{t(r.labelKey)}</dt>
                    <dd style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                      {r.value}
                    </dd>
                  </Fragment>
                ))}
              </dl>
            );
          })()}

          {/* D2: the pair-specific tension. Shown here and not in
              StringTensionCard because it is the more specific answer — placed
              inside THIS string's overlap with THAT frame, rather than derived
              from level alone. Absent, not zero, when the frame publishes no
              ceiling: there is no honest placeholder for a number we do not
              have. */}
          {typeof pick?.tensionLbs === 'number' && (
            <section
              style={{
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--inner-card-border)',
                background: 'var(--inner-card-bg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              <p className="section-label" style={{ margin: 0 }}>{t('pickSheetTension')}</p>
              <p style={{ margin: 0, color: 'var(--text-primary)' }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 'var(--fs-stat)', fontWeight: 600 }}>
                  {pick.tensionLbs}
                </span>
                <span style={{ marginLeft: 'var(--space-1)', fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                  {t('lb')}
                </span>
              </p>
              {/* Never a bare figure — the advisory is what keeps this a
                  conversation with a stringer instead of an instruction. */}
              <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
                {t('tensionAdvisory')}
              </p>
            </section>
          )}

          {hasWhy && (
            <section
              style={{
                borderRadius: 'var(--radius-lg)',
                border: '1px solid var(--inner-card-border)',
                background: 'var(--inner-card-bg)',
                padding: 'var(--space-4)',
                display: 'flex',
                flexDirection: 'column',
                gap: 'var(--space-2)',
              }}
            >
              <p className="section-label" style={{ margin: 0 }}>{t('pickSheetWhyThis')}</p>
              {rest.map((r, i) => (
                <p
                  key={`reason-${i}`}
                  style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}
                >
                  {r}
                </p>
              ))}
              {/* Never collapsed, never behind a tap. */}
              {warnings.map((w, i) => (
                <p
                  key={`warning-${i}`}
                  style={{ margin: 0, fontSize: 'var(--fs-sm)', lineHeight: 'var(--lh-normal)', color: 'var(--sev-warn)' }}
                >
                  {w}
                </p>
              ))}
            </section>
          )}

          {addError && <ErrorState message={addError} />}

          {owned ? (
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>
              {t('railInKitLine')}
            </p>
          ) : (
            <button type="button" className="cc-btn cc-btn-primary cc-btn-lg" disabled={!gear.online || gear.busy} onClick={add}>
              <span className="material-icons icon-sm" aria-hidden="true">add</span>
              {t('pickSheetAdd')}
            </button>
          )}

          {!gear.online && (
            <p style={{ margin: 0, fontSize: 'var(--fs-sm)', color: 'var(--text-muted)' }}>{tStats('offline')}</p>
          )}

          {controls}

          <p style={{ margin: 0, fontSize: 'var(--fs-xs)', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
            {t('pickSheetFootnote')}
          </p>
        </div>
      </BottomSheetBody>
    </BottomSheet>
  );
}
