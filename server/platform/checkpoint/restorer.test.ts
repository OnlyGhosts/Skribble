import { randomBytes } from 'node:crypto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CHECKPOINT_MAX_AGE_MS } from '../../../shared/platform/constants.js';
import { ROOM_CODE_ALPHABET } from '../../../shared/platform/roomCode.js';
import type { PlatformRoomData } from '../engine/state.js';
import { sim, startGame } from '../engine/testHarness.js';
import { MAX_PENDING_RESTORES, RESTORE_RATE_LIMIT_COUNT, RESTORE_WINDOW_MAX_MS, RESTORE_WINDOW_MS, Restorer } from './restorer.js';
import { sealCheckpoint } from './seal.js';

const KEY = randomBytes(32);

interface World {
  restorer: Restorer;
  rebuilt: Array<{ data: PlatformRoomData; issuedAt: number }>;
}

function world(): World {
  const rebuilt: World['rebuilt'] = [];
  const live = new Set<string>();
  const restorer = new Restorer({
    key: KEY,
    clock: { now: () => Date.now() },
    rebuild: (data, issuedAt) => {
      rebuilt.push({ data, issuedAt });
      live.add(data.code);
      return true;
    },
    isLive: (code) => live.has(code),
  });
  return { restorer, rebuilt };
}

/** A Blackjack room of two as a checkpoint issued now, with Ann's token. */
function checkpoint(mutate: (data: PlatformRoomData) => void = () => undefined, code = 'ABCD'): { text: string; token: string; data: PlatformRoomData } {
  const s = sim('blackjack', code, Date.now());
  startGame(s, ['Ann', 'Bob']);
  const data = structuredClone(s.data);
  mutate(data);
  return { text: sealCheckpoint(KEY, code, Date.now(), data), token: data.players[0].token, data };
}

