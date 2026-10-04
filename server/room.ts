import type { Avatar } from '../shared/avatar';
import {
  CHAT_HISTORY_LENGTH,
  CHOOSE_TIME_SECONDS,
  DRAWER_DISCONNECT_GRACE_MS,
  MAX_ACTIONS_PER_TURN,
  MAX_POINTS_PER_STROKE,
  MAX_POINTS_PER_TURN,
  MIN_PLAYERS_TO_START,
  RECONNECT_GRACE_MS,
  TURN_END_SECONDS,
} from '../shared/constants';
import { containsWord, isCloseGuess, isCorrectGuess } from '../shared/guess';
import { hintCountFor, hintRevealOrder, hintSchedule, maskWord } from '../shared/hints';
import type {
  CanvasAction,
  ChatKind,
  ChatMessage,
  ClientMessage,
  DrawOp,
  ErrorCode,
  Phase,
  RoomState,
  ServerMessage,
  TurnEndReason,
} from '../shared/protocol';
import { drawerPoints, guesserPoints } from '../shared/scoring';
import { DEFAULT_SETTINGS, applySettingsPatch, type RoomSettings, type RoomSettingsPatch } from '../shared/settings';
import { buildWordPool, pickWords } from '../shared/words/index';
import { Player, type Rating } from './player';
import { systemClock, type Clock, type Rng, type Transport } from './transport';

/** Messages the connection layer hands to the room (session-level ones are handled before). */
export type RoomMessage = Exclude<ClientMessage, { t: 'create' | 'join' | 'rejoin' | 'leave' | 'ping' }>;

export type JoinResult = { ok: true; player: Player } | { ok: false; code: ErrorCode; message: string };

export interface RoomDeps {
  transport: Transport;
  clock?: Clock;
  rng?: Rng;
  /** Fired when the last seat (connected or in grace) is released. */
  onEmpty?: (room: Room) => void;
  /** Fired when an empty room gets a player again. */
  onOccupied?: (room: Room) => void;
}

type Timer = ReturnType<typeof setTimeout>;
type StrokeAction = Extract<CanvasAction, { kind: 'stroke' }>;
type Podium = Extract<Phase, { kind: 'gameEnd' }>['podium'];

interface TurnState {
  drawerId: string;
  choices: string[];
  /** Empty string until the drawer picked (or was auto-assigned) a word. */
  word: string;
  startedAt: number;
  endsAt: number;
  revealOrder: number[];
  revealed: number[];
  /** Correct guesses this turn; tallied as they happen so leavers still count for the drawer. */
  correct: number;
  /** Everyone who was a connected non-drawer at some point while the word was being drawn. */
  guesserIds: Set<string>;
}

/** How long truncated draw ops are batched before the drawer gets a full canvas resync. */
const CANVAS_RESYNC_DEBOUNCE_MS = 1000;

type InternalPhase =
  | { kind: 'lobby' }
  | { kind: 'choosing'; endsAt: number }
  | { kind: 'drawing' }
  | { kind: 'turnEnd'; reason: TurnEndReason; endsAt: number; points: Record<string, number> }
  | { kind: 'gameEnd'; podium: Podium };

const GAME_PHASES: ReadonlySet<InternalPhase['kind']> = new Set(['choosing', 'drawing', 'turnEnd']);

/** "Alice", "Alice and Bob", "Alice, Bob and Carol". */
function listNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? '';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}
const PUBLIC_CHAT_KINDS: ReadonlySet<ChatKind> = new Set(['chat', 'correct', 'system', 'hint']);

/**
 * One game room. Pure game logic: every side effect goes through `Transport`,
 * time through `Clock`, randomness through `Rng`, and scheduling through the
 * global `setTimeout` so vitest fake timers drive it.
 */
export class Room {
  readonly code: string;
  readonly createdAt: number;
  settings: RoomSettings = { ...DEFAULT_SETTINGS, customWords: [] };

  private readonly transport: Transport;
  private readonly clock: Clock;
  private readonly rng: Rng;
  private readonly onEmpty: ((room: Room) => void) | undefined;
  private readonly onOccupied: ((room: Room) => void) | undefined;

  private readonly players = new Map<string, Player>();
  private readonly byToken = new Map<string, Player>();
  private hostId = '';
  /** Host whose socket dropped: a connected stand-in holds the role until they rejoin or are removed. */
  private returningHostId: string | null = null;
  private nextJoinOrder = 0;

  private phase: InternalPhase = { kind: 'lobby' };
  private turn: TurnState | null = null;
  private round = 0;
  private turnQueue: string[] = [];
  private turnIndex = -1;
  private readonly usedWords = new Set<string>();

  private canvas: CanvasAction[] = [];
  private strokes = new Map<number, StrokeAction>();
  /** Flat coordinate numbers across every stroke in `canvas`; bounded by MAX_POINTS_PER_TURN. */
  private canvasPoints = 0;

  private chatLog: ChatMessage[] = [];
  private nextChatId = 1;

  /** targetId -> voter ids */
  private readonly votes = new Map<string, Set<string>>();

