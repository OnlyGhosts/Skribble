import type { PokerSettings, PokerView } from '@shared/games/poker/protocol';
import { gameById } from '@shared/platform/games';
import { Chat } from '../../platform/components/Chat';
import { LogoutIcon } from '../../platform/components/Icons';
import { SiteHeader } from '../../platform/components/SiteHeader';
import type { GameScreenProps } from '../../platform/game';
import { leaveRoom } from '../../platform/net/actions';

const meta = gameById('poker');

/** The placeholder table: the hand number, the pot and the chat, until the full screen lands. */
export function PokerScreen({ room }: GameScreenProps<PokerView, PokerSettings>) {
  const view = room.game;
  if (!view) return null;
  return (
    <div className="poker">
      <SiteHeader crumb={meta.name}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room">
          <LogoutIcon size={16} /> Leave
        </button>
      </SiteHeader>
      <main className="card" data-testid="poker-table">
        <p className="overlay__kicker">{meta.name}</p>
        <p data-testid="poker-hand" data-hand={view.hand}>{`Hand ${view.hand}`}</p>
        <p data-testid="poker-pot" data-pot={view.pot}>{`Pot ${view.pot}`}</p>
      </main>
      <Chat />
    </div>
  );
}
