import { useState } from 'react';
import { gameById } from '@shared/platform/games';
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { Avatar } from '../../platform/components/Avatar';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { GameMenuSheet, GameTopBar } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { WATCHING_TEXT } from '../../platform/lib/watching';
import { socket } from '../../platform/net/socket';
import { useActiveGame } from '../../platform/store/selectors';

const meta = gameById('template');

/**
 * One big button, a live ranking and the clock. The platform shows the results when the race ends.
 * A player sitting this one out watches: their button is off and the standings list racers only.
 */
export function ClickRaceScreen({ room, meId, isHost }: GameScreenProps<TemplateView, TemplateSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [sheet, setSheet] = useState<'players' | 'menu' | null>(null);
  const view = room.game;
  if (!view) return null;
  const target = room.settings.targetClicks;
  const mine = view.clicks[meId] ?? 0;
  const spectating = !room.players.find((p) => p.id === meId)?.participating;
  const racing = room.phase === 'playing' && !spectating;
  const racers = room.players.filter((p) => p.participating);
  const ranking = racers.slice().sort((a, b) => (view.clicks[b.id] ?? 0) - (view.clicks[a.id] ?? 0) || a.joinOrder - b.joinOrder);
  const watching = room.players.filter((p) => !p.participating);

  return (
    <div className="race">
      {/* Every game's top bar: options, name and status, the clock, players. */}
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId="race-header"
        status={`First to ${target} taps`}
        clock={<Timer endsAt={view.endsAt} warnUnder={5} tickUnder={3} />}
        players={{ open: sheet === 'players', onOpen: () => setSheet('players') }}
        menu={{ open: sheet === 'menu', onOpen: () => setSheet('menu') }}
      />
      <main className="card race__main">
        <h1 className="race__title">First to {target} taps wins</h1>
        <button
          type="button"
          className="race__button"
          style={{ background: meta.accent }}
          onClick={() => socket.send({ t: 'click' })}
          disabled={!racing}
          aria-label={spectating ? "You're watching this race" : `Tap! ${mine} of ${target}`}
          data-testid="click-button"
          data-spectating={spectating}
        >
          {spectating ? (
            <span className="race__watching">Watching</span>
          ) : (
            <>
              <span className="race__count" data-testid="click-count">
                {mine}
              </span>
              <span className="race__target">/ {target}</span>
            </>
          )}
        </button>
        {spectating && (
          <p className="race__note" data-testid="race-spectating">
            {WATCHING_TEXT}
          </p>
        )}
        <ol className="race__list" aria-label="Progress" data-testid="race-list">
          {ranking.map((p) => {
            const clicks = view.clicks[p.id] ?? 0;
            return (
              <li key={p.id} className={`race__row${p.id === meId ? ' race__row--me' : ''}`} data-testid="race-row" data-name={p.name} data-clicks={clicks}>
                <Avatar avatar={p.avatar} size="sm" dimmed={!p.connected} />
                <span className="race__name">{p.name}</span>
                <progress className="race__bar" value={Math.min(clicks, target)} max={target} aria-label={`${p.name}: ${clicks} of ${target}`} />
                <span className="race__clicks">{clicks}</span>
              </li>
            );
          })}
        </ol>
        {watching.length > 0 && (
          <p className="race__note player__status--sitting-out" data-testid="race-watching">
            {`Watching: ${watching.map((p) => p.name).join(', ')}`}
          </p>
        )}
      </main>
      <BottomSheet open={sheet === 'players'} title={`Players (${room.players.length})`} onClose={() => setSheet(null)} testId="players-sheet">
        <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />
      </BottomSheet>
      <GameMenuSheet open={sheet === 'menu'} onClose={() => setSheet(null)} />
    </div>
  );
}
