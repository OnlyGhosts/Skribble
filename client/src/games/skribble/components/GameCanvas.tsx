import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/games/skribble/constants';
import { PHONE_QUERY, matchesMedia } from '../../../platform/lib/media';
import { canvasBus } from '../canvas/bus';
import { CanvasRenderer } from '../canvas/renderer';
import { useDrawing, type DrawingSettings } from '../canvas/useDrawing';
import { useSkribbleStore } from '../store';

interface Props {
  canDraw: boolean;
  settings: DrawingSettings;
  turnKey: string;
  /** Overlays rendered on top of the canvas (choosing, turn end, captions). */
  children?: ReactNode;
  /** Rendered directly under the canvas and counted in the fit calculation (the toolbar). */
  footer?: ReactNode;
}

interface Frame {
  width: number;
  height: number;
}

const ASPECT = CANVAS_WIDTH / CANVAS_HEIGHT;

/**
 * The stage's height only counts when the layout gives it a definite one (a bounded flex item,
 * as on desktop and in the phone app layout). A layout that lets the stage grow with its content
 * opts out with `--canvas-fit: width`, otherwise fitting by height would feed back on itself.
 */
function stageHasDefiniteHeight(stage: HTMLElement): boolean {
  return getComputedStyle(stage).getPropertyValue('--canvas-fit').trim() !== 'width';
}

function sameFrame(a: Frame | null, b: Frame): boolean {
  return a !== null && a.width === b.width && a.height === b.height;
}

/**
 * Hosts the logical 800x600 canvas, scaled to fit its stage while keeping 4:3, and keeps the
 * renderer in sync with the store: remote ops stream in through the bus, structural changes
 * (undo / clear / resync / rejoin) bump `canvasEpoch` and trigger a full replay.
 */
export function GameCanvas({ canDraw, settings, turnKey, children, footer }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const groupRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  // Phone layout: the toolbar spans the stage instead of the canvas, so its height never depends
  // on the canvas width (which would feed back into the by-height fit).
  const [fullWidthGroup, setFullWidthGroup] = useState(() => matchesMedia(PHONE_QUERY));
  const epoch = useSkribbleStore((s) => s.canvasEpoch);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;
    renderer.replayAll(useSkribbleStore.getState().canvas);
    // The store folded the ops into its list before publishing them; the list lets fills be cached.
    const unsubscribe = canvasBus.subscribe((ops) => renderer.applyOps(ops, useSkribbleStore.getState().canvas));
    return () => {
      unsubscribe();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.replayAll(useSkribbleStore.getState().canvas);
  }, [epoch]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const phone = window.matchMedia(PHONE_QUERY);
    const update = () => {
      setFullWidthGroup(phone.matches);
      const rect = stage.getBoundingClientRect();
      let width = rect.width;
      // Fit by both width and height (the toolbar under the canvas counts) whenever the stage has
      // a definite height; otherwise the width rules and the stage grows with the content.
      if (rect.height > 1 && stageHasDefiniteHeight(stage)) {
        const gap = groupRef.current ? parseFloat(getComputedStyle(groupRef.current).rowGap) || 0 : 0;
        const footerHeight = footerRef.current ? footerRef.current.offsetHeight + gap : 0;
        width = Math.min(rect.width, Math.max(0, rect.height - footerHeight) * ASPECT);
      }
      if (width > 0) {
        const next: Frame = { width: Math.floor(width), height: Math.floor(width / ASPECT) };
        setFrame((prev) => (sameFrame(prev, next) ? prev : next));
      }
      const renderer = rendererRef.current;
      if (renderer && renderer.resize(window.devicePixelRatio)) {
        renderer.replayAll(useSkribbleStore.getState().canvas);
      }
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(stage);
    if (footerRef.current) observer?.observe(footerRef.current);
    window.addEventListener('resize', update);
    phone.addEventListener('change', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      phone.removeEventListener('change', update);
    };
  }, [footer !== undefined]);

  useDrawing({ canvasRef, rendererRef, enabled: canDraw, settings, turnKey });

  return (
    <div className="canvas-stage" ref={stageRef}>
      <div className="canvas-group" ref={groupRef} style={frame && !fullWidthGroup ? { width: frame.width } : undefined}>
        <div
          className={`canvas-frame${canDraw ? ` canvas-frame--drawing canvas-frame--tool-${settings.tool}` : ''}`}
          style={frame ? { width: frame.width, height: frame.height } : undefined}
        >
          <canvas
            ref={canvasRef}
            className="game-canvas"
            data-testid="canvas"
            role="img"
            aria-label={canDraw ? 'Drawing canvas — draw here' : 'Drawing canvas'}
            width={CANVAS_WIDTH}
            height={CANVAS_HEIGHT}
          />
          {children}
        </div>
        {footer !== undefined && (
          <div className="canvas-group__footer" ref={footerRef}>
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}
