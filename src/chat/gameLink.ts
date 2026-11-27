import { armed, CHAOS, chat, CHEER_PRICES, paid, secondsLeft, standings, type PaidEvent, type Phase, type Race } from '../race/race.js';
import { houseCss } from '../race/view.js';
import { RETRY } from './streamerBot.js';
import type { TwitchSession } from './twitchLogin.js';

// ponytail: the backend's address before it is deployed; set to the Worker's real URL in #202.
export const GAME_LINK_URL = 'wss://rhino-race.p0mz0r.workers.dev/game';
/** The subprotocol the backend picks; the token rides beside it, since a browser WebSocket can't send headers. */
const PROTOCOL = 'rhino-game';
/** The backend's close codes: a newer link for the same channel took the socket over, or the token was refused. */
const REPLACED = 4000, REFUSED = 4001;
/** The backend's greeting once it has accepted the token. */
const LINKED = JSON.stringify({ type: 'linked' });
/** Milliseconds: a change goes out at most this often (Extension PubSub takes one message a second a channel)… */
const MIN_GAP = 1000;
/** …and the snapshot goes out again this often unchanged, so a rail that missed one catches up. */
const RESEND = 5000;

/** What the Twitch extension's rail draws from (#187): the race as it is now, no game-time stamp, no delay (#180). */
export interface Snapshot {
  /** Whether the rail shows: false in a trial race. */
  show: boolean;
  phase: Phase;
  /** Seconds left in the join window; 0 outside it. */
  countdown: number;
  /** Tanks in the race. */
  field: number;
  /** The interactions switched on. */
  interactions: string[];
  /** The paid events switched on. */
  paid: PaidEvent[];
  /** The hype meter is armed: the nuke may be called. */
  armed: boolean;
  /** Each Twitch viewer racing: their Twitch user ID, place from 1, course progress in whole %, house colour as CSS. */
  racers: { id: string; place: number; progress: number; colour: string; finished: boolean }[];
}

/** The snapshot of `race` now; `colours` are the course art's house colours. */
export function snapshot(race: Race, colours: number[]): Snapshot {
  return {
    show: !race.trial, phase: race.phase, countdown: race.phase === 'join' ? secondsLeft(race) : 0, field: race.racers.length,
    interactions: [...race.enabled], paid: CHAOS.filter((chaos): chaos is PaidEvent => chaos !== 'hype' && race.chaos.has(chaos)), armed: armed(race),
    racers: standings(race).flatMap((s, i) => s.viewerId?.startsWith('twitch:')
      ? [{ id: s.viewerId.slice(7), place: i + 1, progress: Math.floor(s.progress * 100), colour: houseCss(colours, s.colour), finished: s.finishTime !== undefined }] : []),
  };
}

/** A viewer's button press from the backend: `command` a bare chat command, `userId` their Twitch user ID. */
export interface Press { type: 'press'; id: string; userId: string; name: string; command: string }
/** A viewer's Bits purchase from the backend, its receipt checked: `event` the SKU, which names the big event. */
export interface Purchase { type: 'bits'; id: string; userId: string; name: string; event: string }

