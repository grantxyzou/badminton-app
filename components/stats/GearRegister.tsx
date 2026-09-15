'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import GearPickRail from './GearPickRail';
import GearFitSheet from './GearFitSheet';
import FitProfilePage from './FitProfilePage';
import FrameDetailPage from './FrameDetailPage';
import FrameViewSheet from './FrameViewSheet';
import GearSetupCard from './GearSetupCard';
import SetupAddSheet from './SetupAddSheet';
import SetupLineSheet from './SetupLineSheet';
import SetupShareSheet from './SetupShareSheet';
import RacketLookSheet from './RacketLookSheet';
import NextRacketCard from './NextRacketCard';
import GearPickSheet from './GearPickSheet';
import { recordEngagement } from '@/lib/engagement';
import YourKitCard from './YourKitCard';
import StringTensionCard from './StringTensionCard';
import ClubGearCard from './ClubGearCard';
import { useGear } from './useGear';
import { REC_REFETCH_DEBOUNCE_MS, useGearPicks } from './useGearPicks';
import { useClubGear } from './useClubGear';
import { isFlagOn } from '@/lib/flags';
import type { CatalogItem, GearItem } from '@/lib/types';
import { racketIdsByTallyKey, setupLines, setupShare, tensionOnScreen, type SetupCategory } from '@/lib/gearSetup';
import { useCatalog } from './useCatalog';

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

