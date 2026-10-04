/** An in-memory `SocketLike` for driver and connection tests: records what the server sent. */
import { EventEmitter } from 'node:events';
import type { SkribbleServerMessage, SkribbleSettings, SkribbleView } from '../../../shared/games/skribble/protocol.js';
import type { PlatformServerMessage } from '../../../shared/platform/protocol.js';
import type { SocketLike } from './types.js';

/** Every message a test may see: platform messages with Skribble's view, and Skribble's own stream. */
export type AnyServerMessage = PlatformServerMessage<SkribbleView, SkribbleSettings> | SkribbleServerMessage;
export type AnyServerMessageOf<T extends AnyServerMessage['t']> = Extract<AnyServerMessage, { t: T }>;

export class FakeSocket extends EventEmitter implements SocketLike {
  readyState = 1;
  readonly sent: AnyServerMessage[] = [];
  readonly closes: Array<{ code?: number; reason?: string }> = [];
  terminated = false;
  pings = 0;

  send(data: string): void {
    this.sent.push(JSON.parse(data) as AnyServerMessage);
  }

  close(code?: number, reason?: string): void {
    if (this.readyState === 3) return;
    this.closes.push({ code, reason });
    this.readyState = 3;
    this.emit('close');
  }

  terminate(): void {
    if (this.readyState === 3) return;
    this.terminated = true;
    this.readyState = 3;
    this.emit('close');
  }

  ping(): void {
    this.pings++;
  }

  /** Simulates an inbound frame. */
  receive(payload: unknown, raw = false): void {
    const text = raw ? String(payload) : JSON.stringify(payload);
    this.emit('message', Buffer.from(text), false);
  }

  ofType<T extends AnyServerMessage['t']>(t: T): AnyServerMessageOf<T>[] {
    return this.sent.filter((m): m is AnyServerMessageOf<T> => m.t === t);
  }

  last<T extends AnyServerMessage['t']>(t: T): AnyServerMessageOf<T> {
    const list = this.ofType(t);
    const msg = list[list.length - 1];
    if (!msg) throw new Error(`no '${t}' message`);
    return msg;
  }

  errors(): string[] {
    return this.ofType('error').map((m) => m.code);
  }

  chats(): Array<{ kind: string; text: string }> {
    return this.ofType('chat').map((m) => ({ kind: m.message.kind, text: m.message.text }));
  }
}
