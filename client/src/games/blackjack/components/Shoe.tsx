import { formatChips } from '../lib/text';

/** A few card backs stacked with a small offset: the shoe and the discard pile. */
function Stack({ count }: { count: number }) {
  return (
    <span className="bj-stack" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <span key={i} className="bj-stack__card" style={{ transform: `translate(${i * 2}px, ${-i * 2}px)` }} />
      ))}
    </span>
  );
}

/** The shoe, top right: the cards fly out of it. */
export function Shoe({ remaining, reshuffled }: { remaining: number; reshuffled: boolean }) {
  return (
    <div className="bj-shoe" data-testid="shoe" data-remaining={remaining} aria-label={`${remaining} cards in the shoe`} role="img">
      <span className="bj-shoe__stack" data-bj-shoe="">
        <Stack count={3} />
      </span>
      <span className="bj-shoe__count">{reshuffled ? 'New shoe' : formatChips(remaining)}</span>
    </div>
  );
}

/** The discard tray, top left: where the cards go when the table clears. */
export function DiscardTray({ discarded }: { discarded: number }) {
  return (
    <div className="bj-discard" data-testid="discard-tray" data-discarded={discarded} aria-label="Discards" role="img">
      <span className="bj-discard__slot" data-bj-discard="">
        {discarded > 0 && <Stack count={Math.min(3, Math.ceil(discarded / 20))} />}
      </span>
    </div>
  );
}
