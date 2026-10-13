import { gameById } from '@shared/platform/games';
import type { TemplateSettings, TemplateView } from '@shared/games/template/protocol';
import { Avatar } from '../../platform/components/Avatar';
import { Chat } from '../../platform/components/Chat';
import { LogoutIcon } from '../../platform/components/Icons';
import { SiteHeader } from '../../platform/components/SiteHeader';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { leaveRoom } from '../../platform/net/actions';
import { socket } from '../../platform/net/socket';

const meta = gameById('template');

/**
 * One big button, a live ranking and the clock. The platform draws the podium when the race ends.
 * A player sitting this one out watches: their button is off and the standings list racers only.
 */
export function ClickRaceScreen({ room, meId }: GameScreenProps<TemplateView, TemplateSettings>) {
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
      <SiteHeader crumb={meta.name}>
        <button type="button" className="btn btn--ghost btn--sm" onClick={leaveRoom} data-testid="leave-room">
          <LogoutIcon size={16} /> Leave
        </button>
      </SiteHeader>
      <div className="race__grid">
        <main className="card race__main">
          <header className="race__head">
            <div>
              <p className="overlay__kicker">{meta.name}</p>
              <h1 className="race__title">First to {target} taps wins</h1>
            </div>
            <Timer endsAt={view.endsAt} warnUnder={5} tickUnder={3} />
          </header>
          <button
            type="button"
            className="race__button"
            style={{ background: meta.accent }}
            onClick={() => socket.send({ t: 'click' })}
            disabled={!racing}
            aria-label={spectating ? "You're sitting this one out" : `Tap! ${mine} of ${target}`}
            data-testid="click-button"
            data-spectating={spectating}
          >
            {spectating ? (
              <span className="race__watching">Sitting out</span>
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
              You're sitting this one out — the race goes on without you.
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
        <aside className="card race__chat" aria-label="Chat">
          <Chat />
        </aside>
      </div>
    </div>
  );
}
