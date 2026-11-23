import { chat, cheerEvent, paid, REWARDS, type PaidEvent, type Race } from '../race/race.js';
import { heldRedemptions, RETRY, type ChatSource } from './streamerBot.js';

/** The game's registered public Twitch app (#115). Forks register their own. */
export const TWITCH_CLIENT_ID = '5cm8euhmabzd9g4mnkwidz07sftngy';
const SCOPES = 'user:read:chat channel:manage:redemptions bits:read';
const ID = 'https://id.twitch.tv/oauth2';
/** Where the login survives reloads (ADR 0008). Never logged or sent anywhere but Twitch. */
const LOGIN_KEY = 'rhino-twitch-login';

/** Where the IDs of the rewards the game made live: only the app that made a reward may refund its redemptions. */
const REWARDS_KEY = 'rhino-twitch-rewards';
/** Where unsettled redemptions (ID to reward ID) survive a page reload. */
const PENDING_KEY = 'rhino-twitch-redemptions';
const HELIX = 'https://api.twitch.tv/helix';
export const EVENTSUB_URL = 'wss://eventsub.wss.twitch.tv/ws';
/** Channel points a reward starts at; the streamer sets the real cost in Twitch's dashboard (ADR 0008). */
const STARTING_COST = 1000;
/** Seconds past the keepalive before a silent connection counts as gone, so a late keepalive doesn't drop it. */
const KEEPALIVE_SLACK = 2;
/** Twitch asks apps to validate their token on start and hourly. */
const VALIDATE_EVERY = 60 * 60_000;

/** The part of `fetch` the source uses, so tests can stand in for Twitch. */
type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
/** The part of a WebSocket the source uses, so tests can stand in for EventSub. */
interface Socket {
  onmessage: ((e: { data: string }) => void) | null;
  onclose: (() => void) | null;
  close(): void;
}
interface Login { access: string; refresh: string; userId: string; login: string }

const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: TWITCH_CLIENT_ID, ...fields }).toString() });
const stored = (): Login | undefined => { try { return JSON.parse(localStorage.getItem(LOGIN_KEY) ?? '') || undefined; } catch { return undefined; } };

/** Twitch answered, but not OK. */
class HelixError extends Error { constructor(readonly status: number) { super(`Twitch replied ${status}`); } }
const text = (v: unknown): v is string => typeof v === 'string' && v.length > 0 && v.length <= 500;
const storedRewards = (): Partial<Record<PaidEvent, string>> => { try { return JSON.parse(localStorage.getItem(REWARDS_KEY) ?? '{}') ?? {}; } catch { return {}; } };

/** The Twitch account logged in, if any. */
export const twitchLogin = () => stored()?.login;
/** Titles of the game's rewards it has no ID for: not made yet, or Twitch refused (a reward of that title it didn't make). */
export const missingRewards = () => (Object.keys(REWARDS) as PaidEvent[]).filter((event) => !storedRewards()[event]).map((event) => REWARDS[event].title);

/**
 * Device-code login (#116): `code` for the streamer to enter at `uri`; `done` resolves to their login once they have, and
 * the tokens are stored. Rejects if the code expires or is denied.
 */
