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
}

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
}

export interface Alias {
  id: string;
  appName: string;
  etransferName: string;
}

export interface Announcement {
  id: string;
  text: string;
  time: string;
  editedAt?: string;
  sessionId: string;
}
