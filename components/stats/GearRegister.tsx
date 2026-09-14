'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';

import GearPickRail from './GearPickRail';
import GearFitSheet from './GearFitSheet';
import GearSheet from './GearSheet';
import GearSetupCard from './GearSetupCard';
import YourKitCard from './YourKitCard';
import StringTensionCard from './StringTensionCard';
import ClubGearCard from './ClubGearCard';
import { useGear } from './useGear';
import { useGearPicks } from './useGearPicks';
import { useClubGear } from './useClubGear';
import { isFlagOn } from '@/lib/flags';
import type { SetupCategory } from '@/lib/gearSetup';

/**
 * The Gear register: what we'd suggest per category (the pick rail), what you
 * own (Your kit), string tension advice, and what the club plays.
 *
 * Composition only — this component holds no state of its own except the one
 * thing it exists to own.
 *
 * Two surfaces, two jobs, deliberately not two doors to the same room:
 *   - the rail INFORMS (what we'd pick, and whether you already own it)
 *   - the kit rows MANAGE (tap to pick or change)
 *
 * SCOPE — rackets and strings are SELECTABLE; shoes and shuttles are parked
 * because the catalog has no rows for them, not because the UI is missing.
 * Both the rail and the kit rows key off a sourced-category list rather than a
 * flag, so sourcing rows is the only step to un-park a category.
 *
 * `NEXT_PUBLIC_FLAG_GEAR_SETUP` swaps the whole arrangement for the Set-up
 * card (`SetupRegister` below). Two components rather than one with branches,
 * because each owns a different set of hooks and a hook cannot be conditional.
 */

export interface GearRegisterProps {
  activeName: string | null;
}

export default function GearRegister({ activeName }: GearRegisterProps) {
  return isFlagOn('NEXT_PUBLIC_FLAG_GEAR_SETUP')
    ? <SetupRegister activeName={activeName} />
    : <LegacyRegister activeName={activeName} />;
}

function LegacyRegister({ activeName }: GearRegisterProps) {
  // THE single owner of the gear document for this register. Every child takes
  // it as a prop. Before this, four components read GET /api/equipment/gear
  // independently and two of them wrote it, and `useGear` holds per-instance
  // state with no module store, no context and no cross-instance event — so
  // adding a racket in one card left the others stale until reload.
  //
  // `__tests__/components/GearRegister.test.tsx` pins exactly one read per
  // mount. The rule existed before as a sentence in components/stats/CLAUDE.md,
  // and a doc comment cannot fail a build.
  const gear = useGear(activeName);

  // D2: which tension number the register is showing. Null means the pairing
  // could not give one (no frame on file, or one of the 11 catalog rackets
  // with no published ceiling) and the level-based card stands in.
  //
  // Held HERE because the two cards are siblings — the rail resolves the pick,
  // the tension card renders the fallback, and neither can see the other. The
  // alternative, letting the card ask /api/recommend itself, is the second
  // reader this register exists to prevent.
  const [pairTension, setPairTension] = useState<number | null>(null);

  // The fit questionnaire is owned HERE, not by the rail, because it has two
  // doors: the pick sheet's Fit link and a row on the kit card. The rail's
  // door only exists while its racket card is READY — a member whose card is
  // parked (no check-in) or errored (throttled) would otherwise have no way
  // to open the sheet, and so no way to clear a stored comfort answer, on
  // exactly the days the rail is broken.
  const [openFit, setOpenFit] = useState(false);
  const openFitSheet = () => setOpenFit(true);

  return (
    <>
      {/* What you already own comes first, then what we'd suggest. The rail's
          whole job is to say "here is a pick, and whether you already have it",
          which only means something once you have seen your own kit. */}
      <YourKitCard activeName={activeName} gear={gear} onOpenFit={openFitSheet} />
      <GearPickRail activeName={activeName} gear={gear} onPairTension={setPairTension} onOpenFit={openFitSheet} holdFitRefetch={openFit} />
      <StringTensionCard
        activeName={activeName}
        gear={gear}
        // `gear.loadError` un-suppresses. The stand-down only makes sense while
        // the pairing's number is actually ON SCREEN — and when the gear read
        // fails, the rail degrades the string card to its error state, so it
        // isn't. Left suppressed, the tension card would vanish silently and
        // read exactly like "no check-in yet"; it instead renders its own
        // failure, which is what the failed gear read actually is.
        suppressed={pairTension !== null && !gear.loadError}
      />
      <ClubGearCard />
      <GearFitSheet open={openFit} onClose={() => setOpenFit(false)} gear={gear} />
    </>
  );
}

/**
 * The Set-up register (claude.ai/design "Equipment redesign", Turn 2): one
 * spec card, string tension, the club tally, the fit sheet.
 *
 * Every reader has exactly ONE instance, owned here and handed down — the
 * gear doc (`useGear`), the recommend picks (`useGearPicks`, which the rail
 * owns on the other branch) and the club tally (`useClubGear`, shared by the
 * card's "N others play it" and `ClubGearCard`, so the two cannot disagree).
 */
function SetupRegister({ activeName }: GearRegisterProps) {
  const t = useTranslations('stats.gear');
  const gear = useGear(activeName);
  const [pairTension, setPairTension] = useState<number | null>(null);
  const [openFit, setOpenFit] = useState(false);
  const picks = useGearPicks(activeName, gear, { onPairTension: setPairTension, holdFitRefetch: openFit });
  const club = useClubGear();
  // Which line's picker is open. PR 1 routes both lines to the existing
  // catalog sheet; the Set-up add and manage sheets replace it.
  const [picking, setPicking] = useState<SetupCategory | null>(null);

  const items = (gear.gear?.items ?? []).filter((i) => i && !i.retiredAt);
  const ownedForPicking = picking ? items.filter((i) => (i.category ?? 'racket') === picking) : [];

  return (
    <>
      <GearSetupCard
        activeName={activeName}
        gear={gear}
        picks={picks}
        club={club}
        onOpenLine={setPicking}
        onOpenFit={() => setOpenFit(true)}
      />
      <StringTensionCard
        activeName={activeName}
        gear={gear}
        suppressed={pairTension !== null && !gear.loadError}
      />
      <ClubGearCard club={club} mine={gear.loaded && !gear.loadError ? gear.gear : undefined} />
      <GearFitSheet open={openFit} onClose={() => setOpenFit(false)} gear={gear} />
      <GearSheet
        open={picking !== null}
        onClose={() => setPicking(null)}
        category={picking ?? 'racket'}
        title={picking === 'string' ? t('pickString') : t('pickRacket')}
        ownedCatalogIds={ownedForPicking.map((i) => i.catalogId).filter((id): id is string => typeof id === 'string')}
        ownedItems={ownedForPicking}
        activeItemId={gear.active?.id}
        // A racket picked from its line is "the one I play" — the line is the
        // racket IN PLAY, so naming or changing it moves the pointer.
        onPick={(item) => gear.add(item, item.category === 'racket' ? { makeActive: true } : undefined)}
        busy={gear.busy}
        online={gear.online}
      />
    </>
  );
}
