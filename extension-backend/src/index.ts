import { TWITCH_CLIENT_ID } from '../../src/chat/twitchLogin.js';
import { CHEER_PRICES, type ChatResult, type PaidEvent } from '../../src/race/race.js';
import type { Press, Purchase } from '../../src/chat/gameLink.js';

// The extension backend (#187): a Cloudflare Worker that checks a game's Twitch token and hands its socket to one
// Durable Object per channel, which passes the game's snapshots to that channel's viewers over Extension PubSub.

/** The Twitch extension's Client ID (#191); public, unlike its secret. */
const EXTENSION_CLIENT_ID = 'v7ctzkptbah93gk31kw0jx0t2p9657';
/** The subprotocol the game offers beside its token. */
const PROTOCOL = 'rhino-game';
/** Close codes the game can tell apart: its socket was taken by a newer one for the same channel, or its token was refused. */
const REPLACED = 4000, REFUSED = 4001;
/** The snapshot viewers get once the game's link is gone: the rail draws nothing. */
const OFFLINE = { show: false };
/** Extension PubSub's largest message. */
const MAX_MESSAGE = 5 * 1024;
/** The chat commands the rail's buttons send, bare (#198): a viewer can press nothing else. */
const PRESSES = ['!rhino', '!boost', '!missile', '!tesla', '!shield', '!v3', '!nuke'];
/** Milliseconds a press waits for the game's answer. */
const ANSWER_WAIT = 3000;
const GAME_OFFLINE: ChatResult = { ok: false, reason: 'Game offline' }, NO_ANSWER: ChatResult = { ok: false, reason: 'No answer' };
/** Get Users failed, so the game was never asked: the game knows a viewer by name as well as ID. */
const TWITCH_DOWN: ChatResult = { ok: false, reason: 'Twitch didn\'t answer' };
/** A receipt plays once. */
const PLAYED: ChatResult = { ok: false, reason: 'Already played' };
/** The extension's page is served from Twitch's own origin; its JWT, not a cookie, says who presses. */
const CORS = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Authorization, Content-Type', 'Access-Control-Allow-Methods': 'POST' };

/** The parts of the Workers runtime the backend uses, so it builds and tests without Cloudflare's types. */
interface WorkerSocket {
  /** 1 while open; a socket the backend is closing still lists until the game answers. */
  readyState: number;
  accept(): void;
  send(data: string): void;
  close(code: number, reason: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): any;
}
interface State {
  acceptWebSocket(socket: WorkerSocket): void;
  getWebSockets(): WorkerSocket[];
  storage: { get(key: string): Promise<unknown>; put(key: string, value: unknown): Promise<void> };
}
declare const WebSocketPair: new () => { 0: WorkerSocket; 1: WorkerSocket };
type Upgrade = ResponseInit & { webSocket: WorkerSocket };

/** What the Worker's environment holds. */
export interface Env {
  /** The extension secret, base64 (`wrangler secret put EXTENSION_SECRET`): never committed. */
  EXTENSION_SECRET: string;
  /** The Twitch user ID that owns the extension, which its broadcasts are signed as. */
  EXTENSION_OWNER_ID: string;
  /** The extension's Twitch API client secret, for Get Users (`wrangler secret put EXTENSION_CLIENT_SECRET`): never committed. */
  EXTENSION_CLIENT_SECRET: string;
  /** The Durable Objects, one per channel by its Twitch user ID. */
  CHANNEL: { idFromName(name: string): unknown; get(id: any): { fetch(request: Request): Promise<Response> } };
}

/** Answers a WebSocket upgrade with the game's end of a new pair; `backend` gets the other. */
function upgrade(backend: (socket: WorkerSocket) => void): Response {
  const pair = new WebSocketPair();
  backend(pair[1]);
  return new Response(null, { status: 101, webSocket: pair[0], headers: { 'Sec-WebSocket-Protocol': PROTOCOL } } as Upgrade);
}

