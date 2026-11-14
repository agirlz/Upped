import { useEffect, useRef, useState } from 'react';
import { ClipPlayer } from '../components/ClipPlayer';
import { Icon } from '../components/Icon';
import { EnhanceClip } from '../components/EnhanceClip';
import { SideBySide } from '../components/SideBySide';
import { Avatar, handle, ReactionBar, SpotPill, timeAgo, TopBar } from '../components/ui';
import { difficulty, distanceLabel, targetInfo } from '../difficulty';
import { go } from '../router';
import { sfx } from '../sounds';
import { addComment, canDelete, champion, deletePost, flag, isHidden, repliesOf, useAppState, verdict, votesNeeded, vote } from '../store';
import type { Post, State } from '../types';

export function PostView({ id }: { id: string }) {
  const s = useAppState();
  const root = s.posts[id];
  const [tab, setTab] = useState<'replies' | 'comments'>('replies');
  const [compare, setCompare] = useState<string>();
  const [bloopers, setBloopers] = useState<Post>();
  if (!root) return <div className="page">Clip not found.</div>;

  const replies = repliesOf(s, id);
  const champ = champion(s, id);
  const challenge = root.challengeId ? s.challenges[root.challengeId] : undefined;
  const need = votesNeeded(s, root.lobbyId);
  // Compare a reply against whatever held the crown when it was posted.
  const opponent = (p: Post) =>
    [...replies]
      .filter((r) => r.kind === 'upped' && r.createdAt < p.createdAt && verdict(s, r) === 'won' && !isHidden(s, r))
      .at(-1) ?? root;

  return (
    <div className="page">
      <TopBar back={() => go(`/lobby/${root.lobbyId}`)} title="SHOT" />

      {champ && champ.id !== root.id && (
        <div className="crown-banner">
          <Avatar user={s.users[champ.authorId]} size={40} />
          <div className="label grow">
            Holds the crown
            <small>{handle(s.users[champ.authorId])} upped this. Beat their version to take it.</small>
          </div>
          <Icon name="crown" size={28} className="gold" />
        </div>
      )}

      <PostBlock s={s} post={root} onBloopers={() => setBloopers(root)} isChamp={champ?.id === root.id} />
      {challenge && (
        <button className="pill pill-red" onClick={() => go(`/challenge/${challenge.id}`)}>
          <Icon name="trophy" /> Entry for: {challenge.title}
        </button>
      )}

      <button className="btn btn-big full" onClick={() => go(`/record?root=${id}`)}>
        <Icon name="target" /> Try it
      </button>
      <p className="small muted center" style={{ marginTop: -4 }}>
        Make it to match. Tag it harder to up it.
      </p>

      <div className="underline-tabs">
        <button className={tab === 'replies' ? 'on' : ''} onClick={() => setTab('replies')}>
          Replies ({replies.length})
        </button>
        <button className={tab === 'comments' ? 'on' : ''} onClick={() => setTab('comments')}>
          Comments ({root.comments.length})
        </button>
      </div>

      {tab === 'replies' && (
        <>
          {replies.length === 0 ? (
            <p className="muted">Nobody has tried it yet. Will you be first?</p>
          ) : (
            <p className="small muted">
              {need} vote{need === 1 ? '' : 's'} decide{need === 1 ? 's' : ''} a reply in this lobby.
            </p>
          )}
          <div className="stack">
            {replies.map((p) => (
              <div key={p.id} className="card reply">
                <PostBlock s={s} post={p} onBloopers={() => setBloopers(p)} isChamp={champ?.id === p.id} />
                {!isHidden(s, p) && <VoteBox s={s} post={p} against={opponent(p)} />}
                {!isHidden(s, p) && (
                  <button className="btn btn-quiet btn-sm full" onClick={() => setCompare(compare === p.id ? undefined : p.id)}>
                    {compare === p.id ? 'Hide comparison' : '⇆ Compare side by side'}
                  </button>
                )}
                {compare === p.id && <SideBySide a={opponent(p)} b={p} users={s.users} />}
              </div>
            ))}
          </div>
        </>
      )}

      {tab === 'comments' && <Comments s={s} post={root} />}

      {bloopers && <Bloopers post={bloopers} onClose={() => setBloopers(undefined)} name={s.users[bloopers.authorId]?.name} />}
    </div>
  );
}

