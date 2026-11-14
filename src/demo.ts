// Builds a demo lobby with animated sample clips so the app can be tried
// without filming anything. Clips are drawn on a canvas and recorded for real,
// using the same overlay and recorder as live shots.

import { canvasToBlob, drawOverlay, pickMimeType } from './capture';
import { addComment, createChallenge, createLobby, createPost, createUser, DAY, getState, react, seed, vote } from './store';
import type { Target } from './types';

interface Scene {
  bg: [string, string];
  floor: string;
  start: [number, number];
  target: Target;
  bounces: Array<[number, number]>; // intermediate points the ball hits
  ball: string;
  hoop: 'hamper' | 'hoop' | 'cup';
  makes: boolean;
}

const W = 640;
const H = 360;
const DURATION = 3600;

async function film(scene: Scene, code: string, attempt: number) {
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d')!;
  const thumb = document.createElement('canvas');
  thumb.width = 480;
  thumb.height = 270;

  const pts: Array<[number, number]> = [scene.start, ...scene.bounces, [scene.target.x * W, scene.target.y * H]];
  if (!scene.makes) pts[pts.length - 1] = [scene.target.x * W + 40, scene.target.y * H - 10];
  const flightStart = 900;
  const flightEnd = 2400;
  const momentMs = flightEnd;

  const ballAt = (t: number): [number, number] | null => {
    if (t < flightStart) return [scene.start[0], scene.start[1]];
    if (t > flightEnd) {
      if (!scene.makes) {
        const k = (t - flightEnd) / 1000;
        return [pts.at(-1)![0] + k * 120, pts.at(-1)![1] + k * k * 400];
      }
      return null; // dropped in
    }
    const k = (t - flightStart) / (flightEnd - flightStart);
    const seg = Math.min(pts.length - 2, Math.floor(k * (pts.length - 1)));
    const lk = k * (pts.length - 1) - seg;
    const [x0, y0] = pts[seg];
    const [x1, y1] = pts[seg + 1];
    const arc = Math.min(110, Math.abs(x1 - x0) * 0.45);
    return [x0 + (x1 - x0) * lk, y0 + (y1 - y0) * lk - Math.sin(lk * Math.PI) * arc];
  };

  const draw = (t: number) => {
    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, scene.bg[0]);
    g.addColorStop(1, scene.bg[1]);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);
    ctx.fillStyle = scene.floor;
    ctx.fillRect(0, H * 0.78, W, H * 0.22);
    // shooter
    ctx.fillStyle = '#2a2f3a';
    ctx.fillRect(scene.start[0] - 14, scene.start[1] + 8, 28, H * 0.78 - scene.start[1] - 8);
    ctx.beginPath();
    ctx.arc(scene.start[0], scene.start[1] - 6, 12, 0, Math.PI * 2);
    ctx.fill();
    // target object
    const tx = scene.target.x * W;
    const ty = scene.target.y * H;
    const tr = scene.target.r * W;
    ctx.fillStyle = '#d0d4dc';
    if (scene.hoop === 'hoop') {
      ctx.fillStyle = '#e9edf3';
      ctx.fillRect(tx - tr * 1.6, ty - tr * 2.6, tr * 3.2, tr * 2.2);
      ctx.strokeStyle = '#ff6a2b';
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(tx, ty, tr * 0.9, tr * 0.25, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)';
      ctx.lineWidth = 1.5;
      for (let i = -2; i <= 2; i++) {
        ctx.beginPath();
        ctx.moveTo(tx + i * tr * 0.4, ty);
        ctx.lineTo(tx + i * tr * 0.25, ty + tr * 1.1);
        ctx.stroke();
      }
      ctx.fillStyle = '#6b7280';
      ctx.fillRect(tx + tr * 1.5, ty - tr * 2.6, 6, H);
    } else {
      const top = ty;
      const bw = scene.hoop === 'cup' ? tr * 1.4 : tr * 1.9;
      ctx.fillStyle = scene.hoop === 'cup' ? '#e2384d' : '#8b6b4a';
      ctx.beginPath();
      ctx.moveTo(tx - bw, top);
      ctx.lineTo(tx + bw, top);
      ctx.lineTo(tx + bw * 0.8, H * 0.8);
      ctx.lineTo(tx - bw * 0.8, H * 0.8);
      ctx.closePath();
      ctx.fill();
    }
    // bounce surfaces
    ctx.fillStyle = 'rgba(255,255,255,0.12)';
    for (const [bx, by] of scene.bounces) ctx.fillRect(bx - 30, by + 10, 60, 6);
    // ball
    const b = ballAt(t);
    if (b) {
      ctx.fillStyle = scene.ball;
      ctx.beginPath();
      ctx.arc(b[0], b[1], 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.35)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }
    drawOverlay(ctx, W, H, {
      target: scene.target,
      code,
      attempt,
      recording: true,
      elapsedMs: t,
      clock: new Date(),
      hit: scene.makes && t >= momentMs && t < momentMs + 400,
    });
  };

  draw(0);
  const stream = c.captureStream(30);
  const mimeType = pickMimeType();
  const rec = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
  const chunks: Blob[] = [];
  rec.ondataavailable = (e) => e.data.size && chunks.push(e.data);
  const done = new Promise<void>((r) => (rec.onstop = () => r()));
  rec.start(200);
  const t0 = performance.now();
  let snapped = false;
  await new Promise<void>((resolve) => {
    const loop = () => {
      const t = performance.now() - t0;
      draw(Math.min(t, DURATION));
      if (!snapped && t >= momentMs) {
        thumb.getContext('2d')!.drawImage(c, 0, 0, thumb.width, thumb.height);
        snapped = true;
      }
      if (t >= DURATION) return resolve();
      // setTimeout keeps drawing even when the tab is not visible (rAF would pause).
      window.setTimeout(loop, 1000 / 30);
    };
    loop();
  });
  rec.stop();
  await done;
  return {
    video: new Blob(chunks, { type: rec.mimeType || mimeType || 'video/webm' }),
    thumb: (await canvasToBlob(thumb)) ?? undefined,
    momentMs,
    durationMs: DURATION,
  };
}

