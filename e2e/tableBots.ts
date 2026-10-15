import WebSocket from 'ws';

/**
 * Players on bare sockets for the card-table specs: each joins a room, readies up in the lobby,
 * bets a chip when the bets open (Blackjack) and plays its turn when it comes (a stand, or a check
 * or call in Poker), so a table can be filled to the room limit without a browser per seat. A bot
 * can hold its turn (`hold`) until the spec lets it go, to keep the table on someone else's turn.
 */
export interface TableBot {
  name: string;
  id: string | null;
  /** Keeps the turn instead of playing it; letting go plays it at once. */
  setHold(hold: boolean): void;
  /** Errors the server sent back, for a failing spec to print. */
  errors: string[];
  close(): void;
}

type BotRoom = {
  phase: string;
  game: {
    phase: string;
    round?: number;
    hand?: number;
    order: string[];
    turn: { playerId: string } | string | null;
    players: Record<string, { bet: number }>;
    actions?: { canCheck?: boolean; canCall?: boolean };
  } | null;
  players: { id: string; ready: boolean }[];
};

export interface BotOptions {
  game: 'blackjack' | 'poker';
  /** How long the bot thinks before it moves. */
  thinkMs?: number;
  /** Start holding every turn. */
  hold?: boolean;
}

/** First names for the bots, so a full table reads like one. */
export const BOT_NAMES = [
  'Ada', 'Ben', 'Cleo', 'Dev', 'Eli', 'Fay', 'Gus', 'Ivy', 'Jas', 'Kit', 'Lou', 'Max', 'Nia', 'Oli', 'Pip', 'Rae',
  'Sam', 'Tia', 'Uma', 'Vic', 'Wes', 'Xan', 'Yas', 'Zoe', 'Abe', 'Bea', 'Cal', 'Dot', 'Ed', 'Flo', 'Gil', 'Hal',
  'Isa', 'Jo', 'Kai', 'Lia', 'Mo', 'Ned', 'Ola', 'Pat', 'Roz', 'Sid', 'Tom', 'Una', 'Val', 'Wyn', 'Yve', 'Zed',
];

function turnOf(game: NonNullable<BotRoom['game']>): string | null {
  const t = game.turn;
  if (t === null) return null;
  return typeof t === 'string' ? t : t.playerId;
}

export function tableBot(name: string, code: string, base: string, { game: kind, thinkMs = 400, hold = false }: BotOptions): Promise<TableBot> {
  const socket = new WebSocket(`${base.replace(/^http/, 'ws')}/ws`);
  let acted = '';
  let readied = false;
  let betRound = -1;
  let held = hold;
  let latest: BotRoom | null = null;
  const send = (out: object) => socket.readyState === WebSocket.OPEN && socket.send(JSON.stringify(out));

  const step = () => {
    const room = latest;
    const id = bot.id;
    if (!room || !id) return;
    // Each message goes once: a big table sends a snapshot per move, and a bot answering every one
    // of them with the same message would flood the room.
    if (room.phase === 'lobby') {
      if (!readied && !room.players.find((p) => p.id === id)?.ready) {
        readied = true;
        send({ t: 'ready', ready: true });
      }
      return;
    }
    readied = false;
    const g = room.game;
    if (room.phase !== 'playing' || !g) return;
    const round = g.round ?? 0;
    if (kind === 'blackjack' && g.phase === 'betting' && g.order.includes(id) && g.players[id]?.bet === 0 && betRound !== round) {
      betRound = round;
      return send({ t: 'bet', amount: 1 });
    }
    const turn = `${g.phase}:${turnOf(g)}:${JSON.stringify(g.players[id])}`;
    if (g.phase === 'acting' && turnOf(g) === id && acted !== turn && !held) {
      acted = turn;
      const move = kind === 'blackjack' ? { t: 'stand' } : g.actions?.canCheck ? { t: 'check' } : { t: 'call' };
      setTimeout(() => send(move), thinkMs);
    }
  };

  const bot: TableBot = {
    name,
    id: null,
    errors: [],
    setHold(next) {
      held = next;
      if (!next) step();
    },
    close: () => socket.close(),
  };

  socket.on('message', (raw) => {
    const msg = JSON.parse(String(raw)) as { t: string; playerId?: string; room?: BotRoom; code?: string; message?: string };
    if (msg.t === 'welcome' && msg.playerId) bot.id = msg.playerId;
    if (msg.t === 'error') bot.errors.push(`${msg.code ?? ''} ${msg.message ?? ''}`.trim());
    if (msg.room) latest = msg.room;
    step();
  });
  return new Promise((resolve, reject) => {
    socket.on('open', () => {
      socket.send(JSON.stringify({ t: 'join', code, name, avatar: { color: name.charCodeAt(0) % 12, emoji: (name.charCodeAt(0) + name.length) % 24 } }));
      resolve(bot);
    });
    socket.on('error', reject);
  });
}

/** `count` bots joined one after another, named from BOT_NAMES. */
export async function tableBots(count: number, code: string, base: string, options: BotOptions): Promise<TableBot[]> {
  const bots: TableBot[] = [];
  for (let i = 0; i < count; i++) bots.push(await tableBot(BOT_NAMES[i] ?? `Bot ${i + 1}`, code, base, options));
  return bots;
}
