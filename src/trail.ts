// Flight trail: finds the thrown object in the last seconds of a clip and fits
// the arc it flew along, so playback can draw a glowing trail behind it.
//
// 1. While recording, keep small grayscale copies of each frame (FlightFrames).
// 2. After the make, look for small things that move between frames
//    (three-frame differencing, so only the object's current position lights up).
// 3. Anything thrown flies in a smooth arc, so fit one (RANSAC: try many arcs
//    through a few sightings, keep the one most sightings agree with). The
//    called target is where the arc must end, which makes this much more robust.
// Even a handful of sightings at 30-60 fps gives a full, smooth trail.

export interface TrailPoint {
  t: number; // ms into the clip
  x: number; // 0..1 of frame width
  y: number; // 0..1 of frame height
}

const SMALL_W = 192;
const KEEP_MS = 7000;

interface Frame {
  t: number;
  data: Uint8Array;
}

/** Rolling buffer of small grayscale frames taken while recording. */
export class FlightFrames {
  readonly w = SMALL_W;
  h = 108;
  frames: Frame[] = [];
  private canvas = document.createElement('canvas');
  private ctx: CanvasRenderingContext2D;

  constructor(private keepMs = KEEP_MS) {
    this.ctx = this.canvas.getContext('2d', { willReadFrequently: true })!;
  }

  reset() {
    this.frames = [];
  }

  push(src: CanvasImageSource, srcW: number, srcH: number, t: number) {
    const h = Math.max(1, Math.round((SMALL_W * srcH) / srcW));
    if (this.canvas.width !== SMALL_W || this.canvas.height !== h) {
      this.canvas.width = SMALL_W;
      this.canvas.height = h;
      this.h = h;
      this.frames = [];
    }
    this.ctx.drawImage(src, 0, 0, SMALL_W, h);
    const rgba = this.ctx.getImageData(0, 0, SMALL_W, h).data;
    const gray = new Uint8Array(SMALL_W * h);
    for (let i = 0, j = 0; j < gray.length; i += 4, j++) gray[j] = (rgba[i] * 77 + rgba[i + 1] * 150 + rgba[i + 2] * 29) >> 8;
    // The screen redraws faster than many cameras deliver frames; skip repeats,
    // or every other frame would look like "nothing moved".
    const prev = this.frames[this.frames.length - 1];
    if (prev && prev.data.length === gray.length) {
      let same = true;
      for (let k = 0; k < gray.length; k += 97) {
        if (gray[k] !== prev.data[k]) {
          same = false;
          break;
        }
      }
      if (same) return;
    }
    this.frames.push({ t, data: gray });
    while (this.frames.length && t - this.frames[0].t > this.keepMs) this.frames.shift();
  }
}

/**
 * Where the app burns its labels into the video (see drawOverlay): the strip
 * along the top and the recording timer at the bottom right. Their text
 * changes every frame, which looks like motion, so it is ignored.
 */
function inLabels(x: number, y: number, w: number, h: number): boolean {
  const u = 1 / 100; // label sizes are relative to the frame width
  const topBand = (u * 6 * w) / h;
  const bottomBand = (u * 7 * w) / h;
  return y < topBand || (y > 1 - bottomBand && x > 0.72);
}

interface Sighting {
  area?: number;
  tau: number; // seconds relative to the landing (negative = before)
  x: number;
  y: number;
  frame: number;
}

