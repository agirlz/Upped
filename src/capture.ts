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
    ctx.lineWidth = Math.max(2, u * 0.6);
    ctx.strokeStyle = o.hit ? '#c6ff3d' : 'rgba(198,255,61,0.9)';
    ctx.shadowColor = '#c6ff3d';
    ctx.shadowBlur = o.hit ? u * 4 : u * 1.5;
    ctx.setLineDash(o.hit ? [] : [u * 1.6, u * 1.1]);
    ctx.beginPath();
    ctx.arc(cx, cy, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.shadowBlur = 0;
    // tick marks
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.cos(a) * (r + u * 0.6), cy + Math.sin(a) * (r + u * 0.6));
      ctx.lineTo(cx + Math.cos(a) * (r + u * 2), cy + Math.sin(a) * (r + u * 2));
      ctx.stroke();
    }
    label(ctx, 'CALLED SHOT', cx, Math.max(u * 3, cy - r - u * 3.2), u, '#c6ff3d', '#0d0f14', 'center');
  }

  // Verification strip: app name, session code, wall clock.
  const time = o.clock.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  label(ctx, `UPPED ✓ ${o.code} · ${time}`, u * 2, u * 3, u, 'rgba(13,15,20,0.75)', '#ffffff', 'left');
  label(ctx, `ATTEMPT ${o.attempt}`, w - u * 2, u * 3, u, 'rgba(13,15,20,0.75)', '#ffb13d', 'right');

  if (o.recording) {
    const s = (o.elapsedMs / 1000).toFixed(1);
    ctx.fillStyle = '#ff3d5a';
    ctx.beginPath();
    ctx.arc(w - u * 3.5, h - u * 3.5, u * 1.1, 0, Math.PI * 2);
    ctx.fill();
    label(ctx, `${s}s`, w - u * 5.5, h - u * 3.5, u, 'rgba(13,15,20,0.75)', '#ffffff', 'right');
  }

  if (o.countdown !== undefined && o.countdown > 0) {
    ctx.fillStyle = 'rgba(13,15,20,0.45)';
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = '#ffffff';
    ctx.font = `800 ${u * 22}px system-ui, sans-serif`;
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
  ctx.font = `700 ${Math.max(11, u * 2.1)}px system-ui, sans-serif`;
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
