// Supabase backend. Active when the app is built with VITE_SUPABASE_URL and
// VITE_SUPABASE_KEY (the publishable/anon key, which is safe to ship).
// Without them the app runs in "this phone only" mode on IndexedDB.

import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { Challenge, Comment, ID, Lobby, Post, State, User } from './types';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const key = import.meta.env.VITE_SUPABASE_KEY as string | undefined;

export const sb: SupabaseClient | null = url && key ? createClient(url, key, { auth: { persistSession: true } }) : null;
export const cloudEnabled = !!sb;

export const BUCKET = 'clips';
export const CLOUD_PREFIX = 'cloud:';

const ms = (t: string | null | undefined) => (t ? new Date(t).getTime() : 0);
const iso = (t: number) => new Date(t).toISOString();

function must<T>(res: { data: T | null; error: { message: string } | null }): T {
  if (res.error) throw new Error(res.error.message);
  return res.data as T;
}

export async function currentUserId(): Promise<string | null> {
  if (!sb) return null;
  const { data } = await sb.auth.getSession();
  return data.session?.user.id ?? null;
}

/** Signs this phone in anonymously (no email) and creates the player profile. */
export async function signUp(name: string, emoji: string): Promise<string> {
  const client = sb!;
  let uid = await currentUserId();
  if (!uid) {
    const { data, error } = await client.auth.signInAnonymously();
    if (error) {
      if (/anonymous/i.test(error.message)) {
        throw new Error('Anonymous sign-ins are turned off in Supabase. Turn them on: Authentication > Sign In / Providers.');
      }
      throw new Error(error.message);
    }
    uid = data.user!.id;
  }
  must(await client.from('profiles').upsert({ id: uid, name: name.trim(), emoji }));
  return uid;
}

export async function signOut() {
  await sb?.auth.signOut();
}

/** Loads everything this player can see. Row level security limits it to their lobbies. */
export async function fetchAll(meId: string): Promise<Omit<State, 'version'>> {
  const c = sb!;
  const [profiles, lobbies, members, posts, reactions, votes, flags, comments, challenges] = await Promise.all([
    c.from('profiles').select('*'),
    c.from('lobbies').select('*'),
    c.from('lobby_members').select('*'),
    c.from('posts').select('*').order('created_at', { ascending: false }).limit(1000),
    c.from('reactions').select('*'),
    c.from('votes').select('*'),
    c.from('flags').select('*'),
    c.from('comments').select('*').order('created_at'),
    c.from('challenges').select('*'),
  ]);

  const users: Record<ID, User> = {};
  for (const p of must<any[]>(profiles)) users[p.id] = { id: p.id, name: p.name, emoji: p.emoji, createdAt: ms(p.created_at) };

  const lobbyMap: Record<ID, Lobby> = {};
  for (const l of must<any[]>(lobbies)) {
    lobbyMap[l.id] = { id: l.id, name: l.name, code: l.code, createdBy: l.created_by, createdAt: ms(l.created_at), memberIds: [] };
  }
  for (const m of must<any[]>(members)) lobbyMap[m.lobby_id]?.memberIds.push(m.user_id);

  const postMap: Record<ID, Post> = {};
  for (const p of must<any[]>(posts)) {
    postMap[p.id] = {
      id: p.id,
      lobbyId: p.lobby_id,
      authorId: p.author_id,
      kind: p.kind,
      rootId: p.root_id ?? undefined,
      challengeId: p.challenge_id ?? undefined,
      title: p.title,
      rules: p.rules ?? [],
      spot: p.spot ?? undefined,
      distance: p.distance ?? undefined,
      distanceFt: p.distance_ft ?? undefined,
      measured: p.measured ?? false,
      targetSize: p.target_size ?? undefined,
      videoId: CLOUD_PREFIX + p.video_path,
      thumbId: p.thumb_path ? CLOUD_PREFIX + p.thumb_path : undefined,
      missIds: (p.miss_paths ?? []).map((m: string) => CLOUD_PREFIX + m),
      attempts: p.attempts,
      target: p.target ?? undefined,
      momentMs: p.moment_ms,
      durationMs: p.duration_ms,
      verifyCode: p.verify_code,
      recordedAt: ms(p.recorded_at),
      createdAt: ms(p.created_at),
      reactions: {},
      votesUp: [],
      votesDown: [],
      flags: [],
      comments: [],
    };
  }
  for (const r of must<any[]>(reactions)) {
    const p = postMap[r.post_id];
    if (p) (p.reactions[r.emoji] ??= []).push(r.user_id);
  }
  for (const v of must<any[]>(votes)) {
    const p = postMap[v.post_id];
    if (p) (v.up ? p.votesUp : p.votesDown).push(v.user_id);
  }
  for (const f of must<any[]>(flags)) postMap[f.post_id]?.flags.push(f.user_id);
  for (const cm of must<any[]>(comments)) {
    const comment: Comment = { id: cm.id, userId: cm.user_id, text: cm.text, createdAt: ms(cm.created_at) };
    postMap[cm.post_id]?.comments.push(comment);
  }

  const challengeMap: Record<ID, Challenge> = {};
  for (const ch of must<any[]>(challenges)) {
    challengeMap[ch.id] = {
      id: ch.id,
      lobbyId: ch.lobby_id,
      title: ch.title,
      description: ch.description,
      rules: ch.rules ?? [],
      createdBy: ch.created_by,
      startsAt: ms(ch.starts_at),
      endsAt: ms(ch.ends_at),
    };
  }

  return { meId, users, lobbies: lobbyMap, posts: postMap, challenges: challengeMap };
}

