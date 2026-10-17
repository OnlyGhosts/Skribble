import { describe, expect, it } from 'vitest';
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { installBrowserGlobals } from '../test/env';

installBrowserGlobals();

const { GAMES } = await import('./index');
const { GAME_LIST, gameById } = await import('@shared/platform/games');
const { rulesSections } = await import('../platform/lib/rules');
const { RulesCard } = await import('../platform/components/HowToPlay');
const { CHOOSE_TIME_SECONDS } = await import('@shared/games/scribble/constants');
const { SCRIBBLE_DRAW_SECONDS } = await import('@shared/games/scribble/protocol');
const { SPYGAME_ROUND_MINUTES, SPYGAME_POINTS, SPYGAME_VOTE_SECONDS } = await import('@shared/games/spygame/protocol');
const { QUIPGAME_POINTS, QUIPGAME_WRITE_SECONDS } = await import('@shared/games/quipgame/protocol');
const { DEALER_STANDS_AT, NATURAL_PAYOUT, naturalWinnings } = await import('@shared/games/blackjack/cards');
const { POKER_ACT_SECONDS } = await import('@shared/games/poker/protocol');

/** The rules the card reads: the summary and the five sections, in reading order. */
function copyOf(gameId: keyof typeof GAMES): string[] {
  const rules = GAMES[gameId].rules;
  return [rules.summary, ...rulesSections(rules).map((s) => s.text)];
}

const words = (text: string) => text.split(/\s+/).filter(Boolean).length;
const live = GAME_LIST.filter((g) => g.status === 'live');

describe('every game’s How to play', () => {
  it('has a summary and the five sections, each with something to say, in the order the card shows them', () => {
    for (const g of GAME_LIST) {
      const rules = GAMES[g.id].rules;
      expect(rules.summary.trim().length, g.id).toBeGreaterThan(0);
      const sections = rulesSections(rules);
      expect(sections.map((s) => s.key)).toEqual(['round', 'scoring', 'end', 'settings', 'watchers']);
      for (const s of sections) expect(s.text.trim().length, `${g.id} ${s.key}`).toBeGreaterThan(0);
      expect(sections.map((s) => s.heading)).toEqual([rules.unit === 'hand' ? 'How a hand goes' : 'How a round goes', 'How you score', 'How it ends', 'What the settings change', 'Watching']);
      // Everyone who joins mid-game watches: every game says so.
      expect(rules.watchers).toContain('Join mid-game and you watch until the next game.');
    }
    // The card tables deal hands; the others play rounds.
    expect(GAMES.blackjack.rules.unit).toBe('hand');
    expect(GAMES.poker.rules.unit).toBe('hand');
    expect(GAMES.scribble.rules.unit).toBeUndefined();
  });

  it('keeps each live game under about 140 words, in short plain copy: no dashes, curly apostrophes, British spelling', () => {
    for (const g of live) {
      const copy = copyOf(g.id);
      expect(copy.reduce((n, text) => n + words(text), 0), `${g.id} word count`).toBeLessThanOrEqual(140);
      for (const text of copy) {
        expect(text, g.id).not.toMatch(/[—–]/);
        expect(text, g.id).not.toContain("'");
        expect(text, g.id).not.toMatch(/\s{2,}/);
        expect(text.trim(), g.id).toMatch(/[.!?)]$/);
        expect(text, g.id).not.toMatch(/favorite|color|center|customiz/i);
      }
    }
  });

  it('takes every number from the game’s shared constants, so the copy cannot drift from the server', () => {
    expect(GAMES.scribble.rules.round).toContain(`${CHOOSE_TIME_SECONDS} seconds`);
    expect(GAMES.scribble.rules.round).toContain(`${SCRIBBLE_DRAW_SECONDS} seconds`);
    expect(GAMES.scribble.rules.scoring).toContain('400 points');
    expect(GAMES.scribble.rules.scoring).toContain('sliding to 50');
    expect(GAMES.scribble.rules.scoring).toContain('up to 300');
    // The hints setting is capped at half the word's letters (shared/games/scribble/hints.ts).
    expect(GAMES.scribble.rules.settings).toContain('at most half the letters');
    expect(GAMES.spygame.rules.round).toContain(`${SPYGAME_ROUND_MINUTES} minutes`);
    expect(GAMES.spygame.rules.scoring).toContain(`${SPYGAME_POINTS.spyFirstGuess} points (${SPYGAME_POINTS.spySecondGuess} on the second guess)`);
    // The vote: the clock pauses, the accused and the spy do not vote, a missing vote is a No, a tie fails (server/games/spygame/vote.ts).
    expect(GAMES.spygame.rules.round).toContain(`the clock pauses while the other agents vote (${SPYGAME_VOTE_SECONDS} seconds at most; no vote counts as No) and a tie fails`);
    expect(GAMES.quipgame.rules.round).toContain(`${QUIPGAME_WRITE_SECONDS} seconds`);
    expect(GAMES.quipgame.rules.scoring).toContain('1,000 points');
    // The flawless bonus needs 2 or more votes and doubles with the round (shared/games/quipgame/scoring.ts).
    expect(GAMES.quipgame.rules.scoring).toContain(`take every vote, ${QUIPGAME_POINTS.flawlessMinVotes} or more, for ${QUIPGAME_POINTS.flawless} more. Round two pays double, bonus included.`);
    expect(GAMES.quipgame.rules.scoring).toContain('1,500, 1,000 and 500');
    expect(GAMES.blackjack.rules.round).toContain(`draws to ${DEALER_STANDS_AT - 1} and stands on every ${DEALER_STANDS_AT}`);
    expect(GAMES.blackjack.rules.scoring).toContain(`pays ${NATURAL_PAYOUT.wins} to ${NATURAL_PAYOUT.stake}, rounded down`);
    expect(naturalWinnings(2)).toBe(3);
    expect(naturalWinnings(1)).toBe(1);
    // The dealer peeks with an ace or a ten up; double is offered on two cards only; alone, the game ends when the one stack is gone.
    expect(GAMES.blackjack.rules.round).toContain('Ace or ten up, the dealer checks for blackjack, which ends the hand.');
    expect(GAMES.blackjack.rules.round).toContain('double your first two cards for one more');
    expect(GAMES.blackjack.rules.end).toContain('one stack left, or none, or at the host’s word, after the hand');
    // The host's End game ends the point games at once on the scores as they stand.
    for (const id of ['scribble', 'spygame', 'quipgame'] as const) expect(GAMES[id].rules.end, id).toContain('or when the host ends it');
    expect(GAMES.blackjack.rules.settings).toContain('100 to 100,000');
    expect(GAMES.poker.rules.round).toContain(`${POKER_ACT_SECONDS} seconds`);
    expect(GAMES.poker.rules.watchers).toContain(`seats ${gameById('poker').maxPlayers}`);
  });

  it('renders each paragraph with its last two words joined, so no word sits alone on the card’s last line', () => {
    for (const g of GAME_LIST) {
      const html = renderToString(createElement(RulesCard, { meta: g, rules: GAMES[g.id].rules, mode: 'popover' }));
      const paragraphs = [...html.matchAll(/<p class="rules__(?:summary|text)">([^<]*)<\/p>/g)].map((m) => m[1]);
      expect(paragraphs, g.id).toHaveLength(6);
      for (const p of paragraphs) {
        expect(p, `${g.id}: ${p}`).toMatch(/\S \S+$/);
        expect(p.split(' '), g.id).toHaveLength(2);
      }
      expect(html).toContain(`data-game="${g.id}"`);
      expect(html.match(/data-testid="rules-section"/g)).toHaveLength(5);
    }
  });
});
