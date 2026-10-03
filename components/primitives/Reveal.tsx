'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
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
 *
 * Fetching is untouched. The card is MOUNTED from the start (hidden while its
 * skeleton shows), so a card that fetches inside itself still fetches; it says
 * it is ready with `useRevealReady()`. Data the parent owns can be passed as
 * the slot's `ready` prop instead. A hidden card measures 0 — a card that
 * sizes itself on mount should measure again when shown.
 *
 * Motion (opacity only, the existing `.motion-fade`):
 *  - Anything ready within `INSTANT_MS` of the screen appearing shows with no
 *    fade at all: a tab switched back to, answered from cache, must not wait
 *    on choreography.
 *  - Slots revealed together after that stagger 40ms apart, capped at the
 *    fourth. A waiting slot keeps its SKELETON until its turn — the card is
 *    never held invisible in its place, which would read as a blank gap.
 *  - Reduced motion keeps the fade and drops the stagger.
 *
 * Once revealed a slot never goes back to its skeleton, even if `ready` turns
 * false again: a refetch keeps its content (the `loadedRef` rule, enforced
 * here instead of in every card).
 */

export const STAGGER_MS = 40;
const STAGGER_CAP = 3;
/** Ready within this long of the screen mounting = it was effectively already here. */
export const INSTANT_MS = 100;
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

/** Lets a card inside a slot say "my data is here" without lifting its fetch. */
const SlotReadyContext = createContext<((ready: boolean, empty: boolean) => void) | null>(null);

/**
 * Called by a card rendered inside a `RevealSlot` that has no `ready` prop.
 * `ready` true once the card has something to show — loaded OR failed (an
 * error is content too). `empty` when it loaded and has nothing to show.
 * Outside a slot it does nothing.
 */
