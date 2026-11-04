'use client';

import type { SettingsRow } from '@/components/profile/SettingsList';

/**
 * The console's settings as a grid of tiles, three to a row, in place of the
 * sixteen-row lists that made up half the page (Grant, 2026-11-04: "any
 * alternative to keep this page less scrolling lengthy"). Same rows, same
 * `SettingsRow` shape, so a row's `meta` (the bench count, "Set up") still
 * shows and `accent` still means a live count asking for a tap — accent is
 * currency here as it is on Home. Fill-only tiles, like every Tier-2 surface.
 */
export default function LaunchGrid({ rows, label }: { rows: SettingsRow[]; label: string }) {
  return (
    <div className="cc-launch" role="group" aria-label={label}>
      {rows.map((row) => (
        <button
          key={row.label}
          type="button"
          className={`cc-launch-tile${row.accent ? ' cc-launch-tile--accent' : ''}`}
          onClick={row.onClick}
        >
          <span className="material-icons icon-lg cc-launch-icon" aria-hidden="true">{row.icon}</span>
          <span className="cc-launch-label">{row.label}</span>
          {row.meta && <span className="cc-launch-meta">{row.meta}</span>}
        </button>
      ))}
    </div>
  );
}
