import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import worker, { ChannelLink, type Env } from './index.js';

const GAME_CLIENT_ID = '5cm8euhmabzd9g4mnkwidz07sftngy', EXTENSION_CLIENT_ID = 'v7ctzkptbah93gk31kw0jx0t2p9657';
/** A made-up extension secret, base64 as Twitch's dashboard shows it. */
const SECRET = btoa('not the real secret, 32 bytes!!!');

/** One end of a WebSocket as the Workers runtime hands it out. */
class FakeSocket {
  static all: FakeSocket[] = [];
  accepted = false;
  closed: { code: number; reason: string } | undefined;
  sent: string[] = [];
  attachment: unknown;
  /** The game behind this end: answers what the backend sends it, as its socket would, a moment later. */
  game: ((message: any) => unknown) | undefined;
  constructor() { FakeSocket.all.push(this); }
  accept() { this.accepted = true; }
  send(data: string) {
    this.sent.push(data);
    const answer = this.game?.(JSON.parse(data));
    if (answer) queueMicrotask(() => channels.get((this.attachment as { channel: string }).channel)!.webSocketMessage(this as never, JSON.stringify(answer)));
  }
  close(code: number, reason: string) { this.closed = { code, reason }; }
  /** Closed by the backend: closing, until the game answers. */
  get readyState() { return this.closed ? 2 : 1; }
  serializeAttachment(value: unknown) { this.attachment = structuredClone(value); }
  deserializeAttachment() { return this.attachment; }
}
/** The runtime's Durable Object state: only the hibernatable sockets the backend uses. */
class FakeState {
  sockets: FakeSocket[] = [];
  acceptWebSocket(socket: FakeSocket) { this.sockets.push(socket); }
  /** As the runtime: a socket stays listed until its close completes, even once the backend closed it. */
  getWebSockets() { return this.sockets; }
}

/** Twitch: `/oauth2/validate` knows two tokens; PubSub records each broadcast. */
const TOKENS: Record<string, object> = {
  'operator-token': { client_id: GAME_CLIENT_ID, login: 'p0mz0r', user_id: '427115971' },
  'other-app-token': { client_id: 'someoneelse0000000000000000000', login: 'p0mz0r', user_id: '427115971' },
};
/** Twitch's users, as Get Users names them. */
const USERS: Record<string, string> = { '1': 'Kane', '2': 'Seth' };
let broadcasts: { headers: Record<string, string>; body: any }[], channels: Map<string, ChannelLink>, env: Env, userLookups: string[];
beforeEach(() => {
  FakeSocket.all = [];
  broadcasts = [];
  userLookups = [];
  channels = new Map();
  vi.stubGlobal('WebSocketPair', class { 0 = new FakeSocket(); 1 = new FakeSocket(); });
  // Node's Response refuses status 101, which the runtime needs for an upgrade.
  vi.stubGlobal('Response', class {
    status: number; webSocket: FakeSocket | undefined; headers: Headers;
    constructor(private body: string | null, init: { status?: number; webSocket?: FakeSocket; headers?: Record<string, string> } = {}) { this.status = init.status ?? 200; this.webSocket = init.webSocket; this.headers = new Headers(init.headers); }
    async json() { return JSON.parse(this.body!); }
  });
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      const token = TOKENS[init.headers.Authorization!.replace('OAuth ', '')];
      return { ok: !!token, status: token ? 200 : 401, json: async () => token ?? { status: 401, message: 'invalid access token' } };
    }
    if (url === `https://id.twitch.tv/oauth2/token?client_id=${EXTENSION_CLIENT_ID}&client_secret=client-secret&grant_type=client_credentials`) return { ok: true, status: 200, json: async () => ({ access_token: 'app-token', expires_in: 5_000_000 }) };
    if (url.startsWith('https://api.twitch.tv/helix/users?id=')) {
      const id = url.split('=')[1]!;
      expect([init.headers.Authorization, init.headers['Client-Id']]).toEqual(['Bearer app-token', EXTENSION_CLIENT_ID]);
      userLookups.push(id);
      return { ok: true, status: 200, json: async () => ({ data: USERS[id] ? [{ id, display_name: USERS[id] }] : [] }) };
    }
    if (url === 'https://api.twitch.tv/helix/extensions/pubsub') { broadcasts.push({ headers: init.headers, body: JSON.parse(init.body!) }); return { ok: true, status: 204, json: async () => ({}) }; }
    throw new Error(`unexpected fetch ${url}`);
  });
  env = {
    EXTENSION_SECRET: SECRET, EXTENSION_OWNER_ID: '427115971', EXTENSION_CLIENT_SECRET: 'client-secret',
    CHANNEL: { idFromName: (name: string) => name, get: (id: string) => channels.get(id) ?? channels.set(id, new ChannelLink(new FakeState() as never, env)).get(id)! },
  };
});
afterEach(() => vi.unstubAllGlobals());

