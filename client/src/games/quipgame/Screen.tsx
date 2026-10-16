import type { QuipgameSettings, QuipgameView } from '@shared/games/quipgame/protocol';
import { gameById } from '@shared/platform/games';
import { BottomSheet } from '../../platform/components/BottomSheet';
import { GameMenuSheet, GameTopBar, RoundStatus } from '../../platform/components/GameTopBar';
import { PlayerList } from '../../platform/components/PlayerList';
import { Timer } from '../../platform/components/Timer';
import type { GameScreenProps } from '../../platform/game';
import { PHONE_QUERY, useMediaQuery } from '../../platform/lib/media';
import { useAppMode } from '../../platform/lib/useViewport';
import { isWatching } from '../../platform/lib/watching';
import { useActiveGame } from '../../platform/store/selectors';
import { FinalResult, FinalVoting } from './components/Final';
import { Result, ResultFooter } from './components/Result';
import { Voting } from './components/Voting';
import { Spectating, Writing } from './components/Writing';
import { isWriting } from './hooks';
import { roundLabel } from './lib/text';
import { useQuipgame } from './store';

const meta = gameById('quipgame');

/**
 * The Quip Game screen: a compact top bar (round, the clock, players, options) over one centred
 * column that shows the current phase. Phone-first: the page never scrolls, the column does, and
 * the players live in a bottom sheet.
 */
export function QuipGameScreen({ room, meId, isHost }: GameScreenProps<QuipgameView, QuipgameSettings>) {
  const game = useActiveGame();
  const isPhone = useMediaQuery(PHONE_QUERY);
  useAppMode(isPhone);
  const sheet = useQuipgame((s) => s.sheet);
  const openSheet = useQuipgame((s) => s.openSheet);
  const closeSheet = () => openSheet(null);

  const view = room.game;
  if (!view) return null;
  const playing = room.phase === 'playing';
  const holding = Boolean(room.waiting);
  const watching = isWatching(room.players, meId);
  const ticking = playing && !holding && (isWriting(view) || view.phase === 'voting' || view.phase === 'finalVoting');

  return (
    <div className={`quip${isPhone ? ' quip--phone' : ''}`} data-phase={view.phase} data-round={view.round} data-testid="quipgame-screen">
      <GameTopBar
        meta={meta}
        room={room}
        isPhone={isPhone}
        testId="quipgame-header"
        className="quip__top"
        status={view.phase.startsWith('final') ? roundLabel(view, false) : <RoundStatus round={view.round} total={view.totalRounds} />}
        statusData={{ 'data-round': view.round, 'data-total': view.totalRounds }}
        clock={<Timer endsAt={playing ? view.endsAt : null} paused={holding} warnUnder={10} tickUnder={ticking ? 5 : undefined} />}
        players={{ label: 'Scores', open: sheet === 'players', onOpen: () => openSheet('players') }}
        menu={{ open: sheet === 'menu', onOpen: () => openSheet('menu') }}
      />

      <main className="quip__main" data-testid="quipgame-main">
        {isWriting(view) && (view.isSpectator ? <Spectating view={view} watching={watching} /> : <Writing view={view} open={playing} />)}
        {view.phase === 'voting' && view.matchup && <Voting room={room} view={view} matchup={view.matchup} watching={watching} />}
        {view.phase === 'result' && view.result && <Result room={room} view={view} result={view.result} isHost={isHost} playing={playing} holding={holding} />}
        {view.phase === 'finalVoting' && <FinalVoting room={room} view={view} watching={watching} />}
        {view.phase === 'finalResult' && view.finalResult && (
          <FinalResult room={room} view={view} footer={<ResultFooter view={view} isHost={isHost} label="Show results" playing={playing} holding={holding} />} />
        )}
      </main>

      <BottomSheet open={sheet === 'players'} title={`Scores (${room.players.length})`} onClose={closeSheet} testId="players-sheet">
        <PlayerList room={room} meId={meId} isHost={isHost} mode="game" game={game} />
      </BottomSheet>
      {isPhone && <GameMenuSheet open={sheet === 'menu'} onClose={closeSheet} />}
    </div>
  );
}
