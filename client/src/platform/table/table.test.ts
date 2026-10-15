/**
 * The card-table pieces Blackjack and Poker share: the animation queue (planning from a previous
 * timeline, the discards before a new table, the backlog snap, shown numbers stepping to the
 * truth, departures, marks, flights), the desktop shortcuts, and the components (the panel shell,
 * the amount field, the moves, the players grid and its tiles, the spotlight, the deck, the ribbon, the outcome pieces, a card
 * turning over, the chips in the air and the screen shell). Runs in node through react-dom/server.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { createElement, type ReactElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';
import type { Draft, Timeline } from './timeline';

installBrowserGlobals();

const T = await import('./timeline');
const { hotkeyOf, typingIn } = await import('../lib/hotkeys');
const { AmountField } = await import('./AmountField');
const { MoveButton, PanelLabelRow, PanelMoves, PanelShell, releaseClickedButton } = await import('./ControlPanel');
const { PlayerTile, PlayersGrid } = await import('./PlayersGrid');
const { Spotlight } = await import('./Spotlight');
const G = await import('./grid');
const { Deck, DiscardTray } = await import('./Deck');
const { TableRibbon } = await import('./Ribbon');
const { PayoutFloat, TotalPill, outlineClass } = await import('./Outcome');
const { TableCard } = await import('./TableCard');
const { ChipFlights } = await import('./ChipFlights');

const NOW = 1_000_000;
const html = (el: ReactElement): string => renderToString(el);
const noop = () => undefined;

interface Toy {
  id: number;
}

describe('the animation queue', () => {
  const input = (over: Partial<Parameters<typeof T.beginPlan<Toy>>[0]> = {}) => ({ prev: T.emptyTimeline<Toy>(), prevTable: null, prevId: null, nextId: 1, now: NOW, fresh: false, motion: true, ...over });

  it('snaps on a fresh entry and under reduced motion, and starts a first table at once', () => {
    expect(T.beginPlan<Toy>(input({ fresh: true }))).toBeNull();
    expect(T.beginPlan<Toy>(input({ motion: false }))).toBeNull();
    const draft = T.beginPlan<Toy>(input());
    expect(draft).toMatchObject({ same: false, start: NOW });
    expect(draft?.tl.id).toBe(1);
  });

  it('carries on the same table after what is still landing, and keeps the previous timeline when nothing was added', () => {
    const prev: Timeline<Toy> = { ...T.snapTimeline<Toy>(1, NOW), arrivals: { a: NOW }, endsAt: NOW + 400 };
    const draft = T.beginPlan<Toy>(input({ prev, prevTable: { id: 1 }, prevId: 1, nextId: 1, now: NOW + 100 }));
    if (!draft) throw new Error('no draft');
    expect(draft).toMatchObject({ same: true, start: NOW + 400 });
    expect(draft.tl.arrivals).toEqual({ a: NOW });
    expect(T.finishPlan(draft, NOW + 400, false)).toBe(prev);
    draft.tl.arrivals.b = NOW + 400;
    expect(T.finishPlan(draft, NOW + 650, true)).toMatchObject({ endsAt: NOW + 650, arrivals: { a: NOW, b: NOW + 400 } });
    // The previous plan's maps are copies: planning on never touches the old timeline.
    expect(prev.arrivals).toEqual({ a: NOW });
  });

  it('clears the old table to the discards once its outcomes have had their moment, and snaps a backlog too long to play', () => {
    const prev: Timeline<Toy> = { ...T.snapTimeline<Toy>(1, NOW), marks: { [T.OUTCOMES]: NOW + 200 }, endsAt: NOW + 200 };
    const draft = T.beginPlan<Toy>(input({ prev, prevTable: { id: 1 }, prevId: 1, nextId: 2, now: NOW + 300 }));
    expect(draft?.tl.discard).toMatchObject({ table: { id: 1 }, from: NOW + 200 + T.OUTCOME_HOLD_MS, until: NOW + 200 + T.OUTCOME_HOLD_MS + T.DISCARD_MS });
    expect(draft?.start).toBe(NOW + 200 + T.OUTCOME_HOLD_MS + T.DISCARD_MS);
    expect(T.beginPlan<Toy>(input({ prev, prevTable: { id: 1 }, prevId: 1, nextId: 2, now: NOW + 300, hold: 0 }))?.start).toBe(NOW + 300 + T.DISCARD_MS);
    const late = { ...prev, endsAt: NOW + T.MAX_BACKLOG_MS + 500 };
    expect(T.beginPlan<Toy>(input({ prev: late, prevTable: { id: 1 }, prevId: 1, nextId: 1, now: NOW }))).toBeNull();
    const tl = T.finishPlan(draft as Draft<Toy>, 0, true);
    expect(T.frameAt(tl, { id: 2 }, NOW + 300)).toMatchObject({ table: { id: 1 }, leaving: false });
    expect(T.frameAt(tl, { id: 2 }, NOW + 200 + T.OUTCOME_HOLD_MS)).toMatchObject({ table: { id: 1 }, leaving: true });
    expect(T.frameAt(tl, { id: 2 }, NOW + 200 + T.OUTCOME_HOLD_MS + T.DISCARD_MS)).toMatchObject({ table: { id: 2 }, leaving: false });
  });

  it('answers where every card is and which numbers show at any moment', () => {
    const tl = T.snapTimeline<Toy>(1, NOW);
    tl.arrivals.a = NOW;
    tl.moved.m = true;
    tl.arrivals.m = NOW;
    tl.flips.a = NOW + 500;
    tl.departures.d = NOW + 100;
    tl.marks.done = NOW + 800;
    tl.flights.push({ id: 'f', from: 'seat:x', to: 'pot', amount: 40, at: NOW + 200, ms: 300 });
    T.tween(tl, 'pot', 10, NOW + 500, 50);
    T.tween(tl, 'pot', 99, NOW + 900, 0);
    tl.endsAt = NOW + 900;
    expect(T.cardShown(tl, 'a', NOW - 1)).toBe(false);
    expect(T.cardShown(tl, 'never-planned', NOW - 1)).toBe(true);
    expect(T.cardMotion(tl, 'a', NOW + 10)).toBe('deal');
    expect(T.cardMotion(tl, 'm', NOW + 10)).toBe('move');
    expect(T.cardMotion(tl, 'a', NOW + T.DEAL_MS)).toBeNull();
    // A card counts towards a total once it lands: a deal after DEAL_MS, a move after MOVE_MS.
    expect(T.landed(tl, 'a', NOW + T.DEAL_MS - 1)).toBe(false);
    expect(T.landed(tl, 'a', NOW + T.DEAL_MS)).toBe(true);
    expect(T.landed(tl, 'm', NOW + T.MOVE_MS)).toBe(true);
    expect(T.landed(tl, 'never-planned', NOW - 1)).toBe(true);
    expect(T.faceDown(tl, 'a', NOW + 499)).toBe(true);
    expect(T.flipping(tl, 'a', NOW + 500)).toBe(true);
    expect(T.flipping(tl, 'a', NOW + 500 + T.FLIP_MS)).toBe(false);
    expect(T.departure(tl, 'd', NOW)).toBe('here');
    expect(T.departure(tl, 'd', NOW + 100)).toBe('leaving');
    expect(T.departure(tl, 'd', NOW + 100 + T.DISCARD_MS)).toBe('gone');
    expect(T.departure(tl, 'other', NOW)).toBe('gone');
    expect(T.reached(tl, 'done', NOW + 799)).toBe(false);
    expect(T.reached(tl, 'unplanned', NOW)).toBe(true);
    expect(T.flightsAt(tl, NOW + 199)).toEqual([]);
    expect(T.flightsAt(tl, NOW + 200).map((f) => f.id)).toEqual(['f']);
    expect(T.flightsAt(tl, NOW + 500)).toEqual([]);
    expect(T.valueAt(tl, 'pot', 0, NOW)).toBe(10);
    expect(T.valueAt(tl, 'pot', 0, NOW + 500)).toBe(50);
    expect(T.valueAt(tl, 'pot', 0, NOW + 900)).toBe(0);
    expect(T.valueAt(tl, 'unplanned', 7, NOW)).toBe(7);
    expect(T.animating(tl, NOW + 899)).toBe(true);
    expect(T.nextEvent(tl, NOW + 10)).toBe(NOW + 100);
    expect(T.nextEvent(tl, NOW + 900)).toBeNull();
  });
});

describe('the players grid', () => {
  it('steps the tiles down in tiers as the table grows: full to 4 others, compact to 9, small to 23, dense beyond', () => {
    const tiers = [1, 4, 5, 9, 10, 23, 24, 49].map((n) => G.tileTier(n));
    expect(tiers).toEqual(['full', 'full', 'compact', 'compact', 'small', 'small', 'dense', 'dense']);
  });

  it('starts from the tier\'s usual columns before the grid is measured (and on the server render)', () => {
    expect([1, 2, 3, 4].map((n) => G.fitGrid(n, null).cols)).toEqual([1, 2, 3, 4]);
    // Compact: two rows. Small: 4 to 6 columns. Dense: 6 to 8.
    expect([5, 6, 7, 9].map((n) => G.fitGrid(n, null).cols)).toEqual([3, 3, 4, 5]);
    expect([10, 12, 13, 18, 23].map((n) => G.fitGrid(n, null).cols)).toEqual([4, 4, 5, 6, 6]);
    expect([24, 36, 42, 49].map((n) => G.fitGrid(n, null).cols)).toEqual([6, 6, 7, 8]);
    expect(G.fitGrid(49, null)).toEqual({ cols: 8, rows: 7 });
  });

  it('fits the columns to the space: tiles at their natural size keep the usual shape, a short grid spreads wider', () => {
    // Room to spare: the usual shape.
    expect(G.fitGrid(6, { width: 374, height: 200 })).toEqual({ cols: 3, rows: 2 });
    expect(G.fitGrid(12, { width: 374, height: 170 }, { gap: 4 })).toEqual({ cols: 4, rows: 3 });
    // Two others share one row however tall the grid is.
    expect(G.fitGrid(2, { width: 374, height: 400 }).cols).toBe(2);
    // A short grid: 49 small chips spread to more columns rather than shrink to nothing.
    const short = G.fitGrid(49, { width: 304, height: 90 }, { gap: 4 });
    expect(short.cols).toBeGreaterThan(8);
    expect(short.cols * short.rows).toBeGreaterThanOrEqual(49);
    expect(G.tileScale(49, short.cols, { width: 304, height: 90 }, G.TIER_SHAPES.dense, 4)).toBeGreaterThan(G.tileScale(49, 8, { width: 304, height: 90 }, G.TIER_SHAPES.dense, 4));
    // Every fit holds every tile.
    for (const n of [1, 3, 5, 8, 11, 17, 23, 24, 31, 49]) {
      const fit = G.fitGrid(n, { width: 340, height: 140 }, { gap: 4 });
      expect(fit.cols * fit.rows, `${n} tiles`).toBeGreaterThanOrEqual(n);
      expect((fit.cols - 1) * fit.rows, `${n} tiles, no empty row`).toBeLessThan(n + fit.rows);
    }
  });

  it('packs a table tight on a short phone, on a shorter phone from five others, and anywhere (a desktop too) from ten', async () => {
    const { isTight } = await import('./stage');
    expect(isTight(true, true, 1)).toBe(true);
    expect(isTight(true, false, 9)).toBe(false);
    // 360x740 with five to nine others: the compact tiles used to be squeezed into 60px slivers.
    expect(isTight(true, false, 5, true)).toBe(true);
    expect(isTight(true, false, 4, true)).toBe(false);
    expect(isTight(true, false, 10)).toBe(true);
    expect(isTight(true, false, 49)).toBe(true);
    // A desktop with 23 or 49 others gave its grid 14px tiles under a mostly empty spotlight.
    expect(isTight(false, false, 23)).toBe(true);
    expect(isTight(false, false, 49)).toBe(true);
    expect(isTight(false, true, 9)).toBe(false);
  });

  it('never spreads tiles narrower than they read: names, totals and the Playing tag stay whole', () => {
    // Six players on a 360x740 phone, a short grid: five 60px columns read "Har", "Pl"; now never under 64px.
    const fit = G.fitGrid(5, { width: 326, height: 57 });
    expect((326 - (fit.cols - 1) * 6) / fit.cols).toBeGreaterThanOrEqual(G.TIER_SHAPES.compact.minWidth);
    expect(fit.cols).toBeLessThanOrEqual(4);
    // Every tier, every box: the columns keep the tier's minimum width (one column at the least).
    for (const wide of [false, true]) {
      const shapes = wide ? G.WIDE_TIER_SHAPES : G.TIER_SHAPES;
      for (const n of [3, 5, 8, 12, 23, 30, 49])
        for (const box of [{ width: 290, height: 40 }, { width: 326, height: 57 }, { width: 356, height: 300 }, { width: 582, height: 90 }, { width: 742, height: 418 }]) {
          const { cols } = G.fitGrid(n, box, { wide, gap: 4 });
          const min = shapes[G.tileTier(n)].minWidth;
          if (cols > 1) expect((box.width - (cols - 1) * 4) / cols, `${n} tiles in ${box.width}x${box.height}${wide ? ' (desktop)' : ''}`).toBeGreaterThanOrEqual(min);
        }
    }
    // A 1280x800 desktop with 49 others: 13 columns of 41px used to leave the tiles 14px tall.
    expect(G.fitGrid(49, { width: 582, height: 318 }, { wide: true, gap: 8 }).cols).toBeLessThanOrEqual(G.WIDE_TIER_SHAPES.dense.maxCols);
    expect(G.WIDE_TIER_SHAPES.dense.maxCols).toBeLessThanOrEqual(12);
  });

  it('keeps a small tile\'s total inside it on the narrowest phones: a badge on its corner, never cut to one digit', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    const narrow = css.slice(css.indexOf('@container tile (max-width: 56px)'));
    const block = narrow.slice(0, narrow.indexOf('\n}\n'));
    expect(block).toMatch(/\.tbl-tile--small \.tbl-tile__total \{\s*position: absolute;\s*top: 1px;\s*right: 1px;/);
    // The avatar shrinks with a short tile rather than overflow it.
    expect(css).toMatch(/\.tbl-tile--small \{\s*\/\*[^*]*\*\/\s*--face: min\(24px, max\(16px, calc\(100cqh - 19px\)\)\);/);
  });

  it('never cuts a short name in the spotlight label: "Ada\'s turn", not "A…\'s turn"', () => {
    const css = readFileSync(join(import.meta.dirname, '../styles/table.css'), 'utf8');
    // One rule for the name (a later one used to reset the minimum to 0), and a short name never shrinks.
    expect(css.match(/\n\.tbl-spot__name \{/g)).toHaveLength(1);
    expect(css).toMatch(/\n\.tbl-spot__name \{\s*min-width: min\(5ch, 100%\);/);
    expect(css).toMatch(/\.tbl-spot__name--short \{\s*flex: none;/);
    const avatar = { color: 1, emoji: 2 };
    const label = (name: string) => html(createElement(Spotlight, { subject: 't', kind: 'turn', tone: 'active', who: { id: 'p', name, avatar, connected: true }, label: `${name}'s turn`, clock: null }));
    expect(label('Ada')).toContain('tbl-spot__name tbl-spot__name--short">Ada<');
    expect(label('Christopher')).toContain('class="tbl-spot__name">Christopher<');
  });

  it('keeps the space after the name: a flex row drops it at the start of a span ("Piawins 40")', () => {
    const avatar = { color: 1, emoji: 2 };
    const out = html(createElement(Spotlight, { subject: 'r', kind: 'result', tone: 'win', who: { id: 'p', name: 'Pia', avatar, connected: true }, label: 'Pia wins 40', clock: null }));
    expect(out).toContain('tbl-spot__name tbl-spot__name--short">Pia<');
    expect(out).toContain('class="tbl-spot__rest"> wins 40<');
  });

  it('lifts the ends of a desktop row less as the tiles get smaller (the arc costs height)', () => {
    const grid = (n: number) => html(createElement(PlayersGrid, { count: n, label: 'Players', wide: true, children: [] }));
    expect(grid(3)).toContain('--arc:16px');
    expect(grid(12)).toContain('--arc:8px');
    expect(grid(30)).toContain('--arc:4px');
  });

  it('bows the desktop rows into a gentle arc: the middle lowest, the ends lifted', () => {
    expect([0, 1, 2, 3, 4].map((c) => G.arcLift(c, 5))).toEqual([1, 0.25, 0, 0.25, 1]);
    expect(G.arcLift(0, 1)).toBe(0);
  });
});

describe('desktop shortcuts', () => {
  const key = (k: string, over: Partial<Parameters<typeof hotkeyOf>[0]> = {}) => hotkeyOf({ key: k, repeat: false, altKey: false, ctrlKey: false, metaKey: false, target: null, ...over });

  it('names a letter or Space, and leaves typing, repeats, modified keys and a focused button alone', () => {
    expect(key('h')).toBe('H');
    expect(key(' ')).toBe('Space');
    expect(key('Enter')).toBeNull();
    expect(key('h', { repeat: true })).toBeNull();
    expect(key('h', { ctrlKey: true })).toBeNull();
    const input = { tagName: 'INPUT' } as unknown as EventTarget;
    expect(typingIn(input)).toBe(true);
    expect(key('h', { target: input })).toBeNull();
    expect(typingIn({ tagName: 'DIV', isContentEditable: true } as unknown as EventTarget)).toBe(true);
    const button = { tagName: 'BUTTON', closest: (s: string) => (s.includes('button') ? {} : null) } as unknown as EventTarget;
    expect(key(' ', { target: button })).toBeNull();
    expect(key('h', { target: button })).toBe('H');
  });

  it('lets a panel button clicked with the mouse let go of the focus (click MAX, then Space bets), not one pressed from the keyboard', () => {
    let blurred = 0;
    const button = { closest: (sel: string) => (sel === 'button' ? { blur: () => void (blurred += 1) } : null) } as unknown as EventTarget;
    releaseClickedButton({ detail: 1, target: button });
    expect(blurred).toBe(1);
    releaseClickedButton({ detail: 0, target: button });
    expect(blurred).toBe(1);
    releaseClickedButton({ detail: 1, target: null });
    expect(blurred).toBe(1);
  });
});

describe('the components', () => {
  it('the panel shell: the status line, the label row with the balance, the amount with its joined steps, the moves and the hint', () => {
    const out = html(
      createElement(PanelShell, {
        label: 'Play',
        status: { state: 'my-turn', text: 'Your turn', tone: 'go' },
        onSubmit: noop,
        testId: 'panel',
        data: { 'data-amount': 40 },
        hint: 'H hit',
        children: [
        createElement(PanelLabelRow, { key: 'l', label: 'Bet amount', htmlFor: 'amt', balance: 960, truth: 1000 }),
        createElement(AmountField, {
          key: 'a',
          id: 'amt',
          value: '40',
          enabled: true,
          onChange: noop,
          onClear: noop,
          steps: [
            { label: '1/2', ariaLabel: 'Half', testId: 'half', onClick: noop },
            { label: 'MAX', ariaLabel: 'Max', testId: 'max', onClick: noop, pressed: true },
          ],
          inputTestId: 'amount',
          clearTestId: 'clear',
        }),
        createElement(PanelMoves, { key: 'm', children: [createElement(MoveButton, { key: 'h', label: 'Hit', testId: 'hit', enabled: true, onClick: noop, primary: true, hotkey: 'H' }), createElement(MoveButton, { key: 's', label: 'Stand', testId: 'stand', enabled: false, onClick: noop })] }),
        ],
      }),
    );
    expect(out).toMatch(/<form[^>]*data-testid="panel"[^>]*data-amount="40"/);
    expect(out).toContain('tbl-panel__status--go');
    expect(out).toMatch(/data-testid="turn-status" data-state="my-turn"/);
    expect(out).toMatch(/data-testid="my-chips" data-chips="1000" aria-label="Balance 960 chips"/);
    expect(out).toMatch(/<input[^>]*inputMode="numeric"[^>]*value="40"/);
    expect(out).toContain('data-testid="clear"');
    expect(out).toMatch(/aria-pressed="true" data-testid="max"/);
    expect(out).toMatch(/class="btn btn--primary tbl-move"[^>]*aria-keyshortcuts="H" data-testid="hit"/);
    expect(out).toMatch(/disabled=""[^>]*data-testid="stand"/);
    expect(out).toContain('data-testid="hotkey-hint"');
    // A field that is off has no clear button and dims its steps.
    const off = html(createElement(AmountField, { id: 'x', value: '40', enabled: false, onChange: noop, onClear: noop, steps: [{ label: 'MAX', ariaLabel: 'Max', testId: 'max', onClick: noop }], inputTestId: 'amount', clearTestId: 'clear' }));
    expect(off).not.toContain('data-testid="clear"');
    expect(off).toContain('is-off');
    expect(off).toMatch(/disabled=""[^>]*data-testid="max"/);
  });

  it('the players grid: tiles in seat order with the tier and columns on the grid, the turn ringed and tagged, a dimmed seat, a badge and data for the tests', () => {
    const avatar = { color: 1, emoji: 2 };
    const tile = (id: string, name: string, extra: Record<string, unknown>) =>
      createElement(PlayerTile, { key: id, playerId: id, name, avatar, connected: true, count: 2, turn: false, line: { state: 'waiting', text: 'Waiting', tone: 'quiet' }, mark: 'waiting', ...extra });
    const out = html(
      createElement(PlayersGrid, {
        count: 2,
        label: 'Other players',
        children: [
          tile('p1', 'Pia', { chips: 980, turn: true, line: { state: 'turn', text: 'Thinking', tone: 'turn' }, mark: 'turn', badge: createElement('b', { key: 'd' }, 'D'), data: { 'data-bet': 20 }, onOpen: noop }),
          tile('p2', 'Quinn', { connected: false, chips: 0, line: { state: 'out', text: 'Out', tone: 'bad' }, mark: 'out', dimmed: true }),
        ],
      }),
    );
    expect(out).toMatch(/<ul class="tbl-grid tbl-grid--full"[^>]*aria-label="Other players" data-testid="seats" data-tier="full" data-cols="2" data-count="2">/);
    expect(out.match(/class="tbl-grid__cell"/g)).toHaveLength(2);
    expect(out).toMatch(/class="tbl-tile tbl-tile--full tbl-tile--turn"[^>]*data-player-id="p1"[^>]*data-turn="true" aria-current="true" data-bet="20"/);
    expect(out).toContain('data-testid="seat-playing">Playing<');
    expect(out).toContain('tbl-tile__line--turn');
    expect(out).toMatch(/class="tbl-tile tbl-tile--full tbl-tile--dim"[^>]*data-player-id="p2"/);
    expect(out).toContain('data-table-anchor="seat:p1"');
    expect(out).toContain('avatar--dimmed');
    // Only a tile with a sheet to open is a button.
    expect(out.match(/data-testid="seat-open"/g)).toHaveLength(1);
    expect(out).toContain('aria-label="Pia: Thinking. Show details"');
  });

  it('a tile shows its cards only while the table is small, and an outcome outlines it once settled', () => {
    const avatar = { color: 1, emoji: 2 };
    const props = { playerId: 'p1', name: 'Pia', avatar, connected: true, turn: false, line: { state: 'settled', text: 'Win +40', tone: 'strong' as const }, mark: 'win' as const, outcome: 'win' as const, total: { text: '20', tone: 'win' as const }, cards: createElement('i', null, 'cards') };
    expect(html(createElement(PlayerTile, { ...props, count: 3 }))).toContain('<i>cards</i>');
    const many = html(createElement(PlayerTile, { ...props, count: 12 }));
    expect(many).not.toContain('<i>cards</i>');
    expect(many).toContain('tbl-tile--small tbl-tile--win');
    expect(many).toContain('data-testid="seat-total"');
    expect(html(createElement(PlayerTile, { ...props, count: 30 }))).toContain('tbl-tile--dense');
  });

  it('the spotlight: whose turn it is with their avatar, the label, who is next and the clock, the hand under them', () => {
    const avatar = { color: 1, emoji: 2 };
    const out = html(
      createElement(Spotlight, {
        subject: 'turn:p1',
        kind: 'turn',
        tone: 'active',
        who: { id: 'p1', name: 'Pia', avatar, connected: true },
        label: "Pia's turn",
        next: 'Quinn',
        clock: createElement('span', { 'data-testid': 'timer' }),
        children: createElement('i', null, 'hand'),
      }),
    );
    expect(out).toMatch(/class="tbl-spot tbl-spot--turn tbl-spot--tone-active tbl-spot--stack" aria-label="Spotlight" data-testid="spotlight" data-subject="turn:p1" data-kind="turn" data-player-id="p1"/);
    // A long name gives way before "'s turn" does.
    expect(out).toContain('<span class="tbl-spot__name tbl-spot__name--short">Pia</span><span class="tbl-spot__rest">&#x27;s turn</span>');
    expect(out).toContain('data-testid="spot-next">Next: <!-- -->Quinn');
    expect(out).toContain('data-table-anchor="seat:p1"');
    expect(out).toContain('data-testid="timer"');
    expect(out).toContain('<i>hand</i>');
    // Nothing to follow: no body, no avatar.
    const idle = html(createElement(Spotlight, { subject: 'idle', kind: 'idle', tone: 'neutral', label: 'Game over', clock: null }));
    expect(idle).not.toContain('tbl-spot__body');
    expect(idle).not.toContain('avatar');
  });

  it('the deck and the discards, the ribbon, the pill, the outline and the payout', () => {
    expect(html(createElement(Deck, { remaining: 268, name: 'shoe', testId: 'shoe' }))).toMatch(/data-testid="shoe" data-remaining="268" aria-label="268 cards in the shoe"[\s\S]*data-table-deck=""[\s\S]*268</);
    // An endless deck: the stack and no count.
    const endless = html(createElement(Deck, { name: 'shoe', testId: 'shoe' }));
    expect(endless).toMatch(/data-testid="shoe" aria-label="The shoe"[\s\S]*data-table-deck=""/);
    expect(endless).not.toContain('tbl-deck__count');
    expect(html(createElement(DiscardTray, { discarded: 0 }))).not.toContain('tbl-stack');
    expect(html(createElement(DiscardTray, { discarded: 45, label: 'Muck' }))).toMatch(/aria-label="Muck"[\s\S]*data-table-discard=""[\s\S]*tbl-stack__card/);
    expect(html(createElement(TableRibbon, { main: 'BLACKJACK PAYS 3 TO 2', sub: 'DEALER STANDS ON 17' }))).toContain('tbl-ribbon__sub');
    expect(html(createElement(TableRibbon, { main: 'NO LIMIT' }))).not.toContain('tbl-ribbon__sub');
    expect(html(createElement(TotalPill, { tone: 'win', testId: 'pill', children: '21' }))).toBe('<span class="tbl-pill tbl-pill--win" data-testid="pill">21</span>');
    expect(outlineClass('loss')).toBe('tbl-outline tbl-outline--loss');
    expect(html(createElement(PayoutFloat, { text: '+220', tone: 'blackjack' }))).toBe('<span class="tbl-payout tbl-payout--blackjack" aria-hidden="true">+220</span>');
  });

  it('a card: face down without a rank, turning over with its back and face stacked, lifted when it plays', () => {
    const down = html(createElement(TableCard, { card: null, size: 'md', motion: null, leaving: false, testId: 'card' }));
    expect(down).toContain('data-face="down"');
    expect(down).not.toContain('data-rank');
    const turning = html(createElement(TableCard, { card: { rank: 'A', suit: 'S' }, size: 'md', motion: null, leaving: false, flipping: true, highlight: true, testId: 'card' }));
    expect(turning).toMatch(/class="tbl-flip" style="animation-duration:400ms"/);
    expect(turning).toContain('tbl-flip__back');
    expect(turning).toMatch(/playing-card--highlight tbl-flip__front[^>]*data-rank="A"/);
  });

  it('chips in the air: one hidden token per flight until it is placed over its source, nothing without flights', () => {
    expect(html(createElement(ChipFlights, { flights: [] }))).toBe('');
    const out = html(createElement(ChipFlights, { flights: [{ id: 'f1', from: 'seat:p1', to: 'pot', amount: 1200, at: NOW, ms: 300 }] }));
    expect(out).toMatch(/class="tbl-flights" aria-hidden="true"/);
    expect(out).toContain('1,200');
    expect(out).toContain('visibility:hidden');
  });
});

describe('copy', () => {
  it('never shows an em dash in the kit or its stylesheet', () => {
    const files = [...readdirSync(import.meta.dirname).filter((n) => /\.tsx?$/.test(n) && !n.endsWith('.test.ts')).map((n) => join(import.meta.dirname, n)), join(import.meta.dirname, '../styles/table.css'), join(import.meta.dirname, '../lib/hotkeys.ts')];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, 'utf8').includes('\u2014'), file).toBe(false);
  });
});
