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
  deleteToken?: string; // DB-only — never sent to clients
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
  sessionId: string;
}
