'use client';

import { useEffect, useState } from 'react';

const BASE = process.env.NEXT_PUBLIC_BASE_PATH ?? '';

/**
 * The club's offered strings as suggestions on a free-text string field
 * (`<input list={id}>`). The bench's walk-up intake and its "propose a change"
 * field stay free text — a walk-up can bring their own string — but stock is
 * counted by matching a job's label to an offered one, so offering the shelf's
 * own spelling is what keeps a typed "bg 80" from being a job no reel knows.
 * Renders nothing until the list arrives, and nothing if it cannot.
 */
export default function OfferedStringOptions({ id }: { id: string }) {
  const [labels, setLabels] = useState<string[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`${BASE}/api/stringing/strings`, { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => {
        if (!cancelled && d && Array.isArray(d.strings)) setLabels(d.strings.filter((s: unknown): s is string => typeof s === 'string'));
      })
      .catch(() => { /* suggestions only: the field still takes free text */ });
    return () => { cancelled = true; };
  }, []);
  if (labels.length === 0) return null;
  return (
    <datalist id={id}>
      {labels.map((l) => <option key={l} value={l} />)}
    </datalist>
  );
}
