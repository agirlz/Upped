import { go } from '../router';
import { sfx } from '../sounds';
import { champion, isHidden, react, repliesOf, scoreboard } from '../store';
import { difficulty, distanceLabel } from '../difficulty';
import { REACTIONS, type Post, type State, type User } from '../types';
import { Thumb } from './ClipPlayer';
import { Icon } from './Icon';

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
  if (h >= 24) return `${Math.floor(h / 24)}d ${h % 24}h left`;
  if (h >= 1) return `${h}h left`;
  return `${Math.max(1, Math.floor(ms / 60_000))}m left`;
}

export const handle = (u?: User) => (u ? `@${u.name}` : '@unknown');

export function Avatar({ user, size = 32 }: { user?: User; size?: number }) {
  return (
    <span className="avatar" style={{ width: size, height: size, fontSize: size * 0.5 }} title={user?.name}>
      {user?.emoji ?? '?'}
    </span>
  );
}

export function PageTitle({ children, center }: { children: React.ReactNode; center?: boolean }) {
  return <h1 className={`display ${center ? 'center' : ''}`}>{children}</h1>;
}

export function TopBar({ title, back, right }: { title?: React.ReactNode; back?: () => void; right?: React.ReactNode }) {
  return (
    <div className="topbar">
      {back ? (
        <button className="icon-btn" onClick={back} aria-label="Back">
          <Icon name="back" size={24} />
        </button>
      ) : (
        <span />
      )}
      <div className="topbar-title">{title}</div>
      {right ?? <span />}
    </div>
  );
}

export function SpotPill({ post }: { post: Post }) {
  if (!post.spot) return null;
  return (
    <span className="pill pill-orange">
      <Icon name={post.spot === 'court' ? 'hoop' : 'home'} />
      {post.spot === 'court' ? 'Court' : 'At home'}
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
            aria-label={`React ${e}`}
            onClick={(ev) => {
              ev.stopPropagation();
              if (!mine) sfx.reaction(e);
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

const reactionCount = (p: Post) => Object.values(p.reactions).reduce((n, ids) => n + ids.length, 0);

const clipLength = (ms: number) => `0:${String(Math.round(ms / 1000)).padStart(2, '0')}`;

/** Feed card for the root of a challenge chain. */
export function ChainCard({ s, post }: { s: State; post: Post }) {
  const author = s.users[post.authorId];
  const replies = repliesOf(s, post.id).filter((p) => !isHidden(s, p));
  const champ = champion(s, post.id);
  const holder = champ ? s.users[champ.authorId] : undefined;
  const challenge = post.challengeId ? s.challenges[post.challengeId] : undefined;
  const upped = champ && champ.id !== post.id;
  const shown = upped ? champ : post;
  return (
    <article className="card feed-card" onClick={() => go(`/post/${post.id}`)}>
      <div className="feed-media">
        <Thumb blobId={shown.thumbId} className="feed-thumb" />
        <SpotPill post={post} />
        {difficulty(post) !== undefined && (
          <span className="pill pill-solid diff-badge">
            Diff {difficulty(post)}
            {distanceLabel(post) && <> · {distanceLabel(post)}</>}
          </span>
        )}
        {upped && (
          <span className="corner-crown" title="Crown changed hands">
            <Icon name="crown" size={18} />
          </span>
        )}
        <span className="play-btn">
          <Icon name="play" size={22} />
        </span>
        <span className="dur">{clipLength(shown.durationMs)}</span>
      </div>
      <div className="feed-body">
        <h3 className="title">{post.title}</h3>
        <div className="byline">
          <Avatar user={author} size={22} />
          <b>{handle(author)}</b> · {timeAgo(post.createdAt)}
        </div>
        {challenge && (
          <div className="pills">
            <span className="pill pill-red">
              <Icon name="trophy" /> {challenge.title}
            </span>
          </div>
        )}
        <div className="small muted">
          {replies.length} {replies.length === 1 ? 'reply' : 'replies'} · {reactionCount(post)} reactions · made on attempt #
          {post.attempts}
        </div>
        {upped && holder && (
          <div className="small crown-line">
            <Icon name="crown" size={16} /> {handle(holder)} upped it and holds the crown
          </div>
        )}
        <ReactionBar post={post} meId={s.meId!} />
      </div>
    </article>
  );
}

/** Banner for whoever holds the most crowns in a lobby. */
export function CrownBanner({ s, lobbyId }: { s: State; lobbyId: string }) {
  const top = scoreboard(s, { lobbyId }).filter((r) => r.crowns > 0)[0];
  if (!top) return null;
  return (
    <div className="crown-banner">
      <Avatar user={top.user} size={44} />
      <div className="label grow">
        Crown holder
        <small>{handle(top.user)}</small>
      </div>
      <div className="stat">
        Holds
        <b>
          {top.crowns} crown{top.crowns === 1 ? '' : 's'}
        </b>
      </div>
    </div>
  );
}

export function Empty({ icon, title, children }: { icon: string; title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <Icon name={icon} size={40} />
      <h3>{title}</h3>
      {children}
    </div>
  );
}