/** The game opening its link with `token`, as a browser WebSocket offers it. */
const link = (token: string) => worker.fetch(new Request('https://backend.test/game', { headers: { Upgrade: 'websocket', 'Sec-WebSocket-Protocol': `rhino-game, ${token}` } }), env) as unknown as Promise<{ status: number; webSocket: FakeSocket; headers: Headers }>;
/** The game's end of the link just opened, and the backend's. */
const ends = () => ({ game: FakeSocket.all.at(-2)!, backend: FakeSocket.all.at(-1)! });
const snapshot = { show: true, phase: 'racing', countdown: 0, field: 8, interactions: ['boost'], paid: ['kirov'], armed: false, racers: [{ id: '1', place: 2, progress: 40, colour: '#808080', finished: false }] };
const send = (channel: string, message: unknown) => channels.get(channel)!.webSocketMessage(ends().backend as never, JSON.stringify(message));

/** The claims of a JWT, once its HS256 signature checks out against the secret. */
async function verified(jwt: string) {
  const [header, payload, signature] = jwt.split('.') as [string, string, string];
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(SECRET), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
  const bytes = (b64url: string) => Uint8Array.from(atob(b64url.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
  expect(await crypto.subtle.verify('HMAC', key, bytes(signature), new TextEncoder().encode(`${header}.${payload}`))).toBe(true);
  expect(JSON.parse(new TextDecoder().decode(bytes(header)))).toEqual({ alg: 'HS256', typ: 'JWT' });
  return JSON.parse(new TextDecoder().decode(bytes(payload)));
}

describe('extension backend', () => {
  it('binds a game with a token from the game\'s own Twitch app to that token\'s channel', async () => {
    const reply = await link('operator-token');
    expect([reply.status, reply.headers.get('Sec-WebSocket-Protocol'), reply.webSocket]).toEqual([101, 'rhino-game', ends().game]);
    expect([[...channels.keys()], ends().backend.closed]).toEqual([['427115971'], undefined]);
  });

  it('refuses a token Twitch doesn\'t know, or one from another app, and binds no channel', async () => {
    for (const token of ['made-up-token', 'other-app-token']) {
      const reply = await link(token);
      expect([reply.status, ends().backend.closed?.code]).toEqual([101, 4001]);
    }
    expect(channels.size).toBe(0);
  });

  it('passes each snapshot to the channel\'s viewers as one Extension PubSub broadcast, signed with the extension secret', async () => {
    await link('operator-token');
    await send('427115971', { type: 'snapshot', snapshot });
    expect(broadcasts).toHaveLength(1);
    const [{ headers, body }] = broadcasts as [typeof broadcasts[number]];
    expect([headers['Client-Id'], body]).toEqual([EXTENSION_CLIENT_ID, { target: ['broadcast'], broadcaster_id: '427115971', is_global_broadcast: false, message: JSON.stringify(snapshot) }]);
    const claims = await verified(headers.Authorization!.replace('Bearer ', ''));
    expect([claims.role, claims.user_id, claims.channel_id, claims.pubsub_perms]).toEqual(['external', '427115971', '427115971', { send: ['broadcast'] }]);
    expect(claims.exp).toBeGreaterThan(Date.now() / 1000);
  });

  it('drops a snapshot over 5 KB, which PubSub would refuse', async () => {
    await link('operator-token');
    await send('427115971', { type: 'snapshot', snapshot: { ...snapshot, padding: 'x'.repeat(5 * 1024) } });
    expect(broadcasts).toHaveLength(0);
  });

  it('replaces the channel\'s game socket when a second one links', async () => {
    await link('operator-token');
    const first = ends().backend;
    await link('operator-token');
    expect([first.closed?.code, ends().backend.closed, channels.size]).toEqual([4000, undefined, 1]);
  });

  it('greets a game it accepts, so the game can tell a link from a refusal', async () => {
    await link('operator-token');
    expect(ends().backend.sent).toEqual([JSON.stringify({ type: 'linked' })]);
  });

  it('tells the channel\'s viewers the game is offline when its socket closes', async () => {
    await link('operator-token');
    const backend = ends().backend;
    await channels.get('427115971')!.webSocketClose(backend as never, 1006, '');
    expect(broadcasts.map((b) => [b.body.broadcaster_id, JSON.parse(b.body.message)])).toEqual([['427115971', { show: false }]]);
  });

  it('tells viewers the game is offline when the newer link drops while the one it replaced is still closing', async () => {
    await link('operator-token');
    await link('operator-token');
    await channels.get('427115971')!.webSocketClose(ends().backend as never, 1006, '');
    expect(broadcasts.map((b) => JSON.parse(b.body.message))).toEqual([{ show: false }]);
  });

  it('broadcasts no offline when the closing socket was replaced by a newer link', async () => {
    await link('operator-token');
    const first = ends().backend;
    await link('operator-token');
    await channels.get('427115971')!.webSocketClose(first as never, 4000, 'Replaced by a newer link');
    expect(broadcasts).toHaveLength(0);
  });
});

/** A JWT as Twitch hands a viewer of channel 427115971 in `onAuthorized`, signed with `secret`; `user_id` once they share identity. */
async function viewerJwt(claims: object = {}, secret = SECRET) {
  const encode = (value: unknown) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 3600, opaque_user_id: 'U1', user_id: '1', channel_id: '427115971', role: 'viewer', ...claims })}`;
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(secret), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${btoa(String.fromCharCode(...new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')}`;
}
/** A viewer's press as the front end fetches it: what the backend answers, its HTTP status beside it. */
async function press(jwt: string, command: string) {
  const reply = await worker.fetch(new Request('https://backend.test/press', { method: 'POST', headers: { Authorization: `Bearer ${jwt}` }, body: JSON.stringify({ command }) }), env) as unknown as { status: number; json(): Promise<unknown> };
  return [reply.status, await reply.json()];
}
/** The game links its channel and answers each press with `result`; returns the presses it got. */
async function gameAnswering(result: (press: any) => unknown) {
  await link('operator-token');
  const got: unknown[] = [];
  ends().backend.game = (message) => { if (message.type !== 'press') return; got.push(message); return { type: 'reply', id: message.id, result: result(message) }; };
  return got;
}

