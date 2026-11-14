import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Avatar, handle, PageTitle } from '../components/ui';
import { go } from '../router';
import { cloudMode, distanceKm, LOCAL_RADIUS_KM, myLobbies, POINTS, scoreboard, startOfWeek, useAppState, type Score } from '../store';

type Scope = 'lobby' | 'local' | 'global';

export function RanksPage() {
  return (
    <div className="page">
      <PageTitle center>Leaderboard</PageTitle>
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
  const [scope, setScope] = useState<Scope>(fixedLobbyId || lobbies.length ? 'lobby' : 'global');
  const [lobbyId, setLobbyId] = useState(fixedLobbyId ?? lobbies[0]?.id);
  const [week, setWeek] = useState(false);
  const since = week ? startOfWeek() : undefined;

  let rows: Score[] = [];
  let note: React.ReactNode = null;
  if (scope === 'lobby') {
    rows = lobbyId ? scoreboard(s, { lobbyId, since }) : [];
    if (!lobbyId) note = 'Join a lobby to see its rankings.';
  } else if (scope === 'local') {
    if (!me?.place) {
      note = (
        <>
          Set your area on your{' '}
          <button className="link" onClick={() => go('/me')}>
            Profile
          </button>{' '}
          to see players near you.
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

  const podium = rows.length >= 3 ? rows.slice(0, 3) : [];
  const rest = podium.length ? rows.slice(3) : rows;

  return (
    <div className="board">
      {!fixedLobbyId && !cloudMode && (
        <div className="tabs">
          {(['lobby', 'local', 'global'] as const).map((t) => (
            <button key={t} className={`tab ${scope === t ? 'on' : ''}`} onClick={() => setScope(t)}>
              {t === 'lobby' ? 'Lobby' : t === 'local' ? 'Near me' : 'Global'}
            </button>
          ))}
        </div>
      )}
      <div className="row wrap">
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
          <button className={!week ? 'on' : ''} onClick={() => setWeek(false)}>
            All time
          </button>
          <button className={week ? 'on' : ''} onClick={() => setWeek(true)}>
            This week
          </button>
        </div>
      </div>
      {note && <p className="small muted">{note}</p>}

      {podium.length === 3 && (
        <div className="podium">
          {[1, 0, 2].map((i) => {
            const r = podium[i];
            return (
              <div key={r.user.id} className={`podium-card p${i + 1}`}>
                {i === 0 && <Icon name="crown" size={40} className="podium-crown" />}
                <Avatar user={r.user} size={i === 0 ? 60 : 48} />
                <span className="place">{i + 1}</span>
                <span className="who">{handle(r.user)}</span>
                <span className="pts">{r.points.toLocaleString()} pts</span>
              </div>
            );
          })}
        </div>
      )}

      <ol className="ranks">
        {rest.map((r, i) => (
          <li key={r.user.id} className={r.user.id === s.meId ? 'me' : ''}>
            <span className="rank">{i + 1 + podium.length}</span>
            <Avatar user={r.user} size={34} />
            <span className="grow">
              <b>{handle(r.user)}</b>
              <span className="small muted">
                {' '}
                · {r.posts} clip{r.posts === 1 ? '' : 's'}
                {r.crowns > 0 && ` · 👑 ${r.crowns}`}
              </span>
            </span>
            <span className="pts">{r.points.toLocaleString()} pts</span>
          </li>
        ))}
      </ol>
      {scope === 'global' && !cloudMode && (
        <p className="small muted">
          Global rankings fill in once the app runs on a shared server. Right now they show everyone on this device.
        </p>
      )}
    </div>
  );
}
