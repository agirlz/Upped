import { useState } from 'react';
import { Icon } from '../components/Icon';
import { Avatar, handle } from '../components/ui';
import { createUser, isHidden, resetEverything, switchUser, updateMe, useAppState } from '../store';
import { AVATARS } from '../types';

export function MePage() {
  const s = useAppState();
  const me = s.users[s.meId!];
  const [placeMsg, setPlaceMsg] = useState('');
  const [label, setLabel] = useState(me.place?.label ?? '');
  const [newName, setNewName] = useState('');

  const mine = Object.values(s.posts).filter((p) => p.authorId === me.id && !isHidden(s, p));
  const totalAttempts = mine.reduce((n, p) => n + p.attempts, 0);
  const makeRate = totalAttempts ? Math.round((mine.length / totalAttempts) * 100) : 0;
  const best = mine.reduce((m, p) => (p.attempts > m ? p.attempts : m), 0);

  const locate = () => {
    if (!navigator.geolocation) return setPlaceMsg('Location is not available in this browser.');
    setPlaceMsg('Finding you…');
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        // Round to ~10 km so we never store an exact address.
        const round = (n: number) => Math.round(n * 10) / 10;
        updateMe({ place: { lat: round(pos.coords.latitude), lng: round(pos.coords.longitude), label: label.trim() || undefined } });
        setPlaceMsg('Area saved (rounded to about 10 km).');
      },
      () => setPlaceMsg('Could not get your location. Check location permissions.'),
      { maximumAge: 600_000, timeout: 15_000 },
    );
  };

  return (
    <div className="page">
      <div className="me-head">
        <Avatar user={me} size={64} />
        <div>
          <h1 className="title" style={{ fontSize: '1.9rem' }}>{handle(me)}</h1>
          <div className="small muted">Playing since {new Date(me.createdAt).toLocaleDateString()}</div>
        </div>
      </div>

      <div className="stats">
        <div>
          <b>{mine.length}</b>
          <span>makes posted</span>
        </div>
        <div>
          <b>{totalAttempts}</b>
          <span>attempts</span>
        </div>
        <div>
          <b>{makeRate}%</b>
          <span>make rate</span>
        </div>
        <div>
          <b>{best || '-'}</b>
          <span>longest grind</span>
        </div>
      </div>

      <section className="card">
        <h3>Avatar</h3>
        <div className="avatar-grid">
          {AVATARS.map((a) => (
            <button key={a} className={`avatar-pick ${a === me.emoji ? 'on' : ''}`} onClick={() => updateMe({ emoji: a })}>
              {a}
            </button>
          ))}
        </div>
      </section>

      <section className="card">
        <h3>My area</h3>
        <p className="small muted">Used for the "Near me" leaderboard.</p>
        <label className="field">
          <span>Area name (optional)</span>
          <input value={label} maxLength={30} placeholder="e.g. Eastside courts" onChange={(e) => setLabel(e.target.value)} />
        </label>
        <button className="btn btn-quiet full" onClick={locate}>
          <Icon name="pin" /> {me.place ? 'Update my area' : 'Use my location'}
        </button>
        {placeMsg && <p className="small muted">{placeMsg}</p>}
        {me.place && (
          <button className="link small" onClick={() => updateMe({ place: undefined })}>
            Remove my area
          </button>
        )}
      </section>

      <section className="card">
        <h3>Players on this device</h3>
        <p className="small muted">
          Until the shared server is set up, everyone plays on one phone. Add your friends here and switch between them to pass
          the phone around.
        </p>
        <div className="stack tight">
          {Object.values(s.users).map((u) => (
            <button key={u.id} className={`player ${u.id === me.id ? 'on' : ''}`} onClick={() => switchUser(u.id)}>
              <Avatar user={u} size={26} /> {u.name} {u.id === me.id && <span className="pill">playing</span>}
            </button>
          ))}
        </div>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (!newName.trim()) return;
            createUser(newName, AVATARS[Object.keys(s.users).length % AVATARS.length], true);
            setNewName('');
          }}
        >
          <input className="grow" value={newName} maxLength={20} placeholder="Friend's name" onChange={(e) => setNewName(e.target.value)} />
          <button className="btn btn-sm" disabled={!newName.trim()}>
            Add
          </button>
        </form>
      </section>

      <button
        className="link danger small"
        onClick={async () => {
          if (confirm('Delete every player, lobby and clip on this device?')) {
            await resetEverything();
            location.hash = '/';
          }
        }}
      >
        Reset all data on this device
      </button>
    </div>
  );
}
