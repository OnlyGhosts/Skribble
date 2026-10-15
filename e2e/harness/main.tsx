/**
 * A test-only page that renders the real Blackjack table (the production components and styles)
 * from a rigged snapshot, for layouts a real game cannot reach on demand: a seat with 12 split
 * hands, a big table on a given turn. Served by Vite from e2e/blackjack-layout.spec.ts; nothing in
 * the production build imports it. The scenario comes from the query string (see scenario.ts).
 */
import '../../client/src/platform/styles/fonts.css';
import '../../client/src/platform/styles/tokens.css';
import '../../client/src/platform/styles/base.css';
import '../../client/src/platform/styles/components.css';
import '../../client/src/platform/styles/cards.css';
import '../../client/src/platform/styles/table.css';
import '../../client/src/platform/styles/gamebar.css';
import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GAMES } from '../../client/src/games';
import { BlackjackScreen } from '../../client/src/games/blackjack/Screen';
import { useBlackjackStore } from '../../client/src/games/blackjack/store';
import { useViewport } from '../../client/src/platform/lib/useViewport';
import { registerGames } from '../../client/src/platform/registry';
import { usePlatformStore } from '../../client/src/platform/store/usePlatformStore';
import { parseScenario, scenarioRooms, ME } from './scenario';

registerGames(GAMES);

const scenario = parseScenario(new URLSearchParams(location.search));
const rooms = scenarioRooms(scenario);

// The first snapshot shows at once, like a welcome.
usePlatformStore.setState({ playerId: ME, connection: 'connected', room: rooms[0], clockSynced: true });
useBlackjackStore.getState().applyView(rooms[0].game, Date.now(), true, false);

function Harness() {
  useViewport();
  const [step, setStep] = useState(0);
  const room = rooms[step];
  useEffect(() => {
    if (step > 0) {
      // Each later snapshot animates like a live table.
      usePlatformStore.setState({ room });
      useBlackjackStore.getState().applyView(room.game, Date.now(), false, true);
    }
    document.documentElement.dataset.harnessStep = String(step);
    if (step + 1 >= rooms.length) return undefined;
    const t = window.setTimeout(() => setStep(step + 1), scenario.stepMs);
    return () => window.clearTimeout(t);
  }, [room, step]);
  return <BlackjackScreen room={room} meId={ME} isHost={room.hostId === ME} />;
}

const container = document.getElementById('root');
if (!container) throw new Error('Missing #root element');
createRoot(container).render(
  <StrictMode>
    <Harness />
  </StrictMode>,
);
