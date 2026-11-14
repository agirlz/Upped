import { useEffect, useState } from 'react';
import { go, useRoute } from './router';
import { loadState, useAppState } from './store';
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

  useEffect(() => {
    void loadState().then(() => setReady(true));
  }, []);

  if (!ready) return <div className="splash">UPPED</div>;
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
          kind={(query.get('kind') as PostKind) || 'original'}
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
      <nav className="nav">
        <NavBtn on={tab === 'home'} icon="🏠" label="Lobbies" to="/" />
        <NavBtn on={tab === 'challenges'} icon="🏆" label="Challenges" to="/challenges" />
        <button className={`nav-rec ${tab === 'record' ? 'on' : ''}`} onClick={() => go('/record')} aria-label="Record a trick shot">
          ●
        </button>
        <NavBtn on={tab === 'ranks'} icon="📊" label="Ranks" to="/ranks" />
        <NavBtn on={tab === 'me'} icon={s.users[s.meId].emoji} label="Me" to="/me" />
      </nav>
    </div>
  );
}

function NavBtn({ on, icon, label, to }: { on: boolean; icon: string; label: string; to: string }) {
  return (
    <button className={`nav-btn ${on ? 'on' : ''}`} onClick={() => go(to)}>
      <span>{icon}</span>
      <small>{label}</small>
    </button>
  );
}
