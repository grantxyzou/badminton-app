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
 * The wrapper is a grid item, so a flex `gap` on the parent still applies to
 * it while it is closing and then vanishes on unmount — a small jump at the
 * end. Put the spacing INSIDE instead: give the content a top padding and
 * leave the parent without a gap for this child.
 *
 * Never wrap a popover that is not portalled; the body clips.
 */
const CLOSE_MS = 180; // --duration-sheet

export default function Collapse({
  open,
  children,
  id,
}: {
  open: boolean;
  children: ReactNode;
  /** For the control's `aria-controls`. */
  id?: string;
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
    <div ref={ref} id={id} className="motion-collapse" data-open={expanded ? 'true' : 'false'}>
      <div>{children}</div>
    </div>
  );
}
