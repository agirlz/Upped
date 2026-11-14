import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react';
import { blobUrl } from '../db';
import type { Target } from '../types';
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
  { blobId, src, momentMs, target, slowmo = true, autoPlay = true, loop = true, compact, stampText = 'CALLED IT' },
  ref,
) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [url, setUrl] = useState<string | undefined>(src);
  const [zoom, setZoom] = useState(false);
  const [stamp, setStamp] = useState(false);
  const [muted, setMuted] = useState(true);
  const [playing, setPlaying] = useState(false);
  const timer = useRef<number>();

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
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      window.clearTimeout(hideTimer);
    };
  }, [momentMs, slowmo]);

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
        {url && (
          <video
            ref={videoRef}
            src={url}
            playsInline
            muted={muted}
            autoPlay={autoPlay}
            loop={loop}
            onLoadedMetadata={fixDuration}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            style={{
              transformOrigin: origin,
              transform: zoom ? `scale(${target ? 1.9 : 1.3})` : 'scale(1)',
            }}
          />
        )}
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
