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
  /** Total dollars the admin absorbed by covering players in 'absorb' mode
   *  (Σ costPerPerson over absorb-covered players). 0 / absent when nobody
   *  was covered. Drives the "You've covered $X this session" summary. */
  coveredTotal?: number;
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
  /** How a covered (writtenOff) player's share is handled at settle:
   *  - 'absorb'  → the admin eats their share; everyone else pays the same.
   *                The covered player stays IN the per-person denominator.
   *  - 'resplit' → the covered player is excluded from the denominator, so
   *                their share is spread across the remaining payers.
   *  Absent on a writtenOff player (legacy / pre-v1.6) is treated as 'absorb'. */
  coverMode?: 'absorb' | 'resplit';
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

// ---------------------------------------------------------------------------
// Value-hub Slice-0: equipment catalog, player gear, game results.
// Additive + optional per the CLAUDE.md schema rule (bpm-stable and bpm-next
// share one DB). Containers created lazily via `ensureContainer` on the first
// handler call, same pattern as `skills`.
// ---------------------------------------------------------------------------

export type EquipmentCategory =
  | 'racket'
  | 'string'
  | 'shoe'
  | 'shuttle'
  | 'bag'
  | 'grip';

export interface CatalogSource {
  /** Retailer label shown to the user (e.g. "Yumo", "RacquetGuys", "Amazon"). */
  retailer: string;
  url: string;
  /** Affiliate tag, if any. Null/absent = direct link, no monetization. */
  affiliateTag?: string | null;
}

export interface CatalogItem {
  id: string;
  /** Partition key — global catalog is partitioned by category for cheap per-category scans. */
  category: EquipmentCategory;
  brand: string;
  model: string;
  /** Manufacturer's suggested retail price in CAD. Optional — community items may not have MSRP. */
  msrp?: number;
  /** ACE skill stage range this item is appropriate for. `[1, 6]` = all stages. */
  skillRange: [number, number];
  /** Free-form category-specific spec map (e.g. racket → balance/weight/flex). Kept loose for now. */
  attributes?: Record<string, string | number>;
  /** Optional retailer links. Affiliate tags ship null in Slice-0 per Decision D. */
  sources?: CatalogSource[];
  /** Auto-curated catalog seed (e.g. from scripts/seed-equipment-catalog.mjs) vs admin-added. */
  seeded?: boolean;
  /** ISO timestamp the row was first persisted. Optional because seed entries
   *  legitimately don't know it — the catalog isn't a temporal event log.
   *  The API stamps this on admin-created rows; seed-imported rows leave it
   *  unset, and downstream readers must not rely on it for sort. */
  createdAt?: string;
}

export interface GearItem {
  /** Stable ID for this gear entry on the player's gear doc. */
  id: string;
  /** References CatalogItem.id; nullable so free-text "Other" entries can exist before admin promotes them. */
  catalogId: string | null;
  category: EquipmentCategory;
  /** Free-text label, used when catalogId is null. Otherwise mirrors CatalogItem.brand + model. */
  label: string;
  acquiredAt?: string;
  retiredAt?: string;
  /** String-specific: tension in lbs at last restring. */
  tensionLbs?: number;
  notes?: string;
}

export interface StringLogEntry {
  at: string;
  tensionLbs: number;
  /** CatalogItem.id for the string used, or null if not from catalog. */
  catalogId: string | null;
}

export interface PlayerGear {
  /** Doc id — `gear-<memberId>` for easy lookup. */
  id: string;
  /** Partition key — one doc per member. */
  memberId: string;
  items: GearItem[];
  /** String-tension history. Drives the "time to restring" refresh nudge in P7. */
  stringLog?: StringLogEntry[];
  /** Sessions logged since current shoes were acquired — drives shoe-mileage nudge. */
  shoesMileageSessions?: number;
  updatedAt: string;
}

export interface GameResult {
  id: string;
  /** Partition key. */
  sessionId: string;
  /** 1-indexed for the human-readable label; not used as a join key. Optional — Slice-0 logger doesn't capture it. */
  courtNumber?: number;
  teamA: string[];
  teamB: string[];
  scoreA: number;
  scoreB: number;
  /** Who logged the result — player name (self-report) or 'admin' (admin-logged). */
  loggedBy: string;
  loggedAt: string;
}
