// The platform stylesheets come first so a game's stylesheet (imported by its module) can override them.
import './platform/styles/tokens.css';
import './platform/styles/base.css';
import './platform/styles/components.css';
import './platform/styles/library.css';
import './platform/styles/home.css';
import './platform/styles/lobby.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { GAMES } from './games';
import { registerGames } from './platform/registry';

// Games import their own stylesheets; the platform never imports a game by name.
registerGames(GAMES);

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