/** The channel a game's token speaks for: Twitch must know it, and it must come from the game's own app. Never stored. */
async function channelOf(token: string | undefined) {
  if (!token) return undefined;
  const reply = await fetch('https://id.twitch.tv/oauth2/validate', { headers: { Authorization: `OAuth ${token}` } });
  const who = reply.ok ? await reply.json() as { client_id?: string; user_id?: string } : {};
  return who.client_id === TWITCH_CLIENT_ID && who.user_id ? who.user_id : undefined;
}

const base64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const fromBase64url = (text: string) => Uint8Array.from(atob(text.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));
/** The extension secret as an HS256 key. */
const secretKey = (env: Env, use: 'sign' | 'verify') => crypto.subtle.importKey('raw', Uint8Array.from(atob(env.EXTENSION_SECRET), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, [use]);

/** A JWT that lets the backend broadcast to `channel`'s viewers for a minute, signed HS256 with the extension secret. */
async function broadcastJwt(env: Env, channel: string) {
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 60, user_id: env.EXTENSION_OWNER_ID, role: 'external', channel_id: channel, pubsub_perms: { send: ['broadcast'] } })}`;
  return `${body}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', await secretKey(env, 'sign'), new TextEncoder().encode(body))))}`;
}

/** A JWT's claims once it checks out: signed by Twitch with the extension secret, unexpired. */
async function claimsOf(env: Env, jwt: string | undefined): Promise<any> {
  const [header, payload, signature] = jwt?.split('.') ?? [];
  if (!signature) return undefined;
  try {
    if (!await crypto.subtle.verify('HMAC', await secretKey(env, 'verify'), fromBase64url(signature), new TextEncoder().encode(`${header}.${payload}`))) return undefined;
    const claims = JSON.parse(new TextDecoder().decode(fromBase64url(payload!)));
    return claims.exp > Date.now() / 1000 ? claims : undefined;
  } catch { return undefined; }
}

/** A viewer's `onAuthorized` JWT once it checks out. `user_id` only once they share identity. */
async function viewerOf(env: Env, request: Request): Promise<{ channel_id: string; user_id?: string } | undefined> {
  const claims = await claimsOf(env, request.headers.get('Authorization')?.replace(/^Bearer /, ''));
  return claims?.channel_id ? claims : undefined;
}

/** A Bits transaction receipt once it checks out: Twitch signed it, for one of the catalog's SKUs at its price (#191). */
async function purchaseOf(env: Env, receipt: string | undefined): Promise<{ userId: string; event: PaidEvent; transactionId: string } | undefined> {
  const claims = await claimsOf(env, receipt), data = claims?.data, sku = data?.product?.sku, cost = data?.product?.cost;
  if (claims?.topic !== 'bits_transaction_receipt' || !data?.userId || !data.transactionId || !Object.hasOwn(CHEER_PRICES, sku)) return undefined;
  return cost?.type === 'bits' && cost.amount === CHEER_PRICES[sku as PaidEvent] ? { userId: data.userId, event: sku, transactionId: data.transactionId } : undefined;
}

/** The extension's app access token for Get Users, kept until a minute before Twitch expires it. */
let app: { token: string; until: number } | undefined;
async function appToken(env: Env) {
  if (app && app.until > Date.now()) return app.token;
  const reply = await fetch(`https://id.twitch.tv/oauth2/token?client_id=${EXTENSION_CLIENT_ID}&client_secret=${env.EXTENSION_CLIENT_SECRET}&grant_type=client_credentials`, { method: 'POST' });
  const { access_token, expires_in } = await reply.json() as { access_token: string; expires_in: number };
  app = { token: access_token, until: Date.now() + (expires_in - 60) * 1000 };
  return access_token;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...CORS, 'Content-Type': 'application/json' } });

const notSigned = () => json(401, { ok: false, reason: 'Not signed by Twitch' });
/** The game's answer to a checked press or purchase, from the viewer's channel's object. */
async function toChannel(env: Env, request: Request, channel: string, body: object): Promise<Response> {
  const answer = await env.CHANNEL.get(env.CHANNEL.idFromName(channel)).fetch(new Request(request.url, { method: 'POST', body: JSON.stringify(body) }));
  return json(200, await answer.json());
}

