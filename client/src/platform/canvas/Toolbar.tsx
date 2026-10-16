import { useEffect, useRef, useState } from 'react';
import { BRUSH_SIZES } from '@shared/games/scribble/constants';
import { BucketIcon, EraserIcon, PencilIcon, RedoIcon, TrashIcon, UndoIcon } from './Icons';
import { Palette } from './Palette';
import type { DrawTool, DrawingSettings } from './useDrawing';

interface Props {
  settings: DrawingSettings;
  onChange(next: DrawingSettings): void;
  /** Whether undo/clear are offered (something to undo, and a connection to send it over). */
  canUndo: boolean;
  onUndo(): void;
  /** Redo: left out entirely where a game has none. */
  canRedo?: boolean;
  onRedo?(): void;
  onClear(): void;
}

const SIZE_LIST: readonly number[] = BRUSH_SIZES;

const TOOLS: { tool: DrawTool; label: string; key: string; Icon: typeof PencilIcon }[] = [
  { tool: 'brush', label: 'Brush', key: 'B', Icon: PencilIcon },
  { tool: 'eraser', label: 'Eraser', key: 'E', Icon: EraserIcon },
  { tool: 'fill', label: 'Fill', key: 'F', Icon: BucketIcon },
];

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;
}

const dotSize = (size: number): number => Math.max(4, Math.min(22, size * 0.7));

/**
 * The drawer's tools, as on the brand board: segmented groups [brush | eraser | fill], [size],
 * [undo | redo], [clear], then one row of colour swatches (Palette). The size button opens the five sizes.
 */
export function Toolbar({ settings, onChange, canUndo, onUndo, canRedo = false, onRedo, onClear }: Props) {
  const [confirmClear, setConfirmClear] = useState(false);
  const [sizesOpen, setSizesOpen] = useState(false);
  const sizeRef = useRef<HTMLDivElement | null>(null);
  const setTool = (tool: DrawTool) => onChange({ ...settings, tool });

  // Keyboard shortcuts: B brush, E eraser, F fill, Ctrl/Cmd+Z undo, Ctrl/Cmd+Shift+Z or Ctrl+Y redo, [ and ] size.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const key = e.key.toLowerCase();
      if ((e.ctrlKey || e.metaKey) && (key === 'y' || (key === 'z' && e.shiftKey))) {
        if (!onRedo) return;
        e.preventDefault();
        if (canRedo) onRedo();
        return;
      }
      if ((e.ctrlKey || e.metaKey) && key === 'z') {
        e.preventDefault();
        if (canUndo) onUndo();
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
        case 'escape':
          setSizesOpen(false);
          break;
        default:
          return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // The sizes close on a tap anywhere else.
  useEffect(() => {
    if (!sizesOpen) return;
    const onPointer = (e: PointerEvent) => {
      if (sizeRef.current && e.target instanceof Node && !sizeRef.current.contains(e.target)) setSizesOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [sizesOpen]);

  return (
    <div className="toolbar" role="toolbar" aria-label="Drawing tools" data-testid="toolbar">
      <div className="toolbar__row">
        <div className="seg" role="radiogroup" aria-label="Tool">
          {TOOLS.map(({ tool, label, key, Icon }) => (
            <button
              key={tool}
              type="button"
              role="radio"
              aria-checked={settings.tool === tool}
              className={`tool-btn${settings.tool === tool ? ' is-active' : ''}`}
              onClick={() => setTool(tool)}
              aria-label={`${label} (${key})`}
              title={`${label} (${key})`}
              data-testid={`tool-${tool}`}
            >
              <Icon size={22} />
            </button>
          ))}
        </div>

        <div className="seg toolbar__size" ref={sizeRef}>
          <button
            type="button"
            className="tool-btn"
            onClick={() => setSizesOpen((v) => !v)}
            aria-haspopup="true"
            aria-expanded={sizesOpen}
            aria-label={`Brush size ${settings.size}`}
            title="Brush size ([ and ])"
            data-testid="tool-size"
          >
            <span className="size-btn__dot" style={{ width: dotSize(settings.size), height: dotSize(settings.size) }} />
          </button>
          {sizesOpen && (
            <div className="toolbar__sizes" role="radiogroup" aria-label="Brush size" data-testid="tool-sizes">
              {SIZE_LIST.map((size) => (
                <button
                  key={size}
                  type="button"
                  role="radio"
                  aria-checked={settings.size === size}
                  className={`size-btn${settings.size === size ? ' is-active' : ''}`}
                  onClick={() => {
                    onChange({ ...settings, size });
                    setSizesOpen(false);
                  }}
                  aria-label={`Brush size ${size}`}
                  title={`Size ${size}`}
                  data-testid={`tool-size-${size}`}
                >
                  <span className="size-btn__dot" style={{ width: dotSize(size), height: dotSize(size) }} />
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="seg">
          <button type="button" className="tool-btn" onClick={onUndo} disabled={!canUndo} aria-label="Undo (Ctrl+Z)" title="Undo (Ctrl+Z)" data-testid="tool-undo">
            <UndoIcon size={22} />
          </button>
          {onRedo && (
            <button type="button" className="tool-btn" onClick={onRedo} disabled={!canRedo} aria-label="Redo (Ctrl+Shift+Z)" title="Redo (Ctrl+Shift+Z)" data-testid="tool-redo">
              <RedoIcon size={22} />
            </button>
          )}
        </div>

        {confirmClear ? (
          <span className="confirm toolbar__confirm" role="group" aria-label="Confirm clearing the canvas">
            <button
              type="button"
              className="btn btn--danger btn--xs"
              onClick={() => {
                onClear();
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
          <div className="seg">
            <button
              type="button"
              className="tool-btn tool-btn--danger"
              onClick={() => setConfirmClear(true)}
              disabled={!canUndo}
              aria-label="Clear canvas"
              title="Clear canvas"
              data-testid="tool-clear"
            >
              <TrashIcon size={22} />
            </button>
          </div>
        )}
      </div>

      <Palette color={settings.color} erasing={settings.tool === 'eraser'} onPick={(color) => onChange({ ...settings, color, tool: settings.tool === 'eraser' ? 'brush' : settings.tool })} />
    </div>
  );
}
