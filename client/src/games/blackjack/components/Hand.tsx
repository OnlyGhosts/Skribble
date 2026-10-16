import type { PlayingCardSize } from '../../../platform/components/PlayingCard';
import { HandFan, OutcomeFlag } from '../../../platform/table/HandFan';
import { PayoutFloat, type Tone } from '../../../platform/table/Outcome';
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
  /** A seat's small hand: the pill beside the cards, the outcome only as colour. */
  mini?: boolean;
  /** One of several hands side by side: the outcome's word goes inside the pill, which stays over its own hand. */
  narrow?: boolean;
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

/** A hand's colour: its outcome once shown, a bust or a natural as soon as they land, lit while in play. */
export function handTone(outcome: TableHand['outcome'], bust: boolean, natural: boolean, active: boolean): HandTone {
  if (outcome === 'loss' && bust) return 'bust';
  if (outcome) return outcome;
  if (bust) return 'bust';
  if (natural) return 'blackjack';
  return active ? 'active' : 'neutral';
}

/** The word for how a hand ended: a busted loss says Bust. */
function endWord(outcome: NonNullable<TableHand['outcome']>, bust: boolean): string {
  return outcome === 'loss' && bust ? 'Bust' : outcomeLabel(outcome);
}

/**
 * One hand as a stepped fan with its total over the top right corner; once settled, every card is
 * outlined in the outcome's colour, the pill takes it too, and the outcome is said in words beside
 * the pill ("Win +20"). A doubled hand is tagged "2x" there while it plays.
 */
export function Hand({ playerId, index, hand, timeline, now, leaving, size, active, mini = false, narrow = false, testId }: Props) {
  const { cards, total, outcome } = handOnScreen(playerId, index, hand, timeline, now);
  const bust = total !== null && total.total > 21;
  const tone = handTone(outcome, bust, hand.status === 'blackjack' && cards.length === 2, active);
  const payout = outcome && outcome !== 'push' && hand.payout !== null ? payoutText(hand.payout) : '';
  const word = outcome ? endWord(outcome, bust) : '';
  // Beside the pill on a hand of its own; inside it, before the total, when hands sit side by side.
  const inPill = narrow && outcome !== null && !mini;
  const flag = mini || inPill ? null : outcome ? <OutcomeFlag tone={tone} word={word} extra={payout} testId="hand-outcome" /> : hand.doubled ? <span className="tbl-tag">2x</span> : null;
  const lead = inPill ? <span className="tbl-pill__lead" data-testid="hand-outcome">{word}</span> : undefined;
  return (
    <HandFan
      className="bj-hand"
      size={mini ? 'mini' : 'big'}
      tone={tone}
      total={total ? totalText(total, hand.outcome === null && (hand.status === 'waiting' || hand.status === 'acting')) : null}
      lead={lead}
      totalTestId="hand-total"
      flag={flag}
      float={outcome && payout && !mini ? <PayoutFloat text={payout} tone={tone} /> : undefined}
      label={`Hand ${index + 1}${total ? `: ${total.total}` : ''}${outcome ? `, ${endWord(outcome, bust)}` : ''}`}
      testId={testId}
      data={{
        'data-index': index,
        'data-status': hand.status,
        'data-total': total?.total ?? 0,
        'data-bet': hand.bet,
        'data-cards': cards.length,
        'data-active': active,
        'data-outcome': outcome ?? undefined,
        'data-payout': outcome ? (hand.payout ?? 0) : undefined,
      }}
    >
      {cards.map(({ card, key }) => (
        <TableCard key={`${timeline.id}:${key}`} card={card} size={size} motion={cardMotion(timeline, key, now)} leaving={leaving} testId="card" />
      ))}
    </HandFan>
  );
}
