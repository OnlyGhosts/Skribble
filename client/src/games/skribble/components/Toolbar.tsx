import { useEffect, useState } from 'react';
import { BRUSH_SIZES, PALETTE } from '@shared/games/skribble/constants';
import { clearCanvas, undoStroke } from '../actions';
import type { DrawTool, DrawingSettings } from '../canvas/useDrawing';
import { BucketIcon, EraserIcon, PencilIcon, TrashIcon, UndoIcon } from './Icons';

interface Props {
  settings: DrawingSettings;
  onChange(next: DrawingSettings): void;
  canUndo: boolean;
}

const SIZE_LIST: readonly number[] = BRUSH_SIZES;

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

export function Toolbar({ settings, onChange, canUndo }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const setTool = (tool: DrawTool) => onChange({ ...settings, tool });

  // Keyboard shortcuts: B brush, E eraser, F fill, Ctrl/Cmd+Z undo, [ and ] size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (canUndo) undoStroke();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const idx = SIZE_LIST.indexOf(settings.size);
      switch (key) {
        case 'b':
          setTool('brush');
          break;
        case 'e':
          setTool('eraser');
          break;
        case 'f':
          setTool('fill');
          break;
        case '[':
          if (idx > 0) onChange({ ...settings, size: SIZE_LIST[idx - 1] });
          break;
        case ']':
          if (idx >= 0 && idx < SIZE_LIST.length - 1) onChange({ ...settings, size: SIZE_LIST[idx + 1] });
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  const isCustomColor = !PALETTE.includes(settings.color);

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools" data-testid="toolbar">
      <div className="toolbar__group" role="radiogroup" aria-label="Tool">
        <button
          type="button"
          role="radio"
          aria-checked={settings.tool === 'brush'}
          className={`tool-btn${settings.tool === 'brush' ? ' is-active' : ''}`}
          onClick={() => setTool('brush')}
          aria-label="Brush (B)"
          title="Brush (B)"
          data-testid="tool-brush"
        >
          <PencilIcon />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={settings.tool === 'eraser'}
          className={`tool-btn${settings.tool === 'eraser' ? ' is-active' : ''}`}
          onClick={() => setTool('eraser')}
          aria-label="Eraser (E)"
          title="Eraser (E)"
          data-testid="tool-eraser"
        >
          <EraserIcon />
        </button>
        <button
          type="button"
          role="radio"
          aria-checked={settings.tool === 'fill'}
          className={`tool-btn${settings.tool === 'fill' ? ' is-active' : ''}`}
          onClick={() => setTool('fill')}
          aria-label="Fill (F)"
          title="Fill (F)"
          data-testid="tool-fill"
        >
          <BucketIcon />
        </button>
      </div>

      <div className="toolbar__group toolbar__sizes" role="radiogroup" aria-label="Brush size">
        {SIZE_LIST.map((size) => (
          <button
            key={size}
            type="button"
            role="radio"
            aria-checked={settings.size === size}
            className={`size-btn${settings.size === size ? ' is-active' : ''}`}
            onClick={() => onChange({ ...settings, size })}
            aria-label={`Brush size ${size}`}
            title={`Size ${size}`}
            data-testid={`tool-size-${size}`}
          >
            <span className="size-btn__dot" style={{ width: Math.max(4, size * 0.7), height: Math.max(4, size * 0.7) }} />
          </button>
        ))}
      </div>

      <div className="toolbar__group toolbar__palette" role="radiogroup" aria-label="Colour">
        {PALETTE.map((hex) => (
          <button
            key={hex}
            type="button"
            role="radio"
            aria-checked={settings.color === hex && settings.tool !== 'eraser'}
            className={`swatch${settings.color === hex ? ' is-selected' : ''}`}
            style={{ background: hex }}
            onClick={() => onChange({ ...settings, color: hex, tool: settings.tool === 'eraser' ? 'brush' : settings.tool })}
            aria-label={`Colour ${hex}`}
            title={hex}
            data-testid={`tool-color-${hex.slice(1)}`}
          />
        ))}
        <label className={`swatch swatch--custom${isCustomColor ? ' is-selected' : ''}`} title="Custom colour" style={isCustomColor ? { background: settings.color } : undefined}>
          <input
            type="color"
            value={settings.color}
            aria-label="Custom colour"
            data-testid="tool-custom-color"
            onChange={(e) => onChange({ ...settings, color: e.target.value, tool: settings.tool === 'eraser' ? 'brush' : settings.tool })}
          />
        </label>
      </div>

      <div className="toolbar__group toolbar__actions">
        <button type="button" className="tool-btn" onClick={undoStroke} disabled={!canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" data-testid="tool-undo">
          <UndoIcon />
        </button>
        {confirmClear ? (
          <span className="confirm" role="group" aria-label="Confirm clearing the canvas">
            <button
              type="button"
              className="btn btn--danger btn--xs"
              onClick={() => {
                clearCanvas();
                setConfirmClear(false);
              }}
              data-testid="tool-clear-confirm"
            >
              Clear all
            </button>
            <button type="button" className="btn btn--ghost btn--xs" onClick={() => setConfirmClear(false)} data-testid="tool-clear-cancel">
              Keep
            </button>
          </span>
        ) : (
          <button type="button" className="tool-btn tool-btn--danger" onClick={() => setConfirmClear(true)} disabled={!canUndo} aria-label="Clear canvas" title="Clear canvas" data-testid="tool-clear">
            <TrashIcon />
          </button>
        )}
      </div>
    </div>
  );
}
