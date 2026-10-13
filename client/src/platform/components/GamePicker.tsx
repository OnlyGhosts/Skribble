import { GAME_LIST, gameById, type GameMeta } from '@shared/platform/games';
import type { RoomState } from '@shared/platform/protocol';
import { playerCountLabel } from '../lib/party';
import { selectGame } from '../net/actions';
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
 * The top of the lobby: which game the party plays next. The host taps a card to switch (the
 * room, its code and everyone's seat stay); the others see the current game and who decides.
 */
export function GamePicker({ room, isHost }: Props) {
  const current = gameById(room.gameId);
  const host = room.players.find((p) => p.id === room.hostId);
  if (!isHost) {
    return (
      <section className="card game-picker game-picker--readonly" aria-label="Next game" data-testid="game-picker" data-game={current.id}>
        <GameTile game={current} selected readonly />
        <p className="game-picker__note" data-testid="game-picker-note">
          {host?.name ?? 'The host'} picks the game
        </p>
      </section>
    );
  }
  return (
    <section className="card game-picker" aria-labelledby="game-picker-heading" data-testid="game-picker" data-game={current.id}>
      <div className="card__head">
        <h2 className="card__title" id="game-picker-heading">
          Pick the next game
        </h2>
        <span className="pill pill--accent">Host</span>
      </div>
      <div className="game-picker__list" role="radiogroup" aria-labelledby="game-picker-heading">
        {pickableGames(current).map((game) => (
          <GameTile key={game.id} game={game} selected={game.id === current.id} onSelect={() => selectGame(game.id)} />
        ))}
      </div>
    </section>
  );
}

function GameTile({ game, selected, readonly = false, onSelect }: { game: GameMeta; selected: boolean; readonly?: boolean; onSelect?(): void }) {
  const body = (
    <>
      <span className="game-tile__icon" style={{ background: game.accent }} aria-hidden="true">
        {game.icon}
      </span>
      <span className="game-tile__body">
        <span className="game-tile__name">{game.name}</span>
        <span className="game-tile__meta">
          {game.tagline} · {playerCountLabel(game)}
        </span>
      </span>
      {selected && !readonly && (
        <span className="game-tile__check" aria-hidden="true">
          <CheckIcon size={16} />
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