/** `/press`: a viewer's button press, checked here, answered by their channel's game. */
async function press(request: Request, env: Env): Promise<Response> {
  const viewer = await viewerOf(env, request);
  if (!viewer) return notSigned();
  // The game knows a viewer by their Twitch user ID, which Twitch gives only once they share identity.
  if (!viewer.user_id) return json(403, { ok: false, reason: 'Share your Twitch identity to play' });
  const { command } = await request.json().catch(() => ({})) as { command?: string };
  if (!command || !PRESSES.includes(command)) return json(400, { ok: false, reason: 'Unknown action' });
  return toChannel(env, request, viewer.channel_id, { userId: viewer.user_id, command });
}

/**
 * `/bits`: a viewer's Bits purchase, its receipt checked here, played by their channel's game. The viewer's JWT names the
 * channel; the receipt names the buyer, so no shared identity is needed. Never stored or redelivered (#173).
 */
async function bits(request: Request, env: Env): Promise<Response> {
  const viewer = await viewerOf(env, request);
  if (!viewer) return notSigned();
  const { receipt } = await request.json().catch(() => ({})) as { receipt?: string };
  const purchase = await purchaseOf(env, receipt);
  if (!purchase) return json(400, { ok: false, reason: 'Not a Bits receipt' });
  return toChannel(env, request, viewer.channel_id, purchase);
}

/** One channel's link: at most one game socket, its snapshots out to the channel's viewers. */
export class ChannelLink {
  /** Presses waiting on the game's answer, by request ID. */
  private waiting = new Map<string, (result: ChatResult) => void>();
  /** Viewers' display names by Twitch user ID, as Get Users gave them. */
  // ponytail: never trimmed, and forgotten when the object hibernates; fine for one channel's viewers.
  private names = new Map<string, string>();

  constructor(private state: State, private env: Env) {}

  /** A game the Worker has checked, for the channel it names (a newer one replaces the old), or a viewer's checked press or purchase. */
  async fetch(request: Request): Promise<Response> {
    if (request.headers.get('Upgrade') !== 'websocket') {
      const body = await request.json();
      return new Response(JSON.stringify(await ('event' in body ? this.bits(body) : this.press(body))));
    }
    const channel = request.headers.get('X-Channel')!;
    return upgrade((socket) => {
      for (const old of this.state.getWebSockets()) old.close(REPLACED, 'Replaced by a newer link');
      this.state.acceptWebSocket(socket); // hibernatable: the attachment is all that survives between messages
      socket.serializeAttachment({ channel });
      // A refused socket opens too, before its close; this tells the game it is linked.
      socket.send(JSON.stringify({ type: 'linked' }));
    });
  }

