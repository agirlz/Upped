import { useState } from 'react';
import { ClipPlayer } from '../components/ClipPlayer';
import { SideBySide } from '../components/SideBySide';
import { Avatar, ReactionBar, timeAgo } from '../components/ui';
import { go } from '../router';
import {
  addComment,
  champion,
  flag,
  isHidden,
  repliesOf,
  useAppState,
  verdict,
  votesNeeded,
  vote,
} from '../store';
import type { Post, State } from '../types';

export function PostView({ id }: { id: string }) {
  const s = useAppState();
  const root = s.posts[id];
  const [compare, setCompare] = useState<string>();
  const [bloopers, setBloopers] = useState<Post>();
  if (!root) return <div className="page">Clip not found.</div>;

  const replies = repliesOf(s, id);
  const champ = champion(s, id);
  const author = s.users[root.authorId];
  const challenge = root.challengeId ? s.challenges[root.challengeId] : undefined;
  const lobby = s.lobbies[root.lobbyId];
  const compareWith = compare ? s.posts[compare] : undefined;
  // Compare a reply against whatever held the crown when it was posted.
  const opponent = (p: Post) =>
    [...replies]
      .filter((r) => r.kind === 'upped' && r.createdAt < p.createdAt && verdict(s, r) === 'won' && !isHidden(s, r))
      .at(-1) ?? root;

  return (
    <div className="page">
      <button className="back" onClick={() => go(`/lobby/${root.lobbyId}`)}>
        ‹ {lobby?.name ?? 'Lobby'}
      </button>

      {champ && champ.id !== root.id && (
        <div className="crown-banner">
          👑 <b>{s.users[champ.authorId]?.name}</b> holds this one. Up their version to take the crown.
        </div>
      )}

      <PostBlock s={s} post={root} onBloopers={() => setBloopers(root)} isChamp={champ?.id === root.id} />
      {challenge && (
        <button className="tag tag-link" onClick={() => go(`/challenge/${challenge.id}`)}>
          🏆 Entry for: {challenge.title}
        </button>
      )}

      <div className="row">
        <button className="btn btn-ghost grow" onClick={() => go(`/record?root=${id}&kind=matched`)}>
          = Match it
        </button>
        <button className="btn grow" onClick={() => go(`/record?root=${id}&kind=upped`)}>
          🔼 Up it
        </button>
      </div>

      <h2>
        Replies <span className="muted">({replies.length})</span>
      </h2>
      {replies.length === 0 && <p className="muted">Nobody has tried it yet. Will you be first?</p>}
      <p className="small muted">
        {votesNeeded(s, root.lobbyId)} vote{votesNeeded(s, root.lobbyId) === 1 ? '' : 's'} decide a reply in this lobby.
      </p>

      <div className="stack">
        {replies.map((p) => (
          <div key={p.id} className="card reply">
            <PostBlock s={s} post={p} onBloopers={() => setBloopers(p)} isChamp={champ?.id === p.id} />
            {!isHidden(s, p) && <VoteBox s={s} post={p} />}
            {!isHidden(s, p) && (
              <button className="btn btn-ghost full" onClick={() => setCompare(compare === p.id ? undefined : p.id)}>
                {compare === p.id ? 'Hide comparison' : '⇆ Compare side by side'}
              </button>
            )}
            {compare === p.id && compareWith && <SideBySide a={opponent(p)} b={p} users={s.users} />}
          </div>
        ))}
      </div>

      <Comments s={s} post={root} />

      {bloopers && <Bloopers post={bloopers} onClose={() => setBloopers(undefined)} name={author?.name} />}
    </div>
  );
}

