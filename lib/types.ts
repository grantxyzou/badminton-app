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
  prevSessionDate?: string;
  prevCostPerPerson?: number;
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
