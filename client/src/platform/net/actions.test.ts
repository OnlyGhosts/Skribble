import { afterEach, describe, expect, it, vi } from 'vitest';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { socket } = await import('./socket');
const { countMeIn } = await import('./actions');

afterEach(() => vi.restoreAllMocks());

describe('Count me in', () => {
  it('comes back in and readies in one tap, in that order on the one socket', () => {
    const send = vi.spyOn(socket, 'send').mockReturnValue(true);
    countMeIn(false);
    expect(send.mock.calls.map(([msg]) => msg)).toEqual([
      { t: 'sitOut', sitOut: false },
      { t: 'ready', ready: true },
    ]);
  });

  it('only brings the host back in: pressing Start readies them', () => {
    const send = vi.spyOn(socket, 'send').mockReturnValue(true);
    countMeIn(true);
    expect(send.mock.calls.map(([msg]) => msg)).toEqual([{ t: 'sitOut', sitOut: false }]);
  });
});
