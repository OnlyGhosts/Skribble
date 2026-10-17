import { useEffect, useId, useLayoutEffect, useRef, useState, type CSSProperties, type RefObject } from 'react';
import type { GameMeta } from '@shared/platform/games';
import type { GameRules } from '../game';
import { noOrphan } from '../lib/format';
import { DESKTOP_QUERY, useMediaQuery } from '../lib/media';
import { rulesSections } from '../lib/rules';
import { BottomSheet } from './BottomSheet';
import { GameGlyph } from './GameGlyph';
import { CloseIcon, HelpIcon } from './Icons';

interface Props {
  meta: GameMeta;
  rules: GameRules;
  /** An element whose presses leave the popover open (the host's game tiles: the card follows the switch instead of closing). */
  keepOpenIn?: RefObject<HTMLElement | null>;
}

/**
 * The lobby's How to play: a button beside the picked game that opens its rules. On a desktop a
 * popover card hangs off the button (the room stays usable under it); on a phone or tablet the
 * rules come up in the bottom sheet. Either way the card follows the game the host picks, Escape
 * and the close button hand the focus back to the button, and a tap outside closes it.
 */
export function HowToPlay({ meta, rules, keepOpenIn }: Props) {
  const [open, setOpen] = useState(false);
  const desktop = useMediaQuery(DESKTOP_QUERY);
  const buttonRef = useRef<HTMLButtonElement | null>(null);
  const panelId = useId();

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) buttonRef.current?.focus();
  };

  return (
    <div className="how-to-play">
      <button
        ref={buttonRef}
        type="button"
        className="btn btn--secondary how-to-play__btn"
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-controls={open && desktop ? panelId : undefined}
        onClick={() => setOpen((v) => !v)}
        data-testid="how-to-play"
      >
        <HelpIcon size={18} /> How to play
      </button>
      <HowToPlayDialog meta={meta} rules={rules} open={open} mode={desktop ? 'popover' : 'sheet'} onClose={close} anchorRef={buttonRef} keepOpenIn={keepOpenIn} id={panelId} />
    </div>
  );
}

interface DialogProps {
  meta: GameMeta;
  rules: GameRules;
  open: boolean;
  mode: 'popover' | 'sheet';
  /** `refocus`: the close came from the keyboard or the close button, so the button takes the focus back. */
  onClose(refocus: boolean): void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  keepOpenIn?: RefObject<HTMLElement | null>;
  id?: string;
}

/** The open card in either shape; split from the button so each shape renders on its own in tests. */
export function HowToPlayDialog({ meta, rules, open, mode, onClose, anchorRef, keepOpenIn, id }: DialogProps) {
  const label = `How to play ${meta.name}`;
  if (mode === 'sheet') {
    return (
      <BottomSheet open={open} title="How to play" label={label} onClose={() => onClose(true)} testId="how-to-play-sheet" className="sheet--narrow">
        <RulesCard meta={meta} rules={rules} mode="sheet" />
      </BottomSheet>
    );
  }
  if (!open) return null;
  return <Popover meta={meta} rules={rules} label={label} onClose={onClose} anchorRef={anchorRef} keepOpenIn={keepOpenIn} id={id} />;
}

/** The popover's width, as in the stylesheet: decides which side of the button it hangs from. */
const POPOVER_WIDTH = 380;
const EDGE = 16;
/** Less room than this under the button (to the footer), and the card looks for a roomier place. */
const FLIP_UNDER = 280;
/** The least the card gets before it runs over the footer rather than squeeze under or over the button. */
const MIN_HEIGHT = 200;

/**
 * How tall the card may be, and which way it opens: under the button when the room to the footer is
 * decent; else whichever of under (to the footer) and over the button is taller, so Start stays in
 * reach; and only on a screen too short for either does it run down over the footer.
 */
export function popoverRoom(toFooter: number, over: number, toBottom: number): { above: boolean; maxHeight: number } {
  if (toFooter >= FLIP_UNDER) return { above: false, maxHeight: toFooter };
  const above = over > toFooter;
  const best = above ? over : toFooter;
  if (best >= MIN_HEIGHT || toBottom <= best) return { above, maxHeight: Math.max(MIN_HEIGHT, best) };
  return { above: false, maxHeight: Math.max(MIN_HEIGHT, toBottom) };
}

interface Placement {
  right: boolean;
  above: boolean;
  arrowX: number;
  maxHeight: number;
}

