'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import CardHeader from '@/components/primitives/CardHeader';
import CardSkeleton from '@/components/primitives/CardSkeleton';
import ErrorState from '@/components/primitives/ErrorState';
import GearSheet from './GearSheet';
import BagList from './BagList';
import type { GearFailure, UseGear } from './useGear';
import type { EquipmentCategory, GearItem } from '@/lib/types';
import { gearItemLabel, MIN_LB, MAX_LB } from '@/lib/tension';

const CATEGORIES: { key: EquipmentCategory; labelKey: string; icon: string }[] = [
  { key: 'racket', labelKey: 'catRacket', icon: 'sports_tennis' },
  { key: 'string', labelKey: 'catString', icon: 'science' },
  { key: 'shoe', labelKey: 'catShoe', icon: 'fitness_center' },
  { key: 'shuttle', labelKey: 'catShuttle', icon: 'inventory_2' },
];

/**
 * Categories a player can actually pick from. Driven by whether the catalog
 * has rows, not by a flag — same rule as the rail, so the two can never
 * disagree about whether a category is ready.
 */
const PICKABLE: EquipmentCategory[] = ['racket', 'string'];

export interface YourKitCardProps {
  activeName: string | null;
  /**
   * The register's single `UseGear` object. This card MUST NOT call `useGear`
   * itself: a second instance holds its own state with no shared store, which
   * is how adding a racket here used to leave every other gear surface stale
   * until reload. See `GearRegister`'s docstring.
   */
  gear: UseGear;
}

/** `notSet` for an empty row, `gearItemLabel` (shared with `BagList`) for a
 *  filled one — see `lib/tension.ts` for why the formatting lives there. */
function kitValue(item: GearItem | undefined, t: (key: string) => string): string {
  if (!item) return t('notSet');
  return gearItemLabel(item, t('lb'));
}

/** Parses and clamps a raw tension input to `[MIN_LB, MAX_LB]`, rounded to a
 *  whole pound (matching `recommendTension`'s own output). Returns `undefined`
 *  for anything that isn't a real number the member typed — including an empty
 *  string, which `Number('')` reads as `0` (finite!) and would otherwise
 *  silently clamp up to `MIN_LB`. A member who clears the field is saying
 *  "nothing", not "20". Moved here with the field itself, from `GearSheet`. */
function clampTension(raw: string): number | undefined {
  if (raw.trim() === '') return undefined;
  const n = Number(raw);
  if (!Number.isFinite(n)) return undefined;
  return Math.min(MAX_LB, Math.max(MIN_LB, Math.round(n)));
}

/**
 * "Your kit" — one row per equipment category, showing what the member owns
 * and offering the door to change it.
 *
 * Two surfaces, two jobs, deliberately not two doors to the same room:
 *   - the pick rail INFORMS (what we'd suggest, and whether you own it)
 *   - these rows MANAGE (tap to pick or change)
 */