type GearPage = { kind: 'fit' } | { kind: 'frame'; frameId: string };

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
  // Pages in the register (NEXT_PUBLIC_FLAG_GEAR_PAGES): rendered in place of
  // the cards, with the shell's chrome hidden (statsTakeover.ts). A STACK,
  // because a frame page opens another frame, and back should walk back
  // through them. The fit page replaces the fit SHEET as the door to the questions.
  const [pages, setPages] = useState<GearPage[]>([]);
  const page = pages[pages.length - 1] ?? null;
  const pagesOn = isFlagOn('NEXT_PUBLIC_FLAG_GEAR_PAGES');
  const popPage = () => setPages((s) => s.slice(0, -1));
  const openFrame = (frameId: string) => setPages((s) => [...s, { kind: 'frame', frameId }]);
  // Back to the fit page already underneath rather than a second copy on top.
  const openFitPage = () => setPages((s) => {
    const i = s.findIndex((p) => p.kind === 'fit');
    return i >= 0 ? s.slice(0, i + 1) : [...s, { kind: 'fit' }];
  });
  const openFitDoor = () => (pagesOn ? openFitPage() : setOpenFit(true));
  const [view3d, setView3d] = useState<{ item: GearItem | null; row: CatalogItem; key: number } | null>(null);
  // Held while the questions are open, sheet or page: answered at a human
  // pace, every tap would otherwise re-ask /api/recommend against its limit.
  const picks = useGearPicks(activeName, gear, { holdFitRefetch: openFit || pages.some((p) => p.kind === 'fit') });
  const club = useClubGear();
  const catalogRackets = useCatalog('racket');
  const racketIds = useMemo(() => racketIdsByTallyKey(catalogRackets.items), [catalogRackets.items]);

  // The picks are made against the racket IN PLAY, so when that changes (a
  // racket named, changed, swapped in) they are re-asked.
  // Until it lands, `blankStringPairing` refuses to quote the old one: it
  // checks the frame the server says it paired with.
  const activeId = gear.active?.id ?? null;
  const prevActiveRef = useRef<string | null | undefined>(undefined);
  // Held in a ref, not the effect's cleanup: an unrelated dependency changing
  // mid-wait must not cancel a re-ask the next run would then skip.
  const swapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const { refresh } = picks;
  useEffect(() => {
    if (!gear.loaded || gear.loadError) return;
    if (prevActiveRef.current === undefined) { prevActiveRef.current = activeId; return; }
    if (prevActiveRef.current === activeId) return;
    prevActiveRef.current = activeId;
    // Both: the pairing is made against the racket in play, and "where you'd
    // go next" is relative to it (and excludes it). Nothing else about the bag
    // re-asks — a string added or a spare added changes neither answer.
    // A burst of swaps is ONE re-ask: each was two /api/recommend calls
    // against its per-IP minute limit, and the throttled answer renders as
    // "Couldn't load this pick" — five swaps in a minute broke the card.
    if (swapTimerRef.current) clearTimeout(swapTimerRef.current);
    swapTimerRef.current = setTimeout(() => {
      swapTimerRef.current = null;
      refresh('string');
      refresh('racket');
    }, REC_REFETCH_DEBOUNCE_MS);
  }, [gear.loaded, gear.loadError, activeId, refresh]);
  useEffect(() => () => { if (swapTimerRef.current) clearTimeout(swapTimerRef.current); }, []);
  // One sheet at a time: a line's own sheet, or the add sheet. `key` is bumped
  // per opening so each visit starts clean — both sheets keep state that
  // describes one visit (a saved row, a half-chosen tension, a pending
  // remove), and a remount is the whole reset.
  const [sheet, setSheet] = useState<
    | { kind: 'line'; category: SetupCategory; key: number }
    | { kind: 'add'; category: SetupCategory; makeActive: boolean; replacesId?: string; key: number }
    | { kind: 'look'; itemId: string; title: string; key: number }
    | null
  >(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  // Memoised on the doc: the share sheet draws its canvas from a callback ref,
  // and a fresh object per render would redraw (and reload the image) each time.
  const share = useMemo(() => setupShare(activeName ?? '', setupLines(gear.gear)), [activeName, gear.gear]);
  const openAdd = (category: SetupCategory, makeActive: boolean, replacesId?: string) =>
    setSheet((s) => ({ kind: 'add', category, makeActive, replacesId, key: (s?.key ?? 0) + 1 }));
  const openLine = (category: SetupCategory) => {
    const lines = setupLines(gear.loadError ? null : gear.gear);
    const filled = category === 'racket' ? !!lines.racket : !!lines.string;
    // A blank line names itself; a filled one is managed. A racket named from
    // its line is the one in play — the line IS the racket in play.
    if (filled) setSheet((s) => ({ kind: 'line', category, key: (s?.key ?? 0) + 1 }));
    else openAdd(category, true);
  };

  if (page) {
    return (
      <>
        {page.kind === 'fit' ? (
          <FitProfilePage activeName={activeName} gear={gear} picks={picks} onBack={popPage} onOpenFrame={openFrame} />
        ) : (
          <FrameDetailPage
            key={`${page.frameId}-${pages.length}`}
            activeName={activeName}
            gear={gear}
            frameId={page.frameId}
            onBack={popPage}
            onOpenFrame={openFrame}
            onOpenFit={openFitPage}
            onShare={() => setShareOpen(true)}
            onView3d={(item, row) => setView3d((v) => ({ item, row, key: (v?.key ?? 0) + 1 }))}
          />
        )}
        {shareOpen && (
          <SetupShareSheet open onClose={() => setShareOpen(false)} share={share} racketCatalogId={gear.active?.catalogId} racketItemLook={gear.active?.look} />
        )}
        {view3d && (view3d.item
          ? <RacketLookSheet key={view3d.key} open onClose={() => setView3d(null)} gear={gear} item={view3d.item} title={view3d.row.model} />
          : <FrameViewSheet key={view3d.key} open onClose={() => setView3d(null)} row={view3d.row} />)}
      </>
    );
  }

  return (
    <>
      <GearSetupCard
        activeName={activeName}
        gear={gear}
        picks={picks}
        club={club}
        onOpenLine={openLine}
        onShare={() => setShareOpen(true)}
        onOpenFit={openFitDoor}
        onAddTension={() => openLine('string')}
      />
      <NextRacketCard
        gear={gear}
        picks={picks}
        onOpen={() => {
          setPickOpen(true);
          // The Slice-0 series' writer moves with the tap it counts — the rail
          // card's tap on the other branch, this one here. Same kind, so the
          // append-only series stays continuous.
          void recordEngagement('rec_card_tap');
        }}
        onOpenFit={openFitDoor}
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
      <ClubGearCard
        club={club}
        mine={gear.loaded && !gear.loadError ? gear.gear : undefined}
        // A racket row opens that racket's page (pages on). The catalog read is
        // the register's shared, module-cached one — no second request.
        onOpenRacket={pagesOn ? openFrame : undefined}
        racketIds={racketIds}
      />
      <GearFitSheet open={openFit} onClose={() => setOpenFit(false)} gear={gear} />
      <GearPickSheet
        open={pickOpen}
        onClose={() => setPickOpen(false)}
        category="racket"
        pick={picks.view.racket.pick}
        owned={picks.isOwned('racket', picks.view.racket.pick?.item ?? null)}
        gear={gear}
        // Swap, never stack — the same rule as the rail's sheet.
        onOpenFit={() => { setPickOpen(false); openFitDoor(); }}
      />
      {shareOpen && (
        <SetupShareSheet
          open
          onClose={() => setShareOpen(false)}
          share={share}
          racketCatalogId={gear.active?.catalogId}
          racketItemLook={gear.active?.look}
        />
      )}
      {sheet?.kind === 'line' && (
        <SetupLineSheet
          key={sheet.key}
          open
          onClose={() => setSheet(null)}
          category={sheet.category}
          gear={gear}
          // The two sheets swap, never stack.
          // A racket change keeps the old frame as a visible spare; a string
          // change replaces, because the card has no spare line for strings.
          onChange={() => openAdd(sheet.category, true, sheet.category === 'string' ? setupLines(gear.gear).string?.id : undefined)}
          onAddSpare={() => openAdd('racket', false)}
          onViewLook={(item, title) => setSheet((s) => ({ kind: 'look', itemId: item.id, title, key: (s?.key ?? 0) + 1 }))}
          onViewFrame={pagesOn ? (catalogId) => { setSheet(null); openFrame(catalogId); } : undefined}
        />
      )}
      {sheet?.kind === 'look' && (() => {
        const item = gear.gear?.items.find((i) => i.id === sheet.itemId);
        return item ? (
          <RacketLookSheet key={sheet.key} open onClose={() => setSheet(null)} gear={gear} item={item} title={sheet.title} />
        ) : null;
      })()}
      {sheet?.kind === 'add' && (
        <SetupAddSheet
          key={sheet.key}
          open
          onClose={() => setSheet(null)}
          category={sheet.category}
          gear={gear}
          picks={picks}
          makeActive={sheet.makeActive}
          replacesId={sheet.replacesId}
        />
      )}
    </>
  );
}