  async webSocketMessage(socket: WorkerSocket, data: string | ArrayBuffer) {
    let message: { type?: string; snapshot?: unknown; id?: string; result?: ChatResult };
    try { message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    if (message.type === 'reply') return this.waiting.get(message.id!)?.(message.result!);
    if (message.type !== 'snapshot') return;
    const text = JSON.stringify(message.snapshot), { channel } = socket.deserializeAttachment();
    if (new TextEncoder().encode(text).length > MAX_MESSAGE) return;
    await this.broadcast(channel, text);
  }

  /** The game's socket closed: unless a newer link holds the channel, its viewers' rails draw nothing. */
  async webSocketClose(socket: WorkerSocket, code: number, reason: string) {
    try { socket.close(code, reason); } catch { /* already closed */ }
    if (this.state.getWebSockets().some((s) => s !== socket && s.readyState === 1)) return;
    await this.broadcast(socket.deserializeAttachment().channel, JSON.stringify(OFFLINE));
  }
  /** The game's socket failed: as a close. */
  async webSocketError(socket: WorkerSocket) { await this.webSocketClose(socket, 1011, 'Link failed'); }

  private game() { return this.state.getWebSockets().find((s) => s.readyState === 1); }

  /** A viewer's press, sent to the game with a request ID: the game's answer, or why there is none. Never retried. */
  private async press({ userId, command }: { userId: string; command: string }): Promise<ChatResult> {
    if (!this.game()) return GAME_OFFLINE;
    const name = await this.nameOf(userId);
    if (!name) return TWITCH_DOWN;
    return this.ask((id) => ({ type: 'press', id, userId, name, command }));
  }

  /** A viewer's checked purchase, sent as a press is: played once per receipt, and never lost to a failed Get Users. */
  private async bits({ userId, event, transactionId }: { userId: string; event: PaidEvent; transactionId: string }): Promise<ChatResult> {
    if (!this.game()) return GAME_OFFLINE;
    // In storage, so a replayed receipt stays refused after the object hibernates.
    // ponytail: never trimmed, one key per purchase; and per channel, so a receipt replayed to another channel plays there.
    const key = `receipt:${transactionId}`;
    if (await this.state.storage.get(key)) return PLAYED;
    await this.state.storage.put(key, true);
    const name = await this.nameOf(userId) ?? 'A viewer';
    return this.ask((id) => ({ type: 'bits', id, userId, name, event }));
  }

  /** `message` to the game under a new request ID: its answer, or "No answer" after 3 s. */
  private async ask(message: (id: string) => Press | Purchase): Promise<ChatResult> {
    const socket = this.game(); // naming the viewer took a moment: the game may have gone since
    if (!socket) return GAME_OFFLINE;
    const id = crypto.randomUUID();
    try {
      return await new Promise<ChatResult>((resolve) => {
        this.waiting.set(id, resolve);
        setTimeout(() => resolve(NO_ANSWER), ANSWER_WAIT);
        socket.send(JSON.stringify(message(id)));
      });
    } finally { this.waiting.delete(id); }
  }

  /** A viewer's display name, from Get Users the first time. */
  private async nameOf(userId: string): Promise<string | undefined> {
    const known = this.names.get(userId);
    if (known) return known;
    try {
      const reply = await fetch(`https://api.twitch.tv/helix/users?id=${userId}`, { headers: { Authorization: `Bearer ${await appToken(this.env)}`, 'Client-Id': EXTENSION_CLIENT_ID } });
      if (reply.status === 401) app = undefined; // revoked early: a new token on the next press
      const name = reply.ok ? (await reply.json() as { data: { display_name: string }[] }).data[0]?.display_name : undefined;
      if (name) this.names.set(userId, name);
      return name;
    } catch { return undefined; }
  }

  /** `text` to `channel`'s viewers as one Extension PubSub broadcast. */
  private async broadcast(channel: string, text: string) {
    // ponytail: a failed broadcast is dropped; the game re-sends within 5 s, and a rail goes blank after ~10 s of silence anyway.
    await fetch('https://api.twitch.tv/helix/extensions/pubsub', {
      method: 'POST', headers: { Authorization: `Bearer ${await broadcastJwt(this.env, channel)}`, 'Client-Id': EXTENSION_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: ['broadcast'], broadcaster_id: channel, is_global_broadcast: false, message: text }),
    }).catch(() => {});
  }
}

/** The Worker: `/game` takes a game's link, checks its Twitch login and hands it to its channel's object; `/press` a viewer's press, `/bits` their purchase. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);
    if ((pathname === '/press' || pathname === '/bits') && request.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });
    if (pathname === '/press') return press(request, env);
    if (pathname === '/bits') return bits(request, env);
    if (pathname !== '/game' || request.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
    const channel = offered.includes(PROTOCOL) ? await channelOf(offered.find((p) => p !== PROTOCOL)) : undefined;
    // Refused over an open socket, so the game can tell a refusal from a network failure.
    if (!channel) return upgrade((socket) => { socket.accept(); socket.close(REFUSED, 'Twitch login refused'); });
    // The channel's object gets the channel alone, never the token.
    return env.CHANNEL.get(env.CHANNEL.idFromName(channel)).fetch(new Request(request.url, { headers: { Upgrade: 'websocket', 'X-Channel': channel } }));
  },
};
