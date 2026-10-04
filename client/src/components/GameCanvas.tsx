import { useEffect, useRef, useState, type ReactNode } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/constants';
import { canvasBus } from '../canvas/bus';
import { CanvasRenderer } from '../canvas/renderer';
import { useDrawing, type DrawingSettings } from '../canvas/useDrawing';
import { useGameStore } from '../store/useGameStore';

interface Props {
  canDraw: boolean;
  settings: DrawingSettings;
  turnKey: string;
  /** Overlays rendered on top of the canvas (choosing, turn end, game end, captions). */
  children?: ReactNode;
  /** Rendered directly under the canvas and counted in the fit calculation (the toolbar). */
  footer?: ReactNode;
}

interface Frame {
  width: number;
  height: number;
}

const ASPECT = CANVAS_WIDTH / CANVAS_HEIGHT;
const STACKED_QUERY = '(max-width: 760px)';
const GROUP_GAP = 12;

/**
 * Hosts the logical 800x600 canvas, scaled to fit its stage while keeping 4:3, and keeps the
 * renderer in sync with the store: remote ops stream in through the bus, structural changes
 * (undo / clear / resync / rejoin) bump `canvasEpoch` and trigger a full replay.
 */
export function GameCanvas({ canDraw, settings, turnKey, children, footer }: Props) {
  const stageRef = useRef<HTMLDivElement | null>(null);
  const footerRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const rendererRef = useRef<CanvasRenderer | null>(null);
  const [frame, setFrame] = useState<Frame | null>(null);
  const epoch = useGameStore((s) => s.canvasEpoch);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const renderer = new CanvasRenderer(canvas);
    rendererRef.current = renderer;
    renderer.replayAll(useGameStore.getState().canvas);
    const unsubscribe = canvasBus.subscribe((ops) => renderer.applyOps(ops));
    return () => {
      unsubscribe();
      rendererRef.current = null;
    };
  }, []);

  useEffect(() => {
    rendererRef.current?.replayAll(useGameStore.getState().canvas);
  }, [epoch]);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const stacked = window.matchMedia(STACKED_QUERY);
    const update = () => {
      const rect = stage.getBoundingClientRect();
      let width = rect.width;
      // Desktop: the stage has a fixed height, so fit both ways. Stacked (phone): width rules
      // and the stage grows with the content, so its height must not feed back into the fit.
      if (!stacked.matches && rect.height > 1) {
        const footerHeight = footerRef.current ? footerRef.current.offsetHeight + GROUP_GAP : 0;
        width = Math.min(rect.width, Math.max(0, rect.height - footerHeight) * ASPECT);
      }
      if (width > 0) setFrame({ width: Math.floor(width), height: Math.floor(width / ASPECT) });
      const renderer = rendererRef.current;
      if (renderer && renderer.resize(window.devicePixelRatio)) {
        renderer.replayAll(useGameStore.getState().canvas);
      }
    };
    update();
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(update) : null;
    observer?.observe(stage);
    if (footerRef.current) observer?.observe(footerRef.current);
    window.addEventListener('resize', update);
    stacked.addEventListener('change', update);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', update);
      stacked.removeEventListener('change', update);
    };
  }, [footer !== undefined]);

  useDrawing({ canvasRef, rendererRef, enabled: canDraw, settings, turnKey });

  return (
    <div className="canvas-stage" ref={stageRef}>
      <div className="canvas-group" style={frame ? { width: frame.width } : undefined}>
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
