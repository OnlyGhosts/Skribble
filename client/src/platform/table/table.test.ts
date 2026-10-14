/**
 * The card-table pieces Blackjack and Poker share: the animation queue (planning from a previous
 * timeline, the discards before a new table, the backlog snap, shown numbers stepping to the
 * truth, departures, marks, flights), the desktop shortcuts, and the components (the panel shell,
 * the amount field, the moves, the seat strip, the deck, the ribbon, the outcome pieces, a card
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
const { MoveButton, PanelLabelRow, PanelMoves, PanelShell } = await import('./ControlPanel');
const { MiniSeat, SeatStrip } = await import('./SeatStrip');
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

  it('the seat strip: a mini seat with its line, the turn lit, a dimmed seat, a badge and data for the tests', () => {
    const avatar = { color: 1, emoji: 2 };
    const out = html(
      createElement(SeatStrip, {
        turnId: 'p1',
        label: 'Other players',
        children: [
        createElement(MiniSeat, { key: 'p1', playerId: 'p1', name: 'Pia', avatar, connected: true, chips: 980, line: { state: 'turn', text: 'Thinking', tone: 'turn' }, turn: true, badge: createElement('b', { key: 'd' }, 'D'), data: { 'data-bet': 20 } }),
        createElement(MiniSeat, { key: 'p2', playerId: 'p2', name: 'Quinn', avatar, connected: false, chips: 0, line: { state: 'out', text: 'Out', tone: 'bad' }, turn: false, dimmed: true }),
        ],
      }),
    );
    expect(out).toMatch(/<ul class="tbl-seats" aria-label="Other players" data-testid="seats">/);
    expect(out).toMatch(/class="tbl-seat tbl-seat--turn"[^>]*data-player-id="p1"[^>]*data-turn="true" aria-current="true" data-bet="20"/);
    expect(out).toContain('tbl-seat__name-row');
    expect(out).toContain('tbl-seat__line--turn');
    expect(out).toMatch(/class="tbl-seat tbl-seat--dim"[^>]*data-player-id="p2"/);
    expect(out).toContain('data-table-anchor="seat:p1"');
    expect(out).toContain('avatar--dimmed');
  });

  it('the deck and the discards, the ribbon, the pill, the outline and the payout', () => {
    expect(html(createElement(Deck, { remaining: 268, name: 'shoe', testId: 'shoe' }))).toMatch(/data-testid="shoe" data-remaining="268" aria-label="268 cards in the shoe"[\s\S]*data-table-deck=""[\s\S]*268</);
    expect(html(createElement(Deck, { remaining: 312, note: 'New shoe', name: 'shoe', testId: 'shoe' }))).toContain('New shoe');
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
