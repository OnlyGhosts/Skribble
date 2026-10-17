import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { usePlatformStore } = await import('../store/usePlatformStore');
const { NOTICE_DELAY_MS, noticeFor, startConnectionNotice, useConnectionNotice } = await import('./connectionNotice');

const shown = () => useConnectionNotice.getState().notice;

describe('the connection notice', () => {
  let stop: () => void = () => {};

  beforeEach(() => {
    vi.useFakeTimers();
    usePlatformStore.setState({ connection: 'connected', slow: false, room: null });
    stop = startConnectionNotice();
  });

  afterEach(() => {
    stop();
    vi.useRealTimers();
  });

  it('waits about 2 s before it shows, and goes the moment the connection is back', () => {
    expect(NOTICE_DELAY_MS).toBe(2000);
    usePlatformStore.getState().setConnection('reconnecting');
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(NOTICE_DELAY_MS - 100);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(100);
    expect(shown()).toMatchObject({ status: 'reconnecting', title: 'Reconnecting…' });
    usePlatformStore.getState().setConnection('connected');
    expect(shown()).toBeNull();
  });

  it('never shows for a drop shorter than the wait, and starts the wait afresh on the next one', () => {
    usePlatformStore.getState().setConnection('reconnecting');
    vi.advanceTimersByTime(1500);
    usePlatformStore.getState().setConnection('connected');
    vi.advanceTimersByTime(5000);
    expect(shown()).toBeNull();
    usePlatformStore.getState().setConnection('reconnecting');
    vi.advanceTimersByTime(1500);
    expect(shown()).toBeNull();
    vi.advanceTimersByTime(500);
    expect(shown()?.status).toBe('reconnecting');
  });

  it('keeps one wait across failed attempts (connecting, then reconnecting, while still down)', () => {
    usePlatformStore.getState().setConnection('connecting');
    vi.advanceTimersByTime(1000);
    usePlatformStore.getState().setConnection('reconnecting');
    vi.advanceTimersByTime(1000);
    expect(shown()?.title).toBe('Reconnecting…');
  });

  it('shows a server gone quiet at once (that wait was already served) and hides it when the server answers', () => {
    usePlatformStore.getState().setSlow(true);
    expect(shown()?.status).toBe('slow');
    usePlatformStore.getState().setSlow(false);
    expect(shown()).toBeNull();
  });

  it('shows a server restart at once (the server said so) and keeps showing it until the seat is back', () => {
    usePlatformStore.getState().setConnection('restarting');
    expect(shown()).toMatchObject({ status: 'restarting', title: 'The server is restarting.', detail: 'Your game will carry on.' });
    // The socket reopens while the room is still on its way back: still a restart, not "connected".
    usePlatformStore.getState().setConnection('restarting');
    vi.advanceTimersByTime(NOTICE_DELAY_MS * 3);
    expect(shown()?.status).toBe('restarting');
    usePlatformStore.getState().setConnection('connected');
    expect(shown()).toBeNull();
  });

  it('says plainly what is happening, and that the seat is kept inside a room', () => {
    expect(noticeFor('connected', false, true)).toBeNull();
    expect(noticeFor('connecting', false, false)).toEqual({ status: 'connecting', title: 'Connecting…', detail: null });
    expect(noticeFor('reconnecting', false, false)?.detail).toBeNull();
    expect(noticeFor('reconnecting', false, true)?.detail).toBe('Your place in the room is kept.');
    expect(noticeFor('connected', true, true)?.title).toBe('Waiting for the server…');
    for (const status of ['connecting', 'reconnecting', 'restarting', 'connected'] as const) {
      const notice = noticeFor(status, true, true);
      expect(`${notice?.title ?? ''} ${notice?.detail ?? ''}`).not.toMatch(/[—']/);
    }
  });
});
