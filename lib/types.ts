export interface PrevSessionSnapshot {
  courtCount: number;
  costPerCourt: number;
  maxPlayers: number;
  /** Hours between session start and the deadline at the time of advance. */
  deadlineOffsetHours: number;
  /** Hours before session start that signup-open was set (if recorded). 0 if signup was opened immediately. */
  signupOpensOffsetHours: number;
}

export interface ETransferRecipient {
  name: string;
  email: string;
  /** Optional default memo template — supports `{date}` and `{name}` placeholders. */
  memo?: string;
}

export interface Session {
  id: string;
  sessionId?: string;
  title: string;
  locationName?: string;
  locationAddress?: string;
  datetime: string;
  endDatetime?: string;
  deadline: string;
  courts: number;
  maxPlayers: number;
  signupOpen?: boolean;
  approvedNames?: string[];
  costPerCourt?: number;
  birdUsages?: BirdUsage[];
  /** @deprecated Legacy single-object shape; read via normalizeBirdUsages. */
  birdUsage?: BirdUsage;
  showCostBreakdown?: boolean;
  /** prev* fields are written together at advance time; they're related
   *  but kept as flat fields rather than nested because existing prod
   *  records already have the flat shape and the schema rule forbids
   *  renames while bpm-stable + bpm-next share the DB. Treat as a
   *  logical group. */
  prevSessionDate?: string;
  prevCostPerPerson?: number;
  prevSnapshot?: PrevSessionSnapshot;
  /** Anomaly codes detected at the moment of advance. Frozen. Runtime
   *  may read legacy strings outside the union from older records;
   *  consumers should ignore unknown codes (they don't match anything). */
  anomaliesAtAdvance?: import('./anomalies').AnomalyCode[];
  /** Anomaly codes the admin dismissed for this session (live, mutable). */
  anomaliesDismissed?: import('./anomalies').AnomalyCode[];
  /** Per-session override of the e-transfer recipient. Falls back to the admin member's setting if absent. */
  eTransferRecipient?: ETransferRecipient;
  /** Frozen receipt snapshot. Set by POST /api/session/settle, cleared by DELETE.
   *  When present, ReceiptSheet and PaymentsCard prefer these values over live compute,
   *  so retro edits to courts/birds don't redefine what already-paid players paid for. */
  settled?: SettledSnapshot;
}

export interface SettledSnapshot {
  /** ISO timestamp of the settle action. */
  at: string;
  costPerPerson: number;
  totalCost: number;
  courtTotal: number;
  birdTotal: number;
  /** Active player count at settle time (denominator used for costPerPerson). */
  playerCount: number;
  /** Frozen list of active player names — receipt source of truth, immune to later removals. */
  playerNames: string[];
}

export interface BirdUsage {
  purchaseId: string;
  purchaseName: string;
  tubes: number;            // allows 0.5 increments
  costPerTube: number;
  totalBirdCost: number;
}

export interface Player {
  id: string;
  name: string;
  sessionId: string;
  timestamp: string;
  paid?: boolean;
  waitlisted?: boolean;
  removed?: boolean;
  removedAt?: string;
  cancelledBySelf?: boolean;
  selfReportedPaid?: boolean;
  memberId?: string;    // links to Member.id for persistent identity
  deleteToken?: string; // DB-only — never sent to clients
  pinHash?: string;
  recoveryEvents?: RecoveryEvent[];
  /** Dollar amount frozen on this player at settle time. Stable across retro edits. */
  owedAmount?: number;
  /** ISO timestamp when owedAmount was stamped. */
  settledAt?: string;
  /** Admin opted to write off this player's debt when removing them post-settle.
   *  When true, ledger views exclude their owedAmount from "expected to collect." */
  writtenOff?: boolean;
}

export type RecoveryEvent =
  | { event: 'pin-set'; at: string }
  | { event: 'pin-removed'; at: string }
  | { event: 'reset-access-issued'; at: string; admin: 'admin' }
  | { event: 'recovered-via-pin'; at: string }
  | { event: 'recovered-via-code'; at: string }
  | { event: 'recovery-failed'; at: string; reason: 'wrong_pin' | 'wrong_code' | 'expired_code' };

export type Role = 'admin' | 'member';

export interface Member {
  id: string;
  name: string;
  role: Role;
  stage?: number;        // 1-5 ACE skill level
  sessionCount: number;
  lastSeen?: string;
  createdAt: string;
  active: boolean;
  /**
   * scrypt-hashed PIN, mirrored from the player's `pinHash` whenever the
   * player sets or changes their PIN via /api/players. Used by the unified
   * admin auth flow: an admin authenticates with their name + own PIN, the
   * server verifies against this hash. Optional — members who have never set
   * a PIN cannot use admin login.
   */
  pinHash?: string;
  /** Admin-only: organizer's default e-transfer recipient, used by the receipt export. */
  eTransferRecipient?: ETransferRecipient;
  /** Admin-only: dates (YYYY-MM-DD) the admin has marked as skipped. Used by the skip_date anomaly. */
  skipDates?: string[];
}

export interface Alias {
  id: string;
  appName: string;
  etransferName: string;
}

export interface BirdPurchase {
  id: string;
  name: string;            // brand + model (e.g., "Victor Master No.3")
  tubes: number;
  totalCost: number;
  costPerTube: number;
  date: string;
  speed?: number;           // shuttle speed rating
  qualityRating?: number;    // 1-5, shuttle quality rating
  notes?: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  text: string;
  time: string;
  editedAt?: string;
  sessionId: string;
}

export interface PlayerSkills {
  id: string;
  sessionId: string;      // partition key
  name: string;           // player roster name — 1:1 with (sessionId, name)
  scores: Record<string, number>;  // ACE dimension id → 0..6
  updatedAt: string;
}

export interface Release {
  id: string;
  version: string;
  title: {
    en: string;
    'zh-CN': string;
  };
  body: {
    en: string;
    'zh-CN': string;
  };
  publishedAt: string;
  publishedBy: 'admin';
  editedAt?: string;
  env?: 'stable' | 'next' | 'dev';
}
