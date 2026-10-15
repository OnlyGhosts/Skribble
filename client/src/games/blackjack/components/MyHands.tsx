import type { CSSProperties } from 'react';
import type { BlackjackView } from '@shared/games/blackjack/protocol';
import type { Avatar as AvatarData } from '@shared/platform/avatar';
import { Avatar } from '../../../platform/components/Avatar';
import { Chips } from '../../../platform/components/Chips';
import { PlayingCard } from '../../../platform/components/PlayingCard';
import type { Frame } from '../lib/timeline';
import { HandRow } from './HandRow';

interface Props {
  view: BlackjackView;
  meId: string;
  frame: Frame;
  now: number;
  /** My face beside my hands, so they read as mine. */
  avatar?: AvatarData;
}

/**
 * My hands, always in the same place: the bottom of the table, just above the control panel, the
 * same size through every phase (it only changes with the screen and with how many hands I hold).
 * Split hands side by side, the one in play lit; two empty slots, where my cards land, before my
 * first deal and once my next stake is down (the stake under them, where a hand's stake goes; my
 * last round's outcome has had its turn in the spotlight). The spotlight never takes them.
 */
export function MyHands({ view, meId, frame, now, avatar }: Props) {
  const { table, timeline, leaving } = frame;
  const seat = view.players[meId];
  const stake = seat?.bet ?? 0;
  // A settled table stays up for the others; my row moves on to the stake I just put down.
  const hands = table?.settled && stake > 0 ? [] : (table?.hands[meId] ?? []);
  const live = table !== null && !table.settled && !leaving;
  const turnIndex = live && view.phase === 'acting' && view.turn?.playerId === meId ? view.turn.handIndex : -1;
  return (
    <section className="bj-mine tbl-stage__mine" aria-label="Your hands" data-testid="my-area" data-count={hands.length}>
      {avatar && (
        <span className="tbl-me" aria-hidden="true">
          <Avatar avatar={avatar} size="sm" />
          <span className="tbl-me__label">You</span>
        </span>
      )}
      <div className="bj-mine__hands" data-testid="my-hands" data-count={hands.length}>
        {hands.length > 0 ? (
          <HandRow playerId={meId} hands={hands} timeline={timeline} now={now} leaving={leaving} activeIndex={turnIndex} place="mine" size="md" testId="my-hand" chipTestId="my-chip" />
        ) : (
          <div className="bj-hands bj-hands--mine" style={{ '--hands': 1, '--fan': 2 } as CSSProperties}>
            <div className="bj-slot">
              <div className="bj-hand bj-hand--big bj-hand--empty tbl-outline tbl-outline--neutral">
                <div className="bj-hand__top" />
                <div className="bj-hand__cards" aria-hidden="true">
                  <PlayingCard card={null} size="md" slot testId="my-slot" />
                  <PlayingCard card={null} size="md" slot testId="my-slot" />
                </div>
                {stake > 0 && (
                  <div className="bj-hand__foot">
                    <span className="bj-mine__bet" data-testid="my-bet" data-bet={stake}>
                      Bet <Chips value={stake} size={14} />
                    </span>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
