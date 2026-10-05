import { useEffect, useRef, type RefObject } from 'react';
import { CANVAS_HEIGHT, CANVAS_WIDTH } from '@shared/games/skribble/constants';
import type { CanvasAction, DrawOp } from '@shared/games/skribble/protocol';
import { drawQueue } from '../net';
import { useSkribbleStore } from '../store';
import type { CanvasRenderer } from './renderer';

export type DrawTool = 'brush' | 'eraser' | 'fill';

export interface DrawingSettings {
  tool: DrawTool;
  color: string;
  size: number;
}

interface Options {
  canvasRef: RefObject<HTMLCanvasElement | null>;
  rendererRef: RefObject<CanvasRenderer | null>;
  /** Only the drawer, during the drawing phase. */
  enabled: boolean;
  settings: DrawingSettings;
  /** Changes once per turn; resets the stroke id counter. */
  turnKey: string;
}

interface Point {
  x: number;
  y: number;
}

/** Points below this distance (logical px) are dropped — they only add bytes, not shape. */
const MIN_POINT_DISTANCE = 0.5;

const round2 = (v: number): number => Math.round(v * 100) / 100;

function maxStrokeId(actions: readonly CanvasAction[]): number {
  let max = -1;
  for (const a of actions) if (a.kind === 'stroke' && a.id > max) max = a.id;
  return max;
}

/**
 * Pointer handling for the drawer. Every op is rendered locally, folded into the store's action
 * list and queued for the network — the same path remote viewers take, so both sides agree.
 */
export function useDrawing({ canvasRef, rendererRef, enabled, settings, turnKey }: Options): void {
  const settingsRef = useRef(settings);
  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  const strokeCounter = useRef(0);
  useEffect(() => {
    strokeCounter.current = 0;
  }, [turnKey]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !enabled) return;

    let pointerId: number | null = null;
    let strokeId: number | null = null;
    let lastX = 0;
    let lastY = 0;

    const emit = (ops: DrawOp[]): void => {
      const store = useSkribbleStore.getState();
      store.appendOps(ops);
      rendererRef.current?.applyOps(ops, useSkribbleStore.getState().canvas);
      drawQueue.queue(ops);
    };

    const toLogical = (e: { clientX: number; clientY: number }): Point => {
      const rect = canvas.getBoundingClientRect();
      return {
        x: ((e.clientX - rect.left) * CANVAS_WIDTH) / rect.width,
        y: ((e.clientY - rect.top) * CANVAS_HEIGHT) / rect.height,
      };
    };
    const inside = (p: Point): boolean => p.x >= 0 && p.y >= 0 && p.x <= CANVAS_WIDTH && p.y <= CANVAS_HEIGHT;
    const clamp = (p: Point): Point => ({
      x: round2(Math.min(CANVAS_WIDTH, Math.max(0, p.x))),
      y: round2(Math.min(CANVAS_HEIGHT, Math.max(0, p.y))),
    });

    const startStroke = (p: Point): void => {
      const { tool, color, size } = settingsRef.current;
      if (tool === 'fill') return;
      // After a reload the counter restarts, but the server still holds this turn's history
      // (restored into the store), so never reuse an id it already knows.
      const id = Math.max(strokeCounter.current, maxStrokeId(useSkribbleStore.getState().canvas) + 1);
      strokeCounter.current = id + 1;
      strokeId = id;
      lastX = p.x;
      lastY = p.y;
      emit([{ k: 'start', id, tool, color, size, x: p.x, y: p.y }]);
    };

    const endStroke = (): void => {
      if (strokeId === null) return;
      emit([{ k: 'end', id: strokeId }]);
      strokeId = null;
    };

    const onPointerDown = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse' && e.button !== 0) return;
      e.preventDefault();
      if (pointerId !== null) return; // a second finger never draws
      pointerId = e.pointerId;
      try {
        canvas.setPointerCapture(e.pointerId);
      } catch {
        /* capture is an optimisation only */
      }
      const p = clamp(toLogical(e));
      const { tool, color } = settingsRef.current;
      if (tool === 'fill') {
        emit([{ k: 'fill', x: p.x, y: p.y, color }]);
        return;
      }
      startStroke(p);
    };

    const onPointerMove = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      if (settingsRef.current.tool === 'fill') return;
      const coalesced = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
      const events = coalesced.length > 0 ? coalesced : [e];
      const pts: number[] = [];
      const flush = (): void => {
        if (pts.length > 0 && strokeId !== null) emit([{ k: 'move', id: strokeId, pts: pts.slice() }]);
        pts.length = 0;
      };
      for (const ev of events) {
        const raw = toLogical(ev);
        if (!inside(raw)) {
          // Leaving the canvas ends the stroke; coming back while still pressed starts a new one.
          flush();
          endStroke();
          continue;
        }
        const p = clamp(raw);
        if (strokeId === null) {
          startStroke(p);
          continue;
        }
        if (Math.hypot(p.x - lastX, p.y - lastY) < MIN_POINT_DISTANCE) continue;
        pts.push(p.x, p.y);
        lastX = p.x;
        lastY = p.y;
      }
      flush();
    };

    const onPointerUp = (e: PointerEvent): void => {
      if (e.pointerId !== pointerId) return;
      e.preventDefault();
      endStroke();
      pointerId = null;
      try {
        canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* already released */
      }
      drawQueue.flush();
    };

    const onContextMenu = (e: Event): void => e.preventDefault();

    canvas.addEventListener('pointerdown', onPointerDown);
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerup', onPointerUp);
    canvas.addEventListener('pointercancel', onPointerUp);
    canvas.addEventListener('contextmenu', onContextMenu);
    return () => {
      canvas.removeEventListener('pointerdown', onPointerDown);
      canvas.removeEventListener('pointermove', onPointerMove);
      canvas.removeEventListener('pointerup', onPointerUp);
      canvas.removeEventListener('pointercancel', onPointerUp);
      canvas.removeEventListener('contextmenu', onContextMenu);
      endStroke();
      drawQueue.flush();
    };
  }, [canvasRef, rendererRef, enabled]);
}
