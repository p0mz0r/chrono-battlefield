// The setup wizard's steps (#161), as plain data, and what its checks read from Twitch: setup.ts draws them.
import { HelixError, TWITCH_CLIENT_ID, type Fetch } from '../chat/twitchLogin.js';

export type Step = 'install' | 'chat' | 'streamerbot' | 'twitch' | 'extension' | 'obs' | 'courses' | 'race' | 'keys' | 'trial';

/** The steps in order: the chat source's own step only for the source picked, then the Twitch extension's for either. */
export const wizardSteps = (source: '' | 'streamerbot' | 'twitch'): Step[] =>
  ['install', 'chat', ...source ? [source, 'extension' as const] : [], 'obs', 'courses', 'race', 'keys', 'trial'];

/**
 * Whether setup opens by itself on the Twitch extension's step on this start: once, for an operator who finished setup
 * before the update added it. One who hasn't sees the step in the wizard anyway.
 */
export const opensOnExtension = ({ source, setupDone, extensionSeen }: { source: '' | 'streamerbot' | 'twitch'; setupDone: boolean; extensionSeen: boolean }) =>
  setupDone && !!source && !extensionSeen;

/** The Rhino Race Twitch extension's Client ID (#191), which Twitch names it by in a channel's slots. */
export const EXTENSION_ID = 'v7ctzkptbah93gk31kw0jx0t2p9657';

/**
 * What holds the channel's one overlay slot, from Get User Active Extensions with the operator's token (no extra scope):
 * ours, nothing, or another extension, by name. The game only reads the slot; activating stays on Twitch.
 */
export async function overlaySlot(access: string, fetch = globalThis.fetch as Fetch): Promise<{ ours: boolean; other?: string }> {
  const reply = await fetch('https://api.twitch.tv/helix/users/extensions', { headers: { Authorization: `Bearer ${access}`, 'Client-Id': TWITCH_CLIENT_ID } });
  if (!reply.ok) throw new HelixError(reply.status);
  const slot = (await reply.json()).data?.overlay?.['1'];
  if (!slot?.active) return { ours: false };
  return slot.id === EXTENSION_ID ? { ours: true } : { ours: false, other: slot.name };
}

/** Race setup's course import and race setup forms, which setup shows in its steps, and its trial race. */
export interface RaceForms { courses: HTMLElement; race: HTMLElement; trial: () => void }

/** What the checks see: the install, the chat source's connection (`undefined` while connecting) and the Twitch login. */
export interface SetupState { installFound: boolean; chatOnline: boolean | undefined; twitchLogin: string }

/** Whether Next may leave `step`: the install found, Streamer.bot connected, Twitch logged in; the rest is information. */
export function canLeave(step: Step, state: SetupState): boolean {
  if (step === 'install') return state.installFound;
  if (step === 'streamerbot') return state.chatOnline === true;
  if (step === 'twitch') return !!state.twitchLogin;
  return true;
}
