import type { CSSProperties } from 'react';
import type { BlackjackRoomState, BlackjackView } from '@shared/games/blackjack/protocol';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import { HandFan } from '../../../platform/table/HandFan';
import { StakePill } from '../../../platform/table/Stakes';
import { TableStage } from '../../../platform/table/TableStage';
import { playerOf } from '../hooks';
import { stageKind, stageOwner, type BjFocus } from '../lib/focus';
import type { TableHand } from '../lib/table';
import type { Frame } from '../lib/timeline';
import { HandRow } from './HandRow';

interface Props {
  room: BlackjackRoomState;
  view: BlackjackView;
  meId: string;
  focus: BjFocus;
  frame: Frame;
  now: number;
}

/** Past this many chips a stake reads short ("Bet 12k"), so it keeps to the owner's column. */
const SHORT_STAKE = 10_000;

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

/** Two empty places where my cards will land: before my first deal, and once my next stake is down. */
function EmptyHand() {
  return (
    <div className="bj-hands bj-hands--mine" style={{ '--hands': 1, '--fan': 2 } as CSSProperties}>
      <div className="bj-slot">
        <HandFan className="bj-hand bj-hand--empty" tone="neutral" total={null} label="No cards yet" testId="my-empty">
          {[0, 1].map((i) => (
            <PlayingCard key={i} card={null} size="md" slot testId="my-slot" />
          ))}
        </HandFan>
      </div>
    </div>
  );
}

/**
 * The stage at the bottom of the table, the same place and size all game long: the hands that
 * matter to me, big. My own (each split hand in its slot, the one in play lit), except on another
 * player's turn, when theirs take the middle and mine sit small at the side so my total is never
 * out of sight. Whose hands they are and the stake on them are in the left column.
 */
export function Stage({ room, view, meId, focus, frame, now }: Props) {
  const { timeline, leaving } = frame;
  const seat = view.players[meId];
  const owner = stageOwner(focus, seat !== undefined, meId);
  const mine = owner === meId;
  const player = playerOf(room, owner);
  const myHands = handsOnFelt(frame, view, meId);
  const ownerHands = owner === null ? [] : mine ? myHands : (frame.table?.hands[owner] ?? []);
  // My next stake once it is down (my cards are not dealt yet); otherwise the chips on the hands in play (a settled hand says what it won).
  const nextStake = mine && view.phase === 'betting' ? (seat?.bet ?? 0) : 0;
  const live = frame.table !== null && !frame.table.settled;
  const stake = nextStake > 0 ? nextStake : live ? ownerHands.reduce((sum, h) => sum + h.bet, 0) : 0;
  const myRow = (place: 'mine' | 'aside') => (
    <div className="bj-mine__hands" data-testid="my-hands" data-count={myHands.length}>
      {myHands.length > 0 ? (
        <HandRow playerId={meId} hands={myHands} timeline={timeline} now={now} leaving={leaving} activeIndex={activeIndex(frame, view, meId)} place={place} size="md" testId="my-hand" chipTestId="my-chip" />
      ) : (
        <EmptyHand />
      )}
    </div>
  );
  return (
    <TableStage
      variant={mine ? 'mine' : owner ? 'other' : 'none'}
      label={mine ? 'Your hands' : player ? `${player.name}'s hands` : 'Hands'}
      who={player ? { avatar: player.avatar, connected: player.connected, name: mine ? 'You' : player.name, anchor: mine ? undefined : `seat:${player.id}` } : null}
      owner={stake > 0 && <StakePill value={stake} format={stake >= SHORT_STAKE ? 'short' : 'full'} testId={mine ? 'my-bet' : 'stage-bet'} />}
      aside={
        !mine &&
        seat !== undefined &&
        myHands.length > 0 && (
          <div className="bj-mine bj-mine--aside" data-testid="my-area" data-count={myHands.length}>
            <span className="bj-mine__label">You</span>
            {myRow('aside')}
          </div>
        )
      }
      data={{ 'data-kind': stageKind(focus), 'data-player-id': owner ?? undefined }}
    >
      {mine && (
        <div className="bj-mine" data-testid="my-area" data-count={myHands.length}>
          {myRow('mine')}
        </div>
      )}
      {!mine && owner && (
        <HandRow playerId={owner} hands={ownerHands} timeline={timeline} now={now} leaving={leaving} activeIndex={activeIndex(frame, view, owner)} place="stage" size="md" testId="stage-hand" chipTestId="stage-chip" />
      )}
    </TableStage>
  );
}