function PostBlock({ s, post, onBloopers, isChamp }: { s: State; post: Post; onBloopers: () => void; isChamp: boolean }) {
  const author = s.users[post.authorId];
  const hidden = isHidden(s, post);
  const mine = post.authorId === s.meId;
  const flagged = post.flags.includes(s.meId!);
  const kindLabel = post.kind === 'upped' ? '🔼 Upped' : post.kind === 'matched' ? '= Matched' : null;
  return (
    <div className="post">
      <div className="post-head">
        <Avatar user={author} />
        <div className="grow">
          <div>
            <b>{author?.name}</b> {kindLabel && <span className="pill">{kindLabel}</span>} {isChamp && <span className="pill pill-gold">👑 Holds the crown</span>}
          </div>
          <div className="small muted">{timeAgo(post.createdAt)}</div>
        </div>
      </div>
      {post.kind === 'original' && <h2 className="post-title">{post.title}</h2>}
      {hidden ? (
        <div className="hidden-clip">🚩 Hidden. The lobby flagged this clip as fake.</div>
      ) : (
        <ClipPlayer blobId={post.videoId} momentMs={post.momentMs} target={post.target} />
      )}
      <div className="badges">
        <span className="badge badge-hot">🎯 Made on attempt #{post.attempts}</span>
        {post.target && <span className="badge">Called shot</span>}
        <span className="badge" title="Recorded in the app with a one-time code burned into the video">
          ✓ In-app take · {post.verifyCode}
        </span>
        {post.rules.map((r) => (
          <span key={r} className="badge badge-rule">
            {r}
          </span>
        ))}
      </div>
      <div className="post-actions">
        <ReactionBar post={post} meId={s.meId!} />
        <div className="row tight">
          {post.missIds.length > 0 && (
            <button className="chip" onClick={onBloopers}>
              😂 Bloopers ({post.missIds.length})
            </button>
          )}
          {!mine && (
            <button className={`chip ${flagged ? 'chip-warn' : ''}`} onClick={() => flag(post.id)}>
              🚩 {flagged ? 'Flagged' : 'Fake?'}
              {post.flags.length > 0 && ` ${post.flags.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoteBox({ s, post }: { s: State; post: Post }) {
  const v = verdict(s, post);
  const mine = post.authorId === s.meId;
  const up = post.votesUp.includes(s.meId!);
  const down = post.votesDown.includes(s.meId!);
  const q = post.kind === 'upped' ? 'Did they up it?' : 'Legit match?';
  const status =
    v === 'won'
      ? post.kind === 'upped'
        ? '✅ Lobby says: UPPED'
        : '✅ Lobby says: matched'
      : v === 'lost'
        ? '❌ Lobby says: nope'
        : '⏳ Voting open';
  return (
    <div className={`vote vote-${v}`}>
      <div className="vote-q">
        <b>{q}</b> <span className="small">{status}</span>
      </div>
      {mine ? (
        <p className="small muted">You can't vote on your own clip.</p>
      ) : (
        <div className="row">
          <button className={`btn grow ${up ? '' : 'btn-ghost'}`} onClick={() => vote(post.id, true)}>
            👍 Yes {post.votesUp.length > 0 && `· ${post.votesUp.length}`}
          </button>
          <button className={`btn grow ${down ? 'btn-miss' : 'btn-ghost'}`} onClick={() => vote(post.id, false)}>
            👎 No {post.votesDown.length > 0 && `· ${post.votesDown.length}`}
          </button>
        </div>
      )}
    </div>
  );
}

function Comments({ s, post }: { s: State; post: Post }) {
  const [text, setText] = useState('');
  return (
    <section className="comments">
      <h2>Trash talk</h2>
      {post.comments.length === 0 && <p className="muted small">No comments yet.</p>}
      {post.comments.map((c) => (
        <div key={c.id} className="comment">
          <Avatar user={s.users[c.userId]} size={26} />
          <div>
            <b>{s.users[c.userId]?.name}</b> <span className="small muted">{timeAgo(c.createdAt)}</span>
            <div>{c.text}</div>
          </div>
        </div>
      ))}
      <form
        className="row"
        onSubmit={(e) => {
          e.preventDefault();
          addComment(post.id, text);
          setText('');
        }}
      >
        <input className="grow" value={text} maxLength={280} placeholder="Say something…" onChange={(e) => setText(e.target.value)} />
        <button className="btn" disabled={!text.trim()}>
          Send
        </button>
      </form>
    </section>
  );
}

function Bloopers({ post, onClose, name }: { post: Post; onClose: () => void; name?: string }) {
  const [i, setI] = useState(0);
  const id = post.missIds[i];
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="grow">
            Bloopers {i + 1}/{post.missIds.length}
          </h2>
          <button className="chip" onClick={onClose}>
            ✕
          </button>
        </div>
        <p className="small muted">
          {name ?? 'They'} missed {post.attempts - 1} time{post.attempts === 2 ? '' : 's'} before the make.
        </p>
        <ClipPlayer key={id} blobId={id} momentMs={-10_000} slowmo={false} loop={false} stampText="" />
        <div className="row">
          <button className="btn btn-ghost grow" disabled={i === 0} onClick={() => setI(i - 1)}>
            ‹ Prev
          </button>
          <button className="btn btn-ghost grow" disabled={i >= post.missIds.length - 1} onClick={() => setI(i + 1)}>
            Next ›
          </button>
        </div>
      </div>
    </div>
  );
}
