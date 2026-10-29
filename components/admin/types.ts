export type AdminView =
  | 'club-name'
  | 'dashboard'
  | 'session-details'
  | 'members'
  | 'birds'
  | 'advance'
  | 'releases'
  | 'ledger'
  | 'payments'
  | 'announcements'
  | 'etransfer'
  | 'skip-dates'
  | 'late-cancel'
  | 'guests'
  | 'club-run'
  | 'past-sessions'
  | 'stringing'
  | 'catalog-gaps'
  | 'metrics'
  | 'invite'
  | 'gift-cards'
  | 'sign-in-readiness'
  | 'etransfers';

export interface AdminNavProps {
  onBack: () => void;
  title: string;
  sessionLabel?: string;
  /** The small label above the title. "Admin" unless the page was opened
   *  from somewhere else (the bench from the Stringing tab says "Stringing"). */
  crumb?: string;
}
