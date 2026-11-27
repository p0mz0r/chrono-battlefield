import { TWITCH_CLIENT_ID } from '../../src/chat/twitchLogin.js';

// The extension backend (#187): a Cloudflare Worker that checks a game's Twitch token and hands its socket to one
// Durable Object per channel, which passes the game's snapshots to that channel's viewers over Extension PubSub.

/** The Twitch extension's Client ID (#191); public, unlike its secret. */
const EXTENSION_CLIENT_ID = 'v7ctzkptbah93gk31kw0jx0t2p9657';
/** The subprotocol the game offers beside its token. */
const PROTOCOL = 'rhino-game';
/** Close codes the game can tell apart: its socket was taken by a newer one for the same channel, or its token was refused. */
const REPLACED = 4000, REFUSED = 4001;
/** Extension PubSub's largest message. */
const MAX_MESSAGE = 5 * 1024;

/** The parts of the Workers runtime the backend uses, so it builds and tests without Cloudflare's types. */
interface WorkerSocket {
  accept(): void;
  send(data: string): void;
  close(code: number, reason: string): void;
  serializeAttachment(value: unknown): void;
  deserializeAttachment(): any;
}
interface State {
  acceptWebSocket(socket: WorkerSocket): void;
  getWebSockets(): WorkerSocket[];
}
declare const WebSocketPair: new () => { 0: WorkerSocket; 1: WorkerSocket };
type Upgrade = ResponseInit & { webSocket: WorkerSocket };

/** What the Worker's environment holds. */
export interface Env {
  /** The extension secret, base64 (`wrangler secret put EXTENSION_SECRET`): never committed. */
  EXTENSION_SECRET: string;
  /** The Twitch user ID that owns the extension, which its broadcasts are signed as. */
  EXTENSION_OWNER_ID: string;
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
const encode = (value: unknown) => base64url(new TextEncoder().encode(JSON.stringify(value)));

/** A JWT that lets the backend broadcast to `channel`'s viewers for a minute, signed HS256 with the extension secret. */
async function broadcastJwt(env: Env, channel: string) {
  const body = `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ exp: Math.floor(Date.now() / 1000) + 60, user_id: env.EXTENSION_OWNER_ID, role: 'external', channel_id: channel, pubsub_perms: { send: ['broadcast'] } })}`;
  const key = await crypto.subtle.importKey('raw', Uint8Array.from(atob(env.EXTENSION_SECRET), (c) => c.charCodeAt(0)), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return `${body}.${base64url(new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(body))))}`;
}

/** One channel's link: at most one game socket, its snapshots out to the channel's viewers. */
export class ChannelLink {
  constructor(private state: State, private env: Env) {}

  /** A game the Worker has checked, for the channel it names. A newer one replaces the old. */
  async fetch(request: Request): Promise<Response> {
    const channel = request.headers.get('X-Channel')!;
    return upgrade((socket) => {
      for (const old of this.state.getWebSockets()) old.close(REPLACED, 'Replaced by a newer link');
      this.state.acceptWebSocket(socket); // hibernatable: the attachment is all that survives between messages
      socket.serializeAttachment({ channel });
    });
  }

  async webSocketMessage(socket: WorkerSocket, data: string | ArrayBuffer) {
    let message: { type?: string; snapshot?: unknown };
    try { message = JSON.parse(typeof data === 'string' ? data : new TextDecoder().decode(data)); } catch { return; }
    if (message.type !== 'snapshot') return;
    const text = JSON.stringify(message.snapshot), { channel } = socket.deserializeAttachment();
    if (new TextEncoder().encode(text).length > MAX_MESSAGE) return;
    // ponytail: a failed broadcast is dropped; the game re-sends within 5 s anyway.
    await fetch('https://api.twitch.tv/helix/extensions/pubsub', {
      method: 'POST', headers: { Authorization: `Bearer ${await broadcastJwt(this.env, channel)}`, 'Client-Id': EXTENSION_CLIENT_ID, 'Content-Type': 'application/json' },
      body: JSON.stringify({ target: ['broadcast'], broadcaster_id: channel, is_global_broadcast: false, message: text }),
    }).catch(() => {});
  }
}

/** The Worker: `/game` takes a game's link, checks its Twitch login and hands it to its channel's object. */
export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    if (new URL(request.url).pathname !== '/game' || request.headers.get('Upgrade') !== 'websocket') return new Response('Not found', { status: 404 });
    const offered = (request.headers.get('Sec-WebSocket-Protocol') ?? '').split(',').map((p) => p.trim());
    const channel = offered.includes(PROTOCOL) ? await channelOf(offered.find((p) => p !== PROTOCOL)) : undefined;
    // Refused over an open socket, so the game can tell a refusal from a network failure.
    if (!channel) return upgrade((socket) => { socket.accept(); socket.close(REFUSED, 'Twitch login refused'); });
    // The channel's object gets the channel alone, never the token.
    return env.CHANNEL.get(env.CHANNEL.idFromName(channel)).fetch(new Request(request.url, { headers: { Upgrade: 'websocket', 'X-Channel': channel } }));
  },
};
