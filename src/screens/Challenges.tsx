import { Avatar, Empty, ReactionBar, timeLeft } from '../components/ui';
import { Thumb } from '../components/ClipPlayer';
import { go } from '../router';
import { challengeEntries, myLobbies, useAppState, visibleChallenges } from '../store';

export function ChallengesPage() {
  const s = useAppState();
  const all = visibleChallenges(s).filter((c) => c.endsAt > Date.now());
  const official = all.filter((c) => c.lobbyId === null);
  const lobby = all.filter((c) => c.lobbyId !== null);
  return (
    <div className="page">
      <h1>Challenges</h1>
      <h2>⭐ This week's official challenges</h2>
      <p className="small muted">Open to every player. Most reactions by Sunday night wins.</p>
      <div className="stack">
        {official.map((c) => (
          <article key={c.id} className="card challenge-card official" onClick={() => go(`/challenge/${c.id}`)}>
            <h3>{c.title}</h3>
            <p className="small">{c.description}</p>
            <div className="row tight">
              <span className="pill">{timeLeft(c.endsAt)}</span>
              <span className="pill">{challengeEntries(s, c.id).length} entries</span>
            </div>
          </article>
        ))}
      </div>
      <h2>Lobby challenges</h2>
      {lobby.length === 0 && (
        <Empty icon="🏆" title="No lobby challenges">
          <p className="muted small">Open a lobby and use its Challenges tab to set one for your group.</p>
        </Empty>
      )}
      <div className="stack">
        {lobby.map((c) => (
          <article key={c.id} className="card challenge-card" onClick={() => go(`/challenge/${c.id}`)}>
            <div className="small muted">{s.lobbies[c.lobbyId!]?.name}</div>
            <h3>{c.title}</h3>
            <p className="small">{c.description}</p>
            <div className="row tight">
              <span className="pill">{timeLeft(c.endsAt)}</span>
              <span className="pill">{challengeEntries(s, c.id).length} entries</span>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}

export function ChallengeView({ id }: { id: string }) {
  const s = useAppState();
  const c = s.challenges[id];
  if (!c) return <div className="page">Challenge not found.</div>;
  const entries = challengeEntries(s, id);
  const ended = c.endsAt <= Date.now();
  const lobbies = myLobbies(s);
  const canEnter = !ended && (c.lobbyId ? lobbies.some((l) => l.id === c.lobbyId) : lobbies.length > 0);
  return (
    <div className="page">
      <button className="back" onClick={() => (c.lobbyId ? go(`/lobby/${c.lobbyId}`) : go('/challenges'))}>
        ‹ Back
      </button>
      <div className="small muted">{c.lobbyId ? s.lobbies[c.lobbyId]?.name : '⭐ Official weekly challenge'}</div>
      <h1>🏆 {c.title}</h1>
      <p>{c.description}</p>
      {c.rules.length > 0 && (
        <div className="badges">
          {c.rules.map((r) => (
            <span key={r} className="badge badge-rule">
              {r}
            </span>
          ))}
        </div>
      )}
      <p>
        <span className="pill">{timeLeft(c.endsAt)}</span>
      </p>
      {canEnter && (
        <button className="btn full" onClick={() => go(`/record?challenge=${id}${c.lobbyId ? `&lobby=${c.lobbyId}` : ''}`)}>
          ● Enter this challenge
        </button>
      )}
      {!canEnter && !ended && <p className="muted small">Join a lobby to enter.</p>}
      <h2>{ended ? 'Final standings' : 'Standings'}</h2>
      {entries.length === 0 && <p className="muted">No entries yet.</p>}
      <ol className="entries">
        {entries.map(({ post, score }, i) => (
          <li key={post.id} className="card entry" onClick={() => go(`/post/${post.id}`)}>
            <span className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
            <Thumb blobId={post.thumbId} className="thumb-sm" />
            <div className="grow">
              <div>
                <Avatar user={s.users[post.authorId]} size={22} /> <b>{s.users[post.authorId]?.name}</b>
              </div>
              <div className="small">{post.title}</div>
              <ReactionBar post={post} meId={s.meId!} />
            </div>
            <b className="pts">{score}</b>
          </li>
        ))}
      </ol>
    </div>
  );
}