  private timers: {
    choose: Timer | null;
    draw: Timer | null;
    hints: Timer[];
    turnEnd: Timer | null;
    drawerGone: Timer | null;
    /** Pending "everyone (still connected) guessed" check after a guesser's socket dropped. */
    allGuessed: Timer | null;
    /** Pending canvas resync for a drawer whose ops the caps truncated. */
    resync: Timer | null;
  } = { choose: null, draw: null, hints: [], turnEnd: null, drawerGone: null, allGuessed: null, resync: null };
  private readonly graceTimers = new Map<string, Timer>();
  /** Pending "back to the lobby" check after a disconnect left too few players connected. */
  private lowPlayersTimer: Timer | null = null;
  private destroyed = false;

  constructor(code: string, deps: RoomDeps) {
    this.code = code;
    this.transport = deps.transport;
    this.clock = deps.clock ?? systemClock;
    this.rng = deps.rng ?? Math.random;
    this.onEmpty = deps.onEmpty;
    this.onOccupied = deps.onOccupied;
    this.createdAt = this.clock.now();
  }

  // ---------------------------------------------------------------------------
  // Queries
  // ---------------------------------------------------------------------------

  get hostPlayerId(): string {
    return this.hostId;
  }

  get phaseKind(): InternalPhase['kind'] {
    return this.phase.kind;
  }

  /** Seats taken, counting disconnected players still within their grace period. */
  get playerCount(): number {
    return this.players.size;
  }