/** Small moving blobs in each frame: where the object probably is. */
function sightings(frames: Frame[], w: number, h: number, momentMs: number): { out: Sighting[]; shaky: number } {
  const out: Sighting[] = [];
  let shaky = 0;
  const n = w * h;
  const mask = new Uint8Array(n);
  const label = new Int32Array(n);
  const maxArea = n * 0.012;
  for (let i = 1; i < frames.length - 1; i++) {
    const a = frames[i - 1].data;
    const b = frames[i].data;
    const c = frames[i + 1].data;
    // adaptive threshold from the typical change level of this frame
    let sum = 0;
    for (let p = 0; p < n; p += 7) sum += Math.abs(b[p] - a[p]);
    const th = Math.max(18, (sum / (n / 7)) * 4);
    let on = 0;
    for (let p = 0; p < n; p++) {
      const m = Math.abs(b[p] - a[p]) > th && Math.abs(c[p] - b[p]) > th ? 1 : 0;
      mask[p] = m;
      on += m;
    }
    if (on > n * 0.12) shaky++;
    if (on === 0 || on > n * 0.12) continue; // nothing moving, or the whole picture shook
    label.fill(0);
    let next = 1;
    const stack: number[] = [];
    const blobs: Array<{ x: number; y: number; area: number }> = [];
    for (let p = 0; p < n; p++) {
      if (!mask[p] || label[p]) continue;
      let area = 0;
      let sx = 0;
      let sy = 0;
      label[p] = next;
      stack.push(p);
      while (stack.length) {
        const q = stack.pop()!;
        const qx = q % w;
        const qy = (q - qx) / w;
        area++;
        sx += qx;
        sy += qy;
        // 8-neighbourhood so a thin blur streak stays one blob
        for (let dy = -1; dy <= 1; dy++) {
          const ny = qy + dy;
          if (ny < 0 || ny >= h) continue;
          for (let dx = -1; dx <= 1; dx++) {
            const nx = qx + dx;
            if (nx < 0 || nx >= w || (dx === 0 && dy === 0)) continue;
            const r = ny * w + nx;
            if (mask[r] && !label[r]) {
              label[r] = next;
              stack.push(r);
            }
          }
        }
      }
      next++;
      const bx = sx / area / w;
      const by = sy / area / h;
      // Single-pixel specks are compression noise; the app's own labels tick every frame.
      if (area >= 2 && area <= maxArea && !inLabels(bx, by, w, h)) blobs.push({ x: bx, y: by, area });
    }
    // An arm or body makes big blobs; keep the smaller ones, at most a few per frame.
    blobs.sort((p, q) => p.area - q.area);
    for (const bl of blobs.slice(0, 6)) out.push({ tau: (frames[i].t - momentMs) / 1000, x: bl.x, y: bl.y, frame: i, area: bl.area });
  }
  return { out, shaky: shaky / Math.max(1, frames.length - 2) };
}

interface Arc {
  ax: number;
  bx: number;
  ay: number;
  by: number;
  cy: number;
}

const at = (m: Arc, tau: number) => ({ x: m.ax + m.bx * tau, y: m.ay + m.by * tau + m.cy * tau * tau });

/** Least-squares fit of x = a + b·τ and y = a + b·τ + c·τ² (weighted). */
function fit(pts: Array<{ tau: number; x: number; y: number; wt: number }>): Arc | null {
  let s0 = 0, s1 = 0, s2 = 0, s3 = 0, s4 = 0, sx0 = 0, sx1 = 0, sy0 = 0, sy1 = 0, sy2 = 0;
  for (const p of pts) {
    const t = p.tau, w = p.wt, t2 = t * t;
    s0 += w; s1 += w * t; s2 += w * t2; s3 += w * t2 * t; s4 += w * t2 * t2;
    sx0 += w * p.x; sx1 += w * p.x * t;
    sy0 += w * p.y; sy1 += w * p.y * t; sy2 += w * p.y * t2;
  }
  const dx = s0 * s2 - s1 * s1;
  if (Math.abs(dx) < 1e-9) return null;
  const bx = (s0 * sx1 - s1 * sx0) / dx;
  const ax = (sx0 - bx * s1) / s0;
  // 3x3 normal equations for the quadratic (Cramer's rule)
  const det = (a: number[][]) =>
    a[0][0] * (a[1][1] * a[2][2] - a[1][2] * a[2][1]) - a[0][1] * (a[1][0] * a[2][2] - a[1][2] * a[2][0]) + a[0][2] * (a[1][0] * a[2][1] - a[1][1] * a[2][0]);
  const M = [[s0, s1, s2], [s1, s2, s3], [s2, s3, s4]];
  const D = det(M);
  if (Math.abs(D) < 1e-12) return null;
  const rhs = [sy0, sy1, sy2];
  const col = (k: number) => M.map((row, r) => row.map((v, c) => (c === k ? rhs[r] : v)));
  return { ax, bx, ay: det(col(0)) / D, by: det(col(1)) / D, cy: det(col(2)) / D };
}

