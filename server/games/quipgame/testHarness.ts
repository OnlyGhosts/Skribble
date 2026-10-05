/** Quip Game's test harness, shared by its test files: reading the state, writing a whole round, voting as the room. */
import type { QuipgameChoice, QuipgameView } from '../../../shared/games/quipgame/protocol.js';
import type { Effect } from '../../platform/engine/effects.js';
import { viewFor } from '../../platform/engine/view.js';
import type { Sim } from '../../platform/engine/testHarness.js';
import type { QuipgameData } from './module.js';
import { currentMatchup, matchupAuthors, type MatchupData } from './state.js';

export const data = (s: Sim): QuipgameData => s.data.game as QuipgameData;

export const view = (s: Sim, viewer: string | null = null): QuipgameView => {
  const game = viewFor(s.data, viewer, s.now).game;
  if (!game) throw new Error('no game');
  return game as QuipgameView;
};

export const score = (s: Sim, id: string): number => s.data.players.find((p) => p.id === id)?.score ?? -1;
export const token = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.token ?? '';
export const nameOf = (s: Sim, id: string): string => s.data.players.find((p) => p.id === id)?.name ?? '?';

export const disconnect = (s: Sim, id: string): void => {
  s.apply({ type: 'connectionClosed', playerId: id, connectionId: `conn-${nameOf(s, id)}` });
};
export const reconnect = (s: Sim, id: string): void => {
  s.apply({ type: 'rejoin', token: token(s, id), connectionId: `conn-${nameOf(s, id)}-2` });
};

/** The error messages a set of effects carries. */
export const errors = (effects: Effect[]): string[] =>
  effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'error' ? [(e.msg as { message: string }).message] : []));

export const errorCodes = (effects: Effect[]): string[] =>
  effects.flatMap((e) => (e.type === 'send' && e.msg.t === 'error' ? [(e.msg as { code: string }).code] : []));

export function matchup(s: Sim): MatchupData {
  const m = currentMatchup(data(s));
  if (!m) throw new Error('no matchup');
  return m;
}

/** The current matchup's authors in A/B order. */
export const authors = (s: Sim): string[] => matchupAuthors(data(s), matchup(s));

/** Seated, connected non-authors in join order. */
export const voters = (s: Sim): string[] => s.data.players.filter((p) => p.connected && !authors(s).includes(p.id)).map((p) => p.id);

/** A player's answer text in tests: who wrote it and to which prompt, so results can be checked by text. */
export const answerText = (s: Sim, id: string, promptId: string): string => `${nameOf(s, id)} on ${promptId}`;

/** Every round player (but `except`) answers all of their prompts. */
export function writeAll(s: Sim, except: string[] = []): void {
  for (const id of data(s).roundPlayers) {
    if (except.includes(id) || !s.data.players.some((p) => p.id === id && p.connected)) continue;
    for (const p of view(s, id).myPrompts) {
      if (view(s, id).myAnswers[p.id]) continue;
      s.game(id, { t: 'answer', promptId: p.id, text: answerText(s, id, p.id) });
    }
  }
}

/** The eligible voters cast `choices` in join order (fewer choices than voters leaves the rest silent). */
export function castVotes(s: Sim, choices: QuipgameChoice[]): Effect[] {
  const ids = voters(s);
  let effects: Effect[] = [];
  choices.forEach((choice, i) => {
    effects = s.game(ids[i], { t: 'vote', choice });
  });
  return effects;
}

/** Plays every matchup of the current round: everyone votes A, the host skips each result. */
export function playRound(s: Sim, host: string): void {
  const round = data(s).round;
  while (data(s).round === round && s.data.phase === 'playing' && data(s).phase !== 'finalWriting') {
    if (data(s).phase === 'voting') castVotes(s, voters(s).map(() => 'a'));
    if (data(s).phase === 'result') s.game(host, { t: 'next' });
  }
}

/** A deterministic [0, 1) sequence so shuffles are reproducible but not degenerate. */
export function lcg(seed: number): () => number {
  let x = seed;
  return () => {
    x = (x * 1664525 + 1013904223) % 4294967296;
    return x / 4294967296;
  };
}
