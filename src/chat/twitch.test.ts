import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { CellGrid } from '../movement/index.js';
import { loadCourse, mapHash } from '../race/course.js';
import { createRace, eventChips, openJoinWindow, REWARDS as GAME_REWARDS, type Race } from '../race/race.js';
import { connectTwitch } from './twitch.js';
import { loginTwitch, logoutTwitch, twitchSession } from './twitchLogin.js';

const MAP = new TextEncoder().encode('[Map]\nTheater=TEMPERATE\n');
const OPEN: CellGrid = { width: 20, height: 10, speed: new Array(200).fill(1), level: new Array(200).fill(0), ramp: new Array(200).fill(0), blocked: new Array(200).fill(false), deck: new Array(200).fill(-1) };
const newRace = () => createRace(loadCourse({ name: 'Test', map: 'test.map', mapHash: mapHash(MAP), source: 'shipped', author: 'tests', link: '', startGrid: [[1, 1], [1, 3], [1, 5]], waypoints: [[10, 2]], laps: [], finish: [18, 2], bridges: [] }, MAP, OPEN), OPEN, 1);

/** Stands in for Twitch's EventSub WebSocket: one per connection. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  onopen: (() => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  onclose: (() => void) | null = null;
  constructor(public url: string) { FakeSocket.all.push(this); }
  send() { throw new Error('EventSub sockets are receive-only'); }
  close() { this.drop(); }
  drop() { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.(); }
  message(message_type: string, payload: unknown, subscription_type?: string) { this.onmessage?.({ data: JSON.stringify({ metadata: { message_id: 'm', message_type, message_timestamp: '', subscription_type }, payload }) }); }
  /** Opens and sends the welcome, as Twitch does; subscriptions must follow within 10 s. */
  welcome(id = 'session-1') { this.readyState = 1; this.onopen?.(); this.message('session_welcome', { session: { id, status: 'connected', keepalive_timeout_seconds: 10, reconnect_url: null } }); }
  notify(type: string, event: unknown) { this.message('notification', { subscription: { type }, event }, type); }
}
const last = () => FakeSocket.all.at(-1)!;

/** A Twitch API response the fake fetch hands back. */
type Reply = { status?: number; body?: unknown };
/** Stands in for id.twitch.tv and api.twitch.tv: answers by method and path, records every request. */
class FakeTwitch {
  calls: { method: string; url: URL; headers: Record<string, string>; body: string }[] = [];
  routes = new Map<string, (req: { url: URL; body: string; headers: Record<string, string> }) => Reply>();
  on(route: string, reply: (req: { url: URL; body: string; headers: Record<string, string> }) => Reply) { this.routes.set(route, reply); return this; }
  fetch = async (input: string, init: { method?: string; headers?: Record<string, string>; body?: string } = {}) => {
    const url = new URL(input), method = init.method ?? 'GET', headers = init.headers ?? {}, body = init.body ?? '';
    this.calls.push({ method, url, headers, body });
    const route = this.routes.get(`${method} ${url.origin}${url.pathname}`);
    const { status = 200, body: reply = {} } = route ? route({ url, body, headers }) : { status: 404 };
    return { ok: status < 300, status, json: async () => reply };
  };
  /** The requests to one route, as their form or JSON bodies. */
  sent(route: string) { return this.calls.filter((c) => `${c.method} ${c.url.origin}${c.url.pathname}` === route); }
}

let twitch: FakeTwitch, storage: Map<string, string>;
beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map();
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  twitch = new FakeTwitch();
});
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });

const DEVICE = 'POST https://id.twitch.tv/oauth2/device', TOKEN = 'POST https://id.twitch.tv/oauth2/token', VALIDATE = 'GET https://id.twitch.tv/oauth2/validate';

