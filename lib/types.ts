import type { StringingStatus, PlayerStage } from './stringing';
import type { StatsPrivacy } from './statsPrivacy';

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
  /** ISO timestamp of the first time signupOpen flipped false -> true. Written
   *  by PUT /api/session alongside the flip. This is the value
   *  `calculateSignupOpensOffset` in the advance route wants (it currently
   *  hardcodes 0 for want of it) — wiring that up is deliberately left for a
   *  follow-up so this stays a notification change. */
  signupOpenedAt?: string;
  /** ISO timestamp of the sign-up-open push send. Presence means "already
   *  notified for this session" — toggling sign-ups closed and open again does
   *  NOT re-notify. Session-scoped, so the next session starts clean. */
  signupOpenNotifiedAt?: string;
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
  /**
   * Admin-issued PIN-reset code, persisted on the member so it survives cold
   * starts (the previous in-memory map lost codes when the B1 dyno slept).
   * `hash` is scrypt("salt:hash"); single active code per member; consumed
   * (deleted) on a successful `/api/players/recover` code redemption. Like
   * `pinHash`, this is a STRIP-CANARY — never send it to a client.
   */
  recoveryCode?: { hash: string; expiresAt: number };
  /** Audit trail of recovery-related events (issue / redeem / fail). */
  recoveryEvents?: RecoveryEvent[];
  /** Admin-only: organizer's default e-transfer recipient, used by the receipt export. */
  eTransferRecipient?: ETransferRecipient;
  /** Admin-only: dates (YYYY-MM-DD) the admin has marked as skipped. Used by the skip_date anomaly. */
  skipDates?: string[];
  /**
   * Club-comparison privacy. Absent means NEVER ASKED — read it through
   * `normalizeStatsPrivacy` (lib/statsPrivacy.ts), which maps absence to
   * `{ clubComparison: true, promptedAt: null }` so existing members get the
   * first-run prompt once instead of silently defaulting into a comparison.
   * Unlike `pinHash` / `recoveryCode` this is NOT a strip-canary — the member
   * reads their own setting back via `GET /api/members/me`.
   */
  statsPrivacy?: StatsPrivacy;
  /**
   * Account email for the email+password provider, normalized lowercase.
   * NARROW strip-canary: removed from every list and cross-member response,
   * but returned by `GET /api/members/me` for the caller's OWN record — the
   * same exception `statsPrivacy` already has, since Profile must be able to
   * show you which address you signed in with.
   */
  email?: string;
  /** True only once a mailed verification link has actually been redeemed. */
  emailVerified?: boolean;
  /** scrypt, self-describing format from lib/passwordHash.ts. STRIP-CANARY. */
  passwordHash?: string;
  /** SHA-256 of a single-use emailed token. 24h TTL. STRIP-CANARY. */
  emailVerification?: { hash: string; expiresAt: number };
  /** SHA-256 of a single-use emailed token. 1h TTL. STRIP-CANARY. */
  passwordReset?: { hash: string; expiresAt: number };
  /**
   * DISPLAY ONLY — never authoritative. The `identities` container is the
   * source of truth; on a mismatch, believe `identities`. Exists so Profile can
   * render "Google connected" without a second round-trip.
   */
  linkedProviders?: ('google' | 'apple')[];
  /**
   * Upgrade-nudge dismissal. Stored on the MEMBER, not localStorage — a
   * per-device dismissal would re-nag the same person on every device they own.
   */
  authNudge?: { dismissedAt: string | null };
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

/**
 * A manual stock reconciliation. Stored in the same `birds` container as
 * purchases, discriminated by `type: 'adjustment'`. Lets an admin correct
 * the computed on-hand count (purchased − used) to match a physical recount
 * — broken tubes, gifts, miscounts, etc. `delta` is added to currentStock
 * (can be negative). `countedTotal` is the physical number the admin entered,
 * kept for the audit trail. Undo = delete the doc by id.
 */
