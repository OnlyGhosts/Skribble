import { useEffect, useRef, useState } from 'react';
import { PALETTE } from '@shared/games/skribble/constants';
import { PlusIcon } from './Icons';

/** The colours always on show (the board's row: black, red, orange, yellow, green, blue, purple). */
export const QUICK_COLOURS: readonly string[] = PALETTE.slice(0, 7);
/** The rest of the palette, behind the More colours swatch with the custom picker. */
export const MORE_COLOURS: readonly string[] = PALETTE.slice(7);

interface Props {
  color: string;
  /** The eraser is in hand: no colour shows as picked. */
  erasing: boolean;
  onPick(color: string): void;
}

/**
 * One row of colour swatches that always fits its width: the quick colours and a More colours
 * swatch that opens the rest of the palette and the custom picker above it. The More swatch takes
 * the colour in hand when it is one of those.
 */
export function Palette({ color, erasing, onPick }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const fromMore = !QUICK_COLOURS.includes(color);

  // The colours close on a tap anywhere else, or Escape.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const pick = (hex: string) => {
    onPick(hex);
    setOpen(false);
  };

  return (
    <div className="toolbar__palette" ref={ref} data-testid="palette">
      <div className="toolbar__swatches" role="radiogroup" aria-label="Colour">
        {QUICK_COLOURS.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={color === hex && !erasing}
            className={`swatch${color === hex ? ' is-selected' : ''}`}
            style={{ background: hex }}
            onClick={() => pick(hex)}
            aria-label={`Colour ${hex}`}
            title={hex}
            data-testid={`tool-color-${hex.slice(1)}`}
          />
        ))}
        <button
          type="button"
          className={`swatch swatch--more${fromMore ? ' is-selected' : ''}`}
          style={fromMore ? { background: color } : undefined}
          onClick={() => setOpen((v) => !v)}
          aria-haspopup="true"
          aria-expanded={open}
          aria-label="More colours"
          title="More colours"
          data-testid="tool-more-colors"
        >
          {!fromMore && <PlusIcon size={20} />}
        </button>
      </div>
      {open && (
        <div className="toolbar__more" role="radiogroup" aria-label="More colours" data-testid="tool-colors-more">
          {MORE_COLOURS.map((hex) => (
            <button
              key={hex}
              type="button"
              role="radio"
              aria-checked={color === hex && !erasing}
              className={`swatch${color === hex ? ' is-selected' : ''}`}
              style={{ background: hex }}
              onClick={() => pick(hex)}
              aria-label={`Colour ${hex}`}
              title={hex}
              data-testid={`tool-color-${hex.slice(1)}`}
            />
          ))}
          <label className={`swatch swatch--custom${fromMore && !PALETTE.includes(color) ? ' is-selected' : ''}`} title="Custom colour">
            <input type="color" value={color} aria-label="Custom colour" data-testid="tool-custom-color" onChange={(e) => onPick(e.target.value)} />
          </label>
        </div>
      )}
    </div>
  );
}