describe('Twitch direct login', () => {
  it('shows the device code, waits for the streamer to enter it and remembers who logged in', async () => {
    let entered = false;
    twitch.on(DEVICE, () => ({ body: { device_code: 'dev-1', user_code: 'ABCD-EFGH', verification_uri: 'https://www.twitch.tv/activate?device-code=ABCD-EFGH', expires_in: 1800, interval: 5 } }))
      .on(TOKEN, () => entered ? { body: { access_token: 'acc-1', refresh_token: 'ref-1', expires_in: 14000 } } : { status: 400, body: { status: 400, message: 'authorization_pending' } })
      .on(VALIDATE, () => ({ body: { client_id: 'x', login: 'p0mz0r', user_id: '427115971', expires_in: 14000 } }));
    const login = await loginTwitch({ fetch: twitch.fetch });
    expect([login.code, login.uri]).toEqual(['ABCD-EFGH', 'https://www.twitch.tv/activate?device-code=ABCD-EFGH']);
    expect(new URLSearchParams(twitch.sent(DEVICE)[0]!.body).get('scopes')).toBe('user:read:chat channel:manage:redemptions bits:read');
    await vi.advanceTimersByTimeAsync(10_000);
    expect(twitch.sent(TOKEN)).toHaveLength(2);
    entered = true;
    await vi.advanceTimersByTimeAsync(5000);
    expect(await login.done).toBe('p0mz0r');
    expect(new URLSearchParams(twitch.sent(TOKEN)[0]!.body).get('grant_type')).toBe('urn:ietf:params:oauth:grant-type:device_code');
    expect(twitch.sent(VALIDATE)[0]!.headers.Authorization).toBe('OAuth acc-1');
    expect(JSON.parse(storage.get('rhino-twitch-login')!)).toEqual({ access: 'acc-1', refresh: 'ref-1', userId: '427115971', login: 'p0mz0r' });
  });
});

const REVOKE = 'POST https://id.twitch.tv/oauth2/revoke';

describe('Shared Twitch login', () => {
  const STORED = { access: 'acc-1', refresh: 'ref-1', userId: '42', login: 'p0mz0r' };
  beforeEach(() => { storage.set('rhino-twitch-login', JSON.stringify(STORED)); });

  it('has no session without a stored login', () => {
    storage.clear();
    expect(twitchSession({ fetch: twitch.fetch })).toBeUndefined();
  });

  it('refreshes once however many callers hit the expiry, and remembers the new pair', async () => {
    twitch.on(VALIDATE, () => ({ body: {} })).on(TOKEN, () => ({ body: { access_token: 'acc-2', refresh_token: 'ref-2' } }));
    const session = twitchSession({ fetch: twitch.fetch })!;
    await Promise.all([session.refresh(), session.refresh()]);
    expect(twitch.sent(TOKEN).map((c) => Object.fromEntries(new URLSearchParams(c.body)))).toEqual([{ client_id: '5cm8euhmabzd9g4mnkwidz07sftngy', grant_type: 'refresh_token', refresh_token: 'ref-1' }]);
    expect(session.login.access).toBe('acc-2');
    expect(JSON.parse(storage.get('rhino-twitch-login')!)).toEqual({ ...STORED, access: 'acc-2', refresh: 'ref-2' });
    session.close();
  });

  it('validates on start and hourly, refreshing once Twitch no longer accepts the token', async () => {
    let good = 'acc-1';
    twitch.on(VALIDATE, ({ headers }) => headers.Authorization === `OAuth ${good}` ? { body: {} } : { status: 401 })
      .on(TOKEN, () => ({ body: { access_token: 'acc-2', refresh_token: 'ref-2' } }));
    const session = twitchSession({ fetch: twitch.fetch })!;
    await session.validated;
    expect([twitch.sent(VALIDATE).length, twitch.sent(TOKEN).length]).toEqual([1, 0]);
    good = 'acc-2';
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect([twitch.sent(VALIDATE).length, twitch.sent(TOKEN).length]).toEqual([2, 1]);
    session.close();
    await vi.advanceTimersByTimeAsync(60 * 60_000);
    expect(twitch.sent(VALIDATE)).toHaveLength(2);
  });

  it('logs out when Twitch refuses the refresh token, but not when it is merely down', async () => {
    let refused = false;
    twitch.on(VALIDATE, () => ({ body: {} })).on(TOKEN, () => refused ? { status: 400, body: { message: 'Invalid refresh token' } } : { status: 503 });
    let loggedOut = 0;
    const session = twitchSession({ fetch: twitch.fetch, onLogout: () => loggedOut++ })!;
    await expect(session.refresh()).rejects.toThrow();
    expect([loggedOut, storage.has('rhino-twitch-login')]).toEqual([0, true]);
    refused = true;
    await expect(session.refresh()).rejects.toThrow('Twitch login expired');
    expect([loggedOut, storage.has('rhino-twitch-login')]).toEqual([1, false]);
  });

  it('log out revokes the token and forgets the login, even when Twitch is down', async () => {
    twitch.on(REVOKE, () => ({ body: {} }));
    await logoutTwitch({ fetch: twitch.fetch });
    expect(twitch.sent(REVOKE).map((c) => Object.fromEntries(new URLSearchParams(c.body)))).toEqual([{ client_id: '5cm8euhmabzd9g4mnkwidz07sftngy', token: 'acc-1' }]);
    expect(storage.has('rhino-twitch-login')).toBe(false);
    storage.set('rhino-twitch-login', JSON.stringify(STORED));
    await logoutTwitch({ fetch: async () => { throw new TypeError('Failed to fetch'); } });
    expect(storage.has('rhino-twitch-login')).toBe(false);
  });
});

