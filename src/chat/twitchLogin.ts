/** The game's registered public Twitch app (#115). Forks register their own. */
export const TWITCH_CLIENT_ID = '5cm8euhmabzd9g4mnkwidz07sftngy';
/** The same whatever the chat source, so the streamer logs in once for Twitch direct and the game link. */
const SCOPES = 'user:read:chat channel:manage:redemptions bits:read';
const ID = 'https://id.twitch.tv/oauth2';
/** Where the login survives reloads (ADR 0008). Never logged or sent anywhere but Twitch. */
const LOGIN_KEY = 'rhino-twitch-login';
/**
 * Where the IDs of the rewards the game made live: only the app that made a reward may refund its redemptions. They
 * belong to the channel logged in, so a new login forgets them.
 */
export const REWARDS_KEY = 'rhino-twitch-rewards';
/** Twitch asks apps to validate their token on start and hourly. */
const VALIDATE_EVERY = 60 * 60_000;

/** The part of `fetch` the login uses, so tests can stand in for Twitch. */
export type Fetch = (url: string, init?: { method?: string; headers?: Record<string, string>; body?: string }) => Promise<{ ok: boolean; status: number; json(): Promise<any> }>;
export interface Login { access: string; refresh: string; userId: string; login: string }

/** Twitch answered, but not OK. */
export class HelixError extends Error { constructor(readonly status: number) { super(`Twitch replied ${status}`); } }

const form = (fields: Record<string, string>) => ({ method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ client_id: TWITCH_CLIENT_ID, ...fields }).toString() });
const stored = (): Login | undefined => { try { return JSON.parse(localStorage.getItem(LOGIN_KEY) ?? '') || undefined; } catch { return undefined; } };

/** The Twitch account logged in, if any. */
export const twitchLogin = () => stored()?.login;

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

/** Log out of Twitch: revokes the token and forgets the login, even if Twitch can't be reached. */
export async function logoutTwitch({ fetch = globalThis.fetch as Fetch } = {}) {
  const login = stored();
  localStorage.removeItem(LOGIN_KEY);
  if (login) await fetch(`${ID}/revoke`, form({ token: login.access })).catch(() => {});
}

/**
 * The stored login, kept good while in use: `refresh` trades the refresh token in for a new pair, once however many
 * callers hit the expiry, and the token is validated on start (`validated`, which rejects if that fails) and hourly. A refused refresh token logs
 * out and calls `onLogout` and each of `loggedOut`; a new pair calls each of `refreshed`. One per page: Twitch takes each
 * refresh token once, so a second session's would be spent. Undefined when nobody is logged in.
 */
export function twitchSession({ fetch = globalThis.fetch as Fetch, onLogout = () => {} } = {}) {
  const login = stored();
  if (!login) return undefined;
  const refreshed = new Set<() => void>(), loggedOut = new Set([onLogout]);
  let refreshing: Promise<void> | undefined;
  const refresh = () => refreshing ??= (async () => {
    const reply = await fetch(`${ID}/token`, form({ grant_type: 'refresh_token', refresh_token: login.refresh }));
    if (reply.status === 400 || reply.status === 401) {
      localStorage.removeItem(LOGIN_KEY);
      close();
      for (const listener of loggedOut) listener();
      throw new Error('Twitch login expired');
    }
    if (!reply.ok) throw new HelixError(reply.status);
    const token = await reply.json();
    Object.assign(login, { access: token.access_token, refresh: token.refresh_token });
    localStorage.setItem(LOGIN_KEY, JSON.stringify(login));
    for (const listener of refreshed) listener();
  })().finally(() => { refreshing = undefined; });
  const validate = async () => {
    if ((await fetch(`${ID}/validate`, { headers: { Authorization: `OAuth ${login.access}` } })).status === 401) await refresh();
  };
  const hourly = setInterval(() => void validate().catch(() => {}), VALIDATE_EVERY);
  function close() { clearInterval(hourly); }
  const validated = validate();
  validated.catch(() => {}); // a caller that doesn't wait for it isn't left with an unhandled rejection
  return { login, refresh, validated, close, refreshed, loggedOut };
}
/** The page's one Twitch login while in use. */
export type TwitchSession = NonNullable<ReturnType<typeof twitchSession>>;