export async function remoteCreateLobby(name: string): Promise<string> {
  const row = must<any>(await sb!.rpc('create_lobby', { p_name: name }));
  return row.id;
}

export async function remoteJoinLobby(code: string): Promise<string | null> {
  return must<string | null>(await sb!.rpc('join_lobby', { p_code: code }));
}

export async function upload(path: string, blob: Blob): Promise<void> {
  const contentType = blob.type.split(';')[0] || 'video/webm';
  const { error } = await sb!.storage.from(BUCKET).upload(path, blob, { contentType, upsert: false });
  if (error) throw new Error(`Upload failed: ${error.message}`);
}

export async function download(path: string): Promise<Blob | undefined> {
  const { data, error } = await sb!.storage.from(BUCKET).download(path);
  if (error) return undefined;
  return data;
}

export async function insertPost(p: Post, paths: { video: string; thumb?: string; misses: string[] }) {
  must(
    await sb!.from('posts').insert({
      id: p.id,
      lobby_id: p.lobbyId,
      author_id: p.authorId,
      kind: p.kind,
      root_id: p.rootId ?? null,
      challenge_id: p.challengeId ?? null,
      title: p.title,
      rules: p.rules,
      spot: p.spot ?? null,
      distance: p.distance ?? null,
      distance_ft: p.distanceFt ?? null,
      measured: !!p.measured,
      target_size: p.targetSize ?? null,
      video_path: paths.video,
      thumb_path: paths.thumb ?? null,
      miss_paths: paths.misses,
      attempts: p.attempts,
      target: p.target ?? null,
      moment_ms: Math.round(p.momentMs),
      duration_ms: Math.round(p.durationMs),
      verify_code: p.verifyCode,
      recorded_at: iso(p.recordedAt),
    }),
  );
}

export async function deletePostRemote(p: Post) {
  must(await sb!.from('posts').delete().eq('id', p.id));
  const paths = [p.videoId, p.thumbId, ...p.missIds]
    .filter((x): x is string => !!x && x.startsWith(CLOUD_PREFIX))
    .map((x) => x.slice(CLOUD_PREFIX.length));
  if (paths.length) await sb!.storage.from(BUCKET).remove(paths);
}

export async function setReaction(postId: ID, userId: ID, emoji: string, on: boolean) {
  if (on) must(await sb!.from('reactions').upsert({ post_id: postId, user_id: userId, emoji }));
  else must(await sb!.from('reactions').delete().match({ post_id: postId, user_id: userId, emoji }));
}

export async function setVote(postId: ID, userId: ID, up: boolean | null) {
  if (up === null) must(await sb!.from('votes').delete().match({ post_id: postId, user_id: userId }));
  else must(await sb!.from('votes').upsert({ post_id: postId, user_id: userId, up }));
}

export async function setFlag(postId: ID, userId: ID, on: boolean) {
  if (on) must(await sb!.from('flags').upsert({ post_id: postId, user_id: userId }));
  else must(await sb!.from('flags').delete().match({ post_id: postId, user_id: userId }));
}

export async function insertComment(c: Comment, postId: ID) {
  must(await sb!.from('comments').insert({ id: c.id, post_id: postId, user_id: c.userId, text: c.text }));
}

export async function insertChallenge(c: Challenge) {
  must(
    await sb!.from('challenges').insert({
      id: c.id,
      lobby_id: c.lobbyId,
      title: c.title,
      description: c.description,
      rules: c.rules,
      created_by: c.createdBy,
      ends_at: iso(c.endsAt),
    }),
  );
}

export async function updateProfile(userId: ID, patch: { name?: string; emoji?: string }) {
  must(await sb!.from('profiles').update(patch).eq('id', userId));
}

/** Calls `onChange` (debounced) whenever anything this player can see changes. */
export function subscribe(onChange: () => void): () => void {
  if (!sb) return () => {};
  let t: number | undefined;
  const fire = () => {
    window.clearTimeout(t);
    t = window.setTimeout(onChange, 400);
  };
  const channel = sb
    .channel('upped-live')
    .on('postgres_changes', { event: '*', schema: 'public' }, fire)
    .subscribe();
  const onFocus = () => document.visibilityState === 'visible' && fire();
  document.addEventListener('visibilitychange', onFocus);
  return () => {
    document.removeEventListener('visibilitychange', onFocus);
    void sb!.removeChannel(channel);
  };
}
