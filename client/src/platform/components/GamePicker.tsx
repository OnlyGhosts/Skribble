import type { CSSProperties } from 'react';
import { GAME_LIST, gameById, type GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { playerCountLabel } from '../lib/party';
import { selectGame } from '../net/actions';
import { GameGlyph } from './GameGlyph';
import { CheckIcon } from './Icons';

interface Props {
  room: RoomState;
  isHost: boolean;
}

/** The games a party can switch to: every live game, plus the current one when it is hidden (the template game in tests). */
export function pickableGames(current: GameMeta): GameMeta[] {
  return GAME_LIST.filter((g) => g.status === 'live' || g.id === current.id);
}

/**
 * Which game the party plays next. The host taps a tile in the three-column grid to switch (the
 * room, its code and everyone's seat stay); the others see the current game and who decides.
 */
export function GamePicker({ room, isHost }: Props) {
  const current = gameById(room.gameId);
  const host = room.players.find((p) => p.id === room.hostId);
  if (!isHost) {
    return (
      <section className="card game-picker game-picker--readonly" aria-labelledby="game-picker-heading" data-testid="game-picker" data-game={current.id}>
        <h2 className="card__title" id="game-picker-heading">
          Next game
        </h2>
        <div className="game-picker__current">
          <GameTile game={current} selected readonly />
          <p className="game-picker__note" data-testid="game-picker-note">
            {host?.name ?? 'The host'} picks the game
          </p>
        </div>
      </section>
    );
  }
  return (
    <section className="card game-picker" aria-labelledby="game-picker-heading" data-testid="game-picker" data-game={current.id}>
      <h2 className="card__title" id="game-picker-heading">
        Pick a game
      </h2>
      <div className="game-picker__list" role="radiogroup" aria-labelledby="game-picker-heading">
        {pickableGames(current).map((game) => (
          <GameTile key={game.id} game={game} selected={game.id === current.id} onSelect={() => selectGame(game.id)} />
        ))}
      </div>
      <p className="game-picker__meta" data-testid="game-picker-meta">
        {current.name} · {playerCountLabel(current)}
      </p>
    </section>
  );
}

function GameTile({ game, selected, readonly = false, onSelect }: { game: GameMeta; selected: boolean; readonly?: boolean; onSelect?(): void }) {
  const body = (
    <>
      <span className="game-tile__icon" style={{ '--tile-accent': `var(--game-${game.id}, ${game.accent})` } as CSSProperties} aria-hidden="true">
        <GameGlyph game={game} size={22} />
      </span>
      <span className="game-tile__name">{game.name}</span>
      {selected && (
        <span className="game-tile__check" aria-hidden="true">
          <CheckIcon size={14} />
        </span>
      )}
    </>
  );
  if (readonly) {
    return (
      <div className="game-tile game-tile--readonly is-selected" data-testid="game-tile" data-game={game.id}>
        {body}
      </div>
    );
  }
  return (
    <button type="button" role="radio" aria-checked={selected} className={`game-tile${selected ? ' is-selected' : ''}`} onClick={onSelect} data-testid="game-tile" data-game={game.id}>
      {body}
    </button>
  );
}
