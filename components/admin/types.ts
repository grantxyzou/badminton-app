export type AdminView =
  | 'dashboard'
  | 'session-details'
  | 'date-time'
  | 'members'
  | 'birds'
  | 'advance'
  | 'players-full'
  | 'releases'
  | 'ledger'
  | 'payments'
  | 'announcements'
  | 'etransfer'
  | 'skip-dates'
  | 'past-sessions';

export interface AdminNavProps {
  onBack: () => void;
  title: string;
  sessionLabel?: string;
}
