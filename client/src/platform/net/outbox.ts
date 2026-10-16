import { CLIENT_SEQ_KEY, type WireMessage } from '@shared/platform/protocol';

/** A message older than this is not worth sending again after a reconnect: the moment it was for has passed. */
export const OUTBOX_TTL_MS = 30_000;
/** At most this many messages are kept; the oldest go first. */
export const OUTBOX_MAX = 200;

interface Entry {
  seq: number;
  msg: WireMessage;
  sentAt: number;
}

/**
 * The room messages this page sent, each numbered (CLIENT_SEQ_KEY) so the room applies it once. A
 * socket can look open while it is dead (a phone switching networks): what went out on it may
 * never have arrived. After the rejoin, the welcome says the last number the room applied for the
 * seat, and only the messages above it are sent again, in order.
 */
export class Outbox {
  private entries: Entry[] = [];
  private nextSeq = 1;

  /** Numbers a message and keeps it; returns what goes on the wire. */
  stamp(msg: WireMessage, now: number): WireMessage {
    const seq = this.nextSeq++;
    const wire: WireMessage = { ...msg, [CLIENT_SEQ_KEY]: seq };
    this.prune(now);
    this.entries.push({ seq, msg: wire, sentAt: now });
    if (this.entries.length > OUTBOX_MAX) this.entries.splice(0, this.entries.length - OUTBOX_MAX);
    return wire;
  }

  /**
   * The welcome of a rejoin into the same seat: `applied` is the last number the room applied.
   * Returns the messages to send again (above it and still fresh) and forgets the rest; numbering
   * carries on above whatever the room has seen.
   */
  resume(applied: number, now: number): WireMessage[] {
    this.nextSeq = Math.max(this.nextSeq, applied + 1);
    this.prune(now);
    this.entries = this.entries.filter((e) => e.seq > applied);
    return this.entries.map((e) => e.msg);
  }

  /** A welcome into another seat (or a first one): nothing kept belongs to it. */
  reset(applied: number): void {
    this.entries = [];
    this.nextSeq = Math.max(this.nextSeq, applied + 1);
  }

  get size(): number {
    return this.entries.length;
  }

  private prune(now: number): void {
    const cutoff = now - OUTBOX_TTL_MS;
    if (this.entries.length > 0 && this.entries[0].sentAt < cutoff) this.entries = this.entries.filter((e) => e.sentAt >= cutoff);
  }
}