/** The answer an offer gets, once it has one. */
function answerOf(offered: ReturnType<Restorer['offer']>): { value: unknown } {
  const box: { value: unknown } = { value: undefined };
  void Promise.resolve(offered).then((v) => (box.value = v));
  return box;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-01-01T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

describe('Restorer', () => {
  it('restores the newest candidate once the window closes, and answers every offer then', async () => {
    const w = world();
    const old = checkpoint();
    vi.advanceTimersByTime(2000);
    const fresh = checkpoint((d) => {
      d.players[0].score = 77;
    });
    const answers: unknown[] = [];
    void Promise.resolve(w.restorer.offer('ABCD', fresh.token, fresh.text)).then((a) => answers.push(a));
    void Promise.resolve(w.restorer.offer('ABCD', old.data.players[1].token, old.text)).then((a) => answers.push(a));
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS - 1);
    expect(w.rebuilt).toEqual([]);
    expect(answers).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(w.rebuilt).toHaveLength(1);
    expect(w.rebuilt[0].data.players[0].score).toBe(77);
    expect(answers).toEqual([{ ok: true }, { ok: true }]);
  });

  it('refuses a room whose platform record or game state does not load', () => {
    const w = world();
    const broken = checkpoint((d) => {
      (d as { players: unknown }).players = 'nobody';
    });
    expect(w.restorer.offer('ABCD', 'whatever-token', broken.text)).toMatchObject({ ok: false });
    const badGame = checkpoint((d) => {
      d.game = { phase: 'nonsense' };
    });
    expect(w.restorer.offer('ABCD', badGame.token, badGame.text)).toMatchObject({ ok: false });
    const removedGame = checkpoint((d) => {
      (d as { gameId: string }).gameId = 'hangman';
    });
    expect(w.restorer.offer('ABCD', removedGame.token, removedGame.text)).toMatchObject({ ok: false });
    vi.advanceTimersByTime(RESTORE_WINDOW_MS);
    expect(w.rebuilt).toEqual([]);
  });

  it('refuses a kicked token even when the checkpoint still lists it', () => {
    const w = world();
    const cp = checkpoint((d) => {
      d.kickedTokens = [d.players[0].token];
    });
    expect(w.restorer.offer('ABCD', cp.token, cp.text)).toMatchObject({ ok: false });
  });

  it('remembers a deleted code: older checkpoints are refused, a later room with the code is not', async () => {
    const w = world();
    const before = checkpoint();
    vi.advanceTimersByTime(1000);
    w.restorer.remember('ABCD', Date.now());
    expect(w.restorer.offer('ABCD', before.token, before.text)).toMatchObject({ ok: false });
    vi.advanceTimersByTime(1000);
    const after = checkpoint();
    const answer = w.restorer.offer('ABCD', after.token, after.text);
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS);
    await expect(Promise.resolve(answer)).resolves.toEqual({ ok: true });
  });

  it('forgets a deleted code once its checkpoints have expired anyway', () => {
    const w = world();
    w.restorer.remember('ABCD', Date.now());
    vi.advanceTimersByTime(CHECKPOINT_MAX_AGE_MS + 1);
    w.restorer.remember('WXYZ', Date.now());
    const cp = checkpoint();
    expect(w.restorer.offer('ABCD', cp.token, cp.text)).not.toMatchObject({ ok: false });
  });

  it('limits authentic attempts per room code; garbage sent with the code uses up none of them', async () => {
    const w = world();
    // A stranger who knows the code: refused, but the phone is told to keep asking, and the room's tries are untouched.
    for (let i = 0; i < RESTORE_RATE_LIMIT_COUNT * 2; i++) expect(w.restorer.offer('ABCD', 'some-token', 'AAAA')).toEqual({ ok: false, message: expect.any(String), retry: true });
    const cp = checkpoint();
    for (let i = 0; i < RESTORE_RATE_LIMIT_COUNT; i++) expect(w.restorer.offer('ABCD', 'not-a-seat-token', cp.text)).toMatchObject({ ok: false, retry: false });
    // Over the limit with nothing being restored: the phone keeps asking quietly instead of ending its game.
    expect(w.restorer.offer('ABCD', cp.token, cp.text)).toMatchObject({ ok: false, retry: true });
    vi.advanceTimersByTime(RESTORE_WINDOW_MAX_MS);
    expect(w.rebuilt).toEqual([]);
  });

  it('lets a phone that holds a checkpoint keep asking while too many rooms restore at once', () => {
    const w = world();
    const codes = Array.from({ length: MAX_PENDING_RESTORES }, (_, i) => `${ROOM_CODE_ALPHABET[i % 31]}${ROOM_CODE_ALPHABET[Math.floor(i / 31)]}ZZ`);
    for (const code of codes) {
      const cp = checkpoint(() => undefined, code);
      void w.restorer.offer(code, cp.token, cp.text);
    }
    const cp = checkpoint();
    expect(w.restorer.offer('ABCD', cp.token, cp.text)).toMatchObject({ ok: false, retry: true });
    w.restorer.stop();
  });

  it('waits for a second phone before trusting a lone checkpoint, up to RESTORE_WINDOW_MAX_MS', async () => {
    const w = world();
    const old = checkpoint();
    vi.advanceTimersByTime(5000);
    const fresh = checkpoint((d) => {
      d.players[1].score = 55;
    });
    const first = answerOf(w.restorer.offer('ABCD', old.token, old.text));
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS + 2000);
    expect(w.rebuilt).toEqual([]);
    // The second phone, on a later reconnect step, has the newer copy: it wins, and the restore closes now.
    const second = answerOf(w.restorer.offer('ABCD', fresh.data.players[1].token, fresh.text));
    await vi.advanceTimersByTimeAsync(0);
    expect(w.rebuilt.map((r) => r.data.players[1].score)).toEqual([55]);
    expect([first.value, second.value]).toEqual([{ ok: true }, { ok: true }]);

    // Nobody else ever comes: the lone copy is restored once the longest wait is over.
    const alone = world();
    const lone = checkpoint();
    void alone.restorer.offer('ABCD', lone.token, lone.text);
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MAX_MS - 1);
    expect(alone.rebuilt).toEqual([]);
    await vi.advanceTimersByTimeAsync(1);
    expect(alone.rebuilt).toHaveLength(1);
  });

  it('does not wait for a second phone when the checkpoint went to this phone alone', async () => {
    const w = world();
    const solo = checkpoint((d) => {
      d.players[1].connected = false;
    });
    void w.restorer.offer('ABCD', solo.token, solo.text);
    await vi.advanceTimersByTimeAsync(RESTORE_WINDOW_MS);
    expect(w.rebuilt).toHaveLength(1);
  });

  it('says whether a lost room may still come back: checkpoints on, a recent start, and the code not deleted here', () => {
    const w = world();
    expect(w.restorer.mayRestore('ABCD')).toBe(true);
    w.restorer.remember('ABCD', Date.now());
    expect(w.restorer.mayRestore('ABCD')).toBe(false);
    expect(w.restorer.mayRestore('WXYZ')).toBe(true);
    // Every checkpoint issued before this process started has expired by now.
    vi.advanceTimersByTime(CHECKPOINT_MAX_AGE_MS);
    expect(w.restorer.mayRestore('WXYZ')).toBe(false);
    const off = new Restorer({ key: null, clock: { now: () => Date.now() }, rebuild: () => true, isLive: () => false });
    expect(off.mayRestore('WXYZ')).toBe(false);
  });

  it('refuses everything without a key', () => {
    const restorer = new Restorer({ key: null, clock: { now: () => Date.now() }, rebuild: () => true, isLive: () => false });
    const cp = checkpoint();
    expect(restorer.offer('ABCD', cp.token, cp.text)).toMatchObject({ ok: false });
  });
});
