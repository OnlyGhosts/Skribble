import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SCHEDULE_SLACK_MS, createSoundSchedule } from './schedule';

describe('createSoundSchedule', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('plays each sound at its moment, a just-missed one at once, and skips one long gone', () => {
    const now = Date.now();
    const schedule = createSoundSchedule();
    const played: string[] = [];
    schedule.at(now + 300, () => played.push('later'));
    schedule.at(now - SCHEDULE_SLACK_MS / 2, () => played.push('just missed'));
    schedule.at(now - SCHEDULE_SLACK_MS * 3, () => played.push('long gone'));
    vi.advanceTimersByTime(0);
    expect(played).toEqual(['just missed']);
    vi.advanceTimersByTime(299);
    expect(played).toEqual(['just missed']);
    vi.advanceTimersByTime(1);
    expect(played).toEqual(['just missed', 'later']);
  });

  it('drops everything pending on clear', () => {
    const schedule = createSoundSchedule();
    const play = vi.fn();
    schedule.at(Date.now() + 100, play);
    schedule.clear();
    vi.advanceTimersByTime(500);
    expect(play).not.toHaveBeenCalled();
  });
});
