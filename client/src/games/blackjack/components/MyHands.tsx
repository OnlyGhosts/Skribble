import type { CSSProperties } from 'react';
import type { BlackjackView } from '@shared/games/blackjack/protocol';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard, type PlayingCardSize } from '../../../platform/components/PlayingCard';
import type { Frame } from '../lib/timeline';
import { Hand } from './Hand';

interface Props {
  view: BlackjackView;
  meId: string;
  frame: Frame;
  now: number;
  size: PlayingCardSize;
  /** In the spotlight (my turn, my result) or at the bottom of the table. */
  place: 'spot' | 'bottom';
  /** At the bottom: my face beside my hands, so they read as mine. */
  avatar?: AvatarData;
}

/**
 * How many hands share the width and the most cards in any of them: the stylesheet sizes the
 * cards so every hand fits its box (blackjack.css, --fit-w), however many hits and splits.
 */
export function fanStyle(hands: readonly { cards: readonly unknown[] }[]): CSSProperties {
  const fan = Math.max(2, ...hands.map((h) => h.cards.length));
  return { '--hands': Math.max(1, hands.length), '--fan': fan } as CSSProperties;
}

/** My hands: split hands side by side, the one in play lit; two empty slots before my first deal. */
export function MyHands({ view, meId, frame, now, size, place, avatar }: Props) {
  const { table, timeline, leaving } = frame;
  const hands = table?.hands[meId] ?? [];
  const seat = view.players[meId];
  const live = table !== null && !table.settled && !leaving;
  const turnIndex = live && view.phase === 'acting' && view.turn?.playerId === meId ? view.turn.handIndex : -1;
  const newBet = view.phase === 'betting' && seat && seat.bet > 0 ? seat.bet : 0;
  const shown: PlayingCardSize = hands.length > 2 ? 'md' : size;
  return (
    <section
      className={`bj-mine bj-mine--${place} bj-mine--n${Math.max(1, hands.length)}${place === 'bottom' ? ' tbl-stage__mine' : ''}`}
      style={fanStyle(hands)}
      aria-label="Your hands"
      data-testid="my-hands"
      data-count={hands.length}
    >
      {place === 'bottom' && avatar && (
        <span className="tbl-me" aria-hidden="true">
          <Avatar avatar={avatar} size="sm" />
          <span className="tbl-me__label">You</span>
        </span>
      )}
      {hands.length > 0 ? (
        <div className="bj-mine__hands">
          {hands.map((hand, i) => (
            <Hand key={i} playerId={meId} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size={shown} active={i === turnIndex} testId="my-hand" />
          ))}
        </div>
      ) : (
        <div className="bj-mine__empty" aria-hidden="true">
          <PlayingCard card={null} size={shown} slot testId="my-slot" />
          <PlayingCard card={null} size={shown} slot testId="my-slot" />
        </div>
      )}
      {newBet > 0 && (
        <span className="bj-mine__bet" data-testid="my-bet" data-bet={newBet}>
          Bet <Chips value={newBet} size={14} />
        </span>
      )}
    </section>
  );
}