interface PopoverProps {
  meta: GameMeta;
  rules: GameRules;
  label: string;
  onClose(refocus: boolean): void;
  anchorRef?: RefObject<HTMLButtonElement | null>;
  keepOpenIn?: RefObject<HTMLElement | null>;
  id?: string;
}

function Popover({ meta, rules, label, onClose, anchorRef, keepOpenIn, id }: PopoverProps) {
  const panelRef = useRef<HTMLDivElement | null>(null);
  // The latest callback without re-arming the listeners on every parent render.
  const onCloseRef = useRef(onClose);
  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);
  const [placement, setPlacement] = useState<Placement>({ right: false, above: false, arrowX: 24, maxHeight: 0 });

  // Hangs under the button, from its left edge (or its right edge when the card would run off the
  // screen), the arrow at the button's middle; over the button instead when the room below is short.
  useLayoutEffect(() => {
    const place = () => {
      const anchor = anchorRef?.current?.getBoundingClientRect();
      if (!anchor) return;
      const right = anchor.left + POPOVER_WIDTH > window.innerWidth - EDGE && anchor.right - POPOVER_WIDTH >= EDGE;
      // The card stops short of the lobby's sticky footer, so Start and Ready stay in reach while it is open.
      const footer = document.querySelector('.lobby__footer')?.getBoundingClientRect().top ?? window.innerHeight;
      const toFooter = Math.min(footer, window.innerHeight) - anchor.bottom - EDGE * 2;
      const toBottom = window.innerHeight - anchor.bottom - EDGE * 2;
      const over = anchor.top - EDGE * 2;
      setPlacement({ right, arrowX: anchor.width / 2, ...popoverRoom(toFooter, over, toBottom) });
    };
    place();
    window.addEventListener('resize', place);
    return () => window.removeEventListener('resize', place);
  }, [anchorRef]);

  useEffect(() => {
    panelRef.current?.focus({ preventScroll: true });
    const onPointer = (e: PointerEvent) => {
      const inside = (el: Element | null | undefined) => el instanceof Node && e.target instanceof Node && el.contains(e.target);
      if (!inside(panelRef.current) && !inside(anchorRef?.current) && !inside(keepOpenIn?.current)) onCloseRef.current(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onCloseRef.current(true);
    };
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKey);
    };
  }, [anchorRef, keepOpenIn]);

  const style = { '--anchor-x': `${placement.arrowX}px`, '--popover-max': placement.maxHeight ? `${placement.maxHeight}px` : 'none' } as CSSProperties;
  return (
    <div
      className={`how-to-play__popover${placement.right ? ' how-to-play__popover--right' : ''}${placement.above ? ' how-to-play__popover--above' : ''}`}
      ref={panelRef}
      tabIndex={-1}
      role="dialog"
      aria-label={label}
      id={id}
      style={style}
      data-testid="how-to-play-popover"
    >
      <button type="button" className="icon-btn how-to-play__close" onClick={() => onClose(true)} aria-label="Close" data-testid="how-to-play-close">
        <CloseIcon size={18} />
      </button>
      <div className="how-to-play__scroll">
        <RulesCard meta={meta} rules={rules} mode="popover" />
      </div>
    </div>
  );
}

/** The rules themselves: the game's name and glyph, its one-line summary, then the five sections. */
export function RulesCard({ meta, rules, mode }: { meta: GameMeta; rules: GameRules; mode: 'popover' | 'sheet' }) {
  const accent = { '--game-accent': `var(--game-${meta.id})` } as CSSProperties;
  return (
    <div className="rules" data-testid="how-to-play-card" data-game={meta.id} data-mode={mode}>
      <div className="rules__head">
        <span className="rules__glyph" style={accent} aria-hidden="true">
          <GameGlyph game={meta} size={22} strokeWidth={2} />
        </span>
        <div className="rules__intro">
          <h3 className="rules__name" data-testid="rules-name">
            {noOrphan(meta.name)}
          </h3>
          <p className="rules__summary">{noOrphan(rules.summary)}</p>
        </div>
      </div>
      {rulesSections(rules).map((s) => (
        <section key={s.key} className="rules__section" data-testid="rules-section" data-section={s.key}>
          <h4 className="rules__heading">{s.heading}</h4>
          <p className="rules__text">{noOrphan(s.text)}</p>
        </section>
      ))}
    </div>
  );
}
