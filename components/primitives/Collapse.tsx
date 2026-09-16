'use client';

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';

/**
 * A disclosure body that opens and closes instead of appearing — recipe 2
 * ("Open") of the motion system in `app/globals.css`.
 *
 * Closed means ABSENT, the same as the `{open && …}` it replaces: children
 * mount when it opens and unmount once the close has finished, so a query for
 * the content of a closed disclosure still finds nothing and nothing inside it
 * fetches while it is shut.
 *
 * Both directions move:
 *  - OPEN mounts at `0fr`, forces a style read so the browser has a start
 *    value, then flips to `1fr` in the same commit — before paint, no frame
 *    of pop.
 *  - CLOSE flips back to `0fr` and unmounts after `--duration-sheet`.
 *
 * Spacing ABOVE it must live inside, or it outlives the close: a parent's
 * `space-y-*` margin or flex `gap` still applies while the body is closing and
 * vanishes on unmount — a small jump at the end. Pass `spaceAbove` (a token):
 * it cancels a `space-y` margin on the wrapper and becomes top padding inside
 * the clipped area, so it closes with everything else. A flex `gap` cannot be
 * cancelled from the child; drop it from the parent for this child instead.
 *
 * Never wrap a popover that is not portalled; the body clips.
 */
const CLOSE_MS = 180; // --duration-sheet

export default function Collapse({
  open,
  children,
  id,
  spaceAbove,
}: {
  open: boolean;
  children: ReactNode;
  /** For the control's `aria-controls`. */
  id?: string;
  /** A spacing token, e.g. `'var(--space-3)'`. See the note above. */
  spaceAbove?: string;
}) {
  const [mounted, setMounted] = useState(open);
  const [expanded, setExpanded] = useState(open);
  const ref = useRef<HTMLDivElement>(null);

  // Opening: mount first (at 0fr), then expand once the node exists.
  if (open && !mounted) setMounted(true);

  useLayoutEffect(() => {
    if (!open || expanded || !ref.current) return;
    // Reading layout flushes the 0fr style, so the flip below transitions.
    void ref.current.offsetHeight;
    setExpanded(true);
  }, [open, expanded, mounted]);

  useEffect(() => {
    if (open) return;
    setExpanded(false);
    const t = setTimeout(() => setMounted(false), CLOSE_MS);
    return () => clearTimeout(t);
  }, [open]);

  if (!mounted) return null;
  return (
    <div
      ref={ref}
      id={id}
      className="motion-collapse"
      data-open={expanded ? 'true' : 'false'}
      style={spaceAbove ? { marginTop: '0' } : undefined}
    >
      {/* The grid item clips; padding has to sit one level in, because a
          clipped item's own padding cannot shrink below itself. */}
      <div>
        <div style={spaceAbove ? { paddingTop: spaceAbove } : undefined}>{children}</div>
      </div>
    </div>
  );
}
