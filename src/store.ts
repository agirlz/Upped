import { useSyncExternalStore } from 'react';
import * as cloud from './cloud';
import { blobPut, clearAll, kvGet, kvSet, setRemoteBlobSource } from './db';
import type { Challenge, DistanceBucket, ID, Lobby, Post, PostKind, Spot, State, Target, TargetSize, User } from './types';

// ---------------------------------------------------------------------------
// State container. All data lives in one object, persisted to IndexedDB.
// In cloud mode (Supabase configured) the server is the source of truth: changes
// are applied locally right away, sent to the server, and the state is reloaded
// whenever the server reports a change.
// ---------------------------------------------------------------------------

const KEY = 'state';
const empty = (): State => ({ version: 1, meId: null, users: {}, lobbies: {}, posts: {}, challenges: {} });

let state: State = empty();
let loaded = false;
const listeners = new Set<() => void>();

export const cloudMode = cloud.cloudEnabled;
let unsubscribeLive: (() => void) | null = null;

export async function loadState(): Promise<void> {
  if (cloudMode) {
    setRemoteBlobSource(cloud.download);
    const me = await cloud.currentUserId();
    if (me) await refresh(me);
  } else {
    const saved = await kvGet<State>(KEY);
    if (saved && saved.version === 1) state = saved;
  }
  ensureOfficialChallenges();
  loaded = true;
  emit();
}

/** Reload everything from the server. */
export async function refresh(meId = state.meId): Promise<void> {
  if (!cloudMode || !meId) return;
  try {
    const data = await cloud.fetchAll(meId);
    // A profile row is required; without one the player must sign up again.
    state = { version: 1, ...data, meId: data.users[meId] ? meId : null };
    ensureOfficialChallenges();
    emit();
    if (!unsubscribeLive) unsubscribeLive = cloud.subscribe(() => void refresh());
  } catch (e) {
    reportError(e);
  }
}

// Errors from background server calls are shown by the app shell.
let errorListener: ((msg: string) => void) | null = null;
export function onError(fn: (msg: string) => void) {
  errorListener = fn;
}
function reportError(e: unknown) {
  const msg = e instanceof Error ? e.message : String(e);
  console.error(msg);
  errorListener?.(msg);
}

/** Run a server call in the background; on failure, show it and reload the truth. */
function remote(fn: () => Promise<unknown>) {
  if (!cloudMode) return;
  fn().catch((e) => {
    reportError(e);
    void refresh();
  });
}

function emit() {
  listeners.forEach((l) => l());
}

function commit(mutator: (draft: State) => void) {
  const next: State = structuredClone(state);
  mutator(next);
  state = next;
  emit();
  if (!cloudMode) void kvSet(KEY, state);
}

export function getState(): State {
  return state;
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

/** The whole state. The object is replaced on every change, so derive values from it per render. */
export function useAppState(): State {
  return useSyncExternalStore(subscribe, () => state);
}

export const isLoaded = () => loaded;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export const uid = (): string =>
  typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) =>
        (Number(c) ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (Number(c) / 4)))).toString(16),
      );

const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomCode(len = 4): string {
  const bytes = new Uint8Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => CODE_CHARS[b % CODE_CHARS.length]).join('');
}

export const DAY = 86_400_000;

export function startOfWeek(t = Date.now()): number {
  const d = new Date(t);
  const day = (d.getDay() + 6) % 7; // Monday = 0
  d.setHours(0, 0, 0, 0);
  return d.getTime() - day * DAY;
}

// ---------------------------------------------------------------------------
// Users & lobbies
// ---------------------------------------------------------------------------

/** First-run sign up. In cloud mode this signs the phone in anonymously (no email). */
export async function signUpPlayer(name: string, emoji: string): Promise<void> {
  if (cloudMode) {
    const id = await cloud.signUp(name, emoji);
    await refresh(id);
    return;
  }
  createUser(name, emoji);
}

export function createUser(name: string, emoji: string, makeMe = true): User {
  const user: User = { id: uid(), name: name.trim(), emoji, createdAt: Date.now() };
  commit((s) => {
    s.users[user.id] = user;
    if (makeMe) s.meId = user.id;
  });
  return user;
}

export function switchUser(id: ID) {
  commit((s) => {
    s.meId = id;
  });
}

