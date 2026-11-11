import { chat, paid, REWARDS, type BigEvent, type Race } from '../race/race.js';

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
/** Paid events by reward title, lower case: the operator types the titles by hand, so case and outer spaces don't matter (#102). */
const BY_TITLE = new Map(Object.entries(REWARDS).map(([event, { title }]) => [title.toLowerCase(), event as Exclude<BigEvent, 'nuke'>]));
/** Where unsettled redemptions survive a page reload. */
const PENDING_KEY = 'rhino-streamerbot-redemptions';
/** Seconds before the first reconnect, doubling to the longest. */
export const RETRY = { first: 1, longest: 30 };

/**
 * Unsettled redemptions by ID, kept under `key` across page reloads. Those left from before a reload are refunded, as if
 * still waiting at race end: the race they were for is gone.
 */
export function heldRedemptions<T>(race: Race, key: string) {
  let held = new Map<string, T>();
  try { held = new Map(JSON.parse(localStorage.getItem(key) || '[]')); } catch { /* malformed: nothing to refund */ }
  // ponytail: one whose event landed just before the reload is refunded too (its "fulfilled" never went out); rare, and in the viewer's favour.
  for (const reference of held.keys()) race.settlements.push({ reference, outcome: 'refunded' });
  return { held, save: () => localStorage.setItem(key, JSON.stringify([...held])) };
}

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
  /** Unsettled redemptions: ID to its reward, which `DoAction` hands back to Streamer.bot. */
  const { held: rewards, save } = heldRedemptions<{ id: string; title: string }>(race, PENDING_KEY);
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
    // Chat events carry a `user` object; Streamer.bot 1.0.7's redemptions carry flat `user_id`/`user_name` instead.
    const user = (data.user ?? (data.user_id === undefined ? undefined : { id: data.user_id, name: data.user_name })) as User | undefined;
    const who = viewer(source, user) ?? (source === 'Twitch' && type === 'Cheer' ? { viewerId: 'twitch:anonymous', name: 'Anonymous' } : undefined);
    if (!who) return;
    // Twitch and Kick chat carry `text`, YouTube's `message`.
    if (type === 'ChatMessage' || (source === 'YouTube' && type === 'Message')) {
      const line = data.text ?? data.message;
      if (text(line)) chat(race, { ...who, text: line });
    }
    if (source !== 'Twitch') return; // YouTube and Kick paid events wait for a later ticket
    if (type === 'Cheer' && typeof data.bits === 'number') paid(race, { ...who, event: 'chronoSwap', via: 'cheer', bits: data.bits, reference: '' });
    if (type === 'RewardRedemption') {
      const reward = data.reward as { id?: unknown; title?: unknown } | null, id = data.redemptionId ?? data.id;
      const event = text(reward?.title) ? BY_TITLE.get(reward.title.trim().toLowerCase()) : undefined;
      if (!event || !text(id) || !text(reward?.id)) return;
      rewards.set(id, { id: reward.id, title: reward.title as string });
      save();
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
      if (!reward) continue; // another source's, such as the dev panel's
      rewards.delete(reference);
      save();
      socket!.send(JSON.stringify({ request: 'DoAction', id: `rhino-settle-${reference}`, action: { name: SETTLE_ACTION }, args: { redemptionId: reference, rewardId: reward.id, reward: reward.title, outcome } }));
    }
  }, 250);

  connect();
  return {
    online: () => up,
    close() { closed = true; clearTimeout(retry); clearInterval(drain); socket?.close(); },
  };
}
