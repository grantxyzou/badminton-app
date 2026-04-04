'use client';

import type { AdminNavProps } from './types';

export default function AdminBackHeader({ onBack, title, sessionLabel }: AdminNavProps) {
  return (
    <div className="animate-fadeIn">
      <button
        onClick={onBack}
        className="flex items-center gap-1 text-sm font-medium mb-3 transition-colors active:scale-95"
        style={{ color: 'var(--accent)', minHeight: 44 }}
      >
        <span className="material-icons" style={{ fontSize: 18 }}>chevron_left</span>
        Admin
      </button>
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-bold" style={{ color: 'var(--text-primary)' }}>{title}</h2>
        {sessionLabel && (
          <span
            className="text-[10px] font-semibold px-2 py-1 rounded-full"
            style={{
              background: 'var(--inner-card-green-bg)',
              color: 'var(--accent)',
              border: '1px solid var(--inner-card-green-border)',
            }}
          >
            {sessionLabel}
          </span>
        )}
      </div>
    </div>
  );
}