function PostBlock({ s, post, onBloopers, isChamp }: { s: State; post: Post; onBloopers: () => void; isChamp: boolean }) {
  const author = s.users[post.authorId];
  const hidden = isHidden(s, post);
  const mine = post.authorId === s.meId;
  const flagged = post.flags.includes(s.meId!);
  const [enhancing, setEnhancing] = useState(false);
  return (
    <div className="post">
      {post.kind === 'original' && <h2 className="title" style={{ fontSize: '1.6rem' }}>{post.title}</h2>}
      <div className="post-head">
        <Avatar user={author} size={post.kind === 'original' ? 30 : 36} />
        <div className="grow byline">
          <b>{handle(author)}</b> · {timeAgo(post.createdAt)}
          {post.kind === 'matched' && <span className="pill pill-lime">Matched it</span>}
          {post.kind === 'upped' && <span className="pill pill-lime">Upped it</span>}
        </div>
        {isChamp && (
          <span className="pill pill-gold">
            <Icon name="crown" /> Holds the crown
          </span>
        )}
      </div>
      {hidden ? (
        <div className="hidden-clip">Hidden. The lobby flagged this clip as fake.</div>
      ) : (
        <ClipPlayer blobId={post.videoId} momentMs={post.momentMs} target={post.target} trail={post.trail} celebrate={post.kind === 'original'} />
      )}
      <div className="pills">
        {difficulty(post) !== undefined && <span className="pill pill-solid">Difficulty {difficulty(post)}</span>}
        <SpotPill post={post} />
        {distanceLabel(post) && (
          <span className={`pill ${post.measured ? 'pill-lime' : ''}`}>
            <Icon name="pin" /> {distanceLabel(post)}
          </span>
        )}
        {targetInfo(post.targetSize) && <span className="pill">{targetInfo(post.targetSize)!.label} target</span>}
        <span className="pill">Attempt #{post.attempts}</span>
        {post.target && !post.target.late && (
          <span className="pill pill-lime">
            <Icon name="target" /> Called shot
          </span>
        )}
        {post.target?.late && (
          <span className="pill" title="The target was marked after the shot, not called before it">
            <Icon name="target" /> Target added later
          </span>
        )}
        {post.trail && <span className="pill pill-lime">✨ Trail</span>}
        <span className="pill" title="Recorded in the app with a one-time code burned into the video">
          <Icon name="check" /> In-app · {post.verifyCode}
        </span>
        {post.rules.map((r) => (
          <span key={r} className="pill pill-orange">
            {r}
          </span>
        ))}
      </div>
      {enhancing && <EnhanceClip post={post} onClose={() => setEnhancing(false)} />}
      <div className="post-actions">
        <ReactionBar post={post} meId={s.meId!} />
        <div className="row tight">
          {mine && !hidden && (!post.trail || !post.target || post.target.late) && (
            <button className="chip chip-on" onClick={() => setEnhancing(true)}>
              ✨ {post.target?.late ? 'Redo target & trail' : !post.target ? (post.trail ? 'Add target' : 'Add target & trail') : 'Add trail'}
            </button>
          )}
          {post.missIds.length > 0 && (
            <button className="chip" onClick={onBloopers}>
              😂 Bloopers ({post.missIds.length})
            </button>
          )}
          {canDelete(s, post) && (
            <button
              className="chip"
              onClick={async () => {
                if (!confirm(post.kind === 'original' ? 'Delete this clip and all its replies?' : 'Delete this clip?')) return;
                try {
                  await deletePost(post.id);
                  if (post.kind === 'original') go(`/lobby/${post.lobbyId}`);
                } catch (e) {
                  alert((e as Error).message);
                }
              }}
            >
              <Icon name="x" /> Delete
            </button>
          )}
          {!mine && (
            <button className={`chip ${flagged ? 'chip-warn' : ''}`} onClick={() => flag(post.id)}>
              <Icon name="flag" /> {flagged ? 'Flagged' : 'Fake?'}
              {post.flags.length > 0 && ` ${post.flags.length}`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function VoteBox({ s, post, against }: { s: State; post: Post; against: Post }) {
  const mine = difficulty(post);
  const theirs = difficulty(against);
  const v = verdict(s, post);
  const isAuthor = post.authorId === s.meId;
  const up = post.votesUp.includes(s.meId!);
  const down = post.votesDown.includes(s.meId!);
  const total = post.votesUp.length + post.votesDown.length;
  const pct = total ? Math.round((post.votesUp.length / total) * 100) : 0;
  const q = post.kind === 'upped' ? 'Did they up it?' : 'Legit match?';
  // Cheer or boo when the verdict changes while you're watching (your vote or someone else's, live).
  const prev = useRef(v);
  useEffect(() => {
    if (prev.current === v) return;
    if (v === 'won') sfx.win();
    if (v === 'lost') sfx.lose();
    prev.current = v;
  }, [v]);
  return (
    <div className="vote">
      <div className="vote-q">
        <b>{q}</b>
        <span className="small muted">
          {total} vote{total === 1 ? '' : 's'}
        </span>
      </div>
      {v === 'won' && (
        <div className="result result-win">
          <Icon name="check" size={26} />
          <div className="grow">
            {post.kind === 'upped' ? 'Winner' : 'Matched'}
            <small>{pct}% said yes</small>
          </div>
          <span className="big">{pct}%</span>
        </div>
      )}
      {v === 'lost' && (
        <div className="result result-lose">
          <Icon name="x" size={26} />
          <div className="grow">
            Not this time
            <small>{100 - pct}% said no</small>
          </div>
          <span className="big">{pct}%</span>
        </div>
      )}
      {v === 'pending' && total > 0 && (
        <div className="result-bar">
          <span style={{ width: `${pct}%` }} />
        </div>
      )}
      {mine !== undefined && theirs !== undefined && (
        <p className="small muted">
          Difficulty <b className="lime">{mine}</b> vs <b>{theirs}</b> ({s.users[against.authorId]?.name ?? 'theirs'})
          {post.kind === 'upped' && (mine > theirs ? ' · tagged harder' : ' · not tagged harder: check it')}
        </p>
      )}
      {isAuthor ? (
        <p className="small muted">You can't vote on your own clip.</p>
      ) : (
        <div className="row">
          <button className={`btn btn-sm grow ${up ? '' : 'btn-quiet'}`} onClick={() => vote(post.id, true)}>
            <Icon name="check" /> Yes {post.votesUp.length > 0 && `· ${post.votesUp.length}`}
          </button>
          <button className={`btn btn-sm grow ${down ? 'btn-miss' : 'btn-quiet'}`} onClick={() => vote(post.id, false)}>
            <Icon name="x" /> No {post.votesDown.length > 0 && `· ${post.votesDown.length}`}
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
      {post.comments.length === 0 && <p className="muted small">No trash talk yet. Start it.</p>}
      {post.comments.map((c) => (
        <div key={c.id} className="comment">
          <Avatar user={s.users[c.userId]} size={30} />
          <div>
            <b>{handle(s.users[c.userId])}</b> <span className="small muted">{timeAgo(c.createdAt)}</span>
            <div>{c.text}</div>
          </div>
        </div>
      ))}
      <form
        className="composer"
        onSubmit={(e) => {
          e.preventDefault();
          addComment(post.id, text);
          setText('');
        }}
      >
        <input className="grow" value={text} maxLength={280} placeholder="Add a comment…" onChange={(e) => setText(e.target.value)} />
        <button className="icon-btn" disabled={!text.trim()} aria-label="Send">
          <Icon name="upRight" />
        </button>
      </form>
    </section>
  );
}

function Bloopers({ post, onClose, name }: { post: Post; onClose: () => void; name?: string }) {
  const [i, setI] = useState(0);
  const id = post.missIds[i];
  useEffect(() => sfx.bloopers(), []);
  return (
    <div className="modal" onClick={onClose}>
      <div className="modal-body" onClick={(e) => e.stopPropagation()}>
        <div className="row">
          <h2 className="section-title grow" style={{ margin: 0 }}>
            Bloopers <span className="count">{i + 1}/{post.missIds.length}</span>
          </h2>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            <Icon name="x" />
          </button>
        </div>
        <p className="small muted">
          {name ?? 'They'} missed {post.attempts - 1} time{post.attempts === 2 ? '' : 's'} before the make.
        </p>
        <ClipPlayer key={id} blobId={id} momentMs={-10_000} slowmo={false} loop={false} stampText="" />
        <div className="row">
          <button className="btn btn-quiet btn-sm grow" disabled={i === 0} onClick={() => setI(i - 1)}>
            Prev
          </button>
          <button className="btn btn-quiet btn-sm grow" disabled={i >= post.missIds.length - 1} onClick={() => setI(i + 1)}>
            Next
          </button>
        </div>
      </div>
    </div>
  );
}
