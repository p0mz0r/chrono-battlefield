import { armed, CHAOS, secondsLeft, standings, type PaidEvent, type Phase, type Race } from '../race/race.js';
import { houseCss } from '../race/view.js';
import { RETRY } from './streamerBot.js';
import type { TwitchSession } from './twitchLogin.js';

// ponytail: the backend's address before it is deployed; set to the Worker's real URL in #202.
export const GAME_LINK_URL = 'wss://rhino-race.p0mz0r.workers.dev/game';
/** The subprotocol the backend picks; the token rides beside it, since a browser WebSocket can't send headers. */
const PROTOCOL = 'rhino-game';
/** The backend's close code for a socket a newer link for the same channel took over. */
const REPLACED = 4000;
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

/** The part of a WebSocket the link uses, so tests can stand in for the backend. */
interface Socket {
  readyState: number;
  onopen: (() => void) | null;
  onclose: ((e: { code: number }) => void) | null;
  send(data: string): void;
  close(): void;
}

/**
 * The game link (#187): while the Twitch extension is switched on, an outbound socket to the extension backend, which
 * checks the operator's token once and binds the socket to their channel. Snapshots go out on change and every few
 * seconds. A new token from the shared login reconnects with it; a drop reconnects with growing waits.
 */
export function connectGameLink(race: Race, colours: number[], account: TwitchSession, { url = GAME_LINK_URL, Socket = WebSocket as new (url: string, protocols: string[]) => Socket } = {}) {
  let socket: Socket | undefined, wait = RETRY.first, closed = false, retry: ReturnType<typeof setTimeout> | undefined, sent = '', sentAt = -Infinity;

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
    s.onopen = () => { wait = RETRY.first; sentAt = -Infinity; send(); };
    s.onclose = ({ code }) => {
      // Replaced: another game links this channel now; taking it back would start the two trading it forever.
      if (closed || s !== socket || code === REPLACED) return;
      retry = setTimeout(connect, wait * 1000);
      wait = Math.min(wait * 2, RETRY.longest);
    };
  };
  const reconnect = () => { const old = socket; clearTimeout(retry); connect(); old?.close(); };

  const beat = setInterval(send, 250);
  account.refreshed.add(reconnect);
  account.loggedOut.add(close);
  function close() {
    closed = true;
    clearTimeout(retry);
    clearInterval(beat);
    account.refreshed.delete(reconnect);
    account.loggedOut.delete(close);
    socket?.close();
  }

  connect();
  return { close };
}
