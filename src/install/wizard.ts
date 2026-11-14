// The setup wizard's steps (#161), as plain data: setup.ts draws them.

export type Step = 'install' | 'chat' | 'streamerbot' | 'twitch' | 'obs' | 'courses' | 'race' | 'keys' | 'trial';

/** The steps in order: the chat source's own step only for the source picked. */
export const wizardSteps = (source: '' | 'streamerbot' | 'twitch'): Step[] =>
  ['install', 'chat', ...source ? [source] : [], 'obs', 'courses', 'race', 'keys', 'trial'];

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
