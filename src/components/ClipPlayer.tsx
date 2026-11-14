import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { blobUrl } from '../db';
import { sfx } from '../sounds';
import type { Post, Target } from '../types';
import { Icon } from './Icon';

export interface ClipPlayerHandle {
  /** Restart from the beginning after `delayMs` (used to sync two clips). */
  restart: (delayMs?: number) => void;
  pause: () => void;
}

interface Props {
  blobId?: string;
  src?: string;
  momentMs: number;
  target?: Target;
  slowmo?: boolean;
  autoPlay?: boolean;
  loop?: boolean;
  compact?: boolean;
  stampText?: string;
  /** Flight arc to draw as a glowing trail. */
  trail?: Post['trail'];
  /** Play the celebration sound the first time the make is shown. */
  celebrate?: boolean;
}

const SLOW_BEFORE = 450;
const SLOW_AFTER = 700;
// The stamp waits until the replay is over so it never covers the target while the ball goes in.
const STAMP_DELAY = SLOW_AFTER + 250;
const STAMP_SHOW = 1400;

/**
 * Plays a clip and automatically drops into a zoomed slow-motion replay
 * around the moment the ball reached the called target.
 */
export const ClipPlayer = forwardRef<ClipPlayerHandle, Props>(function ClipPlayer(
  { blobId, src, momentMs, target, slowmo = true, autoPlay = true, loop = true, compact, stampText = 'CALLED IT', trail, celebrate },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | undefined>(src);
  const [zoom, setZoom] = useState(false);
  const [stamp, setStamp] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number>();
  // A target marked after the shot wasn't "called", so the stamp says so.
  if (target?.late && stampText === 'CALLED IT') stampText = 'MADE IT';
  const trailPath = useRef<SVGPathElement>(null);
  const trailHead = useRef<SVGCircleElement>(null);
  const [dims, setDims] = useState({ w: 16, h: 9 });
  const celebrated = useRef(false);

  useEffect(() => {
    if (src) return setUrl(src);
    let alive = true;
    if (blobId) void blobUrl(blobId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [blobId, src]);

  // Watch playback position and switch slow-mo / zoom on and off.
  useEffect(() => {
    let raf = 0;
    let lastT = 0;
    let fired = false;
    let hideTimer = 0;
    const fire = () => {
      fired = true;
      if (celebrate && !celebrated.current && stampText) {
        celebrated.current = true;
        sfx.make();
      }
      setStamp(true);
      window.clearTimeout(hideTimer);
      hideTimer = window.setTimeout(() => setStamp(false), STAMP_SHOW);
    };
    const tick = () => {
      const v = videoRef.current;
      if (v) {
        const t = v.currentTime * 1000;
        const inWindow = slowmo && t >= momentMs - SLOW_BEFORE && t <= momentMs + SLOW_AFTER;
        const rate = inWindow ? 0.3 : 1;
        if (v.playbackRate !== rate) v.playbackRate = rate;
        setZoom(inWindow);
        // Show the stamp once per play-through, after the replay; if the clip
        // ends (or loops) before that, show it at the end instead.
        const restarted = t + 200 < lastT;
        if (!fired && momentMs >= 0 && (t >= momentMs + STAMP_DELAY || (restarted && lastT >= momentMs) || (v.ended && t >= momentMs))) fire();
        if (restarted) fired = t >= momentMs + STAMP_DELAY;
        lastT = t;
        drawTrail(t);
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer);
    };
  }, [momentMs, slowmo, trail, dims, celebrate, stampText]);

  // The trail grows with playback: drawn up to the current moment, with a bright head.
  function drawTrail(t: number) {
    const path = trailPath.current;
    const head = trailHead.current;
    if (!path || !head || !trail?.length) return;
    const shown = trail.filter((p) => p.t <= t);
    if (shown.length < 2) {
      path.setAttribute('d', '');
      head.setAttribute('r', '0');
      return;
    }
    path.setAttribute('d', 'M' + shown.map((p) => `${(p.x * dims.w).toFixed(1)} ${(p.y * dims.h).toFixed(1)}`).join(' L'));
    const last = shown[shown.length - 1];
    const flying = t <= trail[trail.length - 1].t + 60;
    head.setAttribute('cx', String(last.x * dims.w));
    head.setAttribute('cy', String(last.y * dims.h));
    head.setAttribute('r', flying ? String(dims.w * 0.012) : '0');
  }

  useImperativeHandle(ref, () => ({
    restart(delayMs = 0) {
      const v = videoRef.current;
      if (!v) return;
      window.clearTimeout(timer.current);
      v.pause();
      v.currentTime = 0;
      timer.current = window.setTimeout(() => void v.play().catch(() => {}), delayMs);
    },
    pause() {
      window.clearTimeout(timer.current);
      videoRef.current?.pause();
    },
  }));

  // MediaRecorder WebM files often report an infinite duration, which breaks seeking.
  // Seeking far past the end once forces the browser to compute the real duration.
  const fixDuration = () => {
    const v = videoRef.current;
    if (!v || Number.isFinite(v.duration)) return;
    const back = () => {
      v.removeEventListener('timeupdate', back);
      v.currentTime = 0;
      if (autoPlay) void v.play().catch(() => {});
    };
    v.addEventListener('timeupdate', back);
    v.currentTime = 1e9;
  };

  const toggle = () => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) void v.play().catch(() => {});
    else v.pause();
  };

  const origin = target ? `${target.x * 100}% ${target.y * 100}%` : '50% 50%';

  return (
    <div className={`clip ${compact ? 'clip-compact' : ''}`}>
      <div className="clip-frame" onClick={toggle}>
        <div
          className="clip-zoom"
          style={{ transformOrigin: origin, transform: zoom ? `scale(${target ? 1.9 : 1.3})` : 'scale(1)' }}
        >
        {url && (
          <video
            ref={videoRef}
            src={url}
            playsInline
            muted={muted}
            autoPlay={autoPlay}
            loop={loop}
            onLoadedMetadata={(e) => {
              const v = e.currentTarget;
              if (v.videoWidth) setDims({ w: v.videoWidth, h: v.videoHeight });
              fixDuration();
            }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
          />
        )}
        {((trail && trail.length > 1) || target?.late) && (
          <svg className="clip-trail" viewBox={`0 0 ${dims.w} ${dims.h}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true">
            {target?.late && <TargetRing target={target} w={dims.w} h={dims.h} />}
            <path ref={trailPath} fill="none" strokeLinecap="round" strokeLinejoin="round" strokeWidth={dims.w * 0.012} />
            <circle ref={trailHead} r="0" />
          </svg>
        )}
        </div>
        {!url && <div className="clip-loading">Loading clip…</div>}
        {stamp && stampText && (
          <div className={`clip-stamp ${target && target.y < 0.5 ? 'stamp-low' : 'stamp-high'}`}>
            <span className="stamp-target">
              <Icon name="target" size={compact ? 14 : 22} />
            </span>
            {stampText}
          </div>
        )}
        {zoom && <div className="clip-slowmo">SLOW-MO</div>}
        {!playing && url && (
          <div className="clip-play">
            <span className="play-btn">
              <Icon name="play" size={22} />
            </span>
          </div>
        )}
      </div>
      {!compact && (
        <div className="clip-bar">
          <button className="chip" onClick={() => setMuted((m) => !m)}>
            <Icon name={muted ? 'mute' : 'sound'} /> {muted ? 'Sound off' : 'Sound on'}
          </button>
          <button
            className="chip"
            onClick={() => {
              const v = videoRef.current;
              if (!v) return;
              v.currentTime = Math.max(0, (momentMs - 1500) / 1000);
              void v.play().catch(() => {});
            }}
          >
            <Icon name="replay" /> Replay the moment
          </button>
        </div>
      )}
    </div>
  );
});

export function Thumb({ blobId, className }: { blobId?: string; className?: string }) {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    let alive = true;
    if (blobId) void blobUrl(blobId).then((u) => alive && setUrl(u));
    return () => {
      alive = false;
    };
  }, [blobId]);
  return url ? <img className={className ?? 'thumb'} src={url} alt="" /> : <div className={className ?? 'thumb'} />;
}

/** The target ring for clips whose target was added after recording (drawn on playback). */
export function TargetRing({ target, w, h }: { target: Target; w: number; h: number }) {
  const cx = target.x * w;
  const cy = target.y * h;
  const r = target.r * w;
  const u = w / 100;
  const ticks = [0, 1, 2, 3].map((i) => {
    const a = (i * Math.PI) / 2;
    return (
      <line
        key={i}
        x1={cx + Math.cos(a) * (r - u * 1.6)}
        y1={cy + Math.sin(a) * (r - u * 1.6)}
        x2={cx + Math.cos(a) * (r + u * 2.4)}
        y2={cy + Math.sin(a) * (r + u * 2.4)}
      />
    );
  });
  return (
    <g className="late-ring" strokeWidth={Math.max(2, u * 0.55)}>
      <circle cx={cx} cy={cy} r={r} fill="none" />
      {ticks}
      <circle cx={cx} cy={cy} r={Math.max(1.5, u * 0.35)} className="dot" />
    </g>
  );
}
