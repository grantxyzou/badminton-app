'use client';

import type { Session } from '@/lib/types';

interface Props {
  session: Session | null;
  onEditDates: () => void;
}

function fmtSessionDate(iso: string): string {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric',
    }) + ' · ' + new Date(iso).toLocaleTimeString(undefined, {
      hour: '2-digit', minute: '2-digit',
    });
  } catch { return iso; }
}

export default function SessionContextBar({ session, onEditDates }: Props) {
  return (
    <button
      onClick={onEditDates}
      className="w-full inner-card-green p-3 flex items-center justify-between transition-all active:scale-[0.98]"
      style={{ minHeight: 44, borderRadius: 12 }}
    >
      <div className="text-left">
        <p className="text-[10px] font-medium" style={{ color: 'var(--text-muted)' }}>Editing</p>
        <p className="text-sm font-semibold" style={{ color: 'var(--accent)' }}>
          {session?.datetime ? fmtSessionDate(session.datetime) : 'No session'}
        </p>
      </div>
      <span className="material-icons" style={{ fontSize: 16, color: 'var(--text-muted)' }}>edit</span>
    </button>
  );
}
