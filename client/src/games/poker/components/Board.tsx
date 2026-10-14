import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { nameOf } from '../hooks';
import { blindsLabel, streetLabel } from '../lib/text';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  size: 'md' | 'lg';
}

const BOARD_SIZE = 5;

/** The table: the five community cards (empty slots until dealt), the pot and any side pots. */
export function Board({ room, view, size }: Props) {
  const slots = Math.max(0, BOARD_SIZE - view.community.length);
  const sidePots = view.pots.length > 1 ? view.pots : [];
  return (
    <section className="pk-board card" aria-label="Table" data-testid="board" data-street={view.street ?? ''} data-cards={view.community.length}>
      <div className="pk-board__head">
        <span className="pk-board__street" data-testid="street">
          {streetLabel(view.street)}
        </span>
        <span className="pk-board__blinds" data-testid="blinds" data-small={view.blinds.small} data-big={view.blinds.big}>
          Blinds {blindsLabel(view)}
        </span>
      </div>
      <div className="pk-board__cards" role="group" aria-label="Community cards">
        {view.community.map((card, i) => (
          <PlayingCard key={`${i}-${card.rank}${card.suit}`} card={card} size={size} testId="community-card" />
        ))}
        {Array.from({ length: slots }, (_, i) => (
          <PlayingCard key={`slot-${i}`} card={null} size={size} slot testId="community-slot" />
        ))}
      </div>
      <div className="pk-board__pot">
        <span className="pk-board__pot-label">Pot</span>
        <Chips value={view.pot} size={18} className="pk-board__pot-value" testId="pot" />
      </div>
      {sidePots.length > 0 && (
        <ul className="pk-board__pots" aria-label="Pots" data-testid="pots">
          {sidePots.map((pot, i) => (
            <li key={i} className="pk-board__side" data-testid="side-pot" data-amount={pot.amount} data-players={pot.playerIds.join(',')} title={pot.playerIds.map((id) => nameOf(room, id)).join(', ')}>
              <span>{i === 0 ? 'Main' : `Side ${i}`}</span>
              <Chips value={pot.amount} size={12} />
              <span className="pk-board__side-who">{pot.playerIds.length} in</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
