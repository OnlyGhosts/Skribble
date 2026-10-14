import { useEffect, useRef, useState, type ReactNode } from 'react';
import { ArrowIcon } from './Icons';

export interface TabItem {
  /** A target side's id, or 'mine' for the viewer's own fleet. */
  key: string;
  label: ReactNode;
  className?: string;
  data?: Record<string, string | undefined>;
}

interface Props {
  items: TabItem[];
  activeKey: string;
  onSelect(key: string): void;
}

export const tabId = (key: string): string => `bs-tab-${key}`;
export const panelId = (key: string): string => `bs-panel-${key}`;

/**
 * The strip of grids: a 44px tab each, scrolling sideways when there are more than fit (an
 * eight-player game has seven targets). The active tab is scrolled into view whenever it changes
 * (a turn opens a target, a move window the own fleet), and a chevron at the edge says more lie
 * beyond it and pages the strip along.
 */
export function Tabs({ items, activeKey, onSelect }: Props) {
  const strip = useRef<HTMLDivElement>(null);
  const [overflow, setOverflow] = useState<{ left: boolean; right: boolean }>({ left: false, right: false });

  useEffect(() => {
    const el = strip.current;
    if (!el) return;
    const measure = () => {
      const more = el.scrollWidth - el.clientWidth;
      setOverflow({ left: el.scrollLeft > 1, right: more > 1 && el.scrollLeft < more - 1 });
    };
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(measure);
    observer?.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer?.disconnect();
    };
  }, [items.length]);

  useEffect(() => {
    const active = strip.current?.querySelector<HTMLElement>(`[data-key="${activeKey}"]`);
    active?.scrollIntoView?.({ inline: 'nearest', block: 'nearest' });
  }, [activeKey]);

  const page = (direction: 1 | -1) => () => strip.current?.scrollBy({ left: direction * strip.current.clientWidth * 0.8, behavior: 'smooth' });

  return (
    <div className="bs-tabs-wrap" data-testid="tabs" data-overflow={overflow.right ? (overflow.left ? 'both' : 'right') : overflow.left ? 'left' : undefined}>
      {overflow.left && (
        <button type="button" className="bs-tabs__more bs-tabs__more--left" onClick={page(-1)} aria-label="Earlier grids" data-testid="tabs-more-left">
          <ArrowIcon size={16} direction="left" />
        </button>
      )}
      <div className="bs-tabs" role="tablist" aria-label="Grids" ref={strip} data-testid="tab-strip">
        {items.map((item) => (
          <button
            key={item.key}
            type="button"
            role="tab"
            id={tabId(item.key)}
            aria-controls={panelId(item.key)}
            aria-selected={item.key === activeKey}
            className={`bs-tab${item.key === activeKey ? ' is-active' : ''}${item.className ? ` ${item.className}` : ''}`}
            onClick={() => onSelect(item.key)}
            data-testid="tab"
            data-key={item.key}
            {...item.data}
          >
            {item.label}
          </button>
        ))}
      </div>
      {overflow.right && (
        <button type="button" className="bs-tabs__more bs-tabs__more--right" onClick={page(1)} aria-label="More grids" data-testid="tabs-more-right">
          <ArrowIcon size={16} direction="right" />
        </button>
      )}
    </div>
  );
}