export function useRevealReady(ready: boolean, empty = false) {
  const set = useContext(SlotReadyContext);
  useLayoutEffect(() => {
    set?.(ready, empty);
  }, [set, ready, empty]);
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

function byDomOrder(a: SlotReport, b: SlotReport): number {
  if (!a.node || !b.node || a.node === b.node) return 0;
  return a.node.compareDocumentPosition(b.node) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1;
}

export function RevealGroup({ children }: { children: ReactNode }) {
  const slots = useRef(new Map<string, SlotReport>());
  const [revealed, setRevealed] = useState<ReadonlyMap<string, Reveal>>(() => new Map());
  const revealedRef = useRef(revealed);
  const mountedAt = useRef<number | null>(null);
  // Reveals made in the same commit share one batch, so they stagger against
  // each other. Layout effects of one commit run synchronously; a microtask
  // closes the batch after them.
  const batch = useRef<{ count: number; open: boolean }>({ count: 0, open: false });

  const recompute = useCallback(() => {
    const now = performance.now();
    mountedAt.current ??= now;
    const instant = now - mountedAt.current <= INSTANT_MS;
    const reduce = prefersReducedMotion();
    const ordered = [...slots.current.entries()].sort(([, a], [, b]) => byDomOrder(a, b));
    let next: Map<string, Reveal> | null = null;
    for (const [id, slot] of ordered) {
      if (revealedRef.current.has(id) || next?.has(id)) continue;
      if (!slot.ready) break;
      let delay: number | null = null;
      if (!instant) {
        if (!batch.current.open) {
          batch.current = { count: 0, open: true };
          queueMicrotask(() => {
            batch.current.open = false;
          });
        }
        delay = reduce ? 0 : Math.min(batch.current.count, STAGGER_CAP) * STAGGER_MS;
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
      slots.current.set(id, { ready, empty, node });
      recompute();
    },
    [recompute],
  );

  const unregister = useCallback(
    (id: string) => {
      slots.current.delete(id);
      // A pending slot leaving may unblock the ones below it.
      recompute();
    },
    [recompute],
  );

  const api = useMemo<GroupApi>(() => ({ report, unregister, revealed }), [report, unregister, revealed]);
  return <GroupContext.Provider value={api}>{children}</GroupContext.Provider>;
}

export function RevealSlot({
  ready: readyProp,
  placeholder,
  empty: emptyProp,
  canBeEmpty = emptyProp !== undefined,
  children,
}: {
  /**
   * The card's data has arrived (loaded OR failed). Omit it when the card
   * reports its own readiness with `useRevealReady()`.
   */
  ready?: boolean;
  /** Shaped like the final card, so nothing moves when it is replaced. */
  placeholder: ReactNode;
  /** The card has nothing to show. Its skeleton closes instead. */
  empty?: boolean;
  /**
   * The card might turn out empty, so its skeleton is wrapped to be able to
   * close. Implied by passing `empty`; set it when the card reports emptiness
   * through `useRevealReady`.
   */
  canBeEmpty?: boolean;
  children: ReactNode;
}) {
  const group = useContext(GroupContext);
  const id = useId();
  const node = useRef<HTMLDivElement>(null);

  // Readiness: the prop when given, else what the card inside reports.
  const [reported, setReported] = useState({ ready: false, empty: false });
  const onReport = useCallback((ready: boolean, empty: boolean) => {
    setReported((prev) => (prev.ready === ready && prev.empty === empty ? prev : { ready, empty }));
  }, []);
  const ready = readyProp ?? reported.ready;
  const isEmpty = emptyProp ?? reported.empty;

  // Standalone (no group): the slot is its own ordering.
  const soloMountedAt = useRef<number | null>(null);
  const [solo, setSolo] = useState<Reveal | null>(null);
  useLayoutEffect(() => {
    if (group) return;
    const now = performance.now();
    soloMountedAt.current ??= now;
    if (!ready || solo) return;
    setSolo({ delay: now - soloMountedAt.current <= INSTANT_MS ? null : 0 });
  }, [group, ready, solo]);

  useLayoutEffect(() => {
    group?.report(id, ready, isEmpty, node.current);
  }, [group?.report, id, ready, isEmpty]); // eslint-disable-line react-hooks/exhaustive-deps

  useLayoutEffect(() => {
    if (!group) return;
    return () => group.unregister(id);
  }, [group?.unregister, id]); // eslint-disable-line react-hooks/exhaustive-deps

  const reveal = group ? group.revealed.get(id) ?? null : solo;

  // A staggered slot keeps its skeleton until its turn, then fades the card in.
  const [turnCame, setTurnCame] = useState(false);
  const delay = reveal?.delay ?? null;
  useEffect(() => {
    if (!delay) return;
    const t = setTimeout(() => setTurnCame(true), delay);
    return () => clearTimeout(t);
  }, [delay]);
  const shown = !!reveal && (delay === null || delay === 0 || turnCame);
  const fade = shown && delay !== null;

  // An empty card's skeleton closes, then the slot leaves the layout.
  const [gone, setGone] = useState(false);
  const closing = shown && isEmpty;
  const instantEmpty = closing && delay === null;
  useLayoutEffect(() => {
    if (!closing || instantEmpty) return;
    const t = setTimeout(() => setGone(true), CLOSE_MS);
    return () => clearTimeout(t);
  }, [closing, instantEmpty]);

  const showPlaceholder = !shown || (isEmpty && !instantEmpty);

  return (
    <div ref={node} data-reveal-slot="" hidden={gone || instantEmpty}>
      {showPlaceholder &&
        (canBeEmpty ? <Collapse open={!closing}>{placeholder}</Collapse> : placeholder)}
      {/* Mounted from the start so a card that fetches inside itself fetches.
          `hidden` until its turn, then faded in as it appears. */}
      <div hidden={!shown || isEmpty} className={fade ? 'motion-fade' : undefined}>
        <SlotReadyContext.Provider value={readyProp === undefined ? onReport : null}>
          {children}
        </SlotReadyContext.Provider>
      </div>
    </div>
  );
}
