import { useState } from 'react';
import { Icon, Logo } from '../components/Icon';
import { Avatar, ChainCard, CrownBanner, Empty, TopBar, timeLeft } from '../components/ui';
import { go } from '../router';
import { createChallenge, DAY, useAppState, visibleChallenges } from '../store';
import { RULE_OPTIONS } from '../types';
import { Leaderboard } from './Ranks';

export function LobbyView({ id }: { id: string }) {
  const s = useAppState();
  const lobby = s.lobbies[id];
  const [tab, setTab] = useState<'feed' | 'challenges' | 'ranks'>('feed');
  const [copied, setCopied] = useState(false);
  if (!lobby) return <div className="page">Lobby not found.</div>;

  const roots = Object.values(s.posts)
    .filter((p) => p.lobbyId === id && p.kind === 'original')
    .sort((a, b) => b.createdAt - a.createdAt);
  const challenges = visibleChallenges(s).filter((c) => c.lobbyId === id);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(lobby.code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable */
    }
  };

  return (
    <div className="page">
      <TopBar back={() => go('/')} title={<Logo size={30} />} />
      <h1 className="title" style={{ fontSize: '1.6rem' }}>{lobby.name}</h1>
      <div className="lobby-meta">
        <div className="avatars">
          {lobby.memberIds.map((m) => (
            <Avatar key={m} user={s.users[m]} size={30} />
          ))}
        </div>
        <button className="chip" onClick={copy}>
          <Icon name="share" /> {copied ? 'Copied!' : `Invite code: ${lobby.code}`}
        </button>
      </div>

      <div className="tabs">
        {(['feed', 'challenges', 'ranks'] as const).map((t) => (
          <button key={t} className={`tab ${tab === t ? 'on' : ''}`} onClick={() => setTab(t)}>
            {t === 'feed' ? 'Shots' : t === 'challenges' ? 'Challenges' : 'Ranks'}
          </button>
        ))}
      </div>

      {tab === 'feed' && (
        <>
          <CrownBanner s={s} lobbyId={id} />
          <button className="btn full" onClick={() => go(`/record?lobby=${id}`)}>
            <Icon name="camera" /> Post a trick shot
          </button>
          {roots.length === 0 && (
            <Empty icon="target" title="No shots yet">
              <p className="muted">Be first. Call your target, make the shot, and dare everyone to beat it.</p>
            </Empty>
          )}
          <div className="stack">
            {roots.map((p) => (
              <ChainCard key={p.id} s={s} post={p} />
            ))}
          </div>
        </>
      )}

      {tab === 'challenges' && (
        <>
          <NewChallenge lobbyId={id} />
          {challenges.length === 0 && <p className="muted center">No lobby challenges yet. Set the first one.</p>}
          <div className="stack">
            {challenges.map((c) => (
              <article key={c.id} className="card" onClick={() => go(`/challenge/${c.id}`)}>
                <h3 className="title">{c.title}</h3>
                <p className="small muted">{c.description}</p>
                <span className="pill pill-red">
                  <Icon name="clock" /> {timeLeft(c.endsAt)}
                </span>
              </article>
            ))}
          </div>
        </>
      )}

      {tab === 'ranks' && <Leaderboard fixedLobbyId={id} />}
    </div>
  );
}

function NewChallenge({ lobbyId }: { lobbyId: string }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [desc, setDesc] = useState('');
  const [days, setDays] = useState(3);
  const [rules, setRules] = useState<string[]>([]);
  if (!open)
    return (
      <button className="btn full" onClick={() => setOpen(true)}>
        <Icon name="trophy" /> Set a challenge
      </button>
    );
  return (
    <div className="card form-card">
      <label className="field">
        <span>Challenge</span>
        <input value={title} maxLength={50} placeholder="e.g. Best shot from the roof" onChange={(e) => setTitle(e.target.value)} />
      </label>
      <label className="field">
        <span>Details</span>
        <textarea value={desc} maxLength={200} rows={2} placeholder="What counts, what doesn't" onChange={(e) => setDesc(e.target.value)} />
      </label>
      <div className="field">
        <span>Required rules</span>
        <div className="chips">
          {RULE_OPTIONS.map((r) => (
            <button
              key={r}
              className={`chip ${rules.includes(r) ? 'chip-on' : ''}`}
              onClick={() => setRules((rs) => (rs.includes(r) ? rs.filter((x) => x !== r) : [...rs, r]))}
            >
              {r}
            </button>
          ))}
        </div>
      </div>
      <label className="field">
        <span>Ends in</span>
        <select value={days} onChange={(e) => setDays(Number(e.target.value))}>
          {[1, 2, 3, 5, 7, 14].map((d) => (
            <option key={d} value={d}>
              {d} day{d === 1 ? '' : 's'}
            </option>
          ))}
        </select>
      </label>
      <div className="row">
        <button className="btn btn-quiet" onClick={() => setOpen(false)}>
          Cancel
        </button>
        <button
          className="btn grow"
          disabled={!title.trim()}
          onClick={() => {
            const c = createChallenge({ lobbyId, title: title.trim(), description: desc.trim(), rules, endsAt: Date.now() + days * DAY });
            go(`/challenge/${c.id}`);
          }}
        >
          Start challenge
        </button>
      </div>
    </div>
  );
}
