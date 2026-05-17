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
  | 'announcements'
  | 'etransfer'
  | 'skip-dates';

export interface AdminNavProps {
  onBack: () => void;
  title: string;
  sessionLabel?: string;
}
