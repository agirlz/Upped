import { useState } from 'react';
import { Avatar } from '../components/ui';
import { go } from '../router';
import { distanceKm, LOCAL_RADIUS_KM, myLobbies, POINTS, scoreboard, startOfWeek, useAppState } from '../store';

type Scope = 'lobby' | 'local' | 'global';

export function RanksPage() {
  return (
    <div className="page">
      <h1>Leaderboards</h1>
      <Leaderboard />
      <details className="card small">
        <summary>How points work</summary>
        <ul>
          <li>Post a trick shot: +{POINTS.original}</li>
          <li>Lobby confirms your match: +{POINTS.matched}</li>
          <li>Lobby says you upped it: +{POINTS.upped}</li>
          <li>Holding the crown on a shot: +{POINTS.crown} each</li>
          <li>Each 🔥 from someone else: +{POINTS.fire}, other reactions +{POINTS.reaction}</li>
          <li>Clips the lobby flags as fake score nothing.</li>
        </ul>
      </details>
    </div>
  );
}

export function Leaderboard({ fixedLobbyId }: { fixedLobbyId?: string }) {
  const s = useAppState();
  const lobbies = myLobbies(s);
  const me = s.meId ? s.users[s.meId] : undefined;
  const [scope, setScope] = useState<Scope>(fixedLobbyId ? 'lobby' : 'global');
  const [lobbyId, setLobbyId] = useState(fixedLobbyId ?? lobbies[0]?.id);
  const [week, setWeek] = useState(true);
  const since = week ? startOfWeek() : undefined;

  let rows = [] as ReturnType<typeof scoreboard>;
  let note: React.ReactNode = null;
  if (scope === 'lobby') {
    rows = lobbyId ? scoreboard(s, { lobbyId, since }) : [];
    if (!lobbyId) note = 'Join a lobby to see its rankings.';
  } else if (scope === 'local') {
    if (!me?.place) {
      note = (
        <>
          Set your area on the <button className="link" onClick={() => go('/me')}>Me</button> tab to see players near you.
        </>
      );
    } else {
      const near = Object.values(s.users)
        .filter((u) => u.place && distanceKm(u.place, me.place!) <= LOCAL_RADIUS_KM)
        .map((u) => u.id);
      rows = scoreboard(s, { userIds: near, since });
      note = `Players within ${LOCAL_RADIUS_KM} km of ${me.place.label || 'you'}.`;
    }
  } else {
    rows = scoreboard(s, { since });
  }

  return (
    <div className="board">
      {!fixedLobbyId && (
        <div className="tabs">
          {(['lobby', 'local', 'global'] as const).map((t) => (
            <button key={t} className={`tab ${scope === t ? 'on' : ''}`} onClick={() => setScope(t)}>
              {t === 'lobby' ? 'Lobby' : t === 'local' ? 'Near me' : 'Global'}
            </button>
          ))}
        </div>
      )}
      <div className="row">
        {scope === 'lobby' && !fixedLobbyId && lobbies.length > 1 && (
          <select className="grow" value={lobbyId} onChange={(e) => setLobbyId(e.target.value)}>
            {lobbies.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        )}
        <div className="seg">
          <button className={week ? 'on' : ''} onClick={() => setWeek(true)}>
            This week
          </button>
          <button className={!week ? 'on' : ''} onClick={() => setWeek(false)}>
            All time
          </button>
        </div>
      </div>
      {note && <p className="small muted">{note}</p>}
      <ol className="ranks">
        {rows.map((r, i) => (
          <li key={r.user.id} className={r.user.id === s.meId ? 'me' : ''}>
            <span className="rank">{i === 0 ? '🥇' : i === 1 ? '🥈' : i === 2 ? '🥉' : i + 1}</span>
            <Avatar user={r.user} size={30} />
            <span className="grow">
              <b>{r.user.name}</b>
              <span className="small muted">
                {' '}
                · {r.posts} clip{r.posts === 1 ? '' : 's'}
                {r.crowns > 0 && ` · 👑 ${r.crowns}`}
              </span>
            </span>
            <b className="pts">{r.points}</b>
          </li>
        ))}
      </ol>
      {scope === 'global' && (
        <p className="small muted">
          Global rankings fill in once the app runs on a shared server. Right now they show everyone on this device.
        </p>
      )}
    </div>
  );
}
