import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const css = readFileSync(fileURLToPath(new URL('./spygame.css', import.meta.url)), 'utf8');

/** The declarations of the first rule whose selector list starts with `selector`. */
function ruleOf(selector: string): string {
  const block = css.match(new RegExp(`\n${selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[^{]*\{([^}]*)\}`))?.[1];
  if (block === undefined) throw new Error(`no rule for ${selector}`);
  return block;
}

/**
 * The Spy Game stylesheet sits on the platform tokens, whose status fills are restrained on the
 * dark theme (salmon danger, pale green success). Nothing may put white on them any more: a fill
 * carries the page colour or ink, like `.btn--danger` does.
 */
describe('spy game status fills', () => {
  it('puts the page colour, never white, on the "Yes, spy" vote button', () => {
    const yes = ruleOf('.spy-vote__btn--yes');
    expect(yes).toContain('background: var(--color-danger)');
    expect(yes).toContain('color: var(--color-bg)');
    expect(yes).not.toMatch(/color:\s*(#fff\b|white)/i);
  });

  it('marks the real location with ink on the success fill, never white', () => {
    const real = ruleOf('.spy-tile__mark--real');
    expect(real).toContain('background: var(--color-success)');
    expect(real).toContain('color: var(--color-primary-contrast)');
    expect(real).not.toMatch(/color:\s*(#fff\b|white)/i);
  });

  it('has no hard-coded white text anywhere (every colour comes from the tokens)', () => {
    expect(css).not.toMatch(/color: #fff\b/);
  });
});
