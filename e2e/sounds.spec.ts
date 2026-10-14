import { expect, test, type Browser, type Page } from '@playwright/test';
import { SOUND_BUDGET_BYTES, allSoundUrls } from '../client/src/games/sounds';
import { createParty, expectReadyCount, joinByCode, readyAll } from './party';

/**
 * Sound effects: every file the sound registry names is served and the whole set stays within
 * its budget; and with sound on (the default), a Blackjack table between two players loads the
 * platform's sounds after the first tap, the table's only once its screen mounts, really plays
 * them through Web Audio, and never raises a page error.
 */

test('every sound file in the registry is served, and the set stays within budget', async ({ request }) => {
  const urls = allSoundUrls();
  expect(urls.length).toBeGreaterThan(30);
  let total = 0;
  for (const url of urls) {
    const res = await request.get(url);
    expect(res.status(), url).toBe(200);
    expect(res.headers()['content-type'], url).toContain('audio/mpeg');
    total += (await res.body()).length;
  }
  expect(total).toBeLessThanOrEqual(SOUND_BUDGET_BYTES);
});

test('every sound file decodes in the browser', async ({ page }) => {
  await page.goto('/');
  const failures = await page.evaluate(async (urls) => {
    const ctx = new OfflineAudioContext(1, 1, 44100);
    const bad: string[] = [];
    for (const url of urls) {
      try {
        const buffer = await ctx.decodeAudioData(await (await fetch(url)).arrayBuffer());
        if (buffer.duration <= 0 || buffer.duration > 3) bad.push(`${url}: ${buffer.duration}s`);
      } catch (err) {
        bad.push(`${url}: ${String(err)}`);
      }
    }
    return bad;
  }, allSoundUrls());
  expect(failures).toEqual([]);
});

interface Seat {
  page: Page;
  errors: string[];
  /** Every /sounds/ request, with its status, in order. */
  sounds: { path: string; status: number }[];
}

async function seat(browser: Browser, name: string): Promise<Seat> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  const sounds: Seat['sounds'] = [];
  page.on('pageerror', (err) => errors.push(`${name}: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`${name}: ${msg.text()}`);
  });
  page.on('response', (res) => {
    const path = new URL(res.url()).pathname;
    if (path.startsWith('/sounds/')) sounds.push({ path, status: res.status() });
  });
  // Counts the sounds that really start, so the test knows audio played rather than merely loaded.
  await page.addInitScript(() => {
    const w = window as unknown as { __soundsStarted: number };
    w.__soundsStarted = 0;
    const start = AudioBufferSourceNode.prototype.start;
    AudioBufferSourceNode.prototype.start = function (this: AudioBufferSourceNode, ...args: Parameters<AudioBufferSourceNode['start']>) {
      w.__soundsStarted++;
      return start.apply(this, args);
    };
  });
  return { page, errors, sounds };
}

const started = (p: Page) => p.evaluate(() => (window as unknown as { __soundsStarted: number }).__soundsStarted);

test('with sound on, a table loads its sounds when it mounts and plays them without a page error', async ({ browser }) => {
  const host = await seat(browser, 'Hana');
  const guest = await seat(browser, 'Pia');

  const code = await createParty(host.page, 'Hana', 'blackjack');
  await joinByCode(guest.page, 'Pia', code);
  await readyAll([guest.page]);
  await expectReadyCount(host.page, 2);

  // The taps so far loaded the platform's sounds; nothing of the table's until the game is on screen.
  await expect.poll(() => host.sounds.some((s) => s.path === '/sounds/stings/start.mp3')).toBe(true);
  for (const p of [host, guest]) expect(p.sounds.filter((s) => s.path.startsWith('/sounds/table/'))).toEqual([]);

  await host.page.getByTestId('start-game').click();
  for (const p of [host, guest]) {
    await expect(p.page.getByTestId('blackjack-screen')).toHaveAttribute('data-phase', 'betting');
    await expect.poll(() => p.sounds.some((s) => s.path.startsWith('/sounds/table/deal-'))).toBe(true);
  }

  for (const p of [host, guest]) {
    await p.page.getByTestId('place-bet').click();
    await expect(p.page.getByTestId('place-bet')).toBeDisabled();
  }
  // The deal: cards slide in with their sounds on both pages.
  for (const p of [host, guest]) {
    await expect(p.page.getByTestId('blackjack-screen')).not.toHaveAttribute('data-phase', 'betting');
    await expect.poll(() => started(p.page), { timeout: 10_000 }).toBeGreaterThan(2);
  }

  for (const p of [host, guest]) {
    expect(p.sounds.length).toBeGreaterThan(0);
    expect(p.sounds.filter((s) => s.status !== 200 && s.status !== 304)).toEqual([]);
    expect(p.errors).toEqual([]);
  }
  await host.page.context().close();
  await guest.page.context().close();
});