const HELIX = 'https://api.twitch.tv/helix', REWARDS = `GET ${HELIX}/channel_points/custom_rewards`, CREATE = `POST ${HELIX}/channel_points/custom_rewards`;
const SUBSCRIBE = `POST ${HELIX}/eventsub/subscriptions`, SETTLE = `PATCH ${HELIX}/channel_points/custom_rewards/redemptions`;
const WAITING = `GET ${HELIX}/channel_points/custom_rewards/redemptions`, DELETE = `DELETE ${HELIX}/channel_points/custom_rewards`;
const LOGGED_IN = { access: 'acc-1', refresh: 'ref-1', userId: '42', login: 'p0mz0r' };

/** Twitch with the streamer logged in and none of the game's rewards made yet. */
function liveTwitch() {
  let made = 0;
  return twitch.on(VALIDATE, () => ({ body: { user_id: '42', login: 'p0mz0r', expires_in: 9000 } }))
    .on(REWARDS, () => ({ body: { data: [] } }))
    .on(CREATE, ({ body }) => ({ body: { data: [{ id: `rew-${++made}`, title: JSON.parse(body).title }] } }))
    .on(SUBSCRIBE, () => ({ status: 202, body: { data: [{}] } }))
    .on(SETTLE, () => ({ body: { data: [{}] } }));
}

