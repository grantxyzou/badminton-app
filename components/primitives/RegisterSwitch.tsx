'use client';

import type { ReactNode } from 'react';

/**
 * The switch between a tab's registers: Stats' You / Play / Learn / Gear and
 * Stringing's Racket / Strings / Bench (docs/plans/stringing-tabs.md).
 *
 * One component so the two can't drift apart. Full width, unlike the admin
 * screens' `.segment-control`, which is shared with them. The width is set
 * here, per use, and must never become an edit to the shared class.
 *
 * `aria-current="page"` rather than tab roles: a register replaces the content
 * below it the way a page does, and the switch is how you get between them.
 */
interface Props<T extends string> {
  views: readonly T[];
  value: T;
  onChange: (view: T) => void;
  label: (view: T) => ReactNode;
  /** Names the group for a screen reader: the tab it belongs to. */
  ariaLabel: string;
}

export default function RegisterSwitch<T extends string>({ views, value, onChange, label, ariaLabel }: Props<T>) {
  return (
    <div role="group" aria-label={ariaLabel} className="segment-control flex w-full">
      {views.map((id) => (
        <button
          key={id}
          type="button"
          onClick={() => onChange(id)}
          aria-current={value === id ? 'page' : undefined}
          className={`flex-1 flex items-center justify-center fs-sm ${
            value === id ? 'segment-tab-active' : 'segment-tab-inactive'
          }`}
        >
          {label(id)}
        </button>
      ))}
    </div>
  );
}
