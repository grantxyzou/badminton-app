'use client';

import type { Session } from '@/lib/types';

interface Props {
  session: Session | null;
  onEdit: () => void;
}

export default function VenueSummary({ session, onEdit }: Props) {
  if (!session) return null;

  const details = [
    session.courts && `${session.courts} courts`,
    session.maxPlayers && `${session.maxPlayers} max`,
    session.costPerCourt && `$${session.costPerCourt}/ct`,
    session.signupOpen !== false ? 'Signups open' : 'Signups closed',
  ].filter(Boolean).join(' · ');

  return (
    <button
      onClick={onEdit}
      className="w-full glass-card p-3 flex items-start justify-between transition-all active:scale-[0.98] text-left"
      style={{ minHeight: 44 }}
    >
      <div className="min-w-0">
        <p className="text-sm font-medium truncate" style={{ color: 'var(--text-primary)' }}>
          {session.locationName || 'No venue set'}
        </p>
        <p className="text-xs mt-0.5 truncate" style={{ color: 'var(--text-muted)' }}>
          {details}
        </p>
      </div>
      <span className="material-icons ml-2 shrink-0" style={{ fontSize: 16, color: 'var(--text-muted)' }}>edit</span>
    </button>
  );
}