export interface BirdAdjustment {
  id: string;
  type: 'adjustment';
  delta: number;
  countedTotal: number;
  reason?: string;
  date: string;
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
  /** Id of the GearItem the player is currently using. A pointer rather than
   *  an `active` flag per item: a flag lets two rackets both claim active with
   *  no tiebreak. Absent on every doc written before the bag shipped —
   *  readers fall back to the first racket (see lib/activeRacket.ts). */
  activeRacketId?: string;
  /** "I mostly play" — drives the recommender's format scorer. Absent = 'both'.
   *  Additive and optional: bpm-stable and bpm-next share one database. */
  playFormat?: 'singles' | 'doubles' | 'both';
  /** Upper spend bound in CAD. Absent = no preference; the budget scorer stays
   *  neutral rather than penalising. Never a hard filter (spec D6). */
  budgetMaxCad?: number;
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

/**
 * One recorded engagement interaction (`events` container, PK `/memberId`).
 *
 * Written per-event, never upserted: the Value-Hub Slice-0 kill-criterion asks
 * whether a member interacted "more than once", which needs the history rather
 * than a latest-state row.
 */
export interface EngagementEvent {
  id: string;
  /** Partition key. From the member_session cookie, so it can't be spoofed. */
  memberId: string;
  /** Display name at the time of the event — convenience for readouts. */
  name: string;
  /** Allowlisted in app/api/events/route.ts; not free text. */
  kind: 'rec_card_tap';
  /** ISO 8601. Sortable as a plain string, so range queries are string compares. */
  at: string;
}

/**
 * A racket handed to a stringer.
 *
 * Partitioned by `/memberId`, mirroring `playerGear`: a player reading their
 * own jobs — the hot path once the player side ships — is then a single-
 * partition query, and their gear and their jobs sit together. The bench's
 * "all open jobs" read is cross-partition, which is the right trade because a
 * bench holds a handful of jobs while a season holds hundreds.
 *
 * `memberName`, `racketLabel` and `stringLabel` are DENORMALISED on purpose.
 * The bench list must render without a lookup per row, and — more importantly —
 * a job is a record of what was actually strung. If a player later renames
 * themselves or retires that racket from their bag, the job must still say what
 * sat on the shelf, so these are snapshots rather than live references.
 */
export interface StringingJob {
  /** Random hex doc id. NOT the printed number — see `formatJobNo`. */
  id: string;
  /** Partition key: the player the racket belongs to. */
  memberId: string;
  /** Human-facing tag, e.g. `J-0042`. Unique-ish, cosmetic, never an id. */
  jobNo: string;
  /** Snapshot of the player's name at intake. */
  memberName: string;
  /** Which admin owns the job — drives the bench's Mine / All filter. Null
   *  means unclaimed, which is legitimate: a job can be logged before anyone
   *  has said they will string it. */
  stringerId: string | null;
  stringerName: string | null;
  status: StringingStatus;
  racketLabel: string;
  stringLabel: string;
  tensionMains: number;
  tensionCrosses: number;
  /** Free text, e.g. "Zach · 2 strings, 4 knots". A note, not an enum: the
   *  method is a fact about how this club strings, not a setting to configure. */
  method: string;
  /** STRINGER-ONLY. Stripped from every player-facing response and replaced by
   *  a band — see `priceBand` for why a band and not a margin. */
  priceCents: number | null;
  /** ISO date the racket is promised back. */
  readyBy: string | null;
  /** Set when the player accepts the quote. */
  acceptedAt: string | null;
  paidAt: string | null;
  /** Session the racket changes hands at, when there is one. */
  sessionId: string | null;
  createdAt: string;
  updatedAt: string;
  /** Append-only audit of every status change, so a correction is visible
   *  rather than silent — this is what lets `canTransition` stay permissive. */
  history: { status: StringingStatus; at: string; by: string | null }[];
}

/** What a PLAYER is allowed to see of their own job. Note what is missing:
 *  `priceCents`, `stringerId`, and the bench's `status` vocabulary. */
export interface PlayerStringingJob {
  id: string;
  jobNo: string;
  stage: PlayerStage;
  stageIndex: number;
  racketLabel: string;
  stringLabel: string;
  tensionMains: number;
  tensionCrosses: number;
  method: string;
  /** "$28–32" while the price is still provisional. */
  priceRange: string | null;
  /** The exact amount owed, in dollars, once the job is billable — finished,
   *  priced and unpaid. Null at every other point. A quote is a range; a bill
   *  is a number. See lib/stringingBilling.ts. */
  amountDue: number | null;
  readyBy: string | null;
  paid: boolean;
  createdAt: string;
  updatedAt: string;
}

/**
 * One Web Push subscription = one browser on one device. A member who uses a
 * phone and a laptop has two docs.
 *
 * Deliberately its OWN container (`pushSubscriptions`, PK `/memberId`) rather
 * than an array on `Member`: `Member` is read on hot paths by both deployments,
 * and a per-device array would turn it into a write-contention hot doc. A new
 * container also cannot break bpm-stable, which satisfies the additive-only
 * schema rule for the shared DB.
 */
export interface PushSubscriptionDoc {
  id: string;
  /** Partition key. Always taken from the member_session cookie, NEVER from
   *  the request body — member names are enumerable (security rule 12). */
  memberId: string;
  /** Denormalized for legibility in admin/debug reads, same as kudos.recipientName. */
  memberName: string;
  /** The push service URL. Treated as a credential: never returned to a client. */
  endpoint: string;
  /** sha256(endpoint), hex. The dedup/lookup key — safe to log, unlike the endpoint. */
  endpointHash: string;
  keys: { p256dh: string; auth: string };
  /** Truncated user-agent, so "which device is this?" is answerable when revoking. */
  ua?: string;
  createdAt: string;
  /** Bumped on re-subscribe. Also the eviction order when a member exceeds the device cap. */
  lastSeenAt: string;
  lastSuccessAt?: string;
  /** Incremented on transient send failures (429/5xx). A 404/410 deletes the
   *  doc outright instead — that status means the subscription is truly gone. */
  failureCount?: number;
  /** Phase 2 per-type opt-out. Absent = subscribed to everything. */
  topics?: string[];
}
