'use client';

import { createContext, useContext, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { RevealOutside } from '@/components/primitives/Reveal';

/**
 * Stringing's RIGHT page on a foldable (docs/plans/foldable-layout.md,
 * "Stringing: the list stays left, what you tap opens on the right"). The tab
 * renders an empty slot after its register when the screen shows two pages,
 * and hands it down here; a register puts the thing a tap would open — a job,
 * a string, the player's rackets — into it with `<StringingAside>`.
 *
 * On one screen there is no slot, `useStringingAside()` is `null` and
 * `<StringingAside>` renders nothing, so every caller keeps its phone path
 * (the job page, the string's sheet) exactly as it was. The CSS widens the
 * tab to two pages only while the slot holds something (`:not(:empty)`), so a
 * register with nothing to open keeps its one column.
 */
const AsideSlot = createContext<HTMLElement | null>(null);

export const StringingAsideProvider = AsideSlot.Provider;

/** The right page's element, or `null` on one screen. */
export function useStringingAside(): HTMLElement | null {
  return useContext(AsideSlot);
}

/**
 * Renders its children on the right page. `id` names what is open, so a
 * different job or string crossfades in (opacity only, as a register switch
 * does) rather than snapping.
 */
export function StringingAside({ id, children }: { id: string; children: ReactNode }) {
  const slot = useContext(AsideSlot);
  if (!slot) return null;
  return createPortal(
    <div key={id} className="motion-fade" data-aside-open={id}>
      {/* Anything inside opens its own way again (a sheet), never into the
          page it is already on. */}
      <AsideSlot.Provider value={null}>
        {/* Not part of the left page's loading cascade: a card here must not
            answer for the slot it was rendered from (context follows a portal). */}
        <RevealOutside>{children}</RevealOutside>
      </AsideSlot.Provider>
    </div>,
    slot,
  );
}
