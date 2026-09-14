'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { recordEngagement } from '@/lib/engagement';
import GearPickCard from './GearPickCard';
import GearPickSheet from './GearPickSheet';
import type { UseGear } from './useGear';
import type { EquipmentCategory } from '@/lib/types';
import LockedCard, { PreviewRow, useSignInLink } from './LockedCard';
import { ORDER, SOURCED, useGearPicks } from './useGearPicks';

// Re-exported: tests and callers import the debounce from the rail.
export { REC_REFETCH_DEBOUNCE_MS } from './useGearPicks';

export interface GearPickRailProps {
  activeName: string | null;
  gear: UseGear;
  /**
   * D2: reports the tension the STRING pairing arrived at, or null when it
   * could not give one (parked, errored, or a frame with no published
   * ceiling). `GearRegister` uses it to stand `StringTensionCard` down, so the
   * register never shows the pair-specific number and the level-based one at
   * the same time.
   *
   * A callback rather than a second fetch in the card: this rail already owns
   * the string pick, and a card that re-asked would recreate the multi-reader
   * drift the register was restructured to remove.
   */
  onPairTension?: (lbs: number | null) => void;
  /** Opens the fit questionnaire, which `GearRegister` owns — it has to be
   *  reachable from the kit card as well as from a READY racket pick, or a
   *  member whose racket card is parked or errored could never clear a
   *  stored comfort answer. The rail closes its own sheet first. */
  onOpenFit?: () => void;
  /** True while the fit questionnaire is open. A fit-driven refetch is HELD
   *  until it closes: answered at a human pace, five controls were eleven
   *  `/api/recommend` calls inside a minute against a 10/min limit whose
   *  throttled 200 renders as an error card, and the card is under the sheet
   *  anyway. Format/budget changes (made from the pick sheet) are unaffected. */
  holdFitRefetch?: boolean;
}

/**
 * The artboard's category rail — one card per equipment category, each
 * showing what the member owns beside what `/api/recommend` would suggest.
 *
 * Replaces `GearRail`, which only ever showed a category description; this
 * rail shows an actual scored pick and flips to "In your kit" the moment the
 * member already owns it — the prototype's live bug (recommending back gear
 * the member already has) that this redesign exists to fix.
 *
 * Ownership is read from the `gear` prop (the single owner of the gear
 * document — see `useGear`'s docstring), never from a second fetch: a
 * per-card gear read here would recreate the exact drift bug the register is
 * being restructured to eliminate.
 */
export default function GearPickRail({ activeName, gear, onPairTension, onOpenFit, holdFitRefetch = false }: GearPickRailProps) {
  const t = useTranslations('stats.gear');
  const signInLink = useSignInLink();
  // Every recommend read, refetch rule and reason translation lives in the
  // hook; this component is only the rail's arrangement of it.
  const { view, refused, parkReasons, retry, isOwned, railStatus } = useGearPicks(activeName, gear, { onPairTension, holdFitRefetch });
  // Which category's detail sheet is open. The rail owns this, not the card:
  // the sheet is opened FROM a card but belongs to the rail, which is the only
  // place that holds both the pick and the gear owner needed to add it.
  const [openCategory, setOpenCategory] = useState<EquipmentCategory | null>(null);

  if (!activeName) return null;
  // Refused (this device holds no session for the name): the card stays, as
  // its own shape with nothing in it, and Sign in carries the weight.
  if (refused) {
    return (
      <LockedCard message={t.rich('picksLocked', { link: signInLink })}>
        <PreviewRow icon="sports_tennis" width="50%" />
        <PreviewRow icon="science" width="38%" />
      </LockedCard>
    );
  }

  const openPick = openCategory ? view[openCategory].pick : null;

  return (
    <>
    <div
      style={{
        display: 'flex',
        gap: 'var(--space-4)',
        // Bleed to the column edges so the rail reads as scrollable rather
        // than as cards that happen to be cut off — matches GearRail.
        margin: '0 calc(-1 * var(--space-5))',
        padding: 'var(--space-05) var(--space-5) var(--space-2)',
        overflowX: 'auto',
        scrollSnapType: 'x proximity',
        scrollbarWidth: 'none',
      }}
    >
      {ORDER.map((cat) => {
        const { status, pick } = view[cat];
        return (
          <GearPickCard
            key={cat}
            category={cat}
            pick={pick}
            owned={isOwned(cat, pick?.item ?? null)}
            status={railStatus(status, pick)}
            onRetry={() => retry(cat, status)}
            errorKind={gear.loadError && pick ? 'kit' : 'pick'}
            parkReason={status === 'parked' ? (parkReasons[cat] ?? (SOURCED.includes(cat) ? null : 'no_engine')) : null}
            onOpenFit={onOpenFit}
            onOpen={() => {
              setOpenCategory(cat);
              // The Value-Hub Slice-0 kill-criterion ("did a member interact
              // more than once") had exactly one writer: RacketRecCard's
              // disclosure tap. This tap replaces it, and the `events`
              // container is append-only — a gap in the series is
              // indistinguishable afterwards from real disengagement. Same
              // `rec_card_tap` kind so the series stays continuous.
              // Fire-and-forget by design; nothing on screen depends on it.
              void recordEngagement('rec_card_tap');
            }}
          />
        );
      })}
    </div>

    {/* One sheet, driven by which card was tapped — the same "one picker"
        principle as YourKitCard's GearSheet. It takes the rail's `gear`, so
        adding from it flips this card to IN YOUR KIT and fills the kit row in
        the same pass, with no reload and no second fetch.

        `open` keys off the tapped CATEGORY, never off whether a pick is
        currently resolved. The pick is live — changing format or budget inside
        the sheet refetches it — and gating the sheet's existence on that would
        let it evaporate under the member's finger the moment a refetch came
        back empty (a throttled response is the easy way to hit that). A sheet
        that vanishes with no explanation is the sheet-shaped version of the
        lying empty state; GearPickSheet renders an error instead. */}
    <GearPickSheet
      open={openCategory !== null}
      onClose={() => setOpenCategory(null)}
      category={openCategory ?? 'racket'}
      pick={openPick}
      owned={isOwned(openCategory ?? 'racket', openPick?.item ?? null)}
      gear={gear}
      // One sheet at a time. The pick sheet closes and the questionnaire opens
      // in its place; when that closes the member is back on the rail, whose
      // racket card has re-asked with the new answers. Stacking the two would
      // put a form over the answer it changes. (The 220 ms overlap of the two
      // body-scroll locks during the swap is handled by the lock itself,
      // which is reference-counted for exactly this.)
      onOpenFit={onOpenFit ? () => { setOpenCategory(null); onOpenFit(); } : undefined}
    />
    </>
  );
}
