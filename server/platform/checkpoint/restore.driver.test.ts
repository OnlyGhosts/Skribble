/**
 * Checkpoints through the memory driver and the connection layer: what the phones are sent, and a
 * second driver (the restarted server) bringing rooms back from what they send.
 */
import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_MAX_AGE_MS, EMPTY_ROOM_TTL_MS } from '../../../shared/platform/constants.js';
import type { GameId } from '../../../shared/platform/games.js';
import { RESTORE_RATE_LIMIT_COUNT, handleConnection } from '../connection.js';
import { MemoryDriver } from '../drivers/memory.js';
import { FakeSocket } from '../drivers/testSocket.js';
import { AVATAR } from '../drivers/testUtils.js';
import type { PlatformRoomData } from '../engine/state.js';
import type { BlackjackData } from '../../games/blackjack/module.js';
import { CHECKPOINT_HOLDERS, CHECKPOINT_INTERVAL_MS, CHECKPOINT_REFRESH_MS } from './checkpointer.js';
import { MAX_PENDING_RESTORES, RESTORE_RATE_LIMIT_COUNT as PER_CODE_LIMIT, RESTORE_WINDOW_MAX_MS, RESTORE_WINDOW_MS } from './restorer.js';
import { openCheckpoint } from './seal.js';

const KEY = randomBytes(32);
const clock = { now: (): number => Date.now() };

interface Phone {
  ws: FakeSocket;
  driver: MemoryDriver;
}

function server(key: Buffer | null = KEY): MemoryDriver {
  return new MemoryDriver({ clock, checkpointKey: key });
}

function connect(driver: MemoryDriver): Phone {
  const ws = new FakeSocket();
  handleConnection(ws, { driver, clock, heartbeatMs: 1e9, idleAfterMs: 1e9 });
  return { ws, driver };
}

function welcome(p: Phone): { playerId: string; token: string; code: string } {
  const w = p.ws.last('welcome');
  return { playerId: w.playerId, token: w.token, code: w.room.code };
}

/** A room of `names` (the first creates it, the rest join and ready up). */
function room(driver: MemoryDriver, gameId: GameId, names: string[]): Phone[] {
  const phones = names.map(() => connect(driver));
  phones[0].ws.receive({ t: 'create', gameId, name: names[0], avatar: AVATAR });
  const { code } = welcome(phones[0]);
  phones.slice(1).forEach((p, i) => {
    p.ws.receive({ t: 'join', code, name: names[i + 1], avatar: AVATAR });
    p.ws.receive({ t: 'ready', ready: true });
  });
  return phones;
}

function checkpointOf(p: Phone): string {
  const text = p.ws.last('checkpoint').checkpoint;
  if (text === null) throw new Error('the phone was told to drop its checkpoint');
  return text;
}

/** Whether the phone holds a checkpoint now: it got one, and no word to drop it since. */
function holds(p: Phone): boolean {
  const list = p.ws.ofType('checkpoint');
  return list.length > 0 && list[list.length - 1].checkpoint !== null;
}

function opened(text: string, code: string): PlatformRoomData {
  const out = openCheckpoint(KEY, text, { code, now: Date.now() });
  if (!out.ok) throw new Error(`checkpoint does not open: ${out.reason}`);
  return out.value as PlatformRoomData;
}

function blackjack(driver: MemoryDriver, code: string): BlackjackData {
  return driver.rooms.get(code)?.state.game as BlackjackData;
}

