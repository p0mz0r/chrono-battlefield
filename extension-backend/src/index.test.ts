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
  constructor() { FakeSocket.all.push(this); }
  accept() { this.accepted = true; }
  send(data: string) { this.sent.push(data); }
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
let broadcasts: { headers: Record<string, string>; body: any }[], channels: Map<string, ChannelLink>, env: Env;
beforeEach(() => {
  FakeSocket.all = [];
  broadcasts = [];
  channels = new Map();
  vi.stubGlobal('WebSocketPair', class { 0 = new FakeSocket(); 1 = new FakeSocket(); });
  // Node's Response refuses status 101, which the runtime needs for an upgrade.
  vi.stubGlobal('Response', class { status: number; webSocket: FakeSocket; headers: Headers; constructor(_: null, init: { status: number; webSocket: FakeSocket; headers: Record<string, string> }) { this.status = init.status; this.webSocket = init.webSocket; this.headers = new Headers(init.headers); } });
  vi.stubGlobal('fetch', async (url: string, init: { headers: Record<string, string>; body?: string }) => {
    if (url === 'https://id.twitch.tv/oauth2/validate') {
      const token = TOKENS[init.headers.Authorization!.replace('OAuth ', '')];
      return { ok: !!token, status: token ? 200 : 401, json: async () => token ?? { status: 401, message: 'invalid access token' } };
    }
    if (url === 'https://api.twitch.tv/helix/extensions/pubsub') { broadcasts.push({ headers: init.headers, body: JSON.parse(init.body!) }); return { ok: true, status: 204, json: async () => ({}) }; }
    throw new Error(`unexpected fetch ${url}`);
  });
  env = {
    EXTENSION_SECRET: SECRET, EXTENSION_OWNER_ID: '427115971',
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
