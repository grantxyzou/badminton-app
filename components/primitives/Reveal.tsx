'use client';

import {
  createContext,
  useCallback,
  useContext,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import Collapse from './Collapse';

/**
 * A screen that fills top to bottom — the loading cascade
 * (`docs/plans/loading-cascade.md`).
 *
 * Every card on a screen fetches on its own, so they used to land in NETWORK
 * order, and a card that rendered `null` until its data arrived would insert
 * itself above or between cards already on screen. A `RevealSlot` holds the
 * card's place with its skeleton from the first frame, and a `RevealGroup`
 * lets a slot show its content only once every slot ABOVE it has shown — so
 * the screen fills from the top whatever order the network answers in.
 * Fetching is untouched; this only decides what is rendered.
 *
 * Motion (opacity only, the existing `.motion-fade`):
 *  - Slots revealed together stagger 40ms apart, capped at the fourth, so a
 *    long screen never makes its last card wait on the ones above it.
 *  - Data already there when a slot first renders shows AT ONCE with no fade:
 *    a tab switched back to from cache must not wait on choreography.
 *  - Reduced motion keeps the fade and drops the stagger — the reduced-motion
 *    `.motion-fade` rule restates `animation` with `!important`, which resets
 *    the inline delay.
 *
 * Once revealed a slot never goes back to its skeleton, even if `ready` turns
 * false again: a refetch keeps its content (the `loadedRef` rule, enforced
 * here instead of in every card).
 */

const STAGGER_MS = 40;
const STAGGER_CAP = 3;
/** --duration-sheet, the Collapse close. */
const CLOSE_MS = 180;

interface Reveal {
  /** Fade delay in ms, or null for an instant (un-faded) reveal. */
  delay: number | null;
}

interface SlotReport {
  ready: boolean;
  empty: boolean;
  node: HTMLElement | null;
}

interface GroupApi {
  report: (id: string, ready: boolean, empty: boolean, node: HTMLElement | null) => void;
  unregister: (id: string) => void;
  revealed: ReadonlyMap<string, Reveal>;
}

const GroupContext = createContext<GroupApi | null>(null);

function byDomOrder(a: SlotReport, b: SlotReport): number {
  if (!a.node || !b.node || a.node === b.node) return 0;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function RevealGroup({ children }: { children: ReactNode }) {
  const slots = useRef(new Map<string, SlotReport>());
  const [revealed, setRevealed] = useState<ReadonlyMap<string, Reveal>>(() => new Map());
  const revealedRef = useRef(revealed);
  // Reveals made in the same commit share one batch, so they stagger against
  // each other. Layout effects of one commit run synchronously; a microtask
  // closes the batch after them.
  const batch = useRef<{ count: number; open: boolean }>({ count: 0, open: false });

  const recompute = useCallback((freshId: string | null) => {
    const ordered = [...slots.current.entries()].sort(([, a], [, b]) => byDomOrder(a, b));
    let next: Map<string, Reveal> | null = null;
    for (const [id, slot] of ordered) {
      if (revealedRef.current.has(id) || next?.has(id)) continue;
      if (!slot.ready) break;
      // Ready on its very first report, with nothing above it waiting: the
      // data was already here, so show it as-is.
      const instant = id === freshId;
      let delay: number | null = null;
      if (!instant) {
        if (!batch.current.open) {
          batch.current = { count: 0, open: true };
          queueMicrotask(() => {
            batch.current.open = false;
          });
        }
        delay = Math.min(batch.current.count, STAGGER_CAP) * STAGGER_MS;
        batch.current.count += 1;
      }
      next ??= new Map(revealedRef.current);
      next.set(id, { delay });
    }
    if (next) {
      revealedRef.current = next;
      setRevealed(next);
    }
  }, []);

  const report = useCallback(
    (id: string, ready: boolean, empty: boolean, node: HTMLElement | null) => {
      const prev = slots.current.get(id);
      slots.current.set(id, { ready, empty, node });
      recompute(!prev && ready && allAboveRevealed(id) ? id : null);
    },
    [recompute],
  );

  // A slot ready on arrival is instant only if everything above it has
  // already revealed — otherwise it waited, and waiting is what the fade marks.
  function allAboveRevealed(id: string): boolean {
    const me = slots.current.get(id);
    for (const [otherId, other] of slots.current) {
      if (otherId === id) continue;
      if (byDomOrder(other, me!) < 0 && !revealedRef.current.has(otherId)) return false;
    }
    return true;
  }

  const unregister = useCallback(
    (id: string) => {
      slots.current.delete(id);
      // A pending slot leaving may unblock the ones below it.
      recompute(null);
    },
    [recompute],
  );

  const api = useMemo<GroupApi>(() => ({ report, unregister, revealed }), [report, unregister, revealed]);
  return <GroupContext.Provider value={api}>{children}</GroupContext.Provider>;
}

export function RevealSlot({
  ready,
  placeholder,
  empty,
  children,
}: {
  /** The card's data has arrived (loaded OR failed — an error is content too). */
  ready: boolean;
  /** Shaped like the final card, so nothing moves when it is replaced. */
  placeholder: ReactNode;
  /**
   * The card has nothing to show (no kudos, no requests). Its skeleton closes
   * instead of the card appearing. Pass it only on a card that can be empty —
   * the skeleton is then wrapped so it can close.
   */
  empty?: boolean;
  children: ReactNode;
}) {
  const group = useContext(GroupContext);
  const id = useId();
  const node = useRef<HTMLDivElement>(null);
  const canBeEmpty = empty !== undefined;
  const isEmpty = !!empty;

  // Standalone (no group): the slot is its own ordering.
  const [solo, setSolo] = useState<Reveal | null>(() => (!group && ready ? { delay: null } : null));
  if (!group && ready && !solo) setSolo({ delay: 0 });

  useLayoutEffect(() => {
    group?.report(id, ready, isEmpty, node.current);
  }, [group?.report, id, ready, isEmpty]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!group) return;
    return () => group.unregister(id);
  }, [group?.unregister, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = group ? group.revealed.get(id) ?? null : solo;

  // An empty card's skeleton closes, then the slot leaves the layout.
  const [gone, setGone] = useState(false);
  const closing = !!reveal && isEmpty;
  // Empty on arrival: there is nothing to close, so it was never there.
  const instantEmpty = closing && reveal.delay === null;
  useLayoutEffect(() => {
    if (!closing || instantEmpty) return;
    const t = setTimeout(() => setGone(true), CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing, instantEmpty]);

  if (gone || instantEmpty) return null;

  if (!reveal || isEmpty) {
    return (
      <div ref={node} data-reveal-slot="">
        {canBeEmpty ? <Collapse open={!closing}>{placeholder}</Collapse> : placeholder}
      </div>
    );
  }

  const fade = reveal.delay !== null;
  return (
    <div
      ref={node}
      data-reveal-slot=""
      className={fade ? 'motion-fade' : undefined}
      style={fade ? { animationDelay: `${reveal.delay}ms` } : undefined}
    >
      {children}
    </div>
  );
}
