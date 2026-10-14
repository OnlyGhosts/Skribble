import { useEffect, useRef, useState } from 'react';
import type { PlayerPublic, PodiumEntry, RoomState } from '@shared/platform/protocol';
import { placeLine, podiumOrder, readyLine, winnerHeadline, winners } from '../lib/party';
import { PLATFORM_SOUNDS } from '../lib/platformSounds';
import { useModalFocus } from '../lib/useModalFocus';
import { leaveRoom, playAgain, returnToLobby } from '../net/actions';
import { Avatar } from './Avatar';
import { BottomSheet } from './BottomSheet';
import { Confetti } from './Confetti';
import { PhoneHappy } from './Mascots';
import { LogoutIcon, MoreIcon, PartyIcon, RefreshIcon } from './Icons';
import { ReadyControls } from './ReadyControls';
import { PreferenceRows } from './Preferences';

/** The winner's points under the headline: "1,100 points", or "30 points each" for a tie. */
function pointsLine(score: number, tie: boolean): string {
  return `${score.toLocaleString('en-US')} ${score === 1 ? 'point' : 'points'}${tie ? ' each' : ''}`;
}

function findPlayer(room: RoomState, id: string): PlayerPublic | undefined {
  return room.players.find((p) => p.id === id);
}

/**
 * The end of a game, shown by the platform over any game's screen once the room is 'ended': the
 * winner's celebration, the standings, and what comes next. Everyone readies up for the next game
 * (or sits it out) right here; the host sends the party back to the lobby or straight into another
 * round. Leaving the party lives in the options sheet behind a confirmation, so no stray tap or
 * Enter can take a player out of the room. A modal dialog: the card itself takes the focus (never
 * a button) and Tab stays inside until it goes away.
 */
export function PodiumOverlay({ room, meId, isHost }: { room: RoomState; meId: string | null; isHost: boolean }) {
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmLeave, setConfirmLeave] = useState(false);
  useModalFocus(cardRef, true);

  const me = meId ? (findPlayer(room, meId) ?? null) : null;
  const ordered = podiumOrder(room);
  const top = ordered.slice(0, 3);
  // Visual order puts the winner in the middle, like a real podium.
  const visual = [top[1], top[0], top[2]].filter((p): p is PodiumEntry => p !== undefined);
  const champions = winners(room);
  const iWon = meId !== null && champions.some((e) => e.playerId === meId);
  const place = placeLine(room, meId);
  const host = findPlayer(room, room.hostId);

  // Once per podium: the cue belongs to the moment the overlay appears, whatever changes later.
  const wonAtMount = useRef(iWon);
  useEffect(() => {
    PLATFORM_SOUNDS.play(wonAtMount.current ? 'fanfare' : 'gameOver');
  }, []);

  return (
    <div className="podium-overlay" role="dialog" aria-modal="true" aria-label="Final scores" data-testid="overlay-game-end" data-winner={iWon}>
      <Confetti />
      <div className="overlay__card overlay__card--wide podium-card" ref={cardRef} tabIndex={-1} data-testid="podium-card">
        {/* Only the standings scroll on a small phone: Ready and the host's buttons below never leave the screen. */}
        <div className="podium-card__scroll" data-testid="podium-standings">
          <div className={`podium-hero${iWon ? ' podium-hero--won' : ''}`}>
            <PhoneHappy className="podium-hero__mascot" />
            <h2 className="overlay__title podium-hero__title" data-testid="podium-headline">
              {winnerHeadline(room)}
            </h2>
            {champions.length > 0 && (
              <p className="podium-hero__points" data-testid="podium-points">
                {pointsLine(champions[0].score, champions.length > 1)}
              </p>
            )}
            {me && (
              <p className={`podium-place${iWon ? ' podium-place--won' : ''}`} data-testid="podium-place">
                {place ?? 'You sat this one out'}
              </p>
            )}
          </div>

          <ol className="podium" aria-label="Top three">
            {visual.map((entry) => {
              const player = findPlayer(room, entry.playerId);
              return (
                <li key={entry.playerId} className={`podium__step podium__step--${entry.rank}`} data-rank={entry.rank} data-testid="podium-step">
                  {player ? <Avatar avatar={player.avatar} size="md" /> : <span className="avatar avatar--md avatar--placeholder" />}
                  <span className="podium__name">{player?.name ?? 'Left the game'}</span>
                  <span className="podium__block" aria-hidden="true">
                    {entry.rank}
                  </span>
                </li>
              );
            })}
          </ol>

          <ol className="podium-standings" aria-label="Final standings">
            {ordered.map((entry) => {
              const player = findPlayer(room, entry.playerId);
              return (
                <li key={entry.playerId} className={`podium-standings__row${entry.playerId === meId ? ' podium-standings__row--me' : ''}`} data-testid="podium-entry" data-rank={entry.rank}>
                  <span className="podium-standings__rank">{entry.rank}</span>
                  {player && <Avatar avatar={player.avatar} size="sm" />}
                  <span className="podium-standings__name">
                    {player?.name ?? 'Left the game'}
                    {entry.playerId === meId && <span className="podium-standings__you">You</span>}
                  </span>
                  <span className="podium-standings__score">{entry.score} pts</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="podium-next" data-testid="podium-next">
          {me && <ReadyControls me={me} context="podium" />}
          <p className="podium-next__count" data-testid="podium-ready-count">
            {readyLine(room)}
          </p>
          {isHost ? (
            <div className="overlay__footer podium-overlay__footer">
              <button type="button" className="btn btn--secondary" onClick={playAgain} data-testid="play-again">
                <RefreshIcon size={16} /> Play again
              </button>
              <button type="button" className="btn btn--ghost" onClick={returnToLobby} data-testid="back-to-lobby">
                <PartyIcon size={16} /> Back to lobby
              </button>
            </div>
          ) : (
            <p className="overlay__hint" data-testid="podium-waiting">
              {`${host?.name ?? 'The host'} picks what comes next`}
              <span className="ellipsis" aria-hidden="true" />
            </p>
          )}
        </div>

        {/* Last in the tab order (Ready comes first), pinned to the card's top corner by the stylesheet. */}
        <button type="button" className="icon-btn podium-card__menu" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" aria-expanded={menuOpen} aria-label="More options" data-testid="podium-menu">
          <MoreIcon size={20} />
        </button>
      </div>

      <BottomSheet
        open={menuOpen}
        title="Options"
        onClose={() => {
          setMenuOpen(false);
          setConfirmLeave(false);
        }}
        testId="podium-menu-sheet"
      >
        <div className="menu-sheet">
          <PreferenceRows />
          {confirmLeave ? (
            <div className="start-confirm" role="group" aria-label="Confirm leaving the party" data-testid="podium-leave-confirm">
              <p className="start-confirm__text">Leave the party? You'd need the code to come back in.</p>
              <div className="start-confirm__actions">
                <button type="button" className="btn btn--danger" onClick={leaveRoom} data-testid="podium-leave-yes">
                  <LogoutIcon size={16} /> Leave party
                </button>
                <button type="button" className="btn btn--ghost" onClick={() => setConfirmLeave(false)} data-testid="podium-leave-no">
                  Stay
                </button>
              </div>
            </div>
          ) : (
            <button type="button" className="btn btn--ghost btn--block menu-sheet__leave" onClick={() => setConfirmLeave(true)} data-testid="podium-leave">
              <LogoutIcon size={16} /> Leave party
            </button>
          )}
        </div>
      </BottomSheet>
    </div>
  );
}