export function updateMe(patch: Partial<Pick<User, 'name' | 'emoji' | 'place'>>) {
  commit((s) => {
    if (s.meId) Object.assign(s.users[s.meId], patch);
  });
  const me = state.meId!;
  remote(() => cloud.updateProfile(me, { name: patch.name, emoji: patch.emoji }));
}

/** Create a lobby; resolves to its id. */
export async function createLobby(name: string): Promise<string> {
  if (cloudMode) {
    const id = await cloud.remoteCreateLobby(name.trim());
    await refresh();
    return id;
  }
  return createLocalLobby(name).id;
}

/** Join by invite code; resolves to the lobby id, or null if the code is wrong. */
export async function joinLobby(code: string): Promise<string | null> {
  if (cloudMode) {
    const id = await cloud.remoteJoinLobby(code);
    if (id) await refresh();
    return id;
  }
  return joinLocalLobby(code)?.id ?? null;
}

export function createLocalLobby(name: string): Lobby {
  const me = state.meId!;
  const lobby: Lobby = {
    id: uid(),
    name: name.trim(),
    code: randomCode(6),
    memberIds: [me],
    createdBy: me,
    createdAt: Date.now(),
  };
  commit((s) => {
    s.lobbies[lobby.id] = lobby;
  });
  return lobby;
}

function joinLocalLobby(code: string): Lobby | null {
  const me = state.meId!;
  const lobby = Object.values(state.lobbies).find((l) => l.code === code.trim().toUpperCase());
  if (!lobby) return null;
  commit((s) => {
    const l = s.lobbies[lobby.id];
    if (!l.memberIds.includes(me)) l.memberIds.push(me);
  });
  return state.lobbies[lobby.id];
}

export function myLobbies(s: State): Lobby[] {
  return Object.values(s.lobbies)
    .filter((l) => s.meId && l.memberIds.includes(s.meId))
    .sort((a, b) => lastActivity(s, b.id) - lastActivity(s, a.id));
}

function lastActivity(s: State, lobbyId: ID): number {
  let t = s.lobbies[lobbyId]?.createdAt ?? 0;
  for (const p of Object.values(s.posts)) if (p.lobbyId === lobbyId && p.createdAt > t) t = p.createdAt;
  return t;
}

// ---------------------------------------------------------------------------
// Posts, reactions, votes, comments, flags
// ---------------------------------------------------------------------------

export interface NewPost {
  lobbyId: ID;
  kind: PostKind;
  rootId?: ID;
  challengeId?: ID;
  title: string;
  rules: string[];
  spot?: Spot;
  distance?: DistanceBucket;
  distanceFt?: number;
  measured?: boolean;
  targetSize?: TargetSize;
  video: Blob;
  thumb?: Blob;
  misses: Blob[];
  attempts: number;
  target?: Target;
  trail?: Post['trail'];
  momentMs: number;
  durationMs: number;
  verifyCode: string;
  recordedAt: number;
  authorId?: ID; // defaults to me (demo seeding sets it)
}

export async function createPost(input: NewPost): Promise<Post> {
  if (cloudMode) return createCloudPost(input);
  const videoId = uid();
  await blobPut(videoId, input.video);
  let thumbId: ID | undefined;
  if (input.thumb) {
    thumbId = uid();
    await blobPut(thumbId, input.thumb);
  }
  const missIds: ID[] = [];
  for (const m of input.misses) {
    const id = uid();
    await blobPut(id, m);
    missIds.push(id);
  }
  const post: Post = {
    id: uid(),
    lobbyId: input.lobbyId,
    authorId: input.authorId ?? state.meId!,
    kind: input.kind,
    rootId: input.kind === 'original' ? undefined : input.rootId,
    challengeId: input.challengeId,
    title: input.title.trim(),
    rules: input.rules,
    spot: input.spot,
    distance: input.distance,
    distanceFt: input.distanceFt,
    measured: input.measured,
    targetSize: input.targetSize,
    videoId,
    thumbId,
    missIds,
    attempts: input.attempts,
    target: input.target,
    trail: input.trail,
    momentMs: input.momentMs,
    durationMs: input.durationMs,
    verifyCode: input.verifyCode,
    recordedAt: input.recordedAt,
    createdAt: Date.now(),
    reactions: {},
    votesUp: [],
    votesDown: [],
    flags: [],
    comments: [],
  };
  commit((s) => {
    s.posts[post.id] = post;
  });
  return post;
}

