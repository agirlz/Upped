import { useEffect, useRef } from 'react';
import type { Post, User } from '../types';
import { ClipPlayer, type ClipPlayerHandle } from './ClipPlayer';

/** Two clips next to each other, started so both balls hit the target at the same instant. */
export function SideBySide({ a, b, users }: { a: Post; b: Post; users: Record<string, User> }) {
  const ra = useRef<ClipPlayerHandle>(null);
  const rb = useRef<ClipPlayerHandle>(null);

  const play = () => {
    const lead = Math.max(a.momentMs, b.momentMs);
    ra.current?.restart(lead - a.momentMs);
    rb.current?.restart(lead - b.momentMs);
  };

  useEffect(() => {
    const t = window.setTimeout(play, 300);
    return () => window.clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.id, b.id]);

  return (
    <div className="sbs">
      <div className="sbs-grid">
        {[a, b].map((p, i) => (
          <div key={p.id}>
            <div className="sbs-label">
              {users[p.authorId]?.emoji} {users[p.authorId]?.name}
            </div>
            <ClipPlayer
              ref={i === 0 ? ra : rb}
              blobId={p.videoId}
              momentMs={p.momentMs}
              target={p.target}
              trail={p.trail}
              autoPlay={false}
              loop={false}
              compact
            />
          </div>
        ))}
      </div>
      <button className="btn btn-ghost full" onClick={play}>
        ▶ Play synced (both hit at the same moment)
      </button>
    </div>
  );
}
