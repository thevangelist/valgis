import { useState } from 'react';
import Landing from './Landing';
import Studio from './Studio';
import LiveCamera from './LiveCamera';

type View = 'landing' | 'desktop' | 'camera';

function getInitialView(): View {
  const hash = window.location.hash;
  if (hash === '#camera')  return 'camera';
  if (hash === '#desktop') return 'desktop';
  return 'landing';
}

export default function App() {
  const [view, setView] = useState<View>(getInitialView);

  const go = (v: View) => {
    window.location.hash = v === 'landing' ? '' : v;
    setView(v);
  };

  if (view === 'camera')  return <LiveCamera onBack={() => go('landing')} />;
  if (view === 'desktop') return <Studio onBack={() => go('landing')} />;
  return <Landing onDesktop={() => go('desktop')} onCamera={() => go('camera')} />;
}