const extFor = (b: Blob) => (b.type.includes('mp4') ? 'mp4' : b.type.includes('jpeg') ? 'jpg' : 'webm');

async function createCloudPost(input: NewPost): Promise<Post> {
  const id = uid();
  const base = `${input.lobbyId}/${id}`;
  const video = `${base}/video.${extFor(input.video)}`;
  const thumb = input.thumb ? `${base}/thumb.jpg` : undefined;
  const misses = input.misses.map((m, i) => `${base}/miss-${i + 1}.${extFor(m)}`);
  await cloud.upload(video, input.video);
  if (thumb && input.thumb) await cloud.upload(thumb, input.thumb);
  for (let i = 0; i < misses.length; i++) await cloud.upload(misses[i], input.misses[i]);
  // Keep the just-recorded files on this phone so they play without re-downloading.
  await blobPut(cloud.CLOUD_PREFIX + video, input.video).catch(() => {});
  if (thumb && input.thumb) await blobPut(cloud.CLOUD_PREFIX + thumb, input.thumb).catch(() => {});
  const post: Post = {
    id,
    lobbyId: input.lobbyId,
    authorId: state.meId!,
    kind: input.kind,
    rootId: input.kind === 'original' ? undefined : input.rootId,
    challengeId: input.challengeId,
    title: input.title.trim(),
    rules: input.rules,
    spot: input.spot,
    distance: input.distance,
    distanceFt: input.distanceFt,
    measured: input.measured,
    targetSize: input.targetSize,
    videoId: cloud.CLOUD_PREFIX + video,
    thumbId: thumb && cloud.CLOUD_PREFIX + thumb,
    missIds: misses.map((m) => cloud.CLOUD_PREFIX + m),
    attempts: input.attempts,
    target: input.target,
    trail: input.trail,
    momentMs: input.momentMs,
    durationMs: input.durationMs,
    verifyCode: input.verifyCode,
    recordedAt: input.recordedAt,
    createdAt: Date.now(),
    reactions: {},
    votesUp: [],
    votesDown: [],
    flags: [],
    comments: [],
  };
  await cloud.insertPost(post, { video, thumb, misses });
  commit((s) => {
    s.posts[post.id] = post;
  });
  void refresh();
  return post;
}

/** Add a target / trail to an existing clip (author only). */
export async function savePostAnalysis(postId: ID, patch: { target: Target; trail?: Post['trail']; momentMs: number }) {
  if (cloudMode) await cloud.updatePostAnalysis(postId, patch);
  commit((s) => {
    const p = s.posts[postId];
    if (!p) return;
    p.target = patch.target;
    p.trail = patch.trail;
    p.momentMs = patch.momentMs;
  });
}

/** Authors and lobby admins can delete a clip. */
export function canDelete(s: State, p: Post): boolean {
  return p.authorId === s.meId || s.lobbies[p.lobbyId]?.createdBy === s.meId;
}

export async function deletePost(postId: ID): Promise<void> {
  const p = state.posts[postId];
  if (!p) return;
  if (cloudMode) await cloud.deletePostRemote(p);
  commit((s) => {
    for (const q of Object.values(s.posts)) if (q.id === postId || q.rootId === postId) delete s.posts[q.id];
  });
}

