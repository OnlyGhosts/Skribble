import type { ReactNode } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { Spotlight } from '../../../platform/table/Spotlight';
import { nameOf, playerOf } from '../hooks';
import { seatOutcome, subjectKey, type BjSubject } from '../lib/spotlight';
import type { Frame } from '../lib/timeline';
import { betsLabel, resultLabel, turnLabel } from '../lib/text';
import { Dealer } from './Dealer';
import { Hand } from './Hand';
import { MyHands, fanStyle } from './MyHands';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  subject: BjSubject;
  frame: Frame;
  now: number;
  size: PlayingCardSize;
  clock: ReactNode;
}

/** Bets in a big table: the seats still to bet first, and a count for the rest. */
const BET_ROLL_MAX = 12;

/** Who has bet (lit, with a chip) and who we wait for (dimmed), in seat order; a big table lists the waiting first. */
function BetRoll({ room, view, placed, waiting }: { room: BlackjackRoomState; view: BlackjackView; placed: string[]; waiting: string[] }) {
  const all = view.order;
  const shown = all.length <= BET_ROLL_MAX ? all : [...waiting, ...placed].slice(0, BET_ROLL_MAX - 1);
  const more = all.length - shown.length;
  return (
    <ul className="bj-bets" aria-label="Bets" data-testid="spot-bets" data-placed={placed.length} data-waiting={waiting.length}>
      {shown.map((id) => {
        const p = playerOf(room, id);
        const bet = view.players[id]?.bet ?? 0;
        if (!p) return null;
        return (
          <li key={id} className={`bj-bets__seat${bet > 0 ? ' is-placed' : ''}`} data-player-id={id} data-placed={bet > 0}>
            <Avatar avatar={p.avatar} size="sm" dimmed={!p.connected} />
            <span className="bj-bets__amount">{bet > 0 ? <Chips value={bet} size={10} /> : '...'}</span>
          </li>
        );
      })}
      {more > 0 && <li className="bj-bets__more">+{more}</li>}
    </ul>
  );
}

/**
 * Blackjack's spotlight: the hand being played large (mine on my turn), the dealer while the
 * reveal plays, the bets going down, or how my round went.
 */
export function BjSpotlight({ room, view, meId, subject, frame, now, size, clock }: Props) {
  const { table, timeline, leaving } = frame;
  const key = subjectKey(subject);
  const me = playerOf(room, meId);
  switch (subject.kind) {
    case 'turn': {
      const player = playerOf(room, subject.playerId);
      const hands = table?.hands[subject.playerId] ?? [];
      const stake = hands.reduce((sum, h) => sum + h.bet, 0);
      const next = subject.next === null ? 'Dealer' : subject.next === meId ? 'You' : nameOf(room, subject.next);
      const who = player ? { id: player.id, name: player.name, avatar: player.avatar, connected: player.connected } : null;
      return (
        <Spotlight
          subject={key}
          kind={subject.mine ? 'mine' : 'turn'}
          tone="active"
          who={who}
          label={turnLabel(subject.mine, player?.name ?? 'Someone', subject.handIndex, hands.length)}
          meta={stake > 0 ? <Chips value={stake} size={12} className="bj-spot__stake" /> : undefined}
          next={next}
          clock={clock}
          layout={hands.length > 1 ? 'stack' : 'row'}
          data={{ 'data-hand': subject.handIndex }}
        >
          {subject.mine ? (
            <MyHands view={view} meId={meId} frame={frame} now={now} size={size} place="spot" />
          ) : (
            <div className={`bj-spot__hands bj-spot__hands--n${Math.max(1, hands.length)}`} style={fanStyle(hands)}>
              {hands.map((hand, i) => (
                <Hand key={i} playerId={subject.playerId} index={i} hand={hand} timeline={timeline} now={now} leaving={leaving} size={hands.length > 2 ? 'md' : size} active={i === subject.handIndex} testId="spot-hand" />
              ))}
            </div>
          )}
        </Spotlight>
      );
    }
    case 'dealer':
      return (
        <Spotlight subject={key} kind="dealer" tone="neutral" label="Dealer's turn" clock={clock} layout="row">
          <Dealer table={table} timeline={timeline} now={now} leaving={leaving} size={size} />
        </Spotlight>
      );
    case 'result': {
      const hands = table?.hands[meId] ?? [];
      const outcome = seatOutcome(hands) ?? 'push';
      const back = hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
      const who = me ? { id: me.id, name: me.name, avatar: me.avatar, connected: me.connected } : null;
      return (
        <Spotlight subject={key} kind="result" tone={outcome} who={who} label={resultLabel(outcome, back)} clock={clock} layout={hands.length > 1 ? 'stack' : 'row'} data={{ 'data-outcome': outcome }}>
          <MyHands view={view} meId={meId} frame={frame} now={now} size={size} place="spot" />
        </Spotlight>
      );
    }
    case 'bets': {
      const names = subject.waiting.filter((id) => id !== meId).map((id) => nameOf(room, id));
      const label = betsLabel(subject.first, subject.waiting.includes(meId), names);
      const sub = `${subject.placed.length} of ${view.order.length} bets in`;
      return (
        <Spotlight subject={key} kind="bets" tone="neutral" label={label} meta={<span data-testid="spot-bets-count">{sub}</span>} clock={clock}>
          {view.order.length > 0 ? <BetRoll room={room} view={view} placed={subject.placed} waiting={subject.waiting} /> : undefined}
        </Spotlight>
      );
    }
    case 'idle':
      return <Spotlight subject={key} kind="idle" tone="neutral" label={subject.reason === 'held' ? 'Waiting for players' : 'Game over'} clock={clock} />;
  }
}
