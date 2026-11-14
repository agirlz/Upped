import { useState } from 'react';
import { Icon, Logo } from '../components/Icon';
import { Avatar, Empty, PageTitle, timeAgo } from '../components/ui';
import { buildDemo } from '../demo';
import { go } from '../router';
import { cloudMode, createLobby, joinLobby, myLobbies, signUpPlayer, useAppState } from '../store';
import { AVATARS } from '../types';

export function Onboard() {
  const [name, setName] = useState('');
  const [emoji, setEmoji] = useState(AVATARS[0]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const start = async () => {
    setBusy(true);
    setErr('');
    try {
      await signUpPlayer(name, emoji);
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };
  return (
    <div className="page onboard">
      <div className="hero-logo">
        <Logo size={88} />
      </div>
      <p className="tagline">
        The trick shot app
        <br />
        for <em>friend groups</em>
      </p>
      <div className="how">
        <div>
          <Icon name="play" size={26} />
          Post trick shots
        </div>
        <div>
          <Icon name="upRight" size={26} />
          Match or up it
        </div>
        <div>
          <Icon name="users" size={26} />
          Vote for a winner
        </div>
        <div>
          <Icon name="crown" size={26} />
          Hold the crown
        </div>
      </div>
      <label className="field">
        <span>Your name</span>
        <input value={name} maxLength={20} placeholder="What your friends call you" onChange={(e) => setName(e.target.value)} />
      </label>
      <div className="field">
        <span>Pick an avatar</span>
        <div className="avatar-grid">
          {AVATARS.map((a) => (
            <button key={a} className={`avatar-pick ${a === emoji ? 'on' : ''}`} onClick={() => setEmoji(a)}>
              {a}
            </button>
          ))}
        </div>
      </div>
      {err && <p className="error">{err}</p>}
      <button className="btn full" disabled={!name.trim() || busy} onClick={start}>
        {busy ? 'Setting up…' : "Let's go"} <Icon name="upRight" />
      </button>
      {cloudMode && (
        <p className="small muted center">No email needed. Your account lives on this phone, so don't clear this site's data.</p>
      )}
    </div>
  );
}

export function Home() {
  const s = useAppState();
  const lobbies = myLobbies(s);
  const [mode, setMode] = useState<'none' | 'create' | 'join'>('none');
  const [value, setValue] = useState('');
  const [err, setErr] = useState('');
  const [demoBusy, setDemoBusy] = useState<string>();

  const [working, setWorking] = useState(false);
  const submit = async () => {
    setErr('');
    setWorking(true);
    try {
      const id = mode === 'create' ? await createLobby(value) : await joinLobby(value);
      if (!id) return setErr('No lobby with that code.');
      go(`/lobby/${id}`);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setWorking(false);
    }
  };

  const demo = async () => {
    setDemoBusy('Filming demo clips…');
    try {
      const id = await buildDemo((msg) => setDemoBusy(msg));
      go(`/lobby/${id}`);
    } finally {
      setDemoBusy(undefined);
    }
  };

  return (
    <div className="page">
      <div className="topbar">
        <span />
        <Logo size={36} />
        <span />
      </div>
      <PageTitle>Your lobbies</PageTitle>
      {lobbies.length === 0 && (
        <Empty icon="users" title="No lobbies yet">
          <p className="muted">{cloudMode ? "Start one for your crew, or join with a friend's invite code." : "Start one for your group, join with a friend's code, or try the demo lobby."}</p>
        </Empty>
      )}
      <div className="stack">
        {lobbies.map((l) => {
          const posts = Object.values(s.posts).filter((p) => p.lobbyId === l.id);
          const last = posts.sort((a, b) => b.createdAt - a.createdAt)[0];
          return (
            <article key={l.id} className="card lobby-card" onClick={() => go(`/lobby/${l.id}`)}>
              <div>
                <h3 className="title">{l.name}</h3>
                <div className="small muted">
                  {l.memberIds.length} member{l.memberIds.length === 1 ? '' : 's'} · {posts.length} clips
                  {last && <> · last clip {timeAgo(last.createdAt)}</>}
                </div>
              </div>
              <div className="avatars">
                {l.memberIds.slice(0, 5).map((id) => (
                  <Avatar key={id} user={s.users[id]} size={28} />
                ))}
              </div>
            </article>
          );
        })}
      </div>

      {mode === 'none' ? (
        <div className="row wrap">
          <button className="btn grow" onClick={() => setMode('create')}>
            <Icon name="plus" /> New lobby
          </button>
          <button className="btn btn-ghost grow" onClick={() => setMode('join')}>
            Join with code
          </button>
        </div>
      ) : (
        <div className="card form-card">
          <label className="field">
            <span>{mode === 'create' ? 'Lobby name' : 'Invite code'}</span>
            <input
              autoFocus
              value={value}
              maxLength={mode === 'create' ? 30 : 6}
              placeholder={mode === 'create' ? 'e.g. Driveway Legends' : 'ABC123'}
              onChange={(e) => setValue(mode === 'join' ? e.target.value.toUpperCase() : e.target.value)}
            />
          </label>
          {err && <p className="error">{err}</p>}
          <div className="row">
            <button className="btn btn-quiet" onClick={() => (setMode('none'), setValue(''), setErr(''))}>
              Cancel
            </button>
            <button className="btn grow" disabled={!value.trim() || working} onClick={submit}>
              {mode === 'create' ? 'Create lobby' : 'Join'}
            </button>
          </div>
        </div>
      )}

      {!cloudMode && (
        <button className="btn btn-quiet full" disabled={!!demoBusy} onClick={demo}>
          {demoBusy ?? 'Load a demo lobby with sample clips'}
        </button>
      )}
    </div>
  );
}
