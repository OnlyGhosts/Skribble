import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { Chips } from '../../../platform/components/Chips';
import { PayoutFloat, TotalPill, outlineClass, type Tone } from '../../../platform/table/Outcome';
import { TableCard } from '../../../platform/table/TableCard';
import { cardKey, shownTotal, totalText, type TableHand } from '../lib/table';
import { cardMotion, cardShown, landed, outcomesShown, type Timeline } from '../lib/timeline';
import { outcomeLabel, payoutText } from '../lib/text';

export type HandTone = Tone;

interface Props {
  playerId: string;
  index: number;
  hand: TableHand;
  timeline: Timeline;
  now: number;
  leaving: boolean;
  size: PlayingCardSize;
  /** The hand in play right now. */
  active: boolean;
  /** The seat strip's small hand: no bet line, the outcome only as colour. */
  mini?: boolean;
  testId: string;
}

/**
 * The hand as the timeline shows it at `now`: the cards on the felt so far (one may still be
 * sliding in), the total of those that have landed and, once settled on screen, the outcome.
 */
export function handOnScreen(playerId: string, index: number, hand: TableHand, timeline: Timeline, now: number) {
  const cards = hand.cards.map((card, i) => ({ card, key: cardKey(playerId, index, i, card) })).filter((c) => cardShown(timeline, c.key, now));
  const total = shownTotal(cards.filter((c) => landed(timeline, c.key, now)).map((c) => c.card));
  const outcome = hand.outcome !== null && outcomesShown(timeline, now) ? hand.outcome : null;
  return { cards, total, outcome };
}

function toneOf(outcome: TableHand['outcome'], bust: boolean, natural: boolean, active: boolean): HandTone {
  if (outcome) return outcome;
  if (bust) return 'bust';
  if (natural) return 'blackjack';
  return active ? 'active' : 'neutral';
}

/** One hand: the total pill over the cards, then the stake (and the outcome with its payout once settled). */
export function Hand({ playerId, index, hand, timeline, now, leaving, size, active, mini = false, testId }: Props) {
  const { cards, total, outcome } = handOnScreen(playerId, index, hand, timeline, now);
  const bust = total !== null && total.total > 21;
  const tone = toneOf(outcome, bust, hand.status === 'blackjack' && cards.length === 2, active);
  const payout = outcome && hand.payout !== null ? payoutText(hand.payout) : '';
  return (
    <div
      role="group"
      className={`bj-hand ${outlineClass(tone)}${mini ? ' bj-hand--mini' : ''}`}
      aria-label={`Hand ${index + 1}${total ? `: ${total.total}` : ''}${outcome ? `, ${outcomeLabel(outcome)}` : ''}`}
      data-testid={testId}
      data-index={index}
      data-status={hand.status}
      data-total={total?.total ?? 0}
      data-bet={hand.bet}
      data-cards={cards.length}
      data-active={active}
      data-outcome={outcome ?? undefined}
      data-payout={outcome ? (hand.payout ?? 0) : undefined}
    >
      <div className="bj-hand__top">
        {total && (
          <TotalPill tone={tone} testId="hand-total">
            {totalText(total, hand.outcome === null && (hand.status === 'waiting' || hand.status === 'acting'))}
          </TotalPill>
        )}
        {outcome && payout && !mini && <PayoutFloat text={payout} tone={tone} />}
      </div>
      <div className="bj-hand__cards">
        {cards.map(({ card, key }) => (
          <TableCard key={`${timeline.id}:${key}`} card={card} size={size} motion={cardMotion(timeline, key, now)} leaving={leaving} testId="card" />
        ))}
      </div>
      {!mini && (
        <div className="bj-hand__foot">
          {outcome ? (
            <span className={`bj-hand__outcome bj-hand__outcome--${outcome}`} data-testid="hand-outcome">
              {payout ? `${outcomeLabel(outcome)} ${payout}` : outcomeLabel(outcome)}
            </span>
          ) : (
            <Chips value={hand.bet} size={14} className="bj-hand__bet" />
          )}
          {hand.doubled && <span className="tbl-tag">2x</span>}
        </div>
      )}
    </div>
  );
}
