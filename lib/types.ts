export interface Session {
  id: string;
  title: string;
  locationName?: string;
  locationAddress?: string;
  datetime: string;
  deadline: string;
  courts: number;
  maxPlayers: number;
}

export interface Player {
  id: string;
  name: string;
  sessionId: string;
  timestamp: string;
}

export interface Announcement {
  id: string;
  text: string;
  time: string;
  sessionId: string;
}
