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
  | 'past-sessions'
  | 'stringing'
  | 'catalog-gaps'
  | 'metrics';

export interface AdminNavProps {
  onBack: () => void;
  title: string;
  sessionLabel?: string;
  /** The small label above the title. "Admin" unless the page was opened
   *  from somewhere else (the bench from the Stringing tab says "Stringing"). */
  crumb?: string;
}
