import type { SpygameSettings, SpygameView } from '@shared/games/spygame/protocol';
import { gameById } from '@shared/platform/games';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { GameMenuSheet, GameTopBar, RoundStatus } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { isWatching } from '../../platform/lib/watching';
import { useActiveGame } from '../../platform/store/selectors';
import { AccuseList } from './components/AccuseList';
import { CandidateGrid } from './components/CandidateGrid';
import { GuessGrid } from './components/GuessGrid';
import { RevealOverlay } from './components/RevealOverlay';
import { RoleCard } from './components/RoleCard';
import { RoundClock } from './components/RoundClock';
import { VotePanel, VoteSheet } from './components/Vote';
import { nameOf } from './hooks';
import { waitingNotice, wrongGuessNotice } from './lib/text';
import { useSpygame } from './store';

const meta = gameById('spygame');

/**
 * The Spy Game screen. Phones: a one-row header (round, clock, players, menu) over one scrolling
 * column. Its first screen holds the notices, the role card, the vote and every candidate place
 * (a portrait phone fits all 24 without scrolling); the players to accuse follow below. Desktop:
 * the same column on the left, the players to accuse on the right.
 */
export function SpyGameScreen({ room, meId, isHost }: GameScreenProps<SpygameView, SpygameSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  // The sheets live in the game store so a starting vote can close whichever one is up.
  const sheet = useSpygame((s) => s.sheet);
  const openSheet = useSpygame((s) => s.openSheet);
  const closeSheet = () => openSheet(null);
  const playersOpen = sheet === 'players';
  const menuOpen = sheet === 'menu';

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const waitingFor = view.clock.waitingForId ? nameOf(room, view.clock.waitingForId) : null;
  const wrongGuesses = view.spyGuessed.length > 0 && view.phase !== 'reveal';
  const players = <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />;
  const accuse = <AccuseList room={room} view={view} meId={meId} />;

  return (
    <div className={`spy${isPhone ? ' spy--phone' : ''}`} data-phase={view.phase} data-role={view.role} data-testid="spygame-screen">
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId="spygame-header"
        className="spy__top"
        status={<RoundStatus round={view.round} total={view.totalRounds} />}
        clock={<RoundClock clock={view.clock} holding={holding} />}
        players={{ label: 'Scores', open: playersOpen, onOpen: () => openSheet('players') }}
        menu={{ open: menuOpen, onOpen: () => openSheet('menu') }}
        compact={isPhone}
      />

      <div className="spy__stage">
        <main className="spy__main" data-testid="spygame-main">
          <div className="spy__first" data-testid="spygame-first">
            {waitingFor && (
              <div className="banner banner--info spy__banner" role="status" data-testid="spygame-waiting">
                {waitingNotice(waitingFor)}
              </div>
            )}
            {wrongGuesses && (
              <div className="banner spy__banner spy__banner--wrong" role="status" data-testid="spygame-wrong-guess" data-guesses-left={view.guessesLeft}>
                {wrongGuessNotice(view.guessesLeft)}
              </div>
            )}
            <RoleCard view={view} watching={isWatching(room.players, meId)} />
            {view.phase === 'voting' && <VotePanel room={room} view={view} meId={meId} />}
            {view.role === 'spy' ? <GuessGrid view={view} /> : <CandidateGrid view={view} />}
          </div>
          {isPhone && <section className="card spy__accuse-card">{accuse}</section>}
        </main>
        {playing && view.reveal && <RevealOverlay room={room} view={view} reveal={view.reveal} isHost={isHost} holding={holding} />}
      </div>

      {!isPhone && (
        <aside className="spy__aside">
          <section className="card spy__accuse-card spy__accuse-card--desktop">{accuse}</section>
        </aside>
      )}

      <BottomSheet open={playersOpen} title={`Scores (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        {players}
      </BottomSheet>
      {isPhone && <GameMenuSheet open={menuOpen} onClose={closeSheet} />}
      {/* Last, so it stacks above the other sheets should one be open. */}
      <VoteSheet room={room} view={view} meId={meId} />
    </div>
  );
}
