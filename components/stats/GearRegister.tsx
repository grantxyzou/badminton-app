'use client';

import { useEffect, useRef, useState } from 'react';

import GearPickRail from './GearPickRail';
import GearFitSheet from './GearFitSheet';
import GearSetupCard from './GearSetupCard';
import SetupAddSheet from './SetupAddSheet';
import SetupLineSheet from './SetupLineSheet';
import YourKitCard from './YourKitCard';
import StringTensionCard from './StringTensionCard';
import ClubGearCard from './ClubGearCard';
import { useGear } from './useGear';
import { useGearPicks } from './useGearPicks';
import { useClubGear } from './useClubGear';
import { isFlagOn } from '@/lib/flags';
import { setupLines, tensionOnScreen, type SetupCategory } from '@/lib/gearSetup';

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
  const gear = useGear(activeName);
  const [openFit, setOpenFit] = useState(false);
  const picks = useGearPicks(activeName, gear, { holdFitRefetch: openFit });
  const club = useClubGear();

  // The string pairing is made against the racket IN PLAY, so when that
  // changes (a racket named, changed, swapped in) the pairing is re-asked.
  // Until it lands, `blankStringPairing` refuses to quote the old one: it
  // checks the frame the server says it paired with.
  const activeId = gear.active?.id ?? null;
  const prevActiveRef = useRef<string | null | undefined>(undefined);
  const { refresh } = picks;
  useEffect(() => {
    if (!gear.loaded || gear.loadError) return;
    if (prevActiveRef.current === undefined) { prevActiveRef.current = activeId; return; }
    if (prevActiveRef.current === activeId) return;
    prevActiveRef.current = activeId;
    refresh('string');
  }, [gear.loaded, gear.loadError, activeId, refresh]);
  // One sheet at a time: a line's own sheet, or the add sheet. `key` is bumped
  // per opening so each visit starts clean — both sheets keep state that
  // describes one visit (a saved row, a half-chosen tension, a pending
  // remove), and a remount is the whole reset.
  const [sheet, setSheet] = useState<
    | { kind: 'line'; category: SetupCategory; key: number }
    | { kind: 'add'; category: SetupCategory; makeActive: boolean; key: number }
    | null
  >(null);
  const openAdd = (category: SetupCategory, makeActive: boolean) =>
    setSheet((s) => ({ kind: 'add', category, makeActive, key: (s?.key ?? 0) + 1 }));
  const openLine = (category: SetupCategory) => {
    const lines = setupLines(gear.loadError ? null : gear.gear);
    const filled = category === 'racket' ? !!lines.racket : !!lines.string;
    // A blank line names itself; a filled one is managed. A racket named from
    // its line is the one in play — the line IS the racket in play.
    if (filled) setSheet((s) => ({ kind: 'line', category, key: (s?.key ?? 0) + 1 }));
    else openAdd(category, true);
  };

  return (
    <>
      <GearSetupCard
        activeName={activeName}
        gear={gear}
        picks={picks}
        club={club}
        onOpenLine={openLine}
        onOpenFit={() => setOpenFit(true)}
        onAddTension={() => openLine('string')}
      />
      <StringTensionCard
        activeName={activeName}
        gear={gear}
        // Stand down only while the CARD shows a tension number. Not "the
        // pairing has one": with no racket the pairing is against a
        // recommended frame the card never names, and the register would show
        // no number at all.
        suppressed={!gear.loadError && tensionOnScreen(setupLines(gear.gear), picks.view.string)}
      />
      <ClubGearCard club={club} mine={gear.loaded && !gear.loadError ? gear.gear : undefined} />
      <GearFitSheet open={openFit} onClose={() => setOpenFit(false)} gear={gear} />
      {sheet?.kind === 'line' && (
        <SetupLineSheet
          key={sheet.key}
          open
          onClose={() => setSheet(null)}
          category={sheet.category}
          gear={gear}
          // The two sheets swap, never stack.
          onChange={() => openAdd(sheet.category, true)}
          onAddSpare={() => openAdd('racket', false)}
        />
      )}
      {sheet?.kind === 'add' && (
        <SetupAddSheet
          key={sheet.key}
          open
          onClose={() => setSheet(null)}
          category={sheet.category}
          gear={gear}
          picks={picks}
          makeActive={sheet.makeActive}
        />
      )}
    </>
  );
}
