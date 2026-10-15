import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import type { Tone } from '../../../platform/table/Outcome';
import { Spotlight } from '../../../platform/table/Spotlight';
import { nameOf, playerOf } from '../hooks';
import { seatOutcome, subjectKey, type BjSubject } from '../lib/spotlight';
import type { Frame } from '../lib/timeline';
import { betsLabel, dealerRule, formatChips, handMarker, resultLabel, turnLabel } from '../lib/text';
import { HandRow } from './HandRow';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  subject: BjSubject;
  frame: Frame;
  now: number;
  size: PlayingCardSize;
  /** A tight table: another player's hands sit beside their name, in one row, to save height. */
  tight?: boolean;
}

const IDLE_LABELS = { held: 'Waiting for players', over: 'Game over', next: 'Next round soon' } as const;

/** Bets in a big table: the seats still to bet first, and a count for the rest. */
const BET_ROLL_MAX = 12;

/** Who has bet (lit, with a chip), who we wait for, and who sits out or is away (dimmed), in seat order; a big table lists the waiting first. */
function BetRoll({ room, view, placed, waiting }: { room: BlackjackRoomState; view: BlackjackView; placed: string[]; waiting: string[] }) {
  const all = view.order;
  const shown = all.length <= BET_ROLL_MAX ? all : [...waiting, ...placed].slice(0, BET_ROLL_MAX - 1);
  const more = all.length - shown.length;
  return (
    <ul className="bj-bets" aria-label="Bets" data-testid="spot-bets" data-placed={placed.length} data-waiting={waiting.length}>
      {shown.map((id) => {
        const p = playerOf(room, id);
        const bet = view.players[id]?.bet ?? 0;
        const out = bet === 0 && !waiting.includes(id);
        if (!p) return null;
        return (
          <li key={id} className={`bj-bets__seat${bet > 0 ? ' is-placed' : ''}${out ? ' is-out' : ''}`} data-player-id={id} data-placed={bet > 0} data-out={out}>
            <Avatar avatar={p.avatar} size="sm" dimmed={!p.connected || out} />
            <span className="bj-bets__amount">{bet > 0 ? <Chips value={bet} size={10} /> : out ? 'out' : '...'}</span>
          </li>
        );
      })}
      {more > 0 && <li className="bj-bets__more">+{more}</li>}
    </ul>
  );
}

/**
 * Blackjack's spotlight, the part of the table that changes to show what is going on: another
 * player's hand while they play it, whose turn it is (on my turn just that: my cards stay lit where
 * they always are), the dealer playing (the dealer's cards stay in their place too), the bets
 * going down, or how my round went.
 */
export function BjSpotlight({ room, view, meId, subject, frame, now, size, tight = false }: Props) {
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
      // "Hand 3 of 7"; a tight table drops the word.
      const marker =
        hands.length > 1 ? (
          <span className="bj-spot__marker" data-testid="spot-marker" aria-label={handMarker(subject.handIndex, hands.length)}>
            <span className="bj-spot__marker-word">Hand </span>
            {`${subject.handIndex + 1} of ${hands.length}`}
          </span>
        ) : null;
      return (
        <Spotlight
          subject={key}
          kind={subject.mine ? 'mine' : 'turn'}
          tone="active"
          who={who}
          label={turnLabel(subject.mine, player?.name ?? 'Someone')}
          meta={
            // My turn: just the words and which hand; my stake and cards are lit where they always are.
            subject.mine ? (marker ?? undefined) : stake > 0 || marker ? (
              <>
                {marker}
                {stake > 0 && <Chips value={stake} size={12} className="bj-spot__stake" />}
              </>
            ) : undefined
          }
          next={subject.mine ? null : next}
          layout={!subject.mine && hands.length > 1 && !tight ? 'stack' : 'row'}
          data={{ 'data-hand': subject.handIndex }}
        >
          {/* My own cards are lit where they always are, at the bottom: the spotlight does not repeat them. */}
          {subject.mine ? undefined : (
            <HandRow playerId={subject.playerId} hands={hands} timeline={timeline} now={now} leaving={leaving} activeIndex={subject.handIndex} place="spot" size={size} testId="spot-hand" chipTestId="spot-chip" />
          )}
        </Spotlight>
      );
    }
    case 'dealer':
      // The dealer plays in its own place at the top of the table; the spotlight just says so.
      return <Spotlight subject={key} kind="dealer" tone="neutral" label="Dealer's turn" meta={<span>{dealerRule(room.settings.dealerHitsSoft17)}</span>} layout="row" />;
    case 'result': {
      const hands = table?.hands[meId] ?? [];
      const outcome = seatOutcome(hands) ?? 'push';
      const back = hands.reduce((sum, h) => sum + (h.payout ?? 0), 0);
      const staked = hands.reduce((sum, h) => sum + h.bet, 0);
      const who = me ? { id: me.id, name: me.name, avatar: me.avatar, connected: me.connected } : null;
      const tone: Tone = outcome;
      return (
        <Spotlight
          subject={key}
          kind="result"
          tone={tone}
          who={who}
          label={resultLabel(outcome, back)}
          meta={hands.length > 1 ? <span>{`${hands.length} hands, ${formatChips(staked)} staked`}</span> : undefined}
          layout="row"
          data={{ 'data-outcome': outcome }}
        />
      );
    }
    case 'bets': {
      const names = subject.waiting.filter((id) => id !== meId).map((id) => nameOf(room, id));
      const label = betsLabel(subject.waiting.includes(meId), names, subject.placed.length > 0);
      // Out of the seats still taking part: whoever sat out or is away is not counted.
      const sub = `${subject.placed.length} of ${subject.placed.length + subject.waiting.length} bets in`;
      return (
        <Spotlight subject={key} kind="bets" tone="neutral" label={label} meta={<span data-testid="spot-bets-count">{sub}</span>}>
          {view.order.length > 0 ? <BetRoll room={room} view={view} placed={subject.placed} waiting={subject.waiting} /> : undefined}
        </Spotlight>
      );
    }
    case 'idle':
      return <Spotlight subject={key} kind="idle" tone="neutral" label={IDLE_LABELS[subject.reason]} />;
  }
}
