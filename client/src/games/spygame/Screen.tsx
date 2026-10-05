import type { SpygameSettings, SpygameView } from '@shared/games/spygame/protocol';
import { gameById } from '@shared/platform/games';
import { Chat } from '../../platform/components/Chat';
import { LogoutIcon } from '../../platform/components/Icons';
import { SiteHeader } from '../../platform/components/SiteHeader';
import type { GameScreenProps } from '../../platform/game';
import { leaveRoom } from '../../platform/net/actions';

const meta = gameById('spygame');

/** Placeholder until the real screen lands: the round, this player's role and the chat. */
export function SpyGameScreen({ room }: GameScreenProps<SpygameView, SpygameSettings>) {
  const view = room.game;
  if (!view) return null;
  return (
    <div className="card" style={{ margin: 'var(--space-4) auto', width: 'min(640px, 100%)' }}>
      <SiteHeader crumb={meta.name}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room">
          <LogoutIcon size={16} /> Leave
        </button>
      </SiteHeader>
      <p className="overlay__kicker">{`Round ${view.round} of ${view.totalRounds}`}</p>
      <h1 className="card__title" data-testid="spygame-role" data-role={view.role}>
        {view.role === 'spy' ? 'You are the spy' : view.role === 'agent' ? 'You are an agent' : 'Watching this round'}
      </h1>
      <Chat />
    </div>
  );
}
