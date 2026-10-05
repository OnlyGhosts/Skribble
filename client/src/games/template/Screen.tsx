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

/** One big button, a live ranking and the clock. The platform draws the podium when the race ends. */
export function ClickRaceScreen({ room, meId }: GameScreenProps<TemplateView, TemplateSettings>) {
  const view = room.game;
  if (!view) return null;
  const target = room.settings.targetClicks;
  const mine = view.clicks[meId] ?? 0;
  const racing = room.phase === 'playing';
  const ranking = room.players.slice().sort((a, b) => (view.clicks[b.id] ?? 0) - (view.clicks[a.id] ?? 0) || a.joinOrder - b.joinOrder);

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
            aria-label={`Tap! ${mine} of ${target}`}
            data-testid="click-button"
          >
            <span className="race__count" data-testid="click-count">
              {mine}
            </span>
            <span className="race__target">/ {target}</span>
          </button>
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
        </main>
        <aside className="card race__chat" aria-label="Chat">
          <Chat />
        </aside>
      </div>
    </div>
  );
}
