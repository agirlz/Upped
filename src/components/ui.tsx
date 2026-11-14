import { go } from '../router';
import { champion, isHidden, react, repliesOf } from '../store';
import { REACTIONS, type Post, type State, type User } from '../types';
import { Thumb } from './ClipPlayer';

export function timeAgo(t: number): string {
  const s = Math.round((Date.now() - t) / 1000);
  if (s < 60) return 'just now';
  const m = Math.round(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.round(h / 24)}d ago`;
}

export function timeLeft(t: number): string {
  const ms = t - Date.now();
  if (ms <= 0) return 'Ended';
  const h = Math.floor(ms / 3_600_000);
  if (h >= 48) return `${Math.floor(h / 24)} days left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

export function Avatar({ user, size = 32 }: { user?: User; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.55 }} title={user?.name}>
      {user?.emoji ?? '?'}
    </span>
  );
}

export function ReactionBar({ post, meId }: { post: Post; meId: string }) {
  return (
    <div className="reactions">
      {REACTIONS.map((e) => {
        const ids = post.reactions[e] ?? [];
        const mine = ids.includes(meId);
        return (
          <button
            key={e}
            className={`react ${mine ? 'react-on' : ''}`}
            onClick={(ev) => {
              ev.stopPropagation();
              react(post.id, e);
            }}
          >
            {e} {ids.length > 0 && <b>{ids.length}</b>}
          </button>
        );
      })}
    </div>
  );
}

/** Feed card for the root of a challenge chain. */
export function ChainCard({ s, post }: { s: State; post: Post }) {
  const author = s.users[post.authorId];
  const replies = repliesOf(s, post.id).filter((p) => !isHidden(s, p));
  const champ = champion(s, post.id);
  const holder = champ ? s.users[champ.authorId] : undefined;
  const challenge = post.challengeId ? s.challenges[post.challengeId] : undefined;
  return (
    <article className="card chain-card" onClick={() => go(`/post/${post.id}`)}>
      <Thumb blobId={champ?.thumbId ?? post.thumbId} />
      <div className="chain-body">
        <div className="chain-top">
          <Avatar user={author} size={26} />
          <span className="small">
            <b>{author?.name}</b> · {timeAgo(post.createdAt)}
          </span>
        </div>
        <h3>{post.title}</h3>
        {challenge && <div className="tag">🏆 {challenge.title}</div>}
        <div className="small muted">
          🎯 attempt #{post.attempts} · {replies.length} {replies.length === 1 ? 'reply' : 'replies'}
        </div>
        {holder && champ && champ.id !== post.id && (
          <div className="small crown-line">
            👑 {holder.name} upped it
          </div>
        )}
        <ReactionBar post={post} meId={s.meId!} />
      </div>
    </article>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">{icon}</div>
      <h3>{title}</h3>
      {children}
    </div>
  );
}