/** The part of a WebSocket the link uses, so tests can stand in for the backend. */
interface Socket {
  readyState: number;
  onopen: (() => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  send(data: string): void;
  close(): void;
}

/**
 * How the game link is: its first socket still `opening`; `linked` (the backend accepted the token); `offline` (down,
 * reconnecting); or `refused` twice, when it stops trying until the operator logs in again.
 */
export type LinkStatus = 'opening' | 'linked' | 'offline' | 'refused';

/**
 * The game link (#187): while the Twitch extension is switched on, an outbound socket to the extension backend, which
 * checks the operator's token once and binds the socket to their channel. Snapshots go out on change and every few
 * seconds. A new token from the shared login reconnects with it; a drop reconnects with growing waits. A refused token is
 * refreshed and tried once more; refused again, the link stops trying.
 */
export function connectGameLink(race: Race, colours: number[], account: TwitchSession, { url = GAME_LINK_URL, Socket = WebSocket as new (url: string, protocols: string[]) => Socket } = {}) {
  let socket: Socket | undefined, wait = RETRY.first, closed = false, retry: ReturnType<typeof setTimeout> | undefined, sent = '', sentAt = -Infinity;
  let status: LinkStatus = 'opening', refusedOnce = false;
  /** The link a new token is replacing: kept open until the new one links or fails, so viewers' rails never blank on a refresh. */
  let superseded: Socket | undefined;
  const dropSuperseded = () => { superseded?.close(); superseded = undefined; };

  const send = () => {
    if (socket?.readyState !== 1) return;
    const message = JSON.stringify({ type: 'snapshot', snapshot: snapshot(race, colours) }), since = Date.now() - sentAt;
    if (since < RESEND && (message === sent || since < MIN_GAP)) return;
    socket.send(message);
    sent = message;
    sentAt = Date.now();
  };

  const connect = () => {
    const s = socket = new Socket(url, [PROTOCOL, account.login.access]);
    s.onopen = () => { sentAt = -Infinity; send(); };
    s.onmessage = ({ data }) => {
      if (s !== socket) return;
      if (data !== LINKED) return answer(s, data);
      dropSuperseded();
      status = 'linked';
      wait = RETRY.first;
      refusedOnce = false;
    };
    s.onclose = ({ code }) => {
      if (closed || s !== socket) return;
      dropSuperseded();
      status = 'offline';
      // Replaced: another game links this channel now; taking it back would start the two trading it forever.
      if (code === REPLACED) return;
      if (code === REFUSED && refusedOnce) { status = 'refused'; return; }
      // The refreshed token comes back through `refreshed`, which reconnects. A refresh that didn't happen (Twitch unreachable)
      // spends no try: the old token goes again after a wait.
      if (code === REFUSED) { refusedOnce = true; account.refresh().catch(() => { refusedOnce = false; retryLater(); }); return; }
      retryLater();
    };
  };
  /**
   * What the backend forwards, answered by request ID: a press as that Twitch viewer typing the bare command, or a
   * purchase as their extension cheer for its event.
   */
  const answer = (s: Socket, data: string) => {
    let m: Press | Purchase;
    try { m = JSON.parse(data); } catch { return; }
    const viewerId = `twitch:${m.userId}`;
    const result = m.type === 'press' ? chat(race, { viewerId, name: m.name, text: m.command, via: 'extension' })
      : m.type === 'bits' ? (Object.hasOwn(CHEER_PRICES, m.event) ? paid(race, { viewerId, name: m.name, event: m.event as PaidEvent, via: 'cheer', extension: true, reference: '' }) : { ok: false, reason: 'ignored' })
        : undefined;
    if (result) s.send(JSON.stringify({ type: 'reply', id: m.id, result }));
  };
  const retryLater = () => {
    if (closed) return;
    retry = setTimeout(connect, wait * 1000);
    wait = Math.min(wait * 2, RETRY.longest);
  };
  const reconnect = () => {
    if (status === 'refused') return;
    clearTimeout(retry);
    dropSuperseded();
    superseded = socket;
    connect();
  };
  // A refresh token Twitch refused logs the operator out: the link stops, as after a second refusal.
  const loggedOut = () => { close(); status = 'refused'; };

  const beat = setInterval(send, 250);
  account.refreshed.add(reconnect);
  account.loggedOut.add(loggedOut);
  function close() {
    closed = true;
    clearTimeout(retry);
    clearInterval(beat);
    account.refreshed.delete(reconnect);
    account.loggedOut.delete(loggedOut);
    dropSuperseded();
    socket?.close();
  }

  connect();
  return {
    close,
    status: () => status,
    /** The stream's extension offline marker: down after the first attempt, never in a trial race. */
    offline: () => !race.trial && (status === 'offline' || status === 'refused'),
  };
}
