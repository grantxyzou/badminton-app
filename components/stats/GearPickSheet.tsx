'use client';

import { Fragment, useState } from 'react';
import { useTranslations } from 'next-intl';
import ErrorState from '@/components/primitives/ErrorState';
import StatusBadge from '@/components/primitives/StatusBadge';
import { isFlagOn } from '@/lib/flags';
import { BottomSheet, BottomSheetHeader, BottomSheetBody, BottomSheetFooter } from '../BottomSheet';
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
 * Everything here is ordered by what a member can act on:
 *
 *  - The REASON outranks the table. Seven mono spec rows used to sit between
 *    the name and the explanation, so the eye landed on "0.69mm" before it
 *    landed on why this string. The sentence is now the largest text in the
 *    body and the specs collapse behind a disclosure that says how many there
 *    are.
 *  - The ACTION is pinned. "Add to my kit" sat under roughly 700px of reading
 *    in the string case — a button most members never scrolled to. It lives in
 *    the sheet's footer now, filled rather than outlined.
 *  - The INPUTS are one quiet line. Format and budget generate the
 *    recommendation, so they belong above it, but they are set once: two
 *    labelled segment controls competing with the answer is the wrong weight
 *    for something you change twice a year.
 *  - There are no nested cards. SUGGESTED TENSION and WHY THIS were bordered
 *    boxes inside a box, against the rule that materials simplify inward.
 *  - Accent is spent on two things: the Change link and the button. Five green
 *    section labels left the green CTA no way to stand out.
 *
 * A successful add does NOT close the sheet. `owned` flips off the shared
 * `useGear`, so the button becomes the IN YOUR KIT badge in place — the state
 * change is the confirmation, and dismissing on success showed it to nobody.
 *
 * Two things are deliberately NOT collapsed or merged. `warnings` stay inline
 * and uncollapsed — a safety flag that needs a tap to reveal is a safety flag
 * that does not exist. And `provenance` is a separate field from `warnings`
 * precisely so it can join the muted caveat paragraph without taking real
 * warnings down with it (see `StringPairing.provenance`).
 */
