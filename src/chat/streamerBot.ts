import { chat, paid, type BigEvent, type Race } from '../race/race.js';

/** A chat source (#101): platform messages in as the race's chat and paid calls, its settlements out, online or not. */
export interface ChatSource {
  /** False while the connection is down: the stream shows the "chat offline" marker. */
  online(): boolean;
  close(): void;
}

/** Streamer.bot's WebSocket server, at its defaults. */
export const STREAMER_BOT_URL = 'ws://127.0.0.1:8080/';
/** The one action the operator imports; every settlement is a `DoAction` on it (docs/streamer-bot-action.md). */
export const SETTLE_ACTION = 'Rhino Race settle';
// ponytail: placeholder titles until #102 settles them; one place to change.
/** The reward title (lower case, single spaces) each paid event is redeemed under. */
export const REWARD_TITLES: Record<string, Exclude<BigEvent, 'nuke'>> = { 'kirov airship': 'kirov', desolator: 'desolator', 'chrono swap': 'chronoSwap' };
/** Seconds before the first reconnect, doubling to the longest. */
const RETRY = { first: 1, longest: 30 };

/** The part of a WebSocket the source uses, so tests can stand in for Streamer.bot. */
interface Socket {
  readyState: number;
  onopen: (() => void) | null;
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  send(data: string): void;
  close(): void;
}

interface User { id?: unknown; name?: unknown }
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500;

/**
 * Streamer.bot (ADR 0008): chat from Twitch, YouTube and Kick, Twitch redemptions by reward title and cheers by amount.
 * A drop never stops the race: it reconnects with growing waits, and settlements wait in the race until it is back.
 */
export function connectStreamerBot(race: Race, { url = STREAMER_BOT_URL, Socket = WebSocket as new (url: string) => Socket } = {}): ChatSource {
  // Online until the first drop: the first connection is still opening at page load.
  let socket: Socket | undefined, wait = RETRY.first, closed = false, up = true, retry: ReturnType<typeof setTimeout> | undefined;
  /** Redemption ID to its reward, which `DoAction` hands back to Streamer.bot. */
  const rewards = new Map<string, { id: string; title: string }>();
  const open = () => socket?.readyState === 1;
  const viewer = (platform: string, user: User | null | undefined) => {
    const id = typeof user?.id === 'number' ? String(user.id) : user?.id;
    return text(id) && text(user!.name) ? { viewerId: `${platform.toLowerCase()}:${id}`, name: user!.name } : undefined;
  };

  const receive = (raw: string) => {
    let message: { event?: { source?: string; type?: string }; data?: Record<string, unknown> };
    try { message = JSON.parse(raw); } catch { return; }
    const { source = '', type = '' } = message.event ?? {}, data = message.data ?? {};
    // An anonymous cheer still spends bits, so it still counts.
    const who = viewer(source, data.user as User) ?? (source === 'Twitch' && type === 'Cheer' ? { viewerId: 'twitch:anonymous', name: 'Anonymous' } : undefined);
    if (!who) return;
    // Twitch and Kick chat carry `text`, YouTube's `message`.
    if (type === 'ChatMessage' || (source === 'YouTube' && type === 'Message')) {
      const line = data.text ?? data.message;
      if (text(line)) chat(race, { ...who, text: line });
    }
    if (source !== 'Twitch') return; // YouTube and Kick paid events wait for a later ticket
    if (type === 'Cheer' && typeof data.bits === 'number') paid(race, { ...who, event: 'chronoSwap', via: 'cheer', bits: data.bits, reference: '' });
    if (type === 'RewardRedemption') {
      const reward = data.reward as { id?: unknown; title?: unknown } | null, id = data.redemptionId;
      const event = text(reward?.title) ? REWARD_TITLES[reward.title.trim().replace(/\s+/g, ' ').toLowerCase()] : undefined;
      if (!event || !text(id) || !text(reward?.id)) return;
      rewards.set(id, { id: reward.id, title: reward.title as string });
      paid(race, { ...who, event, via: 'redemption', reference: id });
    }
  };

  const connect = () => {
    const s = socket = new Socket(url);
    s.onopen = () => {
      wait = RETRY.first;
      up = true;
      s.send(JSON.stringify({ request: 'Subscribe', id: 'rhino-subscribe', events: { Twitch: ['ChatMessage', 'RewardRedemption', 'Cheer'], YouTube: ['Message'], Kick: ['ChatMessage'] } }));
    };
    s.onmessage = (e) => receive(e.data);
    s.onclose = () => {
      if (closed || s !== socket) return;
      up = false;
      retry = setTimeout(connect, wait * 1000);
      wait = Math.min(wait * 2, RETRY.longest);
    };
  };

  // Settlements stay in the race while offline and go out once back.
  const drain = setInterval(() => {
    if (!open()) return;
    for (const { reference, outcome } of race.settlements.splice(0)) {
      const reward = rewards.get(reference);
      // ponytail: rewards live in page memory, so a reload mid-race leaves its redemptions unsettled in Twitch's queue; persist them if that bites.
      if (!reward) continue; // another source's, such as the dev panel's
      rewards.delete(reference);
      socket!.send(JSON.stringify({ request: 'DoAction', id: `rhino-settle-${reference}`, action: { name: SETTLE_ACTION }, args: { redemptionId: reference, rewardId: reward.id, reward: reward.title, outcome } }));
    }
  }, 250);

  connect();
  return {
    online: () => up,
    close() { closed = true; clearTimeout(retry); clearInterval(drain); socket?.close(); },
  };
}
