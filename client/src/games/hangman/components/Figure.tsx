import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/platform/canvas';
import { HANGMAN_SECTIONS } from '@shared/games/hangman/protocol';
import { livesText } from '../lib/text';

/**
 * The classic figure in logical canvas pixels (800x600), one path per section in drawing order:
 * base, post, beam, rope, head, body, left arm, right arm, left leg, right leg.
 */
export const SECTION_PATHS: readonly string[] = [
  'M200 540 H520',
  'M260 540 V80',
  'M260 80 H480',
  'M480 80 V150',
  'M480 150 a45 45 0 1 0 0.01 0',
  'M480 240 V380',
  'M480 270 L410 340',
  'M480 270 L550 340',
  'M480 380 L420 480',
  'M480 380 L540 480',
];

function stateOf(index: number, section: number): 'done' | 'current' | 'todo' {
  if (index < section - 1) return 'done';
  return index === section - 1 ? 'current' : 'todo';
}

/**
 * The hangman's onion skin over the canvas while they draw: the sections already drawn are
 * invisible (their own strokes are there), the current one is a dashed ghost to trace or ignore,
 * the rest stay faint. Never rendered for anyone else.
 */
export function FigureGhost({ section }: { section: number }) {
  return (
    <svg className="hm-ghost" viewBox={`0 0 ${CANVAS_WIDTH} ${CANVAS_HEIGHT}`} preserveAspectRatio="none" aria-hidden="true" data-testid="hangman-ghost" data-section={section}>
      {SECTION_PATHS.map((d, i) => {
        const state = stateOf(i, section);
        return state === 'done' ? null : <path key={d} d={d} className={`hm-ghost__part hm-ghost__part--${state}`} data-section={i + 1} />;
      })}
    </svg>
  );
}

/** The small figure everyone sees next to the word: the sections drawn so far are solid, the rest faint. */
export function LivesFigure({ wrong, maxWrong }: { wrong: number; maxWrong: number }) {
  const lives = maxWrong - wrong;
  return (
    <svg className="hm-lives" viewBox="180 60 380 500" role="img" aria-label={livesText(lives)} data-testid="hangman-lives" data-lives={lives} data-wrong={wrong}>
      {SECTION_PATHS.map((d, i) => (
        <path key={d} d={d} className={`hm-lives__part${i < wrong ? ' hm-lives__part--drawn' : ''}`}>
          <title>{HANGMAN_SECTIONS[i]}</title>
        </path>
      ))}
    </svg>
  );
}
