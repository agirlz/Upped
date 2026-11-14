// Shared capture helpers: recording format, the burned-in overlay, and
// motion detection inside the called target ring.

import type { Target } from './types';

export function pickMimeType(): string {
  const candidates = [
    'video/mp4;codecs=avc1',
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm',
    'video/mp4',
  ];
  if (typeof MediaRecorder === 'undefined') return '';
  return candidates.find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
}

export interface OverlayInfo {
  target?: Target;
  code: string;
  attempt: number;
  recording: boolean;
  elapsedMs: number;
  clock: Date;
  countdown?: number;
  hit?: boolean; // flash the ring
}

/** Draws the verification overlay that gets baked into every recorded clip. */
export function drawOverlay(ctx: CanvasRenderingContext2D, w: number, h: number, o: OverlayInfo) {
  const u = w / 100; // 1% of width
  ctx.save();

  if (o.target) {
    const cx = o.target.x * w;
    const cy = o.target.y * h;
    const r = o.target.r * w;
    ctx.lineWidth = Math.max(2, u * 0.55);
    ctx.strokeStyle = '#c6ff3d';
    ctx.shadowColor = '#c6ff3d';
    ctx.shadowBlur = o.hit ? u * 5 : u * 2;
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    // crosshair ticks crossing the ring
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r - u * 1.6), cy + Math.sin(a) * (r - u * 1.6));
      ctx.lineTo(cx + Math.cos(a) * (r + u * 2.4), cy + Math.sin(a) * (r + u * 2.4));
      ctx.stroke();
    }
    // centre dot
    ctx.fillStyle = '#c6ff3d';
    ctx.beginPath();
    ctx.arc(cx, cy, Math.max(1.5, u * 0.35), 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;
    bracketLabel(ctx, 'CALLED SHOT', cx, Math.max(u * 4, cy - r - u * 5), u);
  }

  // Verification strip: app name, session code, wall clock.
  const time = o.clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  label(ctx, `UPPED ✓ ${o.code} · ${time}`, u * 2, u * 3, u, 'rgba(11,13,18,0.78)', '#ffffff', 'left');
  label(ctx, `ATTEMPT #${o.attempt}`, w - u * 2, u * 3, u, 'rgba(11,13,18,0.78)', '#c6ff3d', 'right');

  if (o.recording) {
    const s = (o.elapsedMs / 1000).toFixed(1);
    ctx.fillStyle = '#ff3d5a';
    ctx.beginPath();
    ctx.arc(w - u * 3.5, h - u * 3.5, u * 1.1, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, `${s}s`, w - u * 5.5, h - u * 3.5, u, 'rgba(11,13,18,0.78)', '#ffffff', 'right');
  }

  if (o.countdown !== undefined && o.countdown > 0) {
    ctx.fillStyle = 'rgba(11,13,18,0.5)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#c6ff3d';
    ctx.shadowColor = '#c6ff3d';
    ctx.shadowBlur = u * 3;
    ctx.font = `italic ${u * 26}px 'Bebas Neue', Impact, sans-serif`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(o.countdown), w / 2, h / 2);
  }
  ctx.restore();
}

function label(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  u: number,
  bg: string,
  fg: string,
  align: CanvasTextAlign,
) {
  ctx.font = `italic 700 ${Math.max(12, u * 2.4)}px 'Barlow Condensed', system-ui, sans-serif`;
  const tw = ctx.measureText(text).width;
  const padX = u * 1.1;
  const hgt = Math.max(16, u * 3.4);
  let left = x;
  if (align === 'center') left = x - tw / 2 - padX;
  if (align === 'right') left = x - tw - padX * 2;
  ctx.fillStyle = bg;
  roundRect(ctx, left, y - hgt / 2, tw + padX * 2, hgt, hgt / 2);
  ctx.fill();
  ctx.fillStyle = fg;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, left + padX, y + 1);
}

/** "CALLED SHOT" title with lime corner brackets, as in the camera mockup. */
function bracketLabel(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, u: number) {
  ctx.font = `italic ${Math.max(16, u * 4)}px 'Bebas Neue', Impact, sans-serif`;
  const tw = ctx.measureText(text).width;
  const pw = tw + u * 4;
  const ph = Math.max(22, u * 5.4);
  const l = x - pw / 2;
  const t = y - ph / 2;
  ctx.fillStyle = 'rgba(11,13,18,0.72)';
  ctx.fillRect(l, t, pw, ph);
  ctx.strokeStyle = '#c6ff3d';
  ctx.lineWidth = Math.max(2, u * 0.45);
  const k = u * 1.6;
  ctx.beginPath();
  ctx.moveTo(l, t + k); ctx.lineTo(l, t); ctx.lineTo(l + k, t);
  ctx.moveTo(l + pw - k, t); ctx.lineTo(l + pw, t); ctx.lineTo(l + pw, t + k);
  ctx.moveTo(l + pw, t + ph - k); ctx.lineTo(l + pw, t + ph); ctx.lineTo(l + pw - k, t + ph);
  ctx.moveTo(l + k, t + ph); ctx.lineTo(l, t + ph); ctx.lineTo(l, t + ph - k);
  ctx.stroke();
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y + u * 0.3);
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Measures how much the picture changes inside the target ring, frame to frame.
 * The biggest spike is almost always the ball arriving at the target.
 */
