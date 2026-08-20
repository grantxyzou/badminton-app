'use client';

import GearPickRail from './GearPickRail';
import YourKitCard from './YourKitCard';
import StringTensionCard from './StringTensionCard';
import ClubGearCard from './ClubGearCard';
import { useGear } from './useGear';

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
 */

export interface GearRegisterProps {
  activeName: string | null;
}

export default function GearRegister({ activeName }: GearRegisterProps) {
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

  return (
    <>
      <GearPickRail activeName={activeName} gear={gear} />
      <YourKitCard activeName={activeName} gear={gear} />
      <StringTensionCard activeName={activeName} gear={gear} />
      <ClubGearCard />
    </>
  );
}
