/**
 * The card-game pieces games share (Blackjack and Poker): the CSS playing card, the chip count
 * and the chip amount setting, plus the chip formatting helpers.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../../test/env';

installBrowserGlobals();

const { PlayingCard, cardName } = await import('./PlayingCard');
const { Chips } = await import('./Chips');
const { ChipsSetting } = await import('./ChipsSetting');
const { formatChips, parseChipAmount } = await import('../lib/format');

describe('PlayingCard', () => {
  it('renders a face-up card with its rank, suit and accessible name, red for hearts and diamonds', () => {
    const queen = renderToString(createElement(PlayingCard, { card: { rank: 'Q', suit: 'H' }, size: 'lg', testId: 'c' }));
    expect(queen).toContain('data-face="up"');
    expect(queen).toContain('data-rank="Q"');
    expect(queen).toContain('data-suit="H"');
    expect(queen).toContain('aria-label="queen of hearts"');
    expect(queen).toContain('playing-card--red');
    expect(queen).toContain('playing-card--lg');
    const ten = renderToString(createElement(PlayingCard, { card: { rank: '10', suit: 'C' }, highlight: true }));
    expect(ten).not.toContain('playing-card--red');
    expect(ten).toContain('playing-card--highlight');
    expect(cardName({ rank: 'A', suit: 'S' })).toBe('ace of spades');
    expect(cardName({ rank: '7', suit: 'D' })).toBe('7 of diamonds');
  });

  it('puts one big rank and one big suit at the top left, and nothing else on the face', () => {
    const ten = renderToString(createElement(PlayingCard, { card: { rank: '10', suit: 'H' }, testId: 'c' }));
    expect(ten).toContain('<span class="playing-card__corner" aria-hidden="true"><span class="playing-card__rank playing-card__rank--wide">10</span><span class="playing-card__suit">♥</span></span>');
    expect(ten.match(/♥/g)).toHaveLength(1);
    expect(ten).not.toContain('playing-card__pip');
    expect(ten).not.toContain('corner--flip');
    const css = readFileSync(fileURLToPath(new URL('../styles/cards.css', import.meta.url)), 'utf8');
    // Sized from the card's width, so they read at every size a table uses.
    expect(css).toMatch(/\.playing-card__rank \{\s*font-size: calc\(var\(--card-w\) \* 0\.4\);/);
    expect(css).toMatch(/\.playing-card__suit \{[^}]*font-size: calc\(var\(--card-w\) \* 0\.38\);/);
  });

  it('backs every face-down card with the boredgames back: a cream border, the lime field and lattice, the phones medallion', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/cards.css', import.meta.url)), 'utf8');
    expect(css).toMatch(/\.playing-card--down \{\s*background: var\(--card-back-border\);/);
    expect(css).toMatch(/\.playing-card__back \{[^}]*background-color: var\(--card-back-field\);[^}]*background-image: var\(--card-back-mark\), var\(--card-back-lattice\);/);
    // Vector art only, drawn point-symmetric: the second phone is the first turned half way round.
    const mark = css.match(/--card-back-mark: url\("data:image\/svg\+xml,([^"]*)"\);/)?.[1] ?? '';
    expect(mark).toContain("translate(37 50) rotate(-12)");
    expect(mark).toContain("translate(63 50) rotate(168)");
    expect(css).toMatch(/--card-back-lattice: url\("data:image\/svg\+xml,/);
  });

  it('keeps a face-down card and an empty slot free of any rank or suit', () => {
    for (const props of [{ card: null }, { card: null, slot: true }]) {
      const html = renderToString(createElement(PlayingCard, props));
      expect(html).toContain('data-face="down"');
      expect(html).not.toContain('data-rank');
      expect(html).not.toContain('data-suit');
      expect(html).not.toMatch(/[♠♥♦♣]/);
    }
    expect(renderToString(createElement(PlayingCard, { card: null, slot: true }))).toContain('playing-card--slot');
  });

  it('styles cards only with tokens and the fixed white face, without gradients or glow', () => {
    const css = readFileSync(fileURLToPath(new URL('../styles/cards.css', import.meta.url)), 'utf8');
    expect(css).not.toMatch(/gradient|box-shadow|filter:/);
    expect(css).toContain('.playing-card--xl');
    expect(css).toContain('.chip-count');
  });
});

describe('chips', () => {
  it('formats and parses chip amounts', () => {
    expect(formatChips(1500)).toBe('1,500');
    expect(formatChips(0)).toBe('0');
    expect(parseChipAmount('2500', 100, 100000)).toBe(2500);
    expect(parseChipAmount('7', 100, 100000)).toBe(100);
    expect(parseChipAmount('', 100, 100000)).toBeNull();
    expect(parseChipAmount('abc', 100, 100000)).toBeNull();
  });

  it('renders a chip count with its value as data', () => {
    const html = renderToString(createElement(Chips, { value: 12500, testId: 'stack' }));
    expect(html).toContain('data-chips="12500"');
    expect(html).toContain('12,500');
    expect(html).toContain('chip-count__coin');
  });

  it('gives the host presets and a numeric field that holds the value', () => {
    const props = { id: 'stake', label: 'Stake', value: 50, min: 10, max: 500, presets: [10, 50, 100], onCommit: () => undefined };
    const editor = renderToString(createElement(ChipsSetting, props));
    expect(editor).toMatch(/data-testid="settings-stake"[^>]*|type="number"[^>]*data-testid="settings-stake"/);
    expect(editor).toContain('inputMode="numeric"');
    expect(editor).toMatch(/aria-pressed="true"[^>]*data-testid="settings-stake-50"/);
    expect(editor).toMatch(/aria-pressed="false"[^>]*data-testid="settings-stake-10"/);
    expect(editor).toContain('value="50"');
    expect(editor).not.toContain('settings-value-stake');
  });
});
