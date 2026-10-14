import { useEffect, useState } from 'react';

/** Pip positions on a 3x3 grid (0 is top left, 8 bottom right) for each face. */
const PIPS: Readonly<Record<number, readonly number[]>> = {
  1: [4],
  2: [2, 6],
  3: [2, 4, 6],
  4: [0, 2, 6, 8],
  5: [0, 2, 4, 6, 8],
  6: [0, 2, 3, 5, 6, 8],
};

interface Props {
  value: number;
  /** Tumbling through faces before landing on `value`. */
  rolling: boolean;
  size?: 'sm' | 'lg';
  testId?: string;
}

/** A die face. While rolling it flicks through the other faces; the value it lands on is always in `data-value`. */
export function Die({ value, rolling, size = 'sm', testId }: Props) {
  const [face, setFace] = useState(value);
  useEffect(() => {
    if (!rolling) {
      setFace(value);
      return;
    }
    let next = value;
    const id = window.setInterval(() => {
      next = (next % 6) + 1;
      setFace(next);
    }, 90);
    return () => window.clearInterval(id);
  }, [rolling, value]);
  const shown = rolling ? face : value;
  return (
    <span
      className={`bs-die bs-die--${size}${rolling ? ' is-rolling' : ''}`}
      role="img"
      aria-label={rolling ? 'Rolling the die' : `Rolled a ${value}`}
      data-testid={testId}
      data-value={value}
      data-rolling={rolling ? 'true' : undefined}
    >
      {Array.from({ length: 9 }, (_, i) => (
        <span key={i} className={`bs-die__pip${PIPS[shown]?.includes(i) ? ' is-on' : ''}`} aria-hidden="true" />
      ))}
    </span>
  );
}
