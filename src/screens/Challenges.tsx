import { Thumb } from '../components/ClipPlayer';
import { Icon } from '../components/Icon';
import { Avatar, Empty, handle, PageTitle, ReactionBar, TopBar, timeLeft } from '../components/ui';
import { go } from '../router';
import { challengeEntries, myLobbies, useAppState, visibleChallenges } from '../store';
import type { Challenge } from '../types';

function iconFor(c: Challenge): string {
  const r = c.rules.join(' ');
  if (/bed|Not a basketball/.test(r)) return 'basket';
  if (/Bank|wall/.test(r)) return 'hoop';
  if (/Eyes|shoulder/.test(r)) return 'target';
  return 'bulb';
}

export function ChallengesPage() {
  const s = useAppState();
  const all = visibleChallenges(s).filter((c) => c.endsAt > Date.now());
  const official = all.filter((c) => c.lobbyId === null);
  const [hero, ...more] = official;
  const lobby = all.filter((c) => c.lobbyId !== null);
  return (
    <div className="page">
      <PageTitle center>Weekly challenges</PageTitle>
      {hero && (
        <div className="challenge-hero" onClick={() => go(`/challenge/${hero.id}`)}>
          <span className="ball" />
          <span className="this-week">This week</span>
          <h2 className="hero-title">{hero.title}</h2>
          <p className="small">{hero.description}</p>
          <span className="pill">
            <Icon name="clock" /> {timeLeft(hero.endsAt)} · {challengeEntries(s, hero.id).length} entries
          </span>
          <button className="btn" style={{ alignSelf: 'flex-start' }}>
            Join challenge <Icon name="chevron" />
          </button>
        </div>
      )}

      <h2 className="section-title">More challenges</h2>
      <div className="stack tight">
        {[...more, ...lobby].map((c) => (
          <article key={c.id} className="card ch-row" onClick={() => go(`/challenge/${c.id}`)}>
            <span className="ch-icon">
              <Icon name={iconFor(c)} size={26} />
            </span>
            <div className="grow">
              <div className="title">{c.title}</div>
              <div className="small muted">
                {c.lobbyId ? s.lobbies[c.lobbyId]?.name : 'Official'} · {timeLeft(c.endsAt)} · {challengeEntries(s, c.id).length}{' '}
                entries
              </div>
            </div>
            <Icon name="chevron" />
          </article>
        ))}
      </div>
      {lobby.length === 0 && (
        <Empty icon="trophy" title="No lobby challenges">
          <p className="muted small">Open a lobby and use its Challenges tab to set one for your group.</p>
        </Empty>
      )}
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
      <TopBar back={() => (c.lobbyId ? go(`/lobby/${c.lobbyId}`) : go('/challenges'))} title="CHALLENGE" />
      <span className="this-week">{c.lobbyId ? s.lobbies[c.lobbyId]?.name : 'Official · this week'}</span>
      <PageTitle>{c.title}</PageTitle>
      <p>{c.description}</p>
      <div className="pills">
        <span className="pill pill-red">
          <Icon name="clock" /> {timeLeft(c.endsAt)}
        </span>
        {c.rules.map((r) => (
          <span key={r} className="pill pill-orange">
            {r}
          </span>
        ))}
      </div>
      {canEnter && (
        <button className="btn full" onClick={() => go(`/record?challenge=${id}${c.lobbyId ? `&lobby=${c.lobbyId}` : ''}`)}>
          Join challenge <Icon name="chevron" />
        </button>
      )}
      {!canEnter && !ended && <p className="muted small">Join a lobby to enter.</p>}
      <h2 className="section-title">{ended ? 'Final standings' : 'Standings'}</h2>
      {entries.length === 0 && <p className="muted">No entries yet. Be first.</p>}
      <ol className="entries">
        {entries.map(({ post, score }, i) => (
          <li key={post.id} className="card entry" onClick={() => go(`/post/${post.id}`)}>
            <span className="rank">{i + 1}</span>
            <Thumb blobId={post.thumbId} className="thumb-sm" />
            <div className="grow">
              <div className="byline">
                <Avatar user={s.users[post.authorId]} size={20} /> <b>{handle(s.users[post.authorId])}</b>
              </div>
              <div className="small">{post.title}</div>
              <ReactionBar post={post} meId={s.meId!} />
            </div>
            <b className="num lime" style={{ fontSize: '1.5rem' }}>
              {score}
            </b>
          </li>
        ))}
      </ol>
    </div>
  );
}