export default function YourKitCard({ activeName, gear }: YourKitCardProps) {
  const t = useTranslations('stats.gear');
  // The bag-write failure copy lives in `valueHub` alongside bagFull /
  // bagDuplicate, shared with every other surface that writes gear — it moved
  // here with the controls that can produce it.
  const tErr = useTranslations('valueHub');
  const { gear: doc, loaded, loadError, busy, online, add, activate, remove, setTension, active } = gear;
  const [picking, setPicking] = useState<EquipmentCategory | null>(null);
  const [tensionInput, setTensionInput] = useState('');
  const [opError, setOpError] = useState<string | null>(null);

  const items = (doc?.items ?? []) as GearItem[];
  const status: 'loading' | 'ready' | 'error' = loadError ? 'error' : loaded ? 'ready' : 'loading';

  if (!activeName) return null;
  if (status === 'loading') return <CardSkeleton height={220} />;

  // Legacy gear docs predate `category` and are all rackets — same read
  // tolerance as normalizeBirdUsages.
  // LAST of each category, not first. `items` is append-ordered, so "first"
  // is the STALEST thing the member ever added — a member who logged BG65 a
  // year ago and a new string tonight saw the year-old one named as their
  // kit, and the string they just recorded a tension for was invisible. The
  // freshest entry is the one that answers "what are you playing with".
  // Rackets are overridden below by their explicit pointer.
  const byCategory = new Map<EquipmentCategory, GearItem>();
  for (const item of items) {
    if (!item || item.retiredAt) continue;
    byCategory.set((item.category ?? 'racket') as EquipmentCategory, item);
  }
  // Rackets have an active POINTER; array order is not it. This row showed
  // `items[0]`, so a member whose active racket was not the first one added
  // saw the wrong racket named as the one they play with — and every gear
  // surface that reads `activeRacket()` disagreed with this card. `active`
  // comes from the same resolver those surfaces use, legacy pointerless bags
  // included (it falls back to items[0], which is what this row wanted all
  // along).
  if (active) byCategory.set('racket', active);

  const ownedItemsForPicking = picking
    ? items.filter((i) => !i.retiredAt && ((i.category ?? 'racket') as EquipmentCategory) === picking)
    : [];

  /** Everything the member owns, across categories. `BagList` already gates
   *  the activate control on `category === 'racket'` and the tension control
   *  on `'string'`, so one list serves both rather than one per category. */
  const ownedItems = items.filter((i) => !i.retiredAt);

  /** One place a `GearFailure` becomes words, so the picker and these rows can
   *  never describe the same refusal differently. */
  function messageFor(reason: GearFailure): string {
    if (reason === 'bag_full') return tErr('bagFull');
    if (reason === 'duplicate_racket') return tErr('bagDuplicate');
    if (reason === 'unauthorized') return tErr('bagSignInAgain');
    if (reason === 'member_not_found') return tErr('bagMemberMissing');
    if (reason === 'tension_not_saved') return tErr('bagTensionNotSaved');
    if (reason === 'rate_limited') return tErr('bagRateLimited');
    return tErr('recError');
  }

  /** Activate / remove, with their answer actually rendered. A handler that
   *  reports nothing is UNKNOWN, not failed — painting an error here would
   *  assert a refusal nobody reported, which is the mirror of the
   *  lying-empty-state rule. */
  async function runBagOp(op: (id: string) => Promise<ReturnType<typeof activate>> | ReturnType<typeof activate>, id: string) {
    if (busy) return;
    setOpError(null);
    const res = await op(id);
    if (res && !res.ok) setOpError(messageFor(res.reason));
  }

  /** Apply whatever is in the tension field to a string already in the bag. */
  async function applyTension(item: GearItem) {
    const lbs = clampTension(tensionInput);
    if (lbs === undefined || busy) return;
    setOpError(null);
    const res = await setTension(item, lbs);
    if (!res.ok) setOpError(messageFor(res.reason));
  }

  const hasString = ownedItems.some((i) => i.category === 'string');

  return (
    <div className="glass-card p-5 space-y-3">
      <CardHeader icon="inventory_2" title={t('kitTitle')} subtitle={t('kitSubtitle')} />
      {status === 'error' ? (
        <ErrorState message={t('kitError')} />
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
          {CATEGORIES.map(({ key, labelKey, icon }) => {
            const item = byCategory.get(key);
            const pickable = PICKABLE.includes(key);
            // A row that says "Add" and does nothing is worse than a row that
            // says nothing. Unsourced categories render as a plain div with no
            // action word at all, matching the rail's parked cards.
            const Row = pickable ? 'button' : 'div';
            return (
              <Row
                key={key}
                {...(pickable
                  ? {
                      type: 'button' as const,
                      onClick: () => setPicking(key),
                      disabled: busy,
                      'aria-label': `${t(labelKey)} — ${item ? t('change') : t('add')}`,
                    }
                  : {})}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--space-3)',
                  padding: 'var(--space-4)',
                  borderRadius: 'var(--radius-lg)',
                  background: 'var(--inner-card-bg)',
                  border: '1px solid var(--inner-card-border)',
                  width: '100%',
                  textAlign: 'left',
                  cursor: pickable ? 'pointer' : 'default',
                  opacity: pickable ? 1 : 0.6,
                }}
              >
                <span
                  className="material-icons"
                  aria-hidden="true"
                  style={{ fontSize: 'var(--icon-md)', color: 'var(--text-muted)' }}
                >
                  {icon}
                </span>
                <span style={{ minWidth: 0, flex: 1 }}>
                  <span
                    style={{
                      display: 'block',
                      fontSize: 'var(--fs-2xs)',
                      textTransform: 'uppercase',
                      letterSpacing: '0.06em',
                      color: 'var(--text-muted)',
                      fontWeight: 700,
                    }}
                  >
                    {t(labelKey)}
                  </span>
                  <span
                    style={{
                      display: 'block',
                      marginTop: 2,
                      fontSize: 'var(--fs-md)',
                      color: item ? 'var(--text-primary)' : 'var(--text-muted)',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {kitValue(item, t)}
                  </span>
                </span>
                {pickable && (
                  <span style={{ fontSize: 'var(--fs-sm)', color: 'var(--text-secondary)' }}>
                    {item ? t('change') : t('add')}
                  </span>
                )}
              </Row>
            );
          })}
        </div>
      )}

      {/* The kit's MANAGE surface — remove, use-this-one, set tension.
          It used to live inside `GearSheet`, stacked on top of the catalog
          somebody had opened in order to add something: two unrelated jobs
          fighting over one sheet. It belongs with the kit, which is here.
          Only rendered when there is something to manage. */}
      {status === 'ready' && ownedItems.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-3)' }}>
          {/* Above the list, not below it: the flow is type a number, then tap
              the row it belongs to. `BagList`'s control is disabled until the
              field holds something usable, so a field underneath it would
              explain a disabled button only after you had given up on it. */}
          {hasString && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
              <label htmlFor="kit-tension" className="fs-xs" style={{ color: 'var(--text-muted)' }}>
                {t('tensionCaptureLabel')}
              </label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)' }}>
                <input
                  id="kit-tension"
                  type="number"
                  inputMode="numeric"
                  min={MIN_LB}
                  max={MAX_LB}
                  value={tensionInput}
                  onChange={(e) => setTensionInput(e.target.value)}
                  // Select-on-focus, because this field is a two-digit whole
                  // value that is always REPLACED, never appended to. Without
                  // it, tapping a field already holding "30" and typing a
                  // corrected "26" produces 3026, which the clamp folds back
                  // to 30 — silently and plausibly.
                  onFocus={(e) => e.currentTarget.select()}
                  // Show the member the number that will actually be stored.
                  // The clamp is deliberate, but applying it invisibly at save
                  // time means a typo becomes a plausible-looking tension the
                  // member never gave.
                  onBlur={() => {
                    const clamped = clampTension(tensionInput);
                    setTensionInput(clamped === undefined ? '' : String(clamped));
                  }}
                  aria-label={t('tensionCaptureLabel')}
                  className="fs-md"
                  style={{
                    width: 88, minHeight: 44, padding: 'var(--space-3)', borderRadius: 'var(--radius-lg)',
                    background: 'var(--bg-surface)', border: '1px solid var(--border-subtle)',
                    color: 'var(--text-primary)', fontFamily: 'var(--font-mono)',
                  }}
                />
                <span className="fs-sm" style={{ color: 'var(--text-secondary)' }}>{t('lb')}</span>
              </div>
            </div>
          )}

          <BagList
            items={ownedItems}
            activeId={active?.id}
            onActivate={(id) => { void runBagOp(activate, id); }}
            onRemove={(id) => { void runBagOp(remove, id); }}
            onSetTension={(item) => { void applyTension(item); }}
            tensionReady={clampTension(tensionInput) !== undefined}
            busy={busy}
          />

          {opError && <ErrorState message={opError} />}
        </div>
      )}

      {/* One picker, driven by which row was tapped. GearSheet is
          category-agnostic, so strings reuse it rather than getting a
          near-copy that drifts. It BROWSES now and nothing else — owned rows
          appear in place, checked, and are not tappable there. */}
      <GearSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        category={picking ?? 'racket'}
        title={picking === 'string' ? t('pickString') : t('pickRacket')}
        ownedCatalogIds={ownedItemsForPicking
          .map((i) => i.catalogId)
          .filter((id): id is string => typeof id === 'string')}
        ownedItems={ownedItemsForPicking}
        activeItemId={active?.id}
        // `makeActive` for rackets: this row's action word is "Change", and the
        // sheet closes on pick, so picking here means "this is the one I'm
        // using now" — not "add a spare to my bag". Without it the write
        // succeeded, the pointer stayed put, and the row still named the old
        // racket, which read as the picker being broken.
        onPick={(item) => add(item, item.category === 'racket' ? { makeActive: true } : undefined)}
        busy={busy}
        online={online}
      />
    </div>
  );
}