export default function GearPickSheet({ open, onClose, category, pick, owned, gear }: GearPickSheetProps) {
  const t = useTranslations('stats.gear');
  // The two lapsed-session lines live with the other bag-write failures in
  // `valueHub`, alongside bagFull/bagDuplicate, rather than being duplicated.
  const tGearErr = useTranslations('valueHub');
  const tRecovery = useTranslations('recovery');
  const tStats = useTranslations('stats');
  const [addError, setAddError] = useState<string | null>(null);
  // Holds the MESSAGE, not a boolean. As a boolean it could only ever render
  // the generic add-failure line, so a refused preference write said
  // "couldn't add that" no matter what the server actually answered.
  const [prefError, setPrefError] = useState<string | null>(null);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [specsOpen, setSpecsOpen] = useState(false);

  // The rail keeps this sheet MOUNTED for the whole register's life (it is the
  // one sheet for every card), so a refusal from one visit would still be on
  // screen at the next unless it is cleared on the way out. Every exit route —
  // the close button, Escape via BottomSheet, and a successful add — goes
  // through here. The two disclosures reset for the same reason: a sheet that
  // reopens mid-scroll into an expanded spec table is not the sheet the next
  // card asked for.
  function close() {
    setAddError(null);
    setPrefError(null);
    setPrefsOpen(false);
    setSpecsOpen(false);
    onClose();
  }

  const item = pick?.item ?? null;
  const heading = item ? `${item.brand} ${item.model}` : t('pickSheetWeRecommend');

  // The engine's headline reason IS the plain-language line (it's the same
  // string `/api/recommend` returns as `reason`), so the reason list below it
  // shows what's left rather than repeating it back one line lower.
  const reasons = pick?.reasons ?? [];
  const headline = reasons[0] ?? null;
  const rest = reasons.slice(1);
  const warnings = pick?.warnings ?? [];

  // The two preferences the scoring engine actually reads. Only the
  // skill-scored engine consumes them, so the controls follow its flag rather
  // than the sheet's.
  const recommenderOn = isFlagOn('NEXT_PUBLIC_FLAG_GEAR_RECOMMENDER');
  // A failed or still-pending gear read means the stored preferences are
  // UNKNOWN. Lighting `both` / `no cap` out of the `??` fallbacks would assert
  // a setting the server never reported — the same unknown-as-confirmed bug
  // the rail's isOwned() had, and reachable the same way (a 500, or a 403 from
  // a member_session that hit its 30-day TTL while badminton_identity lived
  // on). `undefined` is the unknown sentinel because `null` is a real budget
  // value meaning "no cap", so it cannot double as "we don't know".
  const prefsKnown = gear.loaded && !gear.loadError;
  const playFormat = prefsKnown ? (gear.gear?.playFormat ?? 'both') : null;
  const budgetMaxCad = prefsKnown ? (gear.gear?.budgetMaxCad ?? null) : undefined;

  async function setPref(prefs: { playFormat?: 'singles' | 'doubles' | 'both'; budgetMaxCad?: number | null }) {
    setPrefError(null);
    const res = await gear.setPrefs(prefs);
    if (res.ok) return;
    if (res.reason === 'unauthorized') setPrefError(tGearErr('bagSignInAgain'));
    else if (res.reason === 'member_not_found') setPrefError(tGearErr('bagMemberMissing'));
    else setPrefError(t('pickSheetAddError'));
  }

  async function add() {
    if (!item || gear.busy) return;
    setAddError(null);
    const res = await gear.add(item);
    if (res.ok) {
      // Same rule as the catalog sheet: the answer to "did that work" is the
      // surface changing, not the surface leaving. `owned` flips off the
      // register's shared `useGear`, so the action swaps to the IN YOUR KIT
      // badge and the footer line in place.
      return;
    }
    // `duplicate_racket` is unreachable from here (an owned pick shows the
    // badge, not the button) but is still mapped rather than flattened, so a
    // bag that fills some other way says so instead of reading as a crash.
    if (res.reason === 'bag_full') setAddError(t('pickSheetBagFull'));
    else if (res.reason === 'duplicate_racket') setAddError(t('pickSheetDuplicate'));
    // Same two reasons the catalog sheet now names. This surface shares the
    // register's one `useGear`, so it fails the same way and must say so the
    // same way.
    else if (res.reason === 'unauthorized') setAddError(tGearErr('bagSignInAgain'));
    else if (res.reason === 'member_not_found') setAddError(tGearErr('bagMemberMissing'));
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

  const showPrefs = recommenderOn && category === 'racket';

  /** The band's own words, so the summary line reads as a sentence rather than
   *  as a number. An unrecognised band falls back to the figure itself — never
   *  to "no limit", which would assert a cap the member did not set. */
  function budgetWords(band: number | null): string {
    if (band === null) return t('budgetLower_none');
    if (band === 100) return t('budgetLower_100');
    if (band === 200) return t('budgetLower_200');
    if (band === 350) return t('budgetLower_350');
    return `$${band}`;
  }

  /* The two segment controls, revealed by the Change link rather than shown
     standing. Extracted so the error branch below can render them too: they
     are what changes the gear doc, so they are also what can make the pick
     stop resolving — dropping them exactly then would persist a new budget
     and leave no surface anywhere to change it back (the rail card behind
     this sheet is a non-interactive div in its error state). */
  const controls = showPrefs ? (
    <>
      <section style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('formatLabel')}</p>
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
        <p className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)' }}>{t('budgetLabel')}</p>
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

      {gear.loadError && <ErrorState message={t('kitError')} />}
      {prefError && <ErrorState message={prefError} />}
    </>
  ) : null;

  /* A failed or pending gear read means the preferences are UNKNOWN, and the
     summary sentence must not be written from the `??` fallbacks — it would
     state a format and a budget the server never reported.

     But the CONTROLS still have to be reachable exactly then. They are what
     writes the gear doc, so they are also what can leave a member with a
     budget they cannot change back, and the rail card behind this sheet is a
     non-interactive div in its error state. So an unknown-preferences sheet
     opens with the controls already expanded, rather than folded behind a
     Change link next to a sentence there is no honest way to write. */
  const prefsUnknown = showPrefs && (playFormat === null || budgetMaxCad === undefined);
  const controlsVisible = prefsOpen || prefsUnknown;

  /* One line, above the answer, saying what produced it — with the controls
     folded behind Change. Format and budget are set once or twice a year;
     two labelled segment controls standing open competed with the answer the
     sheet exists to give. */
  const prefSummary = showPrefs ? (
    <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
      {!prefsUnknown && (
        <span className="fs-sm" style={{ color: 'var(--text-muted)' }}>
          {t('pickSheetPrefSummary', {
            format: t(`formatLower_${playFormat}`),
            budget: budgetWords(budgetMaxCad as number | null),
          })}
        </span>
      )}
      {!prefsUnknown && (
        <button
          type="button"
          onClick={() => setPrefsOpen((v) => !v)}
          aria-expanded={prefsOpen}
          className="fs-sm"
          style={{ background: 'transparent', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--accent)' }}
        >
          {t('pickSheetChange')}
        </button>
      )}
    </div>
  ) : null;

  /* The caveat paragraph. Three sentences that used to be in three places —
     an orange line inside the WHY THIS card, and a disclaimer at the very
     bottom of the scroll. `provenance` is conditional (13 of 46 strings carry
     community-estimated ratings), so it is appended rather than baked into the
     footnote copy: the other rows ARE manufacturer-published and saying
     otherwise about them would be a false claim, not a cautious one. */
  const caveat = [t('pickSheetFootnote'), pick?.provenance].filter(Boolean).join(' ');

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

  const specRows = (SPEC_ROWS[item.category] ?? [])
    .map((r) => ({ labelKey: r.labelKey, value: r.render(item.attributes ?? {}) }))
    .filter((r): r is { labelKey: string; value: string } => Boolean(r.value));

  return (
    <BottomSheet open={open} onClose={close} ariaLabel={heading} maxHeight="88dvh">
      {header}

      <BottomSheetBody>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
          {prefSummary}
          {controlsVisible && controls}

          {/* The name, then the price. A racket at $309 is the decision being
              made; it was 14px grey next to the brand, read as a footnote. */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
            <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', flexWrap: 'wrap' }}>
              <span
                className="fs-stat-lg"
                style={{
                  fontFamily: 'var(--font-display)',
                  fontWeight: 700,
                  letterSpacing: '-0.02em',
                  color: 'var(--text-primary)',
                }}
              >
                {item.model}
              </span>
              {owned && <StatusBadge variant="accent">{t('railInKit')}</StatusBadge>}
            </span>
            <span style={{ display: 'flex', alignItems: 'baseline', gap: 'var(--space-3)', flexWrap: 'wrap' }}>
              {typeof item.msrp === 'number' && item.msrp > 0 && (
                <span className="fs-lg" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                  ${item.msrp}
                </span>
              )}
              <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{item.brand}</span>
            </span>
          </div>

          {/* The reason, at the top of the type scale for this body — it is
              the thing a member can act on. */}
          {headline && (
            <p className="fs-lg" style={{ margin: 0, lineHeight: 'var(--lh-snug)', color: 'var(--text-primary)' }}>
              {headline}
            </p>
          )}

          {/* The remaining reasons, as plain checked rows rather than a
              bordered WHY THIS card. */}
          {rest.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
              {rest.map((r, i) => (
                <div key={`reason-${i}`} style={{ display: 'flex', gap: 'var(--space-3)' }}>
                  <span
                    className="material-icons"
                    aria-hidden="true"
                    style={{ fontSize: 'var(--icon-sm)', color: 'var(--text-muted)', flex: '0 0 auto', marginTop: 1 }}
                  >
                    check
                  </span>
                  <p className="fs-md" style={{ margin: 0, lineHeight: 'var(--lh-normal)', color: 'var(--text-secondary)' }}>
                    {r}
                  </p>
                </div>
              ))}
            </div>
          )}

          {/* Never collapsed, never behind a tap, never merged into the muted
              caveat paragraph. These are safety copy. */}
          {warnings.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              {warnings.map((w, i) => (
                <p
                  key={`warning-${i}`}
                  className="fs-md"
                  style={{ margin: 0, lineHeight: 'var(--lh-normal)', color: 'var(--sev-warn)' }}
                >
                  {w}
                </p>
              ))}
            </div>
          )}

          {/* D2: the pair-specific tension. A labelled row between dividers,
              not a card — materials simplify inward. Absent, not zero, when
              the frame publishes no ceiling: there is no honest placeholder
              for a number we do not have. */}
          {typeof pick?.tensionLbs === 'number' && (
            <section style={{ borderTop: '1px solid var(--divider)', paddingTop: 'var(--space-4)' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('pickSheetTension')}</span>
                <span style={{ color: 'var(--text-primary)' }}>
                  <span className="fs-stat" style={{ fontFamily: 'var(--font-mono)', fontWeight: 600 }}>
                    {pick.tensionLbs}
                  </span>
                  <span className="fs-sm" style={{ marginLeft: 'var(--space-1)', color: 'var(--text-secondary)' }}>
                    {t('lb')}
                  </span>
                </span>
              </div>
              {/* Never a bare figure — the advisory is what keeps this a
                  conversation with a stringer instead of an instruction. */}
              <p className="fs-sm" style={{ margin: 'var(--space-2) 0 0', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
                {t('tensionAdvisory')}
              </p>
            </section>
          )}

          {/* The spec table, behind a disclosure that says how many rows are
              in it. It is what a member checks AFTER deciding, and seven mono
              rows between the name and the reason inverted that. */}
          {specRows.length > 0 && (
            <section style={{ borderTop: '1px solid var(--divider)', paddingTop: 'var(--space-4)' }}>
              <button
                type="button"
                onClick={() => setSpecsOpen((v) => !v)}
                aria-expanded={specsOpen}
                aria-controls="pick-sheet-specs"
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)',
                  width: '100%', background: 'transparent', border: 'none', padding: 0, cursor: 'pointer',
                  color: 'inherit', textAlign: 'left',
                }}
              >
                <span className="fs-md" style={{ color: 'var(--text-secondary)' }}>{t('pickSheetFullSpecs')}</span>
                <span style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                  <span className="fs-base" style={{ color: 'var(--text-muted)' }}>{specRows.length}</span>
                  <span
                    className="material-icons"
                    aria-hidden="true"
                    style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}
                  >
                    {specsOpen ? 'expand_less' : 'expand_more'}
                  </span>
                </span>
              </button>

              {specsOpen && (
                <dl
                  id="pick-sheet-specs"
                  style={{
                    margin: 'var(--space-4) 0 0',
                    display: 'grid',
                    gridTemplateColumns: 'auto 1fr',
                    columnGap: 'var(--space-5)',
                    rowGap: 'var(--space-2)',
                  }}
                >
                  {specRows.map((r) => (
                    <Fragment key={r.labelKey}>
                      <dt className="fs-sm" style={{ color: 'var(--text-muted)' }}>{t(r.labelKey)}</dt>
                      <dd className="fs-sm" style={{ margin: 0, color: 'var(--text-secondary)', fontFamily: 'var(--font-mono)' }}>
                        {r.value}
                      </dd>
                    </Fragment>
                  ))}
                </dl>
              )}
            </section>
          )}

          {/* A category with no curated spec list still shows what it has. */}
          {specRows.length === 0 && specLine(item) && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{specLine(item)}</p>
          )}

          {addError && <ErrorState message={addError} />}

          {!gear.online && (
            <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>{tStats('offline')}</p>
          )}
        </div>
      </BottomSheetBody>

      {/* Pinned, so the action is reachable at any scroll position. */}
      <BottomSheetFooter>
        {owned ? (
          <p className="fs-sm" style={{ margin: 0, color: 'var(--text-muted)' }}>
            {t('railInKitLine')}
          </p>
        ) : (
          <button
            type="button"
            className="btn-primary w-full"
            disabled={!gear.online || gear.busy}
            onClick={add}
          >
            {t('pickSheetAdd')}
          </button>
        )}
        <p className="fs-sm" style={{ margin: 'var(--space-4) 0 0', color: 'var(--text-muted)', lineHeight: 'var(--lh-normal)' }}>
          {caveat}
        </p>
      </BottomSheetFooter>
    </BottomSheet>
  );
}
