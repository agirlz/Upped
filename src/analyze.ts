// Re-analyze a clip that was already recorded: play it once (muted, off
// screen), collect its frames, find the landing moment inside the target and
// fit the flight trail. Used by "Add target & trail" on older clips.

import { TargetMotion } from './capture';
import { findTrail, FlightFrames, type TrailPoint } from './trail';
import type { Target } from './types';

export interface Analysis {
  momentMs: number;
  trail: TrailPoint[] | null;
}

type FrameVideo = HTMLVideoElement & {
  requestVideoFrameCallback?: (cb: (now: number, meta: { mediaTime: number }) => void) => number;
};

export async function analyzeClip(url: string, target: Target, onProgress: (fraction: number) => void): Promise<Analysis> {
  const v = document.createElement('video') as FrameVideo;
  v.muted = true;
  v.playsInline = true;
  v.preload = 'auto';
  v.src = url;
  v.style.cssText = 'position:fixed;left:-9999px;top:0;width:2px;height:2px;opacity:0';
  document.body.appendChild(v);
  try {
    await new Promise<void>((res, rej) => {
      v.onloadedmetadata = () => res();
      v.onerror = () => rej(new Error('Could not open this clip.'));
    });
    // Recorded WebM files often report no duration until you seek to the end once.
    if (!Number.isFinite(v.duration)) {
      await new Promise<void>((res) => {
        v.ontimeupdate = () => {
          v.ontimeupdate = null;
          res();
        };
        v.currentTime = 1e9;
      });
      v.currentTime = 0;
    }
    const durationMs = Number.isFinite(v.duration) ? v.duration * 1000 : 10_000;

    const vw = v.videoWidth || 720;
    const vh = v.videoHeight || 405;
    const scale = Math.min(1, 720 / vw);
    const c = document.createElement('canvas');
    c.width = Math.round(vw * scale);
    c.height = Math.round(vh * scale);
    const ctx = c.getContext('2d', { willReadFrequently: true })!;
    const flight = new FlightFrames(60_000);
    const motion = new TargetMotion();

    const grab = (tMs: number) => {
      ctx.drawImage(v, 0, 0, c.width, c.height);
      flight.push(c, c.width, c.height, tMs);
      motion.sample(c, c.width, c.height, target, tMs);
      onProgress(Math.min(1, tMs / durationMs));
    };

    await new Promise<void>((res) => {
      v.onended = () => res();
      if (v.requestVideoFrameCallback) {
        // One callback per real video frame: nothing skipped, nothing doubled.
        const onFrame = (_now: number, meta: { mediaTime: number }) => {
          grab(meta.mediaTime * 1000);
          if (!v.ended) v.requestVideoFrameCallback!(onFrame);
        };
        v.requestVideoFrameCallback(onFrame);
      } else {
        const loop = () => {
          if (v.ended) return;
          grab(v.currentTime * 1000);
          requestAnimationFrame(loop);
        };
        requestAnimationFrame(loop);
      }
      void v.play().catch(() => res());
    });

    const momentMs = motion.peak(durationMs / 2);
    const trail = findTrail(flight, { momentMs, anchor: { x: target.x, y: target.y }, aspect: c.width / c.height });
    return { momentMs, trail };
  } finally {
    v.pause();
    v.remove();
  }
}
