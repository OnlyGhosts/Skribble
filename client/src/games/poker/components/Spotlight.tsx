import type { ReactNode } from 'react';
import type { PokerRoomState, PokerView } from '@shared/games/poker/protocol';
import { Chips } from '../../../platform/components/Chips';
import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { Spotlight } from '../../../platform/table/Spotlight';
import { TableCard } from '../../../platform/table/TableCard';
import { nameOf, playerOf } from '../hooks';
import { holeOnScreen, sameCard, winningCards } from '../lib/screen';
import { subjectKey, type PkSubject } from '../lib/spotlight';
import { winnings, type PokerTable } from '../lib/table';
import { betAnchor, betValue, chipsValue, valueAt, type Timeline } from '../lib/timeline';
import { categoryLabel, formatChips, lastActionLabel } from '../lib/text';
import { DealerButton } from './DealerButton';
import { MyHand } from './MyHand';

interface Props {
  room: PokerRoomState;
  view: PokerView;
  meId: string;
  subject: PkSubject;
  table: PokerTable | null;
  timeline: Timeline;
  /** The current timeline, for the numbers on show. */
  live: Timeline;
  now: number;
  leaving: boolean;
  size: PlayingCardSize;
  clock: ReactNode;
}

const IDLE_LABELS: Record<Extract<PkSubject, { kind: 'idle' }>['reason'], string> = {
  dealing: 'Dealing',
  showdown: 'Showdown',
  held: 'Waiting for players',
  over: 'Game over',
};

/**
 * Poker's spotlight: the player to act with their stack, their bet and their last move (my own
 * hand on my turn), then the winner of the hand with the cards that won it.
 */
export function PkSpotlight({ room, view, meId, subject, table, timeline, live, now, leaving, size, clock }: Props) {
  const key = subjectKey(subject);
  const myHand = <MyHand view={view} meId={meId} table={table} timeline={timeline} live={live} now={now} leaving={leaving} size={size} place="spot" />;
  if (subject.kind === 'idle') return <Spotlight subject={key} kind="idle" tone="neutral" label={IDLE_LABELS[subject.reason]} clock={clock} />;

  const player = playerOf(room, subject.playerId);
  const seat = view.players[subject.playerId];
  const who = player ? { id: player.id, name: player.name, avatar: player.avatar, connected: player.connected } : null;
  const stack = valueAt(live, chipsValue(subject.playerId), seat?.chips ?? 0, now);

  if (subject.kind === 'result') {
    const won = winnings(table?.results ?? null)[subject.playerId] ?? 0;
    const shown = table?.results?.revealed[subject.playerId];
    const best = winningCards(table, timeline, now);
    const label = subject.mine ? `You win ${formatChips(won)}` : `${player?.name ?? 'Someone'} wins ${formatChips(won)}`;
    return (
      <Spotlight subject={key} kind="result" tone="win" who={who} label={label} meta={shown ? <span>{categoryLabel(shown.category)}</span> : undefined} clock={clock} layout={subject.mine ? 'stack' : 'row'}>
        {subject.mine ? (
          myHand
        ) : shown ? (
          <div className="pk-spot__cards">
            {holeOnScreen(table, timeline, subject.playerId, meId, now).map((c) => (
              <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size={size} motion={null} leaving={leaving} highlight={c.card !== null && best.some((b) => c.card !== null && sameCard(b, c.card))} testId="spot-card" />
            ))}
          </div>
        ) : undefined}
      </Spotlight>
    );
  }

  const next = subject.next === null ? null : subject.next === meId ? 'You' : nameOf(room, subject.next);
  const bet = valueAt(live, betValue(subject.playerId), seat?.bet ?? 0, now);
  const action = lastActionLabel(seat?.lastAction ?? null);
  const meta = (
    <>
      <Chips value={stack} size={12} className="pk-spot__stack" testId="spot-stack" />
      {seat?.isDealer && <DealerButton testId="spot-dealer" />}
      {action && <span className="pk-spot__action">{action}</span>}
    </>
  );
  return (
    <Spotlight subject={key} kind={subject.mine ? 'mine' : 'turn'} tone="active" who={who} label={subject.mine ? 'Your turn' : `${player?.name ?? 'Someone'}'s turn`} meta={meta} next={next} clock={clock} layout={subject.mine ? 'stack' : 'row'}>
      {subject.mine ? (
        myHand
      ) : (
        <div className="pk-spot__cards">
          {holeOnScreen(table, timeline, subject.playerId, meId, now).map((c) => (
            <TableCard key={`${timeline.id}:${c.key}`} card={c.card} size={size} motion={c.motion} leaving={leaving || c.leaving} flipping={c.flipping} testId="spot-card" />
          ))}
          <span className="pk-bet pk-bet--spot" data-table-anchor={betAnchor(subject.playerId)} data-testid="spot-bet" data-bet={bet}>
            {bet > 0 && <Chips value={bet} size={13} />}
          </span>
        </div>
      )}
    </Spotlight>
  );
}
