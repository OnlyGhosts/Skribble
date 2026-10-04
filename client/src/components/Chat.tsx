import { useEffect, useLayoutEffect, useRef, useState, type FormEvent, type RefObject, type UIEvent } from 'react';
import { CHAT_MAX_LENGTH } from '@shared/constants';
import type { ChatMessage } from '@shared/protocol';
import { sendChat } from '../net/actions';
import { selectHasGuessed, selectIsDrawer, useGameStore } from '../store/useGameStore';
import { GuessInput } from './GuessInput';
import { ChevronIcon } from './Icons';

/** How close to the bottom (px) still counts as "following" new messages. */
const FOLLOW_THRESHOLD = 48;

function placeholderFor(phaseKind: string | undefined, isDrawer: boolean, hasGuessed: boolean): string {
  if (phaseKind === 'drawing' && !isDrawer) {
    return hasGuessed ? 'You guessed it! Chat with others who know...' : 'Type your guess...';
  }
  return 'Chat...';
}

function MessageRow({ message }: { message: ChatMessage }) {
  return (
    <li className={`chat-msg chat-msg--${message.kind}`} data-testid="chat-message" data-kind={message.kind}>
      {message.name && (message.kind === 'chat' || message.kind === 'guessed') && (
        <span className="chat-msg__name">{message.name}</span>
      )}
      <span className="chat-msg__text">{message.text}</span>
    </li>
  );
}

interface PlainInputProps {
  value: string;
  placeholder: string;
  disabled: boolean;
  onChange(value: string): void;
  focusMemory: RefObject<boolean>;
  inputRef: RefObject<HTMLInputElement | null>;
}

/** The ordinary chat field; hands focus back and forth with the guess tiles across turns. */
function PlainChatInput({ value, placeholder, disabled, onChange, focusMemory, inputRef }: PlainInputProps) {
  useLayoutEffect(() => {
    const input = inputRef.current;
    if (focusMemory.current) {
      focusMemory.current = false;
      input?.focus();
    }
    return () => {
      focusMemory.current = input !== null && document.activeElement === input;
    };
  }, [focusMemory, inputRef]);
  return (
    <input
      ref={inputRef}
      className="input chat__input"
      data-testid="chat-input"
      type="text"
      value={value}
      maxLength={CHAT_MAX_LENGTH}
      placeholder={placeholder}
      aria-label="Chat message"
      autoComplete="off"
      enterKeyHint="send"
      disabled={disabled}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

export function Chat() {
  const messages = useGameStore((s) => s.chat);
  const phaseKind = useGameStore((s) => s.room?.phase.kind);
  const mask = useGameStore((s) => (s.room?.phase.kind === 'drawing' ? s.room.phase.mask : null));
  const isDrawer = useGameStore(selectIsDrawer);
  const hasGuessed = useGameStore(selectHasGuessed);
  const connected = useGameStore((s) => s.connection === 'connected');

  const [text, setText] = useState('');
  const [following, setFollowing] = useState(true);
  const [unread, setUnread] = useState(0);
  const logRef = useRef<HTMLOListElement | null>(null);
  const lastCount = useRef(messages.length);
  const focusMemory = useRef(false);
  const plainInputRef = useRef<HTMLInputElement | null>(null);

  const guessMode = phaseKind === 'drawing' && !isDrawer && !hasGuessed && mask !== null;

  useEffect(() => {
    const log = logRef.current;
    if (!log) return;
    if (following) {
      log.scrollTop = log.scrollHeight;
      setUnread(0);
    } else if (messages.length > lastCount.current) {
      setUnread((n) => n + messages.length - lastCount.current);
    }
    lastCount.current = messages.length;
  }, [messages, following]);

  // The log shrinks when the phone keyboard opens: stay glued to the newest message.
  useEffect(() => {
    const log = logRef.current;
    if (!log || typeof ResizeObserver !== 'function') return;
    const observer = new ResizeObserver(() => {
      if (following) log.scrollTop = log.scrollHeight;
    });
    observer.observe(log);
    return () => observer.disconnect();
  }, [following]);

  const onScroll = (e: UIEvent<HTMLOListElement>) => {
    const el = e.currentTarget;
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight <= FOLLOW_THRESHOLD;
    setFollowing(atBottom);
    if (atBottom) setUnread(0);
  };

  const jumpToLatest = () => {
    const log = logRef.current;
    if (log) log.scrollTop = log.scrollHeight;
    setFollowing(true);
    setUnread(0);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (sendChat(text)) setText('');
    // Tapping the Send button moved the focus to it; keep the field (and the phone keyboard) active.
    plainInputRef.current?.focus();
  };

  return (
    <section className="chat" aria-label="Chat">
      <div className="chat__log-wrap">
        <ol className="chat__log" ref={logRef} onScroll={onScroll} data-testid="chat-log" aria-live="polite" aria-relevant="additions">
          {messages.map((m) => (
            <MessageRow key={m.id} message={m} />
          ))}
        </ol>
        {!following && (
          <button type="button" className="chat__jump" onClick={jumpToLatest} aria-label="Jump to latest messages">
            <ChevronIcon size={14} /> {unread > 0 ? `${unread} new` : 'Latest'}
          </button>
        )}
      </div>
      {guessMode ? (
        <GuessInput mask={mask} focusMemory={focusMemory} />
      ) : (
        <form className="chat__form" onSubmit={submit}>
          <PlainChatInput
            value={text}
            placeholder={placeholderFor(phaseKind, isDrawer, hasGuessed)}
            disabled={!connected}
            onChange={setText}
            focusMemory={focusMemory}
            inputRef={plainInputRef}
          />
          <button type="submit" className="btn btn--primary btn--sm chat__send" disabled={!connected || !text.trim()} data-testid="chat-send">
            Send
          </button>
        </form>
      )}
    </section>
  );
}