  get connectedCount(): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected) n++;
    return n;
  }

  get isEmpty(): boolean {
    return this.players.size === 0;
  }

  get isFull(): boolean {
    return this.players.size >= this.settings.maxPlayers;
  }

  get inProgress(): boolean {
    return this.phase.kind !== 'lobby';
  }

  get isJoinable(): boolean {
    return !this.isFull && (!this.inProgress || this.settings.allowMidGameJoin);
  }

  get canvasHistory(): readonly CanvasAction[] {
    return this.canvas;
  }

  get currentWord(): string | null {
    return this.turn?.word || null;
  }

  getPlayer(id: string): Player | undefined {
    return this.players.get(id);
  }

  listPlayers(): Player[] {
    return [...this.players.values()].sort((a, b) => a.joinOrder - b.joinOrder);
  }

  /** Per-recipient snapshot. `recipient` may be null for a role-less view (used by HTTP previews/tests). */
  getState(recipient: Player | null): RoomState {
    return {
      code: this.code,
      hostId: this.hostId,
      settings: { ...this.settings, customWords: [...this.settings.customWords] },
      players: this.listPlayers().map((p) => p.toPublic(this.hostId)),
      phase: this.publicPhase(recipient),
      round: this.round,
      totalRounds: this.settings.rounds,
      turn: this.phase.kind === 'lobby' ? 0 : Math.min(this.turnIndex + 1, this.turnQueue.length),
      turnsInRound: this.phase.kind === 'lobby' ? 0 : this.turnQueue.length,
      serverTime: this.clock.now(),
    };
  }

  // ---------------------------------------------------------------------------
  // Seats: join / rejoin / leave / disconnect
  // ---------------------------------------------------------------------------

  join(name: string, avatar: Avatar, connectionId: string): JoinResult {
    if (this.destroyed) return { ok: false, code: 'ROOM_NOT_FOUND', message: 'This room no longer exists.' };
    if (this.isFull) return { ok: false, code: 'ROOM_FULL', message: 'This room is full.' };
    if (this.inProgress && !this.settings.allowMidGameJoin) {
      return { ok: false, code: 'GAME_IN_PROGRESS', message: 'A game is in progress and the host disabled mid-game joins.' };
    }
    const now = this.clock.now();
    const wasEmpty = this.players.size === 0;
    const player = new Player({ name, avatar, joinOrder: this.nextJoinOrder++, connectionId, now });
    this.players.set(player.id, player);
    this.byToken.set(player.token, player);
    if (!this.hostId) this.hostId = player.id;
    if (GAME_PHASES.has(this.phase.kind)) this.turnQueue.push(player.id);
    if (this.phase.kind === 'drawing') this.turn?.guesserIds.add(player.id);
    this.transport.attach(player.id, connectionId);
    if (wasEmpty) this.onOccupied?.(this);
    this.standInForAbsentHost();

    this.systemMessage(`${player.name} joined`, { except: player });
    this.sendWelcome(player);
    this.broadcastSnapshot({ except: player });
    this.resumeHeldTurn();
    return { ok: true, player };
  }

  rejoin(token: string, connectionId: string): JoinResult {
    const player = this.byToken.get(token);
    if (!player || this.destroyed) {
      return { ok: false, code: 'REJOIN_FAILED', message: 'Your seat in this room has expired.' };
    }
    const wasConnected = player.connected;
    this.clearGraceTimer(player.id);
    player.markConnected(connectionId, this.clock.now());
    this.transport.attach(player.id, connectionId);
    if (this.turn?.drawerId === player.id && this.timers.drawerGone) {
      clearTimeout(this.timers.drawerGone);
      this.timers.drawerGone = null;
    }
    if (this.phase.kind === 'drawing' && this.turn && this.turn.drawerId !== player.id) this.turn.guesserIds.add(player.id);
    if (this.connectedCount >= MIN_PLAYERS_TO_START) this.clearLowPlayersTimer();
    if (this.returningHostId === player.id) {
      this.returningHostId = null;
      if (this.hostId !== player.id) {
        this.hostId = player.id;
        this.systemMessage(`${player.name} is the host again`, { except: player });
      }
    }

    this.sendWelcome(player);
    if (!wasConnected) {
      this.systemMessage(`${player.name} reconnected`, { except: player });
      this.broadcastSnapshot({ except: player });
    }
    this.resumeHeldTurn();
    return { ok: true, player };
  }

  /** Explicit "leave room": the seat is released immediately. */
  leave(player: Player): void {
    if (!this.players.has(player.id)) return;
    this.removePlayer(player, 'left');
  }

  /**
   * The player's socket went away. The seat is kept for RECONNECT_GRACE_MS.
   * `connectionId` lets stale sockets (already replaced by a rejoin) be ignored.
   */
  handleDisconnect(player: Player, connectionId?: string): void {
    const current = this.players.get(player.id);
    if (!current || this.destroyed) return;
    if (connectionId !== undefined && current.connectionId !== connectionId) return;
    if (!current.connected) return;

    current.markDisconnected(this.clock.now());
    // Votes the leaver cast no longer count (only connected players make up the majority); votes
    // against them stay so a reconnect cannot wipe the tally.
    this.withdrawVotes(current.id);
    this.graceTimers.set(
      current.id,
      setTimeout(() => this.removePlayer(current, 'left'), RECONNECT_GRACE_MS),
    );

    // The room must stay operable while the host is away: a connected player stands in and the
    // role is handed back when the host rejoins.
    if (current.id === this.hostId) this.standInForAbsentHost();

    if (this.turn?.drawerId === current.id && (this.phase.kind === 'choosing' || this.phase.kind === 'drawing')) {
      this.timers.drawerGone = setTimeout(() => {
        this.timers.drawerGone = null;
        this.systemMessage(`${current.name} lost connection — skipping their turn.`);
        this.endTurn('drawerLeft');
      }, DRAWER_DISCONNECT_GRACE_MS);
    }

    // A dropped socket is usually a reload or a flaky network: give the player a moment to come
    // back before abandoning the game (an explicit leave or kick abandons it immediately).
    if (GAME_PHASES.has(this.phase.kind) && this.connectedCount < MIN_PLAYERS_TO_START && !this.lowPlayersTimer) {
      this.lowPlayersTimer = setTimeout(() => {
        this.lowPlayersTimer = null;
        if (!this.ensureEnoughPlayers()) this.resumeHeldTurn();
      }, DRAWER_DISCONNECT_GRACE_MS);
    }
    // Likewise the last unsolved guesser gets the same grace before "everyone guessed" ends the turn.
    if (this.phase.kind === 'drawing' && this.everyoneGuessed() && !this.timers.allGuessed) {
      this.timers.allGuessed = setTimeout(() => {
        this.timers.allGuessed = null;
        if (this.phase.kind === 'drawing' && this.everyoneGuessed()) this.endTurn('allGuessed');
      }, DRAWER_DISCONNECT_GRACE_MS);
    }
    if (this.resolveVotes()) return;
    this.broadcastSnapshot();
  }

  // ---------------------------------------------------------------------------
  // Message routing
  // ---------------------------------------------------------------------------

  handleMessage(player: Player, msg: RoomMessage): void {
    if (this.destroyed || !this.players.has(player.id)) return;
    player.lastSeen = this.clock.now();
    switch (msg.t) {
      case 'updateSettings':
        return this.updateSettings(player, msg.settings);
      case 'updateProfile':
        return this.updateProfile(player, msg.name, msg.avatar);
      case 'start':
        return this.start(player);
      case 'chooseWord':
        return this.chooseWord(player, msg.index);
      case 'draw':
        return this.draw(player, msg.ops);
      case 'undo':
        return this.undo(player);
      case 'clear':
        return this.clear(player);
      case 'chat':
        return this.chat(player, msg.text);
      case 'kick':
        return this.kick(player, msg.playerId);
      case 'voteKick':
        return this.voteKick(player, msg.playerId);
      case 'rate':
        return this.rate(player, msg.value);
      case 'returnToLobby':
        return this.returnToLobby(player);
    }
  }

  // ---------------------------------------------------------------------------
  // Lobby actions
  // ---------------------------------------------------------------------------

  private updateSettings(player: Player, patch: RoomSettingsPatch): void {
    if (!this.requireHost(player) || !this.requirePhase(player, 'lobby', 'Settings can only be changed in the lobby.')) return;
    const next = applySettingsPatch(this.settings, patch);
    // Never let the room shrink below the people already in it.
    next.maxPlayers = Math.max(next.maxPlayers, this.players.size);
    this.settings = next;
    this.broadcastSnapshot();
  }

  private updateProfile(player: Player, name: string | undefined, avatar: Avatar | undefined): void {
    if (!this.requirePhase(player, 'lobby', 'You can only change your profile in the lobby.')) return;
    if (name !== undefined) player.name = name;
    if (avatar !== undefined) player.avatar = { ...avatar };
    this.broadcastSnapshot();
  }

  private start(player: Player): void {
    if (!this.requireHost(player) || !this.requirePhase(player, 'lobby', 'The game has already started.')) return;
    if (this.connectedCount < MIN_PLAYERS_TO_START) {
      return this.fail(player, 'NOT_ALLOWED', `You need at least ${MIN_PLAYERS_TO_START} connected players to start.`);
    }
    for (const p of this.players.values()) p.resetForGame();
    this.usedWords.clear();
    this.votes.clear();
    this.round = 1;
    this.turnQueue = this.listPlayers()
      .filter((p) => p.connected)
      .map((p) => p.id);
    this.turnIndex = -1;
    this.systemMessage('The game has started!');
    this.beginNextTurn();
  }

  private returnToLobby(player: Player): void {
    if (!this.requireHost(player) || !this.requirePhase(player, 'gameEnd', 'You can only return to the lobby after the game ends.')) return;
    this.resetToLobby();
  }

  // ---------------------------------------------------------------------------
  // Turn lifecycle
  // ---------------------------------------------------------------------------

  private beginNextTurn(): void {
    this.clearTurnTimers();
    if (this.connectedCount < MIN_PLAYERS_TO_START) {
      if (this.phase.kind === 'turnEnd' && this.lowPlayersTimer) {
        // Someone is in their reconnect grace: hold at the summary. rejoin() resumes the game,
        // the pending low-player check sends everyone back to the lobby otherwise.
        const away = this.listPlayers().filter((p) => !p.connected).map((p) => p.name);
        this.systemMessage(`Waiting for ${away.join(', ')} to reconnect…`);
        return;
      }
      this.systemMessage('Not enough players — back to the lobby.');
      this.resetToLobby();
      return;
    }
    for (;;) {
      this.turnIndex += 1;
      if (this.turnIndex >= this.turnQueue.length) {
        if (this.round >= this.settings.rounds) return this.finishGame();
        this.round += 1;
        this.turnQueue = this.listPlayers().map((p) => p.id);
        this.turnIndex = -1;
        continue;
      }
      const drawer = this.players.get(this.turnQueue[this.turnIndex]);
      if (!drawer || !drawer.connected) {
        // Skipped drawers leave the schedule so turn/turnsInRound stay accurate.
        this.turnQueue.splice(this.turnIndex, 1);
        this.turnIndex -= 1;
        continue;
      }
      return this.startChoosing(drawer);
    }
  }

  private startChoosing(drawer: Player): void {
    const now = this.clock.now();
    for (const p of this.players.values()) p.resetForTurn();
    drawer.guessedThisTurn = true;
    this.resetCanvas();
    this.broadcast({ t: 'clear' });

    const pool = buildWordPool(this.settings.language, this.settings.customWords, this.settings.customWordsOnly);
    const choices = pickWords(pool, this.settings.wordChoices, this.usedWords, this.rng);
    this.turn = { drawerId: drawer.id, choices, word: '', startedAt: 0, endsAt: 0, revealOrder: [], revealed: [], correct: 0, guesserIds: new Set() };
    if (choices.length === 0) {
      this.phase = { kind: 'choosing', endsAt: now };
      return this.endTurn('noWordChosen');
    }
    this.phase = { kind: 'choosing', endsAt: now + CHOOSE_TIME_SECONDS * 1000 };
    this.timers.choose = setTimeout(() => {
      const d = this.players.get(drawer.id);
      if (!d || !d.connected) return this.endTurn('drawerLeft');
      this.startDrawing(choices[0]);
    }, CHOOSE_TIME_SECONDS * 1000);
    this.broadcastSnapshot();
  }

  private chooseWord(player: Player, index: number): void {
    if (this.phase.kind !== 'choosing' || this.turn?.drawerId !== player.id) {
      return this.fail(player, 'NOT_ALLOWED', 'You are not choosing a word right now.');
    }
    const word = this.turn.choices[index];
    if (word === undefined) return this.fail(player, 'NOT_ALLOWED', 'That is not one of your choices.');
    this.startDrawing(word);
  }

  private startDrawing(word: string): void {
    if (!this.turn) return;
    if (this.timers.choose) clearTimeout(this.timers.choose);
    this.timers.choose = null;
    const now = this.clock.now();
    const drawTimeMs = this.settings.drawTime * 1000;
    this.usedWords.add(word.toLowerCase());
    const hintCount = hintCountFor(word, this.settings.hints);
    this.turn.word = word;
    this.turn.startedAt = now;
    this.turn.endsAt = now + drawTimeMs;
    this.turn.revealOrder = hintRevealOrder(word, hintCount, this.rng);
    this.turn.revealed = [];
    this.turn.correct = 0;
    this.turn.guesserIds = new Set();
    for (const p of this.players.values()) if (p.connected && p.id !== this.turn.drawerId) this.turn.guesserIds.add(p.id);
    this.phase = { kind: 'drawing' };

    this.timers.hints = hintSchedule(drawTimeMs, hintCount).map((offset, i) =>
      setTimeout(() => this.revealHint(i), offset),
    );
    this.timers.draw = setTimeout(() => this.endTurn('timeUp'), drawTimeMs);
    this.broadcastSnapshot();
  }

  private revealHint(i: number): void {
    if (this.phase.kind !== 'drawing' || !this.turn) return;
    const idx = this.turn.revealOrder[i];
    if (idx === undefined || this.turn.revealed.includes(idx)) return;
    this.turn.revealed.push(idx);
    this.broadcastSnapshot();
  }

  private endTurn(reason: TurnEndReason): void {
    const turn = this.turn;
    if (!turn || (this.phase.kind !== 'choosing' && this.phase.kind !== 'drawing')) return;
    this.clearTurnTimers();
    const now = this.clock.now();

    const drawer = this.players.get(turn.drawerId);
    if (drawer && reason !== 'drawerLeft' && reason !== 'noWordChosen') {
      // Per-turn tallies, not the current player map: a guesser who dropped or left after
      // solving still counts, and one who dropped without solving still dilutes the share.
      const pts = drawerPoints(turn.correct, turn.guesserIds.size);
      drawer.score += pts;
      drawer.turnPoints += pts;
    }

    const points: Record<string, number> = {};
    for (const p of this.players.values()) if (p.turnPoints > 0) points[p.id] = p.turnPoints;

    this.phase = { kind: 'turnEnd', reason, endsAt: now + TURN_END_SECONDS * 1000, points };
    if (turn.word) this.pushChat('hint', `The word was: ${turn.word}`);
    this.broadcastSnapshot();
    this.timers.turnEnd = setTimeout(() => this.beginNextTurn(), TURN_END_SECONDS * 1000);
  }

  private finishGame(): void {
    this.clearTurnTimers();
    this.clearLowPlayersTimer();
    this.turn = null;
    const ranked = [...this.players.values()].sort((a, b) => b.score - a.score || a.joinOrder - b.joinOrder);
    const podium: Podium = ranked.map((p) => ({
      playerId: p.id,
      score: p.score,
      rank: 1 + ranked.filter((o) => o.score > p.score).length,
    }));
    this.phase = { kind: 'gameEnd', podium };
    const winners = ranked.filter((p) => p.score === ranked[0]?.score);
    if (winners.length === 0) this.systemMessage('Game over!');
    else if (winners.length === 1) this.systemMessage(`Game over! ${winners[0].name} wins with ${winners[0].score} points.`);
    else this.systemMessage(`Game over! ${listNames(winners.map((p) => p.name))} tie with ${winners[0].score} points.`);
    this.broadcastSnapshot();
  }

  private resetToLobby(): void {
    this.clearTurnTimers();
    this.clearLowPlayersTimer();
    this.turn = null;
    this.phase = { kind: 'lobby' };
    this.round = 0;
    this.turnIndex = -1;
    this.turnQueue = [];
    this.usedWords.clear();
    this.votes.clear();
    for (const p of this.players.values()) p.resetForGame();
    this.resetCanvas();
    this.broadcast({ t: 'clear' });
    this.broadcastSnapshot();
  }

  /** Continues a turn boundary that beginNextTurn held while a player was in reconnect grace. */
  private resumeHeldTurn(): void {
    if (this.phase.kind === 'turnEnd' && !this.timers.turnEnd) this.beginNextTurn();
  }

  /** Returns true when the game had to be abandoned for lack of players. */
  private ensureEnoughPlayers(): boolean {
    if (!GAME_PHASES.has(this.phase.kind)) return false;
    if (this.connectedCount >= MIN_PLAYERS_TO_START) return false;
    this.systemMessage('Not enough players — back to the lobby.');
    this.resetToLobby();
    return true;
  }

  private everyoneGuessed(): boolean {
    if (!this.turn) return false;
    let pending = 0;
    let guessers = 0;
    for (const p of this.players.values()) {
      if (p.id === this.turn.drawerId || !p.connected) continue;
      guessers++;
      if (!p.guessedThisTurn) pending++;
    }
    return guessers > 0 && pending === 0;
  }

  // ---------------------------------------------------------------------------
  // Chat & guessing
  // ---------------------------------------------------------------------------

  private chat(player: Player, text: string): void {
    const turn = this.turn;
    if (!turn || (this.phase.kind !== 'drawing' && this.phase.kind !== 'choosing')) {
      this.pushChat('chat', text, player);
      return;
    }
    if (player.id === turn.drawerId) {
      // While choosing, the drawer already knows every candidate: none of them may reach the guessers.
      const secrets = this.phase.kind === 'choosing' ? turn.choices : [turn.word];
      if (secrets.some((w) => containsWord(text, w))) {
        return this.sendPrivate(player, 'system', "You can't give away the word!");
      }
      return this.pushChat('guessed', text, player, this.guessedRecipients());
    }
    if (this.phase.kind === 'choosing') {
      this.pushChat('chat', text, player);
      return;
    }
    if (player.guessedThisTurn) {
      return this.pushChat('guessed', text, player, this.guessedRecipients());
    }
    if (isCorrectGuess(text, turn.word)) {
      const remaining = Math.max(0, turn.endsAt - this.clock.now());
      const pts = guesserPoints(remaining, this.settings.drawTime * 1000);
      player.guessedThisTurn = true;
      player.score += pts;
      player.turnPoints += pts;
      turn.correct += 1;
      turn.guesserIds.add(player.id);
      this.pushChat('correct', `${player.name} guessed the word!`, player);
      if (this.everyoneGuessed()) return this.endTurn('allGuessed');
      this.broadcastSnapshot();
      return;
    }
    this.pushChat('chat', text, player);
    if (isCloseGuess(text, turn.word)) this.sendPrivate(player, 'close', `'${text}' is close!`);
  }

  private guessedRecipients(): Player[] {
    return [...this.players.values()].filter((p) => p.connected && p.guessedThisTurn);
  }

  // ---------------------------------------------------------------------------
  // Canvas
  // ---------------------------------------------------------------------------

  private requireDrawer(player: Player): boolean {
    if (this.phase.kind === 'drawing' && this.turn?.drawerId === player.id) return true;
    // Ops the drawer had in flight when their turn ended are expected; only strangers get an error.
    if (this.turn?.drawerId !== player.id) this.fail(player, 'NOT_ALLOWED', 'Only the drawer can draw right now.');
    return false;
  }

  private draw(player: Player, ops: DrawOp[]): void {
    if (!this.requireDrawer(player)) return;
    const accepted: DrawOp[] = [];
    let truncated = false;
    for (const op of ops) {
      const kept = this.applyDrawOp(op);
      if (kept) accepted.push(kept);
      if (kept !== op && op.k !== 'end') truncated = true;
    }
    if (accepted.length > 0) this.broadcast({ t: 'draw', ops: accepted }, { except: player });
    // The drawer applied the full ops locally; bring their canvas back to what everyone else has.
    if (truncated) this.scheduleCanvasResync(player);
  }

  private scheduleCanvasResync(drawer: Player): void {
    if (this.timers.resync) return;
    this.timers.resync = setTimeout(() => {
      this.timers.resync = null;
      if (this.phase.kind !== 'drawing' || this.turn?.drawerId !== drawer.id) return;
      this.send(drawer, { t: 'canvas', actions: this.canvasSnapshot() });
    }, CANVAS_RESYNC_DEBOUNCE_MS);
  }

  /** Applies one op to the history; returns the (possibly truncated) op to forward, or null to drop it. */
  private applyDrawOp(op: DrawOp): DrawOp | null {
    switch (op.k) {
      case 'start': {
        if (this.canvas.length >= MAX_ACTIONS_PER_TURN || this.strokes.has(op.id)) return null;
        if (this.canvasPoints + 2 > MAX_POINTS_PER_TURN) return null;
        const stroke: StrokeAction = { kind: 'stroke', id: op.id, tool: op.tool, color: op.color, size: op.size, points: [op.x, op.y] };
        this.canvas.push(stroke);
        this.strokes.set(op.id, stroke);
        this.canvasPoints += 2;
        return op;
      }
      case 'move': {
        const stroke = this.strokes.get(op.id);
        if (!stroke) return null;
        const room = Math.min(MAX_POINTS_PER_STROKE - stroke.points.length, MAX_POINTS_PER_TURN - this.canvasPoints);
        if (room < 2) return null;
        const pts = op.pts.length > room ? op.pts.slice(0, room - (room % 2)) : op.pts;
        stroke.points.push(...pts);
        this.canvasPoints += pts.length;
        return pts === op.pts ? op : { ...op, pts };
      }
      case 'end': {
        const stroke = this.strokes.get(op.id);
        if (!stroke) return null;
        stroke.done = true;
        return op;
      }
      case 'fill': {
        if (this.canvas.length >= MAX_ACTIONS_PER_TURN) return null;
        this.canvas.push({ kind: 'fill', x: op.x, y: op.y, color: op.color });
        return op;
      }
    }
  }

  private undo(player: Player): void {
    if (!this.requireDrawer(player)) return;
    const last = this.canvas.pop();
    if (!last) return;
    if (last.kind === 'stroke') {
      this.strokes.delete(last.id);
      this.canvasPoints -= last.points.length;
    }
    this.broadcast({ t: 'undo' });
  }

  private clear(player: Player): void {
    if (!this.requireDrawer(player)) return;
    this.resetCanvas();
    this.broadcast({ t: 'clear' });
  }

  private resetCanvas(): void {
    this.canvas = [];
    this.strokes = new Map();
    this.canvasPoints = 0;
  }

  // ---------------------------------------------------------------------------
  // Ratings, kicks, host
  // ---------------------------------------------------------------------------

  private rate(player: Player, value: Rating): void {
    if (this.phase.kind !== 'drawing' || !this.turn) return this.fail(player, 'NOT_ALLOWED', 'There is nothing to rate right now.');
    if (this.turn.drawerId === player.id) return this.fail(player, 'NOT_ALLOWED', "You can't rate your own drawing.");
    player.rating = player.rating === value ? null : value;
    this.broadcastSnapshot();
  }

  private kick(player: Player, targetId: string): void {
    if (!this.requireHost(player)) return;
    const target = this.players.get(targetId);
    if (!target) return this.fail(player, 'NOT_ALLOWED', 'That player is not in the room.');
    if (target.id === player.id) return this.fail(player, 'NOT_ALLOWED', "You can't kick yourself.");
    this.removePlayer(target, 'kicked', 'You were kicked by the host.');
  }

  private voteKick(player: Player, targetId: string): void {
    const target = this.players.get(targetId);
    if (!target) return this.fail(player, 'NOT_ALLOWED', 'That player is not in the room.');
    if (target.id === player.id) return this.fail(player, 'NOT_ALLOWED', "You can't vote to kick yourself.");
    // With one other player a "vote" would be a unilateral kick (of the host, even).
    if (this.othersConnected(target) < 2) {
      return this.fail(player, 'NOT_ALLOWED', 'A vote needs at least two other connected players.');
    }
    let voters = this.votes.get(target.id);
    if (!voters) {
      voters = new Set();
      this.votes.set(target.id, voters);
    }
    if (voters.has(player.id)) return;
    voters.add(player.id);
    if (this.resolveVotes()) return;
    this.systemMessage(`${player.name} voted to kick ${target.name} (${voters.size}/${this.votesNeeded(target)})`);
  }

  private othersConnected(target: Player): number {
    let n = 0;
    for (const p of this.players.values()) if (p.connected && p.id !== target.id) n++;
    return n;
  }

  /** A majority of the other connected players, and never a single voter. */
  private votesNeeded(target: Player): number {
    return Math.max(2, Math.floor(this.othersConnected(target) / 2) + 1);
  }

  private withdrawVotes(voterId: string): void {
    for (const [targetId, voters] of this.votes) {
      voters.delete(voterId);
      if (voters.size === 0) this.votes.delete(targetId);
    }
  }

  /**
   * Kicks the first target whose tally meets the threshold, which can also happen when the
   * threshold drops because a voter's peer left. Returns true when someone was removed.
   */
  private resolveVotes(): boolean {
    for (const [targetId, voters] of this.votes) {
      const target = this.players.get(targetId);
      if (!target) {
        this.votes.delete(targetId);
        continue;
      }
      if (voters.size >= this.votesNeeded(target)) {
        this.votes.delete(targetId);
        this.removePlayer(target, 'kicked', 'You were kicked by a vote.');
        return true;
      }
    }
    return false;
  }

  private removePlayer(player: Player, how: 'left' | 'kicked', kickReason?: string): void {
    if (!this.players.has(player.id)) return;
    this.clearGraceTimer(player.id);
    if (how === 'kicked') {
      this.send(player, { t: 'kicked', reason: kickReason ?? 'You were removed from the room.' });
      this.transport.close(player.id);
    }
    this.players.delete(player.id);
    this.byToken.delete(player.token);
    player.token = '';
    player.connectionId = null;
    player.connected = false;

    const queued = this.turnQueue.indexOf(player.id);
    if (queued > this.turnIndex) this.turnQueue.splice(queued, 1);
    this.votes.delete(player.id);
    this.withdrawVotes(player.id);
    if (this.returningHostId === player.id) this.returningHostId = null;

    this.systemMessage(how === 'kicked' ? `${player.name} was kicked` : `${player.name} left`);
    if (player.id === this.hostId) this.transferHost();

    if (this.players.size === 0) {
      this.clearTurnTimers();
      this.clearLowPlayersTimer();
      this.turn = null;
      this.phase = { kind: 'lobby' };
      this.round = 0;
      this.turnIndex = -1;
      this.turnQueue = [];
      // The next group to pick up this code must not inherit the last drawing.
      this.resetCanvas();
      this.onEmpty?.(this);
      return;
    }
    // One player fewer can lower a pending vote's threshold to what is already tallied.
    this.resolveVotes();
    if (this.ensureEnoughPlayers()) return;
    if (this.turn?.drawerId === player.id && (this.phase.kind === 'choosing' || this.phase.kind === 'drawing')) {
      return this.endTurn('drawerLeft');
    }
    if (this.phase.kind === 'drawing' && this.everyoneGuessed()) return this.endTurn('allGuessed');
    this.broadcastSnapshot();
  }

  /**
   * While the host's socket is down, a connected player holds the role (rejoin() hands it back).
   * Called after a disconnect and after a join: a lone host who dropped must not lock the room for
   * whoever arrives during their grace.
   */
  private standInForAbsentHost(): void {
    const host = this.players.get(this.hostId);
    if (!host || host.connected || this.connectedCount === 0) return;
    if (this.returningHostId === null) this.returningHostId = host.id;
    this.transferHost();
  }

  private transferHost(): void {
    const candidates = [...this.players.values()].sort((a, b) => {
      if (a.connected !== b.connected) return a.connected ? -1 : 1;
      return a.connectedAt - b.connectedAt || a.joinOrder - b.joinOrder;
    });
    const next = candidates[0];
    this.hostId = next ? next.id : '';
    if (next) this.systemMessage(`${next.name} is now the host`);
  }

  // ---------------------------------------------------------------------------
  // Messaging helpers
  // ---------------------------------------------------------------------------

  private sendWelcome(player: Player): void {
    this.send(player, {
      t: 'welcome',
      playerId: player.id,
      token: player.token,
      room: this.getState(player),
      canvas: this.canvasSnapshot(),
      chat: [...this.chatLog],
    });
  }

  private canvasSnapshot(): CanvasAction[] {
    return this.canvas.map((a) => (a.kind === 'stroke' ? { ...a, points: [...a.points] } : { ...a }));
  }

  private publicPhase(recipient: Player | null): Phase {
    const turn = this.turn;
    switch (this.phase.kind) {
      case 'lobby':
        return { kind: 'lobby' };
      case 'choosing': {
        const base = { kind: 'choosing' as const, drawerId: turn?.drawerId ?? '', endsAt: this.phase.endsAt };
        return recipient && recipient.id === turn?.drawerId ? { ...base, choices: [...(turn?.choices ?? [])] } : base;
      }
      case 'drawing': {
        let likes = 0;
        let dislikes = 0;
        for (const p of this.players.values()) {
          if (p.rating === 'like') likes++;
          else if (p.rating === 'dislike') dislikes++;
        }
        const word = turn?.word ?? '';
        const phase: Phase = {
          kind: 'drawing',
          drawerId: turn?.drawerId ?? '',
          startedAt: turn?.startedAt ?? 0,
          endsAt: turn?.endsAt ?? 0,
          mask: maskWord(word, turn?.revealed ?? []),
          likes,
          dislikes,
        };
        if (recipient && (recipient.id === turn?.drawerId || recipient.guessedThisTurn)) phase.word = word;
        if (recipient?.rating) phase.myRating = recipient.rating;
        return phase;
      }
      case 'turnEnd':
        return {
          kind: 'turnEnd',
          drawerId: turn?.drawerId ?? '',
          word: turn?.word ?? '',
          reason: this.phase.reason,
          endsAt: this.phase.endsAt,
          points: { ...this.phase.points },
        };
      case 'gameEnd':
        return { kind: 'gameEnd', podium: this.phase.podium.map((e) => ({ ...e })) };
    }
  }

  private send(player: Player, msg: ServerMessage): void {
    if (!player.connected) return;
    this.transport.send(player.id, msg);
  }

  private broadcast(msg: ServerMessage, opts: { except?: Player } = {}): void {
    for (const p of this.players.values()) {
      if (p.connected && p !== opts.except) this.transport.send(p.id, msg);
    }
  }

  private broadcastSnapshot(opts: { except?: Player } = {}): void {
    for (const p of this.players.values()) {
      if (p.connected && p !== opts.except) this.transport.send(p.id, { t: 'room', room: this.getState(p) });
    }
  }

  private fail(player: Player, code: ErrorCode, message: string): void {
    this.send(player, { t: 'error', code, message });
  }

  private requireHost(player: Player): boolean {
    if (player.id === this.hostId) return true;
    this.fail(player, 'NOT_ALLOWED', 'Only the host can do that.');
    return false;
  }

  private requirePhase(player: Player, kind: InternalPhase['kind'], message: string): boolean {
    if (this.phase.kind === kind) return true;
    this.fail(player, 'NOT_ALLOWED', message);
    return false;
  }

  /**
   * Creates a chat message. Public kinds are stored for late joiners; `recipients`
   * defaults to everyone connected.
   */
  private pushChat(kind: ChatKind, text: string, from?: Player, recipients?: Player[], except?: Player): void {
    const message: ChatMessage = { id: this.nextChatId++, kind, text, ts: this.clock.now() };
    if (from) {
      message.playerId = from.id;
      message.name = from.name;
    }
    if (PUBLIC_CHAT_KINDS.has(kind)) {
      this.chatLog.push(message);
      if (this.chatLog.length > CHAT_HISTORY_LENGTH) this.chatLog = this.chatLog.slice(-CHAT_HISTORY_LENGTH);
    }
    const targets = recipients ?? [...this.players.values()];
    for (const p of targets) {
      if (p.connected && p !== except) this.transport.send(p.id, { t: 'chat', message });
    }
  }

  private systemMessage(text: string, opts: { except?: Player } = {}): void {
    this.pushChat('system', text, undefined, undefined, opts.except);
  }

  /** A message only the recipient sees; never stored in the history. */
  private sendPrivate(player: Player, kind: 'system' | 'close', text: string): void {
    const message: ChatMessage = { id: this.nextChatId++, kind, text, ts: this.clock.now() };
    this.send(player, { t: 'chat', message });
  }

  // ---------------------------------------------------------------------------
  // Timers
  // ---------------------------------------------------------------------------

  private clearTurnTimers(): void {
    const t = this.timers;
    if (t.choose) clearTimeout(t.choose);
    if (t.draw) clearTimeout(t.draw);
    if (t.turnEnd) clearTimeout(t.turnEnd);
    if (t.drawerGone) clearTimeout(t.drawerGone);
    if (t.allGuessed) clearTimeout(t.allGuessed);
    if (t.resync) clearTimeout(t.resync);
    for (const h of t.hints) clearTimeout(h);
    this.timers = { choose: null, draw: null, hints: [], turnEnd: null, drawerGone: null, allGuessed: null, resync: null };
  }

  private clearLowPlayersTimer(): void {
    if (this.lowPlayersTimer) clearTimeout(this.lowPlayersTimer);
    this.lowPlayersTimer = null;
  }

  private clearGraceTimer(playerId: string): void {
    const timer = this.graceTimers.get(playerId);
    if (timer) clearTimeout(timer);
    this.graceTimers.delete(playerId);
  }

  /** Stops every timer; the room must not be used afterwards. */
  destroy(): void {
    this.destroyed = true;
    this.clearTurnTimers();
    this.clearLowPlayersTimer();
    for (const id of [...this.graceTimers.keys()]) this.clearGraceTimer(id);
    for (const p of this.players.values()) {
      this.byToken.delete(p.token);
      p.token = '';
    }
    this.players.clear();
  }
}