const ROOM: Omit<Scene, 'makes'> = {
  bg: ['#3a3350', '#241f33'],
  floor: '#5b4636',
  start: [90, 200],
  target: { x: 0.82, y: 0.6, r: 0.06 },
  bounces: [],
  ball: '#f2f2f2',
  hoop: 'hamper',
};

export async function buildDemo(progress: (msg: string) => void): Promise<string> {
  const me = getState().meId!;
  const jay = createUser('Jay', '🦅', false);
  const mo = createUser('Mo', '🐐', false);
  const priya = createUser('Priya', '⚡', false);
  const lobby = createLobby('Driveway Legends (demo)');
  seed((s) => {
    s.lobbies[lobby.id].memberIds.push(jay.id, mo.id, priya.id);
  });

  const shots: Array<{ who: string; scene: Omit<Scene, 'makes'>; misses: number; attempt: number }> = [
    { who: 'Jay', scene: ROOM, misses: 2, attempt: 9 },
    {
      who: 'Mo',
      scene: { ...ROOM, bg: ['#2d3b4f', '#1b2433'], bounces: [[330, 286]], ball: '#ff8a3d', start: [70, 210] },
      misses: 1,
      attempt: 23,
    },
    {
      who: 'Priya',
      scene: { ...ROOM, bg: ['#40333a', '#2a2026'], start: [100, 205] },
      misses: 0,
      attempt: 4,
    },
  ];

  const filmed = [];
  for (let i = 0; i < shots.length; i++) {
    const sh = shots[i];
    progress(`Filming ${sh.who}'s shot (${i + 1}/${shots.length})…`);
    const code = `D${i}${'MO'[i % 2]}X`;
    const make = await film({ ...sh.scene, makes: true }, code, sh.attempt);
    const misses = [];
    for (let m = 0; m < sh.misses; m++) {
      progress(`Filming ${sh.who}'s bloopers…`);
      misses.push((await film({ ...sh.scene, makes: false }, code, m + 1)).video);
    }
    filmed.push({ ...make, misses, code, attempt: sh.attempt });
  }

  progress('Setting up the lobby…');
  const now = Date.now();
  const root = await createPost({
    lobbyId: lobby.id,
    authorId: jay.id,
    kind: 'original',
    title: 'Couch-to-hamper fadeaway',
    rules: ['From the bed'],
    spot: 'home',
    video: filmed[0].video,
    thumb: filmed[0].thumb,
    misses: filmed[0].misses,
    attempts: filmed[0].attempt,
    target: ROOM.target,
    momentMs: filmed[0].momentMs,
    durationMs: filmed[0].durationMs,
    verifyCode: filmed[0].code,
    recordedAt: now - 2 * DAY,
  });
  const upped = await createPost({
    lobbyId: lobby.id,
    authorId: mo.id,
    kind: 'upped',
    rootId: root.id,
    title: '',
    rules: ['From the bed', 'Trick bounce'],
    spot: 'home',
    video: filmed[1].video,
    thumb: filmed[1].thumb,
    misses: filmed[1].misses,
    attempts: filmed[1].attempt,
    target: ROOM.target,
    momentMs: filmed[1].momentMs,
    durationMs: filmed[1].durationMs,
    verifyCode: filmed[1].code,
    recordedAt: now - DAY,
  });
  const matched = await createPost({
    lobbyId: lobby.id,
    authorId: priya.id,
    kind: 'matched',
    rootId: root.id,
    title: '',
    rules: ['From the bed'],
    spot: 'home',
    video: filmed[2].video,
    thumb: filmed[2].thumb,
    misses: [],
    attempts: filmed[2].attempt,
    target: ROOM.target,
    momentMs: filmed[2].momentMs,
    durationMs: filmed[2].durationMs,
    verifyCode: filmed[2].code,
    recordedAt: now - DAY / 2,
  });
  // Backdate so the feed looks lived-in.
  seed((s) => {
    s.posts[root.id].createdAt = now - 2 * DAY;
    s.posts[upped.id].createdAt = now - DAY;
    s.posts[matched.id].createdAt = now - DAY / 2;
  });

  react(root.id, '🔥', mo.id);
  react(root.id, '🔥', priya.id);
  react(root.id, '😱', me);
  react(upped.id, '🐐', jay.id);
  react(upped.id, '🔥', priya.id);
  react(matched.id, '😂', mo.id);
  vote(upped.id, true, priya.id);
  vote(upped.id, true, jay.id);
  vote(matched.id, true, jay.id);
  addComment(root.id, 'Nine tries. Nobody is matching this.', jay.id);
  addComment(root.id, 'Off the floor first. Crown is mine 👑', mo.id);
  addComment(root.id, "23 attempts tho 😂", priya.id);

  createChallenge({
    lobbyId: lobby.id,
    title: 'Best shot from the roof',
    description: 'Shoot from anywhere higher than the hoop. Safely. Most 🔥 by Friday wins.',
    rules: [],
    endsAt: now + 3 * DAY,
  });

  return lobby.id;
}
