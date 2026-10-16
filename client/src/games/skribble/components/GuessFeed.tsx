import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ChatKind, ChatMessage } from '@shared/platform/protocol';
import { CheckIcon } from '../../../platform/components/Icons';
import { useLive } from '../../../platform/lib/useLive';
import { usePlatformStore } from '../../../platform/store/usePlatformStore';
import { useSkribbleStore } from '../store';

/** Wrong guesses, "close" nudges, who got it, the word at the end of a turn and the game's own lines. Notices are toasts. */
const FEED_KINDS: ReadonlySet<ChatKind> = new Set<ChatKind>(['chat', 'guessed', 'correct', 'close', 'hint', 'system']);

function FeedLine({ message }: { message: ChatMessage }) {
  return (
    <li className={`feed-line feed-line--${message.kind}`} data-testid="feed-line" data-kind={message.kind}>
      {message.kind === 'correct' && <CheckIcon size={14} className="feed-line__icon" />}
      {message.name && (message.kind === 'chat' || message.kind === 'guessed') && <span className="feed-line__name">{message.name}</span>}
      <span className="feed-line__text">{message.text}</span>
    </li>
  );
}

/** The guess feed: this game's guesses as they come in, always showing the newest. */
export function GuessFeed() {
  const lines = useLive(usePlatformStore, (s) => s.chat);
  const from = useLive(useSkribbleStore, (s) => s.feedFrom);
  const shown = useMemo(() => lines.filter((m) => m.id > from && FEED_KINDS.has(m.kind)), [lines, from]);
  const logRef = useRef<HTMLOListElement | null>(null);

  useLayoutEffect(() => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
  }, [shown]);

  // The feed shrinks when the phone keyboard opens: stay on the newest line.
  useLayoutEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      log.scrollTop = log.scrollHeight;
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, []);

  return (
    <ol className="feed" ref={logRef} data-testid="guess-feed" aria-label="Guesses" aria-live="polite" aria-relevant="additions">
      {shown.map((m) => (
        <FeedLine key={m.id} message={m} />
      ))}
    </ol>
  );
}
