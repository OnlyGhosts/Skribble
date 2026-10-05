import type { SpygameRoomState, SpygameView, SpygameVoteView } from '@shared/games/spygame/protocol';
import { Avatar } from '../../../platform/components/Avatar';
import { BottomSheet } from '../../../platform/components/BottomSheet';
import { Timer } from '../../../platform/components/Timer';
import { castVote } from '../actions';
import { nameOf, playerOf, voteRoleOf, type VoteRole } from '../hooks';
import { useSpygame } from '../store';

interface Props {
  room: SpygameRoomState;
  view: SpygameView;
  meId: string;
}

/** Votes cast so far. No "to go" count: the number of voters would tell the room whether the accused is the spy. */
function Tally({ vote, testId }: { vote: SpygameVoteView; testId: string }) {
  return (
    <div className="spy-vote__tally" role="status" data-testid={testId} data-yes={vote.yes} data-no={vote.no}>
      <span className="spy-vote__count spy-vote__count--yes">
        <strong>{vote.yes}</strong> yes
      </span>
      <span className="spy-vote__count spy-vote__count--no">
        <strong>{vote.no}</strong> no
      </span>
    </div>
  );
}

function statusLine(role: VoteRole, accusedName: string): string {
  switch (role) {
    case 'accuser':
      return "You started this vote — you're counted as Yes.";
    case 'accused':
      return "You've been accused! You can't vote on yourself.";
    case 'voter':
      return `Is ${accusedName} the spy?`;
    case 'watcher':
      return "You don't vote in this one.";
  }
}

function Buttons({ vote }: { vote: SpygameVoteView }) {
  return (
    <div className="spy-vote__buttons" role="group" aria-label="Your vote">
      <button type="button" className={`btn btn--lg spy-vote__btn spy-vote__btn--yes${vote.myVote === true ? ' is-active' : ''}`} onClick={() => castVote(true)} aria-pressed={vote.myVote === true} data-testid="vote-yes">
        Yes, spy
      </button>
      <button type="button" className={`btn btn--lg spy-vote__btn spy-vote__btn--no${vote.myVote === false ? ' is-active' : ''}`} onClick={() => castVote(false)} aria-pressed={vote.myVote === false} data-testid="vote-no">
        No
      </button>
    </div>
  );
}

/** The accusation, the live tally and the countdown; voters get their Yes/No in the sheet, under the countdown. */
function VoteBody({ room, view, meId, role, withButtons, testIdPrefix }: Props & { role: VoteRole; withButtons: boolean; testIdPrefix: string }) {
  const vote = view.vote;
  if (!vote) return null;
  const accuser = playerOf(room, vote.accuserId);
  const accused = playerOf(room, vote.accusedId);
  const accusedName = nameOf(room, vote.accusedId);
  return (
    <div className={`spy-vote spy-vote--${role}${withButtons ? ' spy-vote--sheet' : ''}`} data-testid={testIdPrefix} data-role={role}>
      <div className="spy-vote__who">
        <span className="spy-vote__person">
          {accuser && <Avatar avatar={accuser.avatar} size="md" />}
          <span>{nameOf(room, vote.accuserId)}</span>
        </span>
        <span className="spy-vote__accuses">accuses</span>
        <span className="spy-vote__person spy-vote__person--accused">
          {accused && <Avatar avatar={accused.avatar} size="md" />}
          <span>{accusedName}</span>
        </span>
      </div>
      <p className={`spy-vote__status${role === 'accused' ? ' spy-vote__status--accused' : ''}`}>{statusLine(role, accusedName)}</p>
      <div className="spy-vote__foot">
        <Tally vote={vote} testId={`${testIdPrefix}-tally`} />
        <Timer endsAt={vote.endsAt} size="md" warnUnder={5} />
      </div>
      {withButtons && role === 'voter' && <Buttons vote={vote} />}
      {role === 'voter' && vote.myVote !== null && <p className="spy-vote__mine">You voted {vote.myVote ? 'Yes' : 'No'}. You can change it until the vote closes.</p>}
    </div>
  );
}

/** The inline vote panel everyone sees while a vote runs (voters reopen the sheet from it). */
export function VotePanel(props: Props) {
  const open = useSpygame((s) => s.setVoteSheetOpen);
  const sheetOpen = useSpygame((s) => s.voteSheetOpen);
  const role = voteRoleOf(props.view, props.meId);
  if (!props.view.vote) return null;
  return (
    <section className="card spy-vote-card" aria-label="Vote">
      <VoteBody {...props} role={role} withButtons={false} testIdPrefix="vote-panel" />
      {role === 'voter' && !sheetOpen && (
        <button type="button" className="btn btn--primary btn--block" onClick={() => open(true)} data-testid="vote-open">
          Cast your vote
        </button>
      )}
    </section>
  );
}

/** The modal sheet with the Yes/No buttons, for eligible voters. */
export function VoteSheet(props: Props) {
  const sheetOpen = useSpygame((s) => s.voteSheetOpen);
  const setOpen = useSpygame((s) => s.setVoteSheetOpen);
  const role = voteRoleOf(props.view, props.meId);
  const open = sheetOpen && role === 'voter' && props.view.vote !== null;
  return (
    <BottomSheet open={open} title="Vote now" onClose={() => setOpen(false)} testId="vote-sheet">
      <VoteBody {...props} role={role} withButtons testIdPrefix="vote" />
    </BottomSheet>
  );
}