export async function loginTwitch({ fetch = globalThis.fetch as Fetch } = {}) {
  const started = await fetch(`${ID}/device`, form({ scopes: SCOPES }));
  if (!started.ok) throw new Error(`Twitch login failed: ${started.status}`);
  const device = await started.json();
  const done = (async () => {
    const until = Date.now() + device.expires_in * 1000;
    while (Date.now() < until) {
      await new Promise((resolve) => setTimeout(resolve, device.interval * 1000));
      const reply = await fetch(`${ID}/token`, form({ scopes: SCOPES, device_code: device.device_code, grant_type: 'urn:ietf:params:oauth:grant-type:device_code' }));
      const token = await reply.json();
      if (reply.ok) {
        const who = await (await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${token.access_token}` } })).json();
        localStorage.setItem(LOGIN_KEY, JSON.stringify({ access: token.access_token, refresh: token.refresh_token, userId: who.user_id, login: who.login }));
        localStorage.removeItem(REWARDS_KEY); // maybe another channel's: the next connection finds or makes this one's
        return who.login as string;
      }
      if (token.message !== 'authorization_pending' && token.message !== 'slow_down') throw new Error(`Twitch login failed: ${token.message}`);
    }
    throw new Error('Twitch login code expired');
  })();
  return { code: device.user_code as string, uri: device.verification_uri as string, done };
}

/**
 * Twitch direct (ADR 0008): chat, redemptions of the game's own rewards and cheers over EventSub, for the logged-in
 * streamer's channel. Creates the rewards it is missing, so it may refund them.
 */
export function connectTwitch(race: Race, { fetch = globalThis.fetch as Fetch, Socket = WebSocket as new (url: string) => Socket } = {}): ChatSource {
  const login = stored();
  // Online until the first drop: the first connection is still opening at page load.
  let socket: Socket | undefined, wait = RETRY.first, closed = false, up = true, opened = false, retry: ReturnType<typeof setTimeout> | undefined;
  if (!login) return { online: () => false, close() {} };
  const broadcaster_id = login.userId;

  let refreshing: Promise<void> | undefined;
  /** Trades the refresh token in for a new pair, once however many calls hit the expiry. A refused one logs out. */
  const refresh = () => refreshing ??= (async () => {
    const reply = await fetch(`${ID}/token`, form({ grant_type: 'refresh_token', refresh_token: login.refresh }));
    if (reply.status === 400 || reply.status === 401) {
      localStorage.removeItem(LOGIN_KEY);
      up = false;
      stop();
      throw new Error('Twitch login expired');
    }
    if (!reply.ok) throw new HelixError(reply.status);
    const token = await reply.json();
    Object.assign(login, { access: token.access_token, refresh: token.refresh_token });
    localStorage.setItem(LOGIN_KEY, JSON.stringify(login));
  })().finally(() => { refreshing = undefined; });

  const api = async (method: string, path: string, query: Record<string, string>, body?: unknown, retried = false): Promise<any> => {
    const reply = await fetch(`${HELIX}/${path}?${new URLSearchParams(query)}`, {
      method, headers: { Authorization: `Bearer ${login.access}`, 'Client-Id': TWITCH_CLIENT_ID, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (reply.status === 401 && !retried) return refresh().then(() => api(method, path, query, body, true));
    if (!reply.ok) throw new HelixError(reply.status);
    return (await reply.json()).data;
  };
  const validate = async () => {
    if ((await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${login.access}` } })).status === 401) await refresh();
  };

  const rewards = storedRewards();
  /** Finds the rewards the game made before by title, and creates the rest. */
  const ensureRewards = async () => {
    const events = Object.keys(REWARDS) as PaidEvent[];
    if (events.every((event) => rewards[event])) return;
    const mine: { id: string; title: string }[] = (await api('GET', 'channel_points/custom_rewards', { broadcaster_id, only_manageable_rewards: 'true' })) ?? [];
    for (const event of events) {
      const { title, prompt } = REWARDS[event];
      rewards[event] = mine.find((reward) => reward.title === title)?.id ?? (await api('POST', 'channel_points/custom_rewards', { broadcaster_id }, { title, prompt, cost: STARTING_COST }).catch(() => undefined))?.[0]?.id;
    }
    localStorage.setItem(REWARDS_KEY, JSON.stringify(rewards));
  };

  /** Unsettled redemptions: ID to its reward's ID, which the status update needs. */
  const { held: pending, save } = heldRedemptions<string>(race, PENDING_KEY);

  const subscribe = async (session_id: string) => {
    const condition = { broadcaster_user_id: broadcaster_id };
    for (const [type, extra] of [['channel.chat.message', { user_id: broadcaster_id }], ['channel.channel_points_custom_reward_redemption.add'], ['channel.cheer']] as const) {
      await api('POST', 'eventsub/subscriptions', {}, { type, version: '1', condition: { ...condition, ...extra }, transport: { method: 'websocket', session_id } });
    }
  };

  const notified = (type: string, e: Record<string, any>) => {
    if (type === 'channel.chat.message' && text(e.chatter_user_id) && text(e.chatter_user_name) && text(e.message?.text)) {
      chat(race, { viewerId: `twitch:${e.chatter_user_id}`, name: e.chatter_user_name, text: e.message.text });
    }
    // An anonymous cheer still spends bits, so it still counts.
    const cheered = type === 'channel.cheer' && typeof e.bits === 'number' ? cheerEvent(e.bits) : undefined;
    if (cheered) {
      const who = !e.is_anonymous && text(e.user_id) && text(e.user_name) ? { viewerId: `twitch:${e.user_id}`, name: e.user_name } : { viewerId: 'twitch:anonymous', name: 'Anonymous' };
      paid(race, { ...who, event: cheered, via: 'cheer', reference: '' });
    }
    if (type === 'channel.channel_points_custom_reward_redemption.add' && text(e.id) && text(e.user_id) && text(e.user_name)) {
      // By ID, not title: only the game's own rewards can be refunded.
      const event = (Object.keys(rewards) as PaidEvent[]).find((key) => rewards[key] === e.reward?.id);
      if (!event) return;
      pending.set(e.id, e.reward.id);
      save();
      paid(race, { viewerId: `twitch:${e.user_id}`, name: e.user_name, event, via: 'redemption', reference: e.id });
    }
  };

  type Message = { metadata?: { message_type?: string; subscription_type?: string }; payload?: { session?: { id?: string; keepalive_timeout_seconds?: number; reconnect_url?: string }; event?: Record<string, unknown> } };

  /** A connection to `url`; `moving` when it replaces the live one at Twitch's request, which keeps its subscriptions. */
  const connect = (url = EVENTSUB_URL, moving = false) => {
    const s = new Socket(url);
    if (!moving) socket = s;
    let quiet: ReturnType<typeof setTimeout> | undefined, keepalive = 10;
    s.onmessage = (e) => {
      let message: Message;
      try { message = JSON.parse(e.data); } catch { return; }
      const { message_type, subscription_type = '' } = message.metadata ?? {}, { session, event } = message.payload ?? {};
      if (message_type === 'session_welcome' && session?.id) {
        keepalive = session.keepalive_timeout_seconds ?? keepalive;
        wait = RETRY.first;
        up = opened = true;
        if (moving) { const old = socket; socket = s; old?.close(); } else subscribe(session.id).catch(() => s.close()); // deaf without it: drop, and try again after the wait
      }
      if (message_type === 'session_reconnect' && session?.reconnect_url) connect(session.reconnect_url, true);
      if (message_type === 'notification' && event) notified(subscription_type, event);
      // Twitch sends something within the keepalive while the connection lives; silence means it is gone.
      clearTimeout(quiet);
      quiet = setTimeout(() => s.close(), (keepalive + KEEPALIVE_SLACK) * 1000);
    };
    s.onclose = () => {
      clearTimeout(quiet);
      if (closed || s !== socket) return;
      up = false;
      retry = setTimeout(connect, wait * 1000);
      wait = Math.min(wait * 2, RETRY.longest);
    };
  };

  // Settlements stay in the race while offline and go out once back.
  const drain = setInterval(() => {
    if (!up) return;
    for (const settlement of race.settlements.splice(0)) {
      const { reference, outcome } = settlement, reward_id = pending.get(reference);
      if (!reward_id) continue; // another source's, such as the dev panel's
      pending.delete(reference);
      save();
      api('PATCH', 'channel_points/custom_rewards/redemptions', { broadcaster_id, reward_id, id: reference }, { status: outcome === 'fulfilled' ? 'FULFILLED' : 'CANCELED' })
        .catch((err: unknown) => {
          // Down or busy: try again. Refused (already settled, reward deleted): drop it.
          // ponytail: retries every drain while Twitch is down; back off if a long outage ever floods it.
          if (err instanceof HelixError && err.status < 500 && err.status !== 429) return;
          pending.set(reference, reward_id);
          save();
          race.settlements.push(settlement);
        });
    }
  }, 250);

  const hourly = setInterval(() => void validate().catch(() => {}), VALIDATE_EVERY);
  function stop() { closed = true; clearTimeout(retry); clearInterval(drain); clearInterval(hourly); socket?.close(); }

  void validate().then(ensureRewards).catch(() => {}); // a network failure leaves them for the next load
  connect();
  return { online: () => up && !opened ? undefined : up, close: stop };
}
