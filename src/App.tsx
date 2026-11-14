import { useEffect, useState } from 'react';
import { Icon, Logo } from './components/Icon';
import { go, useRoute } from './router';
import { loadState, onError, useAppState } from './store';
import { ChallengesPage, ChallengeView } from './screens/Challenges';
import { Home, Onboard } from './screens/Home';
import { LobbyView } from './screens/LobbyView';
import { MePage } from './screens/Me';
import { PostView } from './screens/PostView';
import { RanksPage } from './screens/Ranks';
import { Recorder } from './screens/Recorder';
import type { PostKind } from './types';

export function App() {
  const [ready, setReady] = useState(false);
  const s = useAppState();
  const { path, query } = useRoute();

  const [toast, setToast] = useState<string>();
  useEffect(() => {
    onError((m) => {
      setToast(m);
      window.setTimeout(() => setToast(undefined), 5000);
    });
    void loadState().then(() => setReady(true));
  }, []);

  if (!ready)
    return (
      <div className="splash">
        <Logo size={64} />
      </div>
    );
  if (!s.meId || !s.users[s.meId]) return <Onboard />;

  const [section, id] = path;
  let screen: React.ReactNode;
  switch (section) {
    case 'lobby':
      screen = <LobbyView id={id} />;
      break;
    case 'post':
      screen = <PostView key={id} id={id} />;
      break;
    case 'record':
      screen = (
        <Recorder
          key={query.toString()}
          lobbyId={query.get('lobby') ?? undefined}
          rootId={query.get('root') ?? undefined}
          kind={(query.get('kind') as PostKind) || undefined}
          challengeId={query.get('challenge') ?? undefined}
        />
      );
      break;
    case 'challenges':
      screen = <ChallengesPage />;
      break;
    case 'challenge':
      screen = <ChallengeView id={id} />;
      break;
    case 'ranks':
      screen = <RanksPage />;
      break;
    case 'me':
      screen = <MePage />;
      break;
    default:
      screen = <Home />;
  }

  const tab = section === 'challenges' || section === 'challenge' ? 'challenges' : section === 'ranks' ? 'ranks' : section === 'me' ? 'me' : section === 'record' ? 'record' : 'home';

  return (
    <div className="app">
      <main>{screen}</main>
      {toast && (
        <div className="toast" role="alert" onClick={() => setToast(undefined)}>
          Couldn't sync: {toast}
        </div>
      )}
      <nav className="nav">
        <NavBtn on={tab === 'home'} icon="home" label="Lobby" to="/" />
        <NavBtn on={tab === 'challenges'} icon="trophy" label="Challenges" to="/challenges" />
        <button className="nav-rec" onClick={() => go('/record')} aria-label="Record a trick shot">
          <Icon name="camera" size={26} />
        </button>
        <NavBtn on={tab === 'ranks'} icon="chart" label="Leaderboard" to="/ranks" />
        <NavBtn on={tab === 'me'} icon="user" label="Profile" to="/me" />
      </nav>
    </div>
  );
}

function NavBtn({ on, icon, label, to }: { on: boolean; icon: string; label: string; to: string }) {
  return (
    <button className={`nav-btn ${on ? 'on' : ''}`} onClick={() => go(to)}>
      <Icon name={icon} size={22} />
      <small>{label}</small>
    </button>
  );
}