/** The server dies here: nothing more reaches the phones, which keep what they were sent. */
function kill(driver: MemoryDriver): Promise<void> {
  return driver.shutdown();
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('sending checkpoints', () => {
  it('sends none without a key', () => {
    const a = server(null);
    const phones = room(a, 'blackjack', ['Ann', 'Bob']);
    phones[0].ws.receive({ t: 'start' });
    vi.advanceTimersByTime(10_000);
    expect(phones.flatMap((p) => p.ws.ofType('checkpoint'))).toEqual([]);
  });

  it('sends a room at most every few seconds, the last change always included', () => {
    const a = server();
    const [ann, bob] = room(a, 'blackjack', ['Ann', 'Bob']);
    const { code } = welcome(ann);
    vi.advanceTimersByTime(0);
    const first = ann.ws.ofType('checkpoint').length;
    expect(first).toBe(1);
    // A burst of changes: one more checkpoint, once the interval is up, carrying the last of them.
    bob.ws.receive({ t: 'ready', ready: false });
    vi.advanceTimersByTime(1000);
    bob.ws.receive({ t: 'ready', ready: true });
    vi.advanceTimersByTime(1000);
    bob.ws.receive({ t: 'ready', ready: false });
    expect(ann.ws.ofType('checkpoint')).toHaveLength(first);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    expect(ann.ws.ofType('checkpoint')).toHaveLength(first + 1);
    expect(opened(checkpointOf(ann), code).players.find((p) => p.name === 'Bob')?.ready).toBe(false);
    expect(bob.ws.last('checkpoint').checkpoint).toBe(checkpointOf(ann));
    // Nothing changed since: nothing more is sent.
    vi.advanceTimersByTime(30_000);
    expect(ann.ws.ofType('checkpoint')).toHaveLength(first + 1);
  });

  it('seals a quiet room again now and then, so the phones never hold only an expired one', () => {
    const a = server();
    const [ann, bob] = room(a, 'blackjack', ['Ann', 'Bob']);
    const { code } = welcome(ann);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const first = ann.ws.ofType('checkpoint').length;
    vi.advanceTimersByTime(CHECKPOINT_REFRESH_MS - 1);
    expect(ann.ws.ofType('checkpoint')).toHaveLength(first);
    vi.advanceTimersByTime(1);
    expect(ann.ws.ofType('checkpoint')).toHaveLength(first + 1);
    // An hour of nobody touching the lobby: what the phones hold still opens.
    vi.advanceTimersByTime(60 * 60_000);
    expect(CHECKPOINT_REFRESH_MS).toBeLessThan(CHECKPOINT_MAX_AGE_MS);
    for (const p of [ann, bob]) expect(opened(checkpointOf(p), code).players.map((x) => x.name)).toEqual(['Ann', 'Bob']);
    // Nobody connected: nothing more is sent, and nothing keeps a timer going.
    ann.ws.close();
    bob.ws.close();
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const sent = ann.ws.ofType('checkpoint').length + bob.ws.ofType('checkpoint').length;
    vi.advanceTimersByTime(2 * CHECKPOINT_REFRESH_MS);
    expect(ann.ws.ofType('checkpoint').length + bob.ws.ofType('checkpoint').length).toBe(sent);
  });

  it('sends one at once when the game starts, a turn changes or someone is kicked', () => {
    const a = server();
    const [ann, bob, cy] = room(a, 'blackjack', ['Ann', 'Bob', 'Cy']);
    const { code } = welcome(ann);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const count = (): number => ann.ws.ofType('checkpoint').length;
    let before = count();
    ann.ws.receive({ t: 'start' });
    expect(count()).toBe(before + 1);
    expect(opened(checkpointOf(ann), code).phase).toBe('playing');
    before = count();
    ann.ws.receive({ t: 'kick', playerId: welcome(cy).playerId });
    expect(count()).toBe(before + 1);
    expect(opened(checkpointOf(ann), code).players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    before = count();
    ann.ws.receive({ t: 'bet', amount: 10 });
    bob.ws.receive({ t: 'bet', amount: 10 });
    // The deal is a new phase: on its way at once.
    expect(count()).toBe(before + 1);
    expect((opened(checkpointOf(ann), code).game as BlackjackData).phase.kind).not.toBe('betting');
  });

  it('in a big room goes to the host and the five who joined first, replacing one that drops', () => {
    const a = server();
    const names = ['Ann', 'Bob', 'Cy', 'Di', 'Ed', 'Flo', 'Gus', 'Hal'];
    const phones = room(a, 'blackjack', names);
    const { code } = welcome(phones[0]);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const holders = (): string[] => names.filter((_, i) => holds(phones[i]));
    expect(holders()).toEqual(names.slice(0, CHECKPOINT_HOLDERS));
    // Bob drops: the next checkpoint goes to Gus instead.
    const bob = welcome(phones[1]);
    phones[1].ws.close();
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    expect(names.filter((_, i) => i !== 1 && holds(phones[i]))).toEqual(['Ann', 'Cy', 'Di', 'Ed', 'Flo', 'Gus']);
    expect(phones[7].ws.ofType('checkpoint')).toEqual([]);
    // Bob is back (a screen lock): his place does not move, he is brought up to date and Gus,
    // who will get no more, is told to drop his copy so it cannot roll the room back later.
    const back = connect(a);
    back.ws.receive({ t: 'rejoin', code, token: bob.token });
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    expect(holds(back)).toBe(true);
    expect(phones[6].ws.last('checkpoint').checkpoint).toBeNull();
    expect(names.filter((_, i) => i !== 1 && holds(phones[i]))).toEqual(['Ann', 'Cy', 'Di', 'Ed', 'Flo']);
  });

  it('before a restart, brings every phone that holds one up to date at once', () => {
    const a = server();
    const [ann, bob] = room(a, 'blackjack', ['Ann', 'Bob']);
    const { code } = welcome(ann);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    ann.ws.receive({ t: 'start' });
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    ann.ws.receive({ t: 'bet', amount: 25 });
    a.checkpointAll();
    for (const p of [ann, bob]) expect(blackjackOf(opened(checkpointOf(p), code)).seats[welcome(ann).playerId].bet).toBe(25);
  });
});

function blackjackOf(data: PlatformRoomData): BlackjackData {
  return data.game as BlackjackData;
}

/** A Blackjack table of three, bets open with Ann's 50 down, as the phones last had it. */
function tableMidBets(): { a: MemoryDriver; phones: Phone[]; code: string; seats: Array<{ playerId: string; token: string }> } {
  const a = server();
  const phones = room(a, 'blackjack', ['Ann', 'Bob', 'Cy']);
  const { code } = welcome(phones[0]);
  phones[0].ws.receive({ t: 'start' });
  phones[0].ws.receive({ t: 'bet', amount: 50 });
  vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
  return { a, phones, code, seats: phones.map((p) => welcome(p)) };
}

describe('restoring after a restart', () => {
  it('tells a rejoin that the room is gone, brings it back from a checkpoint and seats everyone again', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);

    const b = server();
    const [ann, bob, cy] = seats.map(() => connect(b));
    ann.ws.receive({ t: 'rejoin', code, token: seats[0].token });
    expect(ann.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', roomGone: true });
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    // Bob, with no checkpoint, rejoins while the room is coming back: still gone, so he tries again.
    bob.ws.receive({ t: 'rejoin', code, token: seats[1].token });
    expect(bob.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', roomGone: true });
    expect(ann.ws.ofType('welcome')).toEqual([]);
    // A lone checkpoint may be an old copy: the restore waits for a second phone's for a while.
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);
    expect(ann.ws.ofType('welcome')).toEqual([]);
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS - RESTORE_WINDOW_MS);
    expect(welcome(ann)).toEqual(seats[0]);
    bob.ws.receive({ t: 'rejoin', code, token: seats[1].token });
    expect(welcome(bob)).toEqual(seats[1]);
    cy.ws.receive({ t: 'rejoin', code, token: seats[2].token });
    expect(welcome(cy)).toEqual(seats[2]);

    const room = b.rooms.get(code);
    expect(room?.hostPlayerId).toBe(seats[0].playerId);
    expect(room?.state.players.every((p) => p.connected)).toBe(true);
    expect(blackjack(b, code).seats[seats[0].playerId]).toMatchObject({ bet: 50, chips: 950 });
    expect(ann.ws.last('welcome').room.players.map((p) => p.score)).toEqual([950, 1000, 1000]);
    // The game carries on: the others bet, the cards go out.
    bob.ws.receive({ t: 'bet', amount: 10 });
    cy.ws.receive({ t: 'bet', amount: 10 });
    expect(blackjack(b, code).phase.kind).not.toBe('betting');
    // And the restored room hands out checkpoints of its own.
    expect(ann.ws.ofType('checkpoint').length).toBeGreaterThan(0);
  });

  it('restores from the newest of the checkpoints that arrive together', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const older = checkpointOf(phones[1]);
    phones[1].ws.receive({ t: 'bet', amount: 70 });
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const newer = checkpointOf(phones[0]);
    expect(newer).not.toBe(older);
    await kill(a);

    const b = server();
    const [ann, bob] = seats.map(() => connect(b));
    // The older one arrives first; the newer one, a moment later, wins.
    bob.ws.receive({ t: 'restore', code, token: seats[1].token, checkpoint: older });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS / 2);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: newer });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);
    expect(welcome(ann)).toEqual(seats[0]);
    expect(welcome(bob)).toEqual(seats[1]);
    expect(blackjack(b, code).seats[seats[1].playerId].bet).toBe(70);
    // Later checkpoints meet a live room: the phone just rejoins, nothing is restored again.
    const cy = connect(b);
    cy.ws.receive({ t: 'restore', code, token: seats[2].token, checkpoint: older });
    expect(welcome(cy)).toEqual(seats[2]);
    expect(blackjack(b, code).seats[seats[1].playerId].bet).toBe(70);
  });

  it('accepts newcomers after the restore', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);
    const b = server();
    const ann = connect(b);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS);
    const dee = connect(b);
    dee.ws.receive({ t: 'join', code: code.toLowerCase(), name: 'Dee', avatar: AVATAR });
    expect(welcome(dee).code).toBe(code);
    expect(b.rooms.get(code)?.state.players.map((p) => p.name)).toEqual(['Ann', 'Bob', 'Cy', 'Dee']);
  });

  it('seats a phone whose own checkpoint does not open, when another phone is bringing the room back', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);
    const b = server();
    const [ann, bob] = seats.map(() => connect(b));
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    bob.ws.receive({ t: 'restore', code, token: seats[1].token, checkpoint: 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA' });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS);
    expect(welcome(ann)).toEqual(seats[0]);
    expect(welcome(bob)).toEqual(seats[1]);
  });

  it('refuses a checkpoint from a phone whose token is not a seat in it', async () => {
    const { a, phones, code } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);
    const b = server();
    const stranger = connect(b);
    stranger.ws.receive({ t: 'restore', code, token: 'not-a-seat-token', checkpoint: held });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);
    expect(stranger.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED' });
    expect(b.rooms.get(code)).toBeUndefined();
  });

  it('keeps a kicked player out: the newest checkpoint no longer has their seat', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const beforeKick = checkpointOf(phones[2]);
    phones[0].ws.receive({ t: 'kick', playerId: seats[2].playerId });
    const afterKick = checkpointOf(phones[0]);
    await kill(a);

    const b = server();
    const [ann, , cy] = seats.map(() => connect(b));
    cy.ws.receive({ t: 'restore', code, token: seats[2].token, checkpoint: beforeKick });
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: afterKick });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);
    expect(welcome(ann)).toEqual(seats[0]);
    expect(cy.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', message: 'You were removed from this room.' });
    expect(cy.ws.ofType('welcome')).toEqual([]);
    expect(b.rooms.get(code)?.state.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
    // Trying again with it, the room live now, is only a refused rejoin.
    cy.ws.receive({ t: 'restore', code, token: seats[2].token, checkpoint: beforeKick });
    expect(cy.ws.ofType('welcome')).toEqual([]);
  });

  it('refuses a checkpoint sealed with another key, or too old, telling the phone to keep asking quietly', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);
    const other = server(randomBytes(32));
    const ann = connect(other);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    // Its own copy does not open, but another phone's may: the game is not over for this phone yet.
    expect(ann.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', roomGone: true });
    expect(other.rooms.get(code)).toBeUndefined();

    vi.advanceTimersByTime(CHECKPOINT_MAX_AGE_MS + 1);
    const b = server();
    const late = connect(b);
    late.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    expect(late.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', roomGone: true });
    expect(b.rooms.get(code)).toBeUndefined();
  });

  it('never brings back a room that was deleted', async () => {
    const a = server();
    const [ann, bob] = room(a, 'blackjack', ['Ann', 'Bob']);
    const { code, token } = welcome(ann);
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const held = checkpointOf(ann);
    ann.ws.receive({ t: 'leave' });
    bob.ws.receive({ t: 'leave' });
    vi.advanceTimersByTime(EMPTY_ROOM_TTL_MS + 1);
    expect(a.rooms.get(code)).toBeUndefined();
    const again = connect(a);
    // The room ended here: a rejoin is not told it may come back, and its checkpoint is refused for good.
    again.ws.receive({ t: 'rejoin', code, token });
    expect(again.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED' });
    expect(again.ws.last('error').roomGone).toBeUndefined();
    again.ws.receive({ t: 'restore', code, token, checkpoint: held });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS);
    expect(again.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED' });
    expect(again.ws.last('error').roomGone).toBeUndefined();
    expect(a.rooms.get(code)).toBeUndefined();
  });

  it('is a plain rejoin when the room is live', () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[1]);
    phones[1].ws.close();
    const bob = connect(a);
    bob.ws.receive({ t: 'restore', code, token: seats[1].token, checkpoint: held });
    expect(welcome(bob)).toEqual(seats[1]);
  });

  it('limits restore attempts per connection', () => {
    const b = server();
    const phone = connect(b);
    for (let i = 0; i <= RESTORE_RATE_LIMIT_COUNT; i++) phone.ws.receive({ t: 'restore', code: 'ABCD', token: 'some-seat-token', checkpoint: 'AAAA' });
    expect(phone.ws.errors()).toEqual([...Array.from({ length: RESTORE_RATE_LIMIT_COUNT }, () => 'REJOIN_FAILED'), 'RATE_LIMITED']);
  });
});