export class TargetMotion {
  private small = document.createElement('canvas');
  private sctx: CanvasRenderingContext2D;
  private prev: Uint8ClampedArray | null = null;
  samples: Array<{ t: number; d: number }> = [];

  constructor(private size = 40) {
    this.small.width = size;
    this.small.height = size;
    this.sctx = this.small.getContext('2d', { willReadFrequently: true })!;
  }

  reset() {
    this.prev = null;
    this.samples = [];
  }

  /** Feed one frame. Returns the change score for this frame. */
  sample(source: CanvasImageSource, srcW: number, srcH: number, target: Target, t: number): number {
    const r = target.r * srcW * 1.3; // a bit of margin around the ring
    const sx = Math.max(0, target.x * srcW - r);
    const sy = Math.max(0, target.y * srcH - r);
    const sw = Math.min(srcW - sx, r * 2);
    const sh = Math.min(srcH - sy, r * 2);
    if (sw <= 1 || sh <= 1) return 0;
    this.sctx.drawImage(source, sx, sy, sw, sh, 0, 0, this.size, this.size);
    const data = this.sctx.getImageData(0, 0, this.size, this.size).data;
    let d = 0;
    if (this.prev) {
      for (let i = 0; i < data.length; i += 4) {
        const g = data[i] * 0.3 + data[i + 1] * 0.59 + data[i + 2] * 0.11;
        const pg = this.prev[i] * 0.3 + this.prev[i + 1] * 0.59 + this.prev[i + 2] * 0.11;
        d += Math.abs(g - pg);
      }
      d /= this.size * this.size;
    }
    this.prev = new Uint8ClampedArray(data);
    this.samples.push({ t, d });
    return d;
  }

  /** Time (ms) of the strongest smoothed motion spike, ignoring the first half second. */
  peak(fallbackMs: number): number {
    const s = this.samples;
    if (s.length < 5) return fallbackMs;
    let best = -1;
    let bestT = fallbackMs;
    for (let i = 2; i < s.length - 2; i++) {
      if (s[i].t < 500) continue;
      const v = (s[i - 1].d + s[i].d * 2 + s[i + 1].d) / 4;
      if (v > best) {
        best = v;
        bestT = s[i].t;
      }
    }
    return best > 1.5 ? bestT : fallbackMs;
  }
}

export function canvasToBlob(canvas: HTMLCanvasElement, type = 'image/jpeg', q = 0.8): Promise<Blob | null> {
  return new Promise((res) => canvas.toBlob(res, type, q));
}

/**
 * Listens for the sharp sound of a landing (a pen clinking in a cup, a ball
 * thudding into a bin). Returns true for a sudden spike well above the
 * recent background level.
 */
export class LandingSound {
  private ctx: AudioContext | null = null;
  private analyser: AnalyserNode | null = null;
  private buf: Float32Array | null = null;
  private baseline = 0.02;

  start(stream: MediaStream) {
    try {
      const AC = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      this.ctx = new AC();
      const src = this.ctx.createMediaStreamSource(stream);
      this.analyser = this.ctx.createAnalyser();
      this.analyser.fftSize = 1024;
      src.connect(this.analyser);
      this.buf = new Float32Array(this.analyser.fftSize);
      void this.ctx.resume();
    } catch {
      this.ctx = null;
    }
  }

  stop() {
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
    this.analyser = null;
  }

  /** Call once per frame. True when this frame looks like a landing. */
  spike(): boolean {
    if (!this.analyser || !this.buf) return false;
    this.analyser.getFloatTimeDomainData(this.buf);
    let peak = 0;
    let sum = 0;
    for (const v of this.buf) {
      const a = Math.abs(v);
      if (a > peak) peak = a;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / this.buf.length);
    const isSpike = peak > 0.25 && rms > Math.max(0.05, this.baseline * 5);
    // slow-moving background level, so talking raises the bar
    this.baseline = this.baseline * 0.95 + rms * 0.05;
    return isSpike;
  }
}

/** Draws `src` to fill w×h (cropping the overflow), optionally mirrored. */
export function drawCover(
  ctx: CanvasRenderingContext2D,
  src: CanvasImageSource,
  sw: number,
  sh: number,
  w: number,
  h: number,
  mirror = false,
) {
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.save();
  if (mirror) {
    ctx.translate(w, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(src, (w - dw) / 2, (h - dh) / 2, dw, dh);
  ctx.restore();
}
