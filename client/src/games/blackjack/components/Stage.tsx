import type { CSSProperties } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { HandFan } from '../../../platform/table/HandFan';
import { TableStage } from '../../../platform/table/TableStage';
import { playerOf } from '../hooks';
import { stageKind, type BjFocus } from '../lib/focus';
import type { TableHand } from '../lib/table';
import type { Frame } from '../lib/timeline';
import { stakeOf } from './Hand';
import { HandRow } from './HandRow';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  /** Whose hands the stage shows (stageOwner): mine, or the hand in play when I am not dealt in. */
  owner: string | null;
  focus: BjFocus;
  frame: Frame;
  now: number;
}

/** A seat's hands still on the felt: a settled round gives way to my next stake once it is down. */
function handsOnFelt(frame: Frame, view: BlackjackView, id: string): TableHand[] {
  const stake = view.players[id]?.bet ?? 0;
  return frame.table?.settled && stake > 0 ? [] : (frame.table?.hands[id] ?? []);
}

/** The hand in play in `id`'s row, or -1. */
function activeIndex(frame: Frame, view: BlackjackView, id: string): number {
  const live = frame.table !== null && !frame.table.settled && !frame.leaving;
  return live && view.phase === 'acting' && view.turn?.playerId === id ? view.turn.handIndex : -1;
}

/** Two empty places where my cards will land, my stake left of them once it is down: before my first deal, and once my next stake is down. */
function EmptyHand({ stake }: { stake: number }) {
  return (
    <div className="bj-hands bj-hands--mine" style={{ '--hands': 1, '--fan': 2 } as CSSProperties}>
      <div className="bj-slot">
        <div className="bj-empty">
          {stake > 0 && <span className="bj-empty__stake">{stakeOf(stake, 'my-bet')}</span>}
          <HandFan className="bj-hand bj-hand--empty" tone="neutral" total={null} label={stake > 0 ? `No cards yet, bet ${stake}` : 'No cards yet'} testId="my-empty">
            {[0, 1].map((i) => (
              <PlayingCard key={i} card={null} size="md" slot testId="my-slot" />
            ))}
          </HandFan>
        </div>
      </div>
    </div>
  );
}

/**
 * The stage at the bottom of the table, the same place and size all game long: my hands, big and
 * centred, in every phase and on every turn (each split hand in its slot, the one in play lit),
 * each with its stake by its total. The player on turn plays in their own seat. Not dealt in, I
 * watch the hand in play here, its owner's name by its total (their seat leaves its cards out).
 */
export function Stage({ room, view, meId, owner, focus, frame, now }: Props) {
  const { timeline, leaving } = frame;
  const mine = owner === meId;
  const player = playerOf(room, owner);
  const myHands = handsOnFelt(frame, view, meId);
  // My next stake once it is down and my cards are not dealt yet.
  const nextStake = mine && view.phase === 'betting' ? (view.players[meId]?.bet ?? 0) : 0;
  const live = frame.table !== null && !frame.table.settled;
  const data = { 'data-kind': stageKind(focus), 'data-player-id': owner ?? undefined };
  if (mine) {
    return (
      <TableStage variant="mine" label="Your hands" data={data}>
        <div className="bj-mine" data-testid="my-area" data-count={myHands.length}>
          <div className="bj-mine__hands" data-testid="my-hands" data-count={myHands.length}>
            {myHands.length > 0 ? (
              <HandRow playerId={meId} hands={myHands} timeline={timeline} now={now} leaving={leaving} activeIndex={activeIndex(frame, view, meId)} place="mine" size="md" stakes={live} testId="my-hand" chipTestId="my-chip" />
            ) : (
              <EmptyHand stake={nextStake} />
            )}
          </div>
        </div>
      </TableStage>
    );
  }
  if (!owner || !player) return <TableStage variant="none" label="Hands" data={data} />;
  return (
    <TableStage variant="other" label={`${player.name}’s hands`} data={data}>
      <div className="bj-mine__hands" data-testid="stage-hands">
        <HandRow
          playerId={owner}
          hands={frame.table?.hands[owner] ?? []}
          timeline={timeline}
          now={now}
          leaving={leaving}
          activeIndex={activeIndex(frame, view, owner)}
          place="stage"
          size="md"
          ownerName={player.name}
          testId="stage-hand"
          chipTestId="stage-chip"
        />
      </div>
    </TableStage>
  );
}
