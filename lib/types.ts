export interface Session {
  id: string;
  title: string;
  location: string;
  datetime: string;
  deadline: string;
  cost: string;
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