describe('old copies, strangers and the order the phones come back in', () => {
  it('a phone back first with a copy from before it dropped does not roll the room back', async () => {
    const { a, phones, code, seats } = tableMidBets();
    // Bob's phone drops (a screen lock) and the table moves on without him: Cy bets 40.
    const stale = checkpointOf(phones[1]);
    phones[1].ws.close();
    phones[2].ws.receive({ t: 'bet', amount: 40 });
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const fresh = checkpointOf(phones[0]);
    await kill(a);

    const b = server();
    const bob = connect(b);
    bob.ws.receive({ t: 'restore', code, token: seats[1].token, checkpoint: stale });
    // The host's phone is a reconnect step behind, well past the first second.
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS + 2000);
    expect(b.rooms.get(code)).toBeUndefined();
    const ann = connect(b);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: fresh });
    await vi.advanceTimersByTimeAsync(0);
    expect(blackjack(b, code).seats[seats[2].playerId].bet).toBe(40);
    expect(welcome(ann)).toEqual(seats[0]);
    expect(welcome(bob)).toEqual(seats[1]);
  });

  it('a kicked player who keeps a copy from before the kick and comes back first stays out', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const beforeKick = checkpointOf(phones[2]);
    phones[0].ws.receive({ t: 'kick', playerId: seats[2].playerId });
    const afterKick = checkpointOf(phones[0]);
    await kill(a);

    const b = server();
    const cy = connect(b);
    cy.ws.receive({ t: 'restore', code, token: seats[2].token, checkpoint: beforeKick });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS + 200);
    const ann = connect(b);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: afterKick });
    await vi.advanceTimersByTimeAsync(0);
    expect(welcome(ann)).toEqual(seats[0]);
    expect(cy.ws.ofType('welcome')).toEqual([]);
    expect(cy.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', message: 'You were removed from this room.' });
    expect(b.rooms.get(code)?.state.players.map((p) => p.name)).toEqual(['Ann', 'Bob']);
  });

  it('a stranger who knows the code cannot use up its restores with garbage', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);
    const b = server();
    for (let c = 0; c < Math.ceil(PER_CODE_LIMIT / RESTORE_RATE_LIMIT_COUNT) + 2; c++) {
      const s = connect(b);
      for (let i = 0; i < RESTORE_RATE_LIMIT_COUNT; i++) s.ws.receive({ t: 'restore', code, token: 'xxxxxxxxxxxx', checkpoint: 'AAAA' });
    }
    const [ann, bob] = seats.map(() => connect(b));
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    bob.ws.receive({ t: 'restore', code, token: seats[1].token, checkpoint: checkpointOf(phones[1]) });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);
    expect(welcome(ann)).toEqual(seats[0]);
    expect(blackjack(b, code).seats[seats[0].playerId].bet).toBe(50);
  });

  it('a phone whose own copy has expired keeps asking and gets its seat once another phone restores', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const stale = checkpointOf(phones[1]);
    vi.advanceTimersByTime(CHECKPOINT_MAX_AGE_MS + 1);
    phones[0].ws.receive({ t: 'chat', text: 'still here' });
    vi.advanceTimersByTime(CHECKPOINT_INTERVAL_MS);
    const fresh = checkpointOf(phones[0]);
    await kill(a);

    const b = server();
    const bob = connect(b);
    bob.ws.receive({ t: 'restore', code, token: seats[1].token, checkpoint: stale });
    // Not "the game ended": another phone may have a copy that opens.
    expect(bob.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', roomGone: true });
    const ann = connect(b);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: fresh });
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS);
    expect(welcome(ann)).toEqual(seats[0]);
    bob.ws.receive({ t: 'rejoin', code, token: seats[1].token });
    expect(welcome(bob)).toEqual(seats[1]);
  });

  it('a restore over the per-code limit is not the end of the game for that phone', async () => {
    const { a, phones, code, seats } = tableMidBets();
    const held = checkpointOf(phones[0]);
    await kill(a);
    const b = server();
    // Authentic offers from a token that is no seat in it count; each is refused for good.
    for (let i = 0; i < PER_CODE_LIMIT; i++) {
      const s = connect(b);
      s.ws.receive({ t: 'restore', code, token: 'not-a-seat-token', checkpoint: held });
      expect(s.ws.last('error').roomGone).toBeUndefined();
    }
    const ann = connect(b);
    ann.ws.receive({ t: 'restore', code, token: seats[0].token, checkpoint: held });
    expect(ann.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED', roomGone: true });
  });

  it('only says a lost room may come back where a checkpoint could do it', async () => {
    const b = server(null);
    const phone = connect(b);
    phone.ws.receive({ t: 'rejoin', code: 'ABCD', token: 'some-seat-token' });
    expect(phone.ws.last('error')).toMatchObject({ code: 'REJOIN_FAILED' });
    expect(phone.ws.last('error').roomGone).toBeUndefined();
    // Every checkpoint from before this process started has expired: nothing can come back.
    const c = server();
    vi.advanceTimersByTime(CHECKPOINT_MAX_AGE_MS);
    const late = connect(c);
    late.ws.receive({ t: 'rejoin', code: 'ABCD', token: 'some-seat-token' });
    expect(late.ws.last('error').roomGone).toBeUndefined();
    await c.shutdown();
  });
});