describe('viewer presses', () => {
  it('forwards a press to the channel\'s game as that viewer, named by Twitch, and answers with what the game replied', async () => {
    const got = await gameAnswering((p) => ({ ok: true, reason: `joined as ${p.name}` }));
    expect(await press(await viewerJwt(), '!rhino')).toEqual([200, { ok: true, reason: 'joined as Kane' }]);
    expect(got).toEqual([{ type: 'press', id: expect.any(String), userId: '1', name: 'Kane', command: '!rhino' }]);
  });

  it('matches each reply to its press by request ID', async () => {
    await link('operator-token');
    const backend = ends().backend, link_ = channels.get('427115971')!;
    const presses = [press(await viewerJwt(), '!boost'), press(await viewerJwt({ user_id: '2' }), '!tesla')];
    while (backend.sent.filter((s) => s.includes('press')).length < 2) await new Promise((r) => setTimeout(r));
    const [boost, tesla] = backend.sent.map((s) => JSON.parse(s)).filter((m) => m.type === 'press');
    await link_.webSocketMessage(backend as never, JSON.stringify({ type: 'reply', id: tesla.id, result: { ok: false, reason: 'Seth is on cooldown' } }));
    await link_.webSocketMessage(backend as never, JSON.stringify({ type: 'reply', id: boost.id, result: { ok: true, reason: 'boosted' } }));
    expect(await Promise.all(presses)).toEqual([[200, { ok: true, reason: 'boosted' }], [200, { ok: false, reason: 'Seth is on cooldown' }]]);
  });

  it('asks Twitch for a viewer\'s name once, then remembers it', async () => {
    await gameAnswering(() => ({ ok: true, reason: '' }));
    for (const command of ['!boost', '!missile']) await press(await viewerJwt(), command);
    expect(userLookups).toEqual(['1']);
  });

  it('answers "Game offline" at once when the channel has no game linked, forwarding nothing', async () => {
    expect(await press(await viewerJwt(), '!rhino')).toEqual([200, { ok: false, reason: 'Game offline' }]);
    await link('operator-token');
    await channels.get('427115971')!.webSocketClose(ends().backend as never, 1006, '');
    expect(await press(await viewerJwt(), '!rhino')).toEqual([200, { ok: false, reason: 'Game offline' }]);
  });

  it('answers "No answer" when the game stays silent for 3 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout'] });
    try {
      await link('operator-token');
      let settled = false;
      const reply = press(await viewerJwt(), '!boost').finally(() => { settled = true; });
      while (!ends().backend.sent.some((s) => s.includes('press'))) await new Promise((r) => setImmediate(r));
      await vi.advanceTimersByTimeAsync(2900);
      expect(settled).toBe(false);
      await vi.advanceTimersByTimeAsync(100);
      expect(await reply).toEqual([200, { ok: false, reason: 'No answer' }]);
    } finally { vi.useRealTimers(); }
  });

  it('refuses a JWT Twitch didn\'t sign with the extension secret, or one expired', async () => {
    const got = await gameAnswering(() => ({ ok: true, reason: '' }));
    for (const jwt of ['', 'not.a.jwt', await viewerJwt({}, btoa('some other secret, 32 bytes long')), await viewerJwt({ exp: Math.floor(Date.now() / 1000) - 1 })])
      expect((await press(jwt, '!rhino'))[0]).toBe(401);
    expect(got).toEqual([]);
  });

  it('refuses a viewer who hasn\'t shared their identity, since the game needs their Twitch user ID', async () => {
    const got = await gameAnswering(() => ({ ok: true, reason: '' }));
    expect((await press(await viewerJwt({ user_id: undefined, opaque_user_id: 'A1' }), '!rhino'))[0]).toBe(403);
    expect(got).toEqual([]);
  });

  it('forwards only the bare commands the rail offers', async () => {
    const got = await gameAnswering(() => ({ ok: true, reason: '' }));
    for (const command of ['!rhino', '!boost', '!missile', '!tesla', '!shield', '!v3', '!nuke']) expect((await press(await viewerJwt(), command))[0]).toBe(200);
    for (const command of ['!bridge 3', '!v3 back', 'hello', '!kirov']) expect((await press(await viewerJwt(), command))[0]).toBe(400);
    expect(got).toHaveLength(7);
  });

  it('lets the extension\'s page on Twitch call it: preflight and replies allow any origin', async () => {
    const preflight = await worker.fetch(new Request('https://backend.test/press', { method: 'OPTIONS' }), env) as unknown as { status: number; headers: Headers };
    expect([preflight.status, preflight.headers.get('Access-Control-Allow-Origin'), preflight.headers.get('Access-Control-Allow-Headers')]).toEqual([204, '*', 'Authorization, Content-Type']);
    const reply = await worker.fetch(new Request('https://backend.test/press', { method: 'POST', body: '{}' }), env) as unknown as { headers: Headers };
    expect(reply.headers.get('Access-Control-Allow-Origin')).toBe('*');
  });
});
