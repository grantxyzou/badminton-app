export type AdminView =
  | 'dashboard'
  | 'session-details'
  | 'date-time'
  | 'members'
  | 'birds'
  | 'advance'
  | 'players-full'
  | 'releases';

export interface AdminNavProps {
  onBack: () => void;
  title: string;
  sessionLabel?: string;
}