/** Numbers from the last search, for troubleshooting (window.__uppedTrail). */
export const debug: Record<string, unknown> = { frames: 0, sightings: 0, inliers: 0 };
if (typeof window !== 'undefined') (window as unknown as { __uppedTrail: typeof debug }).__uppedTrail = debug;

export interface TrailOptions {
  momentMs: number;
  /** Called target: the arc should end here at the landing moment. */
  anchor?: { x: number; y: number };
  aspect: number; // width / height, so distances are measured fairly
  /** Only use this part of the clip (e.g. after a flip from the selfie camera). */
  fromMs?: number;
  toMs?: number;
}

/** Find the flight arc. Returns trail points from release to landing, or null. */
export function findTrail(buf: FlightFrames, opts: TrailOptions): TrailPoint[] | null {
  // Throws in a room or on a court are in the air for well under 1.5 seconds.
  const lo = Math.max(opts.momentMs - 1500, opts.fromMs ?? -Infinity);
  const hi = Math.min(opts.momentMs + 200, opts.toMs ?? Infinity);
  const frames = buf.frames.filter((f) => f.t >= lo && f.t <= hi);
  if (frames.length < 6) return null;
  const seen = sightings(frames, buf.w, buf.h, opts.momentMs);
  const all = seen.out.filter((s) => s.tau <= 0.08);
  debug.shaky = +seen.shaky.toFixed(2);
  debug.reason = 'camera moving too much';
  // A phone swinging around makes the whole picture change: nothing can be trusted.
  if (seen.shaky > 0.35) return null;
  debug.frames = frames.length;
  debug.sightings = all.length;
  debug.inliers = 0;
  if (all.length < 3) return null;

  const tol = 0.035;
  const dist = (m: Arc, s: Sighting) => {
    const p = at(m, s.tau);
    return Math.hypot((p.x - s.x) * opts.aspect, p.y - s.y);
  };
  const anchorPts = opts.anchor ? [{ tau: 0, x: opts.anchor.x, y: opts.anchor.y, wt: 3 }] : [];

  // Deterministic pseudo-random so the same clip always gives the same trail.
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);

  let best: { arc: Arc; frames: Set<number>; inl: Sighting[] } | null = null;
  const tries = Math.min(600, all.length * all.length * 2);
  for (let k = 0; k < tries; k++) {
    const need = opts.anchor ? 2 : 3;
    const pick: Sighting[] = [];
    for (let g = 0; g < 20 && pick.length < need; g++) {
      const s = all[Math.floor(rnd() * all.length)];
      if (pick.every((p) => p.frame !== s.frame && Math.abs(p.tau - s.tau) > 0.03)) pick.push(s);
    }
    if (pick.length < need) continue;
    const arc = fit([...anchorPts, ...pick.map((p) => ({ ...p, wt: 1 }))]);
    if (!arc) continue;
    const inl = all.filter((s) => dist(arc, s) < tol);
    const fr = new Set(inl.map((s) => s.frame));
    if (!best || fr.size > best.frames.size) best = { arc, frames: fr, inl };
  }
  debug.inliers = best?.frames.size ?? 0;
  if (!best || best.frames.size < (opts.anchor ? 3 : 4)) return null;

  // Refine with every agreeing sighting (one per frame: the closest).
  const perFrame = new Map<number, Sighting>();
  for (const s of best.inl) {
    const cur = perFrame.get(s.frame);
    if (!cur || dist(best.arc, s) < dist(best.arc, cur)) perFrame.set(s.frame, s);
  }
  const used = [...perFrame.values()].sort((a, b) => a.frame - b.frame);

  // Be strict. A real throw is seen in several frames in a row, moving along
  // the arc. A curve stitched together from scattered specks (shake, a hand,
  // reflections) is a guess, and a confident-looking wrong trail is worse
  // than none.
  let run = 1;
  let longest = 1;
  for (let i = 1; i < used.length; i++) {
    run = used[i].frame - used[i - 1].frame <= 2 ? run + 1 : 1;
    longest = Math.max(longest, run);
  }
  debug.longestRun = longest;
  debug.reason = 'not enough of the flight seen';
  if (used.length < 6 || longest < 5) return null;

  // It has to actually fly: real progress from sighting to sighting, mostly in
  // one direction. Flicker and noise jitter in place.
  const steps: Array<[number, number]> = [];
  for (let i = 1; i < used.length; i++) {
    if (used[i].frame - used[i - 1].frame > 2) continue;
    steps.push([(used[i].x - used[i - 1].x) * opts.aspect, used[i].y - used[i - 1].y]);
  }
  const net: [number, number] = [(used[used.length - 1].x - used[0].x) * opts.aspect, used[used.length - 1].y - used[0].y];
  const netLen = Math.hypot(net[0], net[1]);
  const stepLens = steps.map(([a, b]) => Math.hypot(a, b)).sort((a, b) => a - b);
  const medianStep = stepLens[Math.floor(stepLens.length / 2)] ?? 0;
  const forward = steps.filter(([a, b]) => a * net[0] + b * net[1] > 0).length / Math.max(1, steps.length);
  Object.assign(debug, { netLen: +netLen.toFixed(3), medianStep: +medianStep.toFixed(4), forward: +forward.toFixed(2) });
  debug.reason = 'nothing actually flew';
  if (netLen < 0.12 || medianStep < 0.008 || forward < 0.7) return null;
  const arc = fit([...anchorPts, ...used.map((s) => ({ ...s, wt: 1 }))]) ?? best.arc;
  // The refined arc must still pass close to the sightings it was built from.
  const err = used.reduce((m, s) => m + dist(arc, s), 0) / used.length;
  debug.fitError = +err.toFixed(4);
  debug.reason = 'sightings do not line up';
  if (err > tol * 0.6) return null;

  debug.arc = arc;
  debug.used = used.map((u) => [+u.tau.toFixed(3), +u.x.toFixed(3), +u.y.toFixed(3), u.area]);
  // Sanity: gravity pulls down (y grows), and it has to actually travel.
  debug.reason = 'gravity';
  if (arc.cy < -0.4) return null;
  const startTau = Math.min(...used.map((s) => s.tau)) - 0.03;
  const endTau = opts.anchor ? 0 : Math.max(...used.map((s) => s.tau));
  debug.reason = 'too short in time';
  if (endTau - startTau < 0.12) return null;
  const a = at(arc, startTau);
  const b = at(arc, endTau);
  debug.reason = 'too short in distance';
  if (Math.hypot((a.x - b.x) * opts.aspect, a.y - b.y) < 0.08) return null;
  debug.reason = 'ok';

  const pts: TrailPoint[] = [];
  for (let tau = startTau; tau <= endTau + 1e-6; tau += 0.016) {
    const p = at(arc, tau);
    if (p.x < -0.1 || p.x > 1.1 || p.y < -0.3 || p.y > 1.1) continue;
    pts.push({ t: Math.round(opts.momentMs + tau * 1000), x: +p.x.toFixed(4), y: +p.y.toFixed(4) });
  }
  return pts.length >= 4 ? pts : null;
}
