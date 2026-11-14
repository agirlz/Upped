export type ID = string;

export interface Place {
  lat: number; // rounded to ~10 km for privacy
  lng: number;
  label?: string;
}

export interface User {
  id: ID;
  name: string;
  emoji: string;
  createdAt: number;
  place?: Place;
}

export interface Lobby {
  id: ID;
  name: string;
  code: string;
  memberIds: ID[];
  createdBy: ID;
  createdAt: number;
}

/** Where the shooter "called" their target, normalized to the video frame (0..1). */
export interface Target {
  x: number;
  y: number;
  r: number; // radius as a fraction of frame width
}

export type PostKind = 'original' | 'matched' | 'upped';
export type Spot = 'court' | 'home';

export interface Comment {
  id: ID;
  userId: ID;
  text: string;
  createdAt: number;
}

export interface Post {
  id: ID;
  lobbyId: ID;
  authorId: ID;
  kind: PostKind;
  /** Root of the challenge chain (undefined for originals). */
  rootId?: ID;
  challengeId?: ID;
  title: string;
  rules: string[];
  spot?: Spot;
  videoId: ID;
  thumbId?: ID;
  missIds: ID[]; // blooper clips
  attempts: number; // attempt number the make happened on
  target?: Target;
  momentMs: number; // when the ball reached the target
  durationMs: number;
  verifyCode: string;
  recordedAt: number;
  createdAt: number;
  reactions: Record<string, ID[]>;
  votesUp: ID[];
  votesDown: ID[];
  flags: ID[];
  comments: Comment[];
}

export interface Challenge {
  id: ID;
  /** null = official weekly challenge open to everyone. */
  lobbyId: ID | null;
  title: string;
  description: string;
  rules: string[];
  createdBy: ID | null;
  startsAt: number;
  endsAt: number;
}

export interface State {
  version: 1;
  meId: ID | null;
  users: Record<ID, User>;
  lobbies: Record<ID, Lobby>;
  posts: Record<ID, Post>;
  challenges: Record<ID, Challenge>;
}

export const REACTIONS = ['🔥', '😱', '😂', '🐐'] as const;

export const RULE_OPTIONS = [
  'Bank shot',
  'Off the wall',
  'Non-dominant hand',
  'Behind the back',
  'Eyes closed',
  'Trick bounce',
  'From the bed',
  'Over the shoulder',
  'Not a basketball',
  'One take',
];

export const AVATARS = ['🦅', '🐐', '⚡', '🔥', '🦈', '🐍', '👑', '🎯', '🚀', '🦍', '🐺', '🧊'];