describe('Twitch direct chat source', () => {
  // Paid events have no rewards now (#184): two stand-ins for the channel-point rewards to come.
  beforeAll(() => { Object.assign(GAME_REWARDS, { kirov: { title: 'Test Kirov', prompt: 'A test reward.' }, desolator: { title: 'Test Desolator', prompt: 'Another.' } }); });
  afterAll(() => { delete GAME_REWARDS.kirov; delete GAME_REWARDS.desolator; });
  let race: Race, source: ReturnType<typeof connectTwitch>;
  const connect = async () => {
    source = connectTwitch(race, { fetch: twitch.fetch, Socket: FakeSocket });
    await vi.advanceTimersByTimeAsync(0);
  };
  beforeEach(async () => {
    FakeSocket.all = [];
    storage.set('rhino-twitch-login', JSON.stringify(LOGGED_IN));
    liveTwitch();
    race = newRace();
    await connect();
    last().welcome();
    await vi.advanceTimersByTimeAsync(0);
  });
  afterEach(() => source.close());

  it("creates the game's rewards under their fixed titles once, and only the missing ones", async () => {
    expect(twitch.sent(CREATE).map((c) => [c.url.searchParams.get('broadcaster_id'), JSON.parse(c.body)])).toEqual([
      ['42', { title: 'Test Kirov', cost: 1000, prompt: 'A test reward.' }],
      ['42', expect.objectContaining({ title: 'Test Desolator' })],
    ]);
    expect(twitch.calls.every((c) => !c.url.href.startsWith(HELIX) || (c.headers['Client-Id'] === '5cm8euhmabzd9g4mnkwidz07sftngy' && c.headers.Authorization === 'Bearer acc-1'))).toBe(true);
    // Reload: the IDs are remembered, so nothing is created again.
    source.close();
    await connect();
    expect(twitch.sent(CREATE)).toHaveLength(2);
    // Stored IDs lost: the game finds the rewards it made before by title and only creates the one it can't find.
    storage.delete('rhino-twitch-rewards');
    twitch.on(REWARDS, ({ url }) => ({ body: { data: url.searchParams.get('only_manageable_rewards') === 'true' ? [{ id: 'rew-1', title: 'Test Kirov' }] : [] } }));
    source.close();
    await connect();
    expect(twitch.sent(CREATE).slice(2).map((c) => JSON.parse(c.body).title)).toEqual(['Test Desolator']);
  });

  it('refunds the waiting redemptions of its retired rewards, then deletes them, before subscribing', async () => {
    const waiting = new Map([['old-1', Array.from({ length: 60 }, (_, i) => `red-${i}`)], ['old-2', []]]);
    // The streamer's own Desolator and Hydrate! aren't the game's: Twitch lists only the game's with only_manageable_rewards.
    twitch.on(REWARDS, ({ url }) => ({ body: { data: url.searchParams.get('only_manageable_rewards') === 'true'
      ? [{ id: 'old-1', title: 'Kirov' }, { id: 'old-2', title: 'Chronosphere' }, { id: 'rew-1', title: 'Test Kirov' }]
      : [{ id: 'theirs', title: 'Desolator' }, { id: 'hydrate', title: 'Hydrate!' }] } }))
      .on(WAITING, ({ url }) => ({ body: { data: waiting.get(url.searchParams.get('reward_id')!)!.slice(0, Number(url.searchParams.get('first'))).map((id) => ({ id })) } }))
      .on(SETTLE, ({ url }) => {
        const ids = url.searchParams.getAll('id'), reward = url.searchParams.get('reward_id')!;
        waiting.set(reward, waiting.get(reward)!.filter((id) => !ids.includes(id)));
        return { body: { data: ids.map((id) => ({ id })) } };
      })
      .on(DELETE, () => ({ status: 204 }));
    source.close();
    const from = twitch.calls.length;
    await connect();
    last().welcome('session-2');
    await vi.advanceTimersByTimeAsync(0);
    const calls = twitch.calls.slice(from).filter((c) => c.url.pathname.includes('/channel_points/') || c.url.pathname.includes('/eventsub/'));
    expect(calls.map((c) => `${c.method} ${c.url.searchParams.get('reward_id') ?? c.url.searchParams.get('id') ?? ''} ${c.url.searchParams.getAll('id').length || ''}`.trim())).toEqual([
      'GET', 'GET old-1', 'PATCH old-1 50', 'GET old-1', 'PATCH old-1 10', 'GET old-1', 'DELETE old-1 1', 'GET old-2', 'DELETE old-2 1', 'POST', 'POST', 'POST',
    ]);
    expect(calls.filter((c) => c.method === 'PATCH').every((c) => JSON.parse(c.body).status === 'CANCELED')).toBe(true);
    // Once none are left, it does nothing.
    twitch.on(REWARDS, () => ({ body: { data: [{ id: 'rew-1', title: 'Test Kirov' }] } }));
    source.close();
    const again = twitch.calls.length;
    await connect();
    expect(twitch.calls.slice(again).filter((c) => [WAITING, SETTLE, DELETE].includes(`${c.method} ${c.url.origin}${c.url.pathname}`))).toEqual([]);
  });

  it('subscribes the session to chat, redemptions and cheers on the streamer\'s channel', () => {
    expect(last().url).toBe('wss://eventsub.wss.twitch.tv/ws');
    expect(twitch.sent(SUBSCRIBE).map((c) => JSON.parse(c.body))).toEqual([
      { type: 'channel.chat.message', version: '1', condition: { broadcaster_user_id: '42', user_id: '42' }, transport: { method: 'websocket', session_id: 'session-1' } },
      { type: 'channel.channel_points_custom_reward_redemption.add', version: '1', condition: { broadcaster_user_id: '42' }, transport: { method: 'websocket', session_id: 'session-1' } },
      { type: 'channel.cheer', version: '1', condition: { broadcaster_user_id: '42' }, transport: { method: 'websocket', session_id: 'session-1' } },
    ]);
  });

  it('lets chatters join under their Twitch user ID', () => {
    openJoinWindow(race);
    last().notify('channel.chat.message', { chatter_user_id: '123', chatter_user_login: 'vera', chatter_user_name: 'Vera', message_id: 'm1', message: { text: '!rhino', fragments: [] }, cheer: null });
    expect(race.racers.map((r) => [r.viewerId, r.name])).toEqual([['twitch:123', 'Vera']]);
  });

  it("settles a redemption of the game's rewards by its status, and ignores the streamer's other rewards", async () => {
    const redeem = (id: string, reward: { id: string; title: string }) => last().notify('channel.channel_points_custom_reward_redemption.add', { id, user_id: '7', user_login: 'vera', user_name: 'Vera', user_input: '', status: 'unfulfilled', reward: { ...reward, cost: 1000, prompt: '' } });
    redeem('red-1', { id: 'rew-1', title: 'Test Kirov' });
    redeem('red-2', { id: 'rew-other', title: 'Hydrate!' });
    // Same title, but not a reward the game made: Twitch wouldn't let it refund this one.
    redeem('red-3', { id: 'rew-other-2', title: 'Test Kirov' });
    race.settlements.push({ reference: 'red-1', outcome: 'fulfilled' });
    await vi.advanceTimersByTimeAsync(1000);
    // Outside a race, so refunded straight away; the later "fulfilled" finds it settled already.
    expect(twitch.sent(SETTLE).map((c) => [Object.fromEntries(c.url.searchParams), JSON.parse(c.body)])).toEqual([
      [{ broadcaster_id: '42', reward_id: 'rew-1', id: 'red-1' }, { status: 'CANCELED' }],
    ]);
  });

  it('turns a cheer of exactly 10, 20 or 50 bits into a Desolator, Kirov or Chronosphere, anonymous ones too', () => {
    const cheer = (bits: number, user: { user_id: string; user_name: string } | null) => last().notify('channel.cheer', { is_anonymous: !user, user_id: user?.user_id ?? null, user_login: null, user_name: user?.user_name ?? null, broadcaster_user_id: '42', message: `Cheer${bits}`, bits });
    const vera = { user_id: '7', user_name: 'Vera' };
    for (const bits of [49, 100, 10, 20, 50]) cheer(bits, vera);
    cheer(50, null);
    expect(eventChips(race).map((c) => c.label)).toEqual(['DESOLATOR · Vera · next race', 'KIROV · Vera · next race', 'CHRONOSPHERE · Vera · next race', 'CHRONOSPHERE · Anonymous · next race']);
  });

  const redeemKirov = (id = 'red-1') => last().notify('channel.channel_points_custom_reward_redemption.add', { id, user_id: '7', user_name: 'Vera', status: 'unfulfilled', reward: { id: 'rew-1', title: 'Test Kirov' } });

  it('goes offline on a drop, keeps settlements for later and reconnects with growing waits', async () => {
    redeemKirov();
    last().drop();
    expect(source.online()).toBe(false);
    const waits: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = FakeSocket.all.length;
      let waited = 0;
      while (FakeSocket.all.length === before) { await vi.advanceTimersByTimeAsync(100); waited += 100; }
      waits.push(waited);
      if (attempt < 3) last().drop();
    }
    expect(waits).toEqual([1000, 2000, 4000, 8000]);
    expect(twitch.sent(SETTLE)).toEqual([]);
    last().welcome('session-2');
    expect(source.online()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    expect(twitch.sent(SETTLE).map((c) => c.url.searchParams.get('id'))).toEqual(['red-1']);
    expect(twitch.sent(SUBSCRIBE).map((c) => JSON.parse(c.body).transport.session_id)).toEqual([...Array(3).fill('session-1'), ...Array(3).fill('session-2')]);
  });

  it('reconnects when Twitch goes quiet past the keepalive', async () => {
    await vi.advanceTimersByTimeAsync(9000);
    last().message('session_keepalive', {});
    await vi.advanceTimersByTimeAsync(9000);
    expect(FakeSocket.all).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(3000);
    expect(source.online()).toBe(false);
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it("moves to Twitch's reconnect URL without dropping out or subscribing again", async () => {
    const old = last();
    old.message('session_reconnect', { session: { id: 'session-1', status: 'reconnecting', reconnect_url: 'wss://eventsub.wss.twitch.tv/ws?reconnect=abc' } });
    expect(last().url).toBe('wss://eventsub.wss.twitch.tv/ws?reconnect=abc');
    last().welcome('session-1');
    await vi.advanceTimersByTimeAsync(5000);
    expect([old.readyState, source.online(), FakeSocket.all.length, twitch.sent(SUBSCRIBE).length]).toEqual([3, true, 2, 3]);
  });

  it('refunds a redemption still unsettled when the page reloads', async () => {
    last().drop();
    redeemKirov();
    source.close();
    race = newRace();
    await connect();
    last().welcome();
    await vi.advanceTimersByTimeAsync(1000);
    expect(twitch.sent(SETTLE).map((c) => [c.url.searchParams.get('id'), JSON.parse(c.body).status])).toEqual([['red-1', 'CANCELED']]);
  });

  /** Twitch expires the access token: Helix and validation answer 401 until the refresh token is traded in. */
  const expire = () => {
    let refreshed = 0;
    twitch.on(SETTLE, ({ headers }) => headers.Authorization === 'Bearer acc-1' ? { status: 401 } : { body: { data: [{}] } })
      .on(VALIDATE, ({ headers }) => headers.Authorization === 'OAuth acc-1' ? { status: 401 } : { body: { user_id: '42', login: 'p0mz0r', expires_in: 9000 } })
      .on(TOKEN, ({ body }) => {
        const form = new URLSearchParams(body);
        refreshed++;
        return form.get('grant_type') === 'refresh_token' && form.get('refresh_token') === `ref-${refreshed}` ? { body: { access_token: `acc-${refreshed + 1}`, refresh_token: `ref-${refreshed + 1}` } } : { status: 400, body: { message: 'Invalid refresh token' } };
      });
  };

  it('refreshes an expired token and retries, remembering the new pair', async () => {
    expire();
    redeemKirov();
    await vi.advanceTimersByTimeAsync(1000);
    expect(twitch.sent(SETTLE).map((c) => c.headers.Authorization)).toEqual(['Bearer acc-1', 'Bearer acc-2']);
    expect(new URLSearchParams(twitch.sent(TOKEN)[0]!.body).get('client_id')).toBe('5cm8euhmabzd9g4mnkwidz07sftngy');
    expect(JSON.parse(storage.get('rhino-twitch-login')!)).toEqual({ ...LOGGED_IN, access: 'acc-2', refresh: 'ref-2' });
  });

  it('validates the token on start and every hour, refreshing it once Twitch no longer accepts it', async () => {
    expect(twitch.sent(VALIDATE)).toHaveLength(1);
    expire();
    await vi.advanceTimersByTimeAsync(59 * 60_000);
    expect([twitch.sent(VALIDATE).length, twitch.sent(TOKEN).length]).toEqual([1, 0]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect([twitch.sent(VALIDATE).length, twitch.sent(TOKEN).length]).toEqual([2, 1]);
    expect(JSON.parse(storage.get('rhino-twitch-login')!).access).toBe('acc-2');
  });

  it('tries a settlement again while Twitch is down, but not one it refuses', async () => {
    let down = true;
    twitch.on(SETTLE, ({ url }) => url.searchParams.get('id') === 'red-2' ? { status: 404 } : down ? { status: 503 } : { body: { data: [{}] } });
    redeemKirov('red-1');
    redeemKirov('red-2');
    await vi.advanceTimersByTimeAsync(300);
    down = false;
    await vi.advanceTimersByTimeAsync(1000);
    expect(twitch.sent(SETTLE).map((c) => c.url.searchParams.get('id'))).toEqual(['red-1', 'red-2', 'red-1']);
  });

  it('reconnects when Twitch refuses a subscription, rather than sit online but deaf', async () => {
    twitch.on(SUBSCRIBE, () => ({ status: 429 }));
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    last().welcome('session-2');
    await vi.advanceTimersByTimeAsync(0);
    expect([source.online(), last().readyState]).toEqual([false, 3]);
  });

  it('stays logged in when Twitch fails to refresh the token for its own reasons', async () => {
    expire();
    twitch.on(TOKEN, () => ({ status: 503 }));
    redeemKirov();
    await vi.advanceTimersByTimeAsync(1000);
    expect([source.online(), storage.has('rhino-twitch-login')]).toEqual([true, true]);
  });

  it('leaves the rewards alone when the login is refused on start', async () => {
    source.close();
    expire();
    twitch.on(TOKEN, () => ({ status: 400, body: { message: 'Invalid refresh token' } }));
    const from = twitch.calls.length;
    await connect();
    expect(twitch.calls.slice(from).map((c) => `${c.method} ${c.url.origin}${c.url.pathname}`)).toEqual([VALIDATE, TOKEN]);
  });

  it('logs out and shows offline when the refresh token is no longer good', async () => {
    expire();
    twitch.on(TOKEN, () => ({ status: 400, body: { message: 'Invalid refresh token' } }));
    redeemKirov();
    await vi.advanceTimersByTimeAsync(1000);
    expect([source.online(), storage.has('rhino-twitch-login'), last().readyState]).toEqual([false, false, 3]);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(1);
  });
});