function toggle(list: ID[], id: ID): ID[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

/** One reaction per person per clip: picking another emoji switches it, the same one removes it. */
export function react(postId: ID, emoji: string, userId = state.meId!) {
  commit((s) => {
    const p = s.posts[postId];
    const had = (p.reactions[emoji] ?? []).includes(userId);
    for (const e of Object.keys(p.reactions)) p.reactions[e] = p.reactions[e].filter((id) => id !== userId);
    if (!had) p.reactions[emoji] = [...(p.reactions[emoji] ?? []), userId];
  });
  const on = (state.posts[postId].reactions[emoji] ?? []).includes(userId);
  remote(() => cloud.setReaction(postId, userId, on ? emoji : null));
}

/** Vote on a reply. up = "it beats / matches it". Voting again on the same side clears the vote. */
export function vote(postId: ID, up: boolean, userId = state.meId!) {
  commit((s) => {
    const p = s.posts[postId];
    if (p.authorId === userId) return;
    const mine = up ? p.votesUp : p.votesDown;
    const other = up ? p.votesDown : p.votesUp;
    const had = mine.includes(userId);
    const nextMine = had ? mine.filter((x) => x !== userId) : [...mine, userId];
    const nextOther = other.filter((x) => x !== userId);
    if (up) {
      p.votesUp = nextMine;
      p.votesDown = nextOther;
    } else {
      p.votesDown = nextMine;
      p.votesUp = nextOther;
    }
  });
  const p = state.posts[postId];
  if (p.authorId === userId) return;
  const now = p.votesUp.includes(userId) ? true : p.votesDown.includes(userId) ? false : null;
  remote(() => cloud.setVote(postId, userId, now));
}

export function flag(postId: ID, userId = state.meId!) {
  commit((s) => {
    const p = s.posts[postId];
    if (p.authorId !== userId) p.flags = toggle(p.flags, userId);
  });
  const p = state.posts[postId];
  if (p.authorId !== userId) remote(() => cloud.setFlag(postId, userId, p.flags.includes(userId)));
}

export function addComment(postId: ID, text: string, userId = state.meId!) {
  if (!text.trim()) return;
  const c = { id: uid(), userId, text: text.trim(), createdAt: Date.now() };
  commit((s) => {
    s.posts[postId].comments.push(c);
  });
  remote(() => cloud.insertComment(c, postId));
}

// ---------------------------------------------------------------------------
// Game rules: verdicts, crowns, points
// ---------------------------------------------------------------------------

/** Votes needed to decide a reply or hide a flagged clip. Scales with lobby size. */
export function votesNeeded(s: State, lobbyId: ID): number {
  const n = s.lobbies[lobbyId]?.memberIds.length ?? 1;
  if (n <= 3) return 1;
  if (n <= 6) return 2;
  return 3;
}

export function isHidden(s: State, p: Post): boolean {
  return p.flags.length >= votesNeeded(s, p.lobbyId) + 1;
}

export type Verdict = 'pending' | 'won' | 'lost';

export function verdict(s: State, p: Post): Verdict {
  if (p.kind === 'original') return 'won';
  const need = votesNeeded(s, p.lobbyId);
  const up = p.votesUp.length;
  const down = p.votesDown.length;
  if (up >= need && up > down) return 'won';
  if (down >= need && down >= up) return 'lost';
  return 'pending';
}

export function repliesOf(s: State, rootId: ID): Post[] {
  return Object.values(s.posts)
    .filter((p) => p.rootId === rootId)
    .sort((a, b) => a.createdAt - b.createdAt);
}

/** The clip that currently holds the crown in a chain: the latest upped reply the lobby accepted. */
export function champion(s: State, rootId: ID): Post | undefined {
  const root = s.posts[rootId];
  if (!root) return undefined;
  const winners = repliesOf(s, rootId).filter(
    (p) => p.kind === 'upped' && !isHidden(s, p) && verdict(s, p) === 'won',
  );
  return winners.at(-1) ?? (isHidden(s, root) ? undefined : root);
}

export const POINTS = {
  original: 10,
  matched: 15,
  upped: 30,
  crown: 25,
  reaction: 1,
  fire: 2,
};

export interface Score {
  user: User;
  points: number;
  crowns: number;
  posts: number;
}

export function scoreboard(s: State, opts: { lobbyId?: ID; userIds?: ID[]; since?: number }): Score[] {
  const scores = new Map<ID, Score>();
  const get = (id: ID) => {
    let sc = scores.get(id);
    if (!sc && s.users[id]) {
      sc = { user: s.users[id], points: 0, crowns: 0, posts: 0 };
      scores.set(id, sc);
    }
    return sc;
  };
  const pool = opts.userIds ?? (opts.lobbyId ? s.lobbies[opts.lobbyId]?.memberIds : Object.keys(s.users)) ?? [];
  pool.forEach(get);

  for (const p of Object.values(s.posts)) {
    if (opts.lobbyId && p.lobbyId !== opts.lobbyId) continue;
    if (opts.since && p.createdAt < opts.since) continue;
    if (isHidden(s, p)) continue;
    const sc = get(p.authorId);
    if (!sc || !pool.includes(p.authorId)) continue;
    sc.posts++;
    const v = verdict(s, p);
    if (p.kind === 'original') sc.points += POINTS.original;
    if (p.kind === 'matched' && v === 'won') sc.points += POINTS.matched;
    if (p.kind === 'upped' && v === 'won') sc.points += POINTS.upped;
    for (const [emoji, ids] of Object.entries(p.reactions)) {
      const others = ids.filter((id) => id !== p.authorId).length;
      sc.points += others * (emoji === '🔥' ? POINTS.fire : POINTS.reaction);
    }
    if (p.kind === 'original') {
      const champ = champion(s, p.id);
      const holder = champ && get(champ.authorId);
      if (holder && pool.includes(champ.authorId)) {
        holder.points += POINTS.crown;
        holder.crowns++;
      }
    }
  }
  return [...scores.values()].sort((a, b) => b.points - a.points || b.crowns - a.crowns);
}

export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export const LOCAL_RADIUS_KM = 50;

// ---------------------------------------------------------------------------
// Challenges
// ---------------------------------------------------------------------------

const OFFICIAL_POOL: Array<Pick<Challenge, 'title' | 'description' | 'rules'>> = [
  { title: 'Bank it from 20+ ft', description: 'Any bank shot from at least 20 feet. Call the backboard square.', rules: ['Bank shot'] },
  { title: 'Bedroom 3-bounce', description: 'Three bounces off anything before it drops in. Furniture counts.', rules: ['Trick bounce'] },
  { title: 'Wrong hand only', description: 'Make it with your non-dominant hand. Any distance, any target.', rules: ['Non-dominant hand'] },
  { title: 'Not a basketball', description: 'Sock, paper ball, orange, shoe. Anything but a basketball.', rules: ['Not a basketball'] },
  { title: 'Blind make', description: 'Eyes closed (or facing away) when it leaves your hands.', rules: ['Eyes closed'] },
  { title: 'Off the wall', description: 'It has to hit a wall before the target.', rules: ['Off the wall'] },
  { title: 'Over the shoulder', description: 'Back to the target. Over the shoulder. Money.', rules: ['Over the shoulder'] },
];

function weekIndex(t: number): number {
  return Math.floor(startOfWeek(t) / (7 * DAY));
}

/** Rotate in three official challenges each week (deterministic, so every player sees the same ones). */
function ensureOfficialChallenges() {
  const start = startOfWeek();
  const w = weekIndex(start);
  const missing: Challenge[] = [];
  for (let i = 0; i < 3; i++) {
    const id = `official-${w}-${i}`;
    if (state.challenges[id]) continue;
    const base = OFFICIAL_POOL[(w * 3 + i) % OFFICIAL_POOL.length];
    missing.push({ id, lobbyId: null, createdBy: null, startsAt: start, endsAt: start + 7 * DAY, ...base });
  }
  if (missing.length) {
    const next = structuredClone(state);
    missing.forEach((c) => (next.challenges[c.id] = c));
    state = next;
    if (!cloudMode) void kvSet(KEY, state);
  }
}

export function createChallenge(input: Omit<Challenge, 'id' | 'createdBy' | 'startsAt'>): Challenge {
  const c: Challenge = { ...input, id: uid(), createdBy: state.meId, startsAt: Date.now() };
  commit((s) => {
    s.challenges[c.id] = c;
  });
  remote(() => cloud.insertChallenge(c));
  return c;
}

export function visibleChallenges(s: State): Challenge[] {
  const mine = new Set(myLobbies(s).map((l) => l.id));
  return Object.values(s.challenges)
    .filter((c) => c.lobbyId === null || mine.has(c.lobbyId))
    .sort((a, b) => a.endsAt - b.endsAt);
}

export function challengeEntries(s: State, challengeId: ID): Array<{ post: Post; score: number }> {
  return Object.values(s.posts)
    .filter((p) => p.challengeId === challengeId && !isHidden(s, p))
    .map((post) => {
      let score = 0;
      for (const [emoji, ids] of Object.entries(post.reactions)) {
        score += ids.filter((id) => id !== post.authorId).length * (emoji === '🔥' ? 2 : 1);
      }
      return { post, score };
    })
    .sort((a, b) => b.score - a.score || a.post.createdAt - b.post.createdAt);
}

// ---------------------------------------------------------------------------

export async function resetEverything() {
  if (cloudMode) {
    unsubscribeLive?.();
    unsubscribeLive = null;
    await cloud.signOut();
  }
  await clearAll();
  state = empty();
  ensureOfficialChallenges();
  emit();
}

/** Direct mutation for demo seeding. */
export function seed(mutator: (s: State) => void) {
  commit(mutator);
}
