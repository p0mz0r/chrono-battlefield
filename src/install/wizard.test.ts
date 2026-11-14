import { describe, expect, it } from 'vitest';
import { canLeave, wizardSteps } from './wizard.js';

describe('setup wizard', () => {
  it('shows the chat source step only for the source picked', () => {
    expect(wizardSteps('')).toEqual(['install', 'chat', 'obs', 'courses', 'race', 'keys', 'trial']);
    expect(wizardSteps('streamerbot')).toEqual(['install', 'chat', 'streamerbot', 'obs', 'courses', 'race', 'keys', 'trial']);
    expect(wizardSteps('twitch')).toEqual(['install', 'chat', 'twitch', 'obs', 'courses', 'race', 'keys', 'trial']);
  });
  it('moves on from the install, Streamer.bot and Twitch only once they work', () => {
    const fine = { installFound: true, chatOnline: true, twitchLogin: 'kane' };
    expect(['install', 'streamerbot', 'twitch', 'obs'].map((step) => canLeave(step as never, fine))).toEqual([true, true, true, true]);
    expect(canLeave('install', { ...fine, installFound: false })).toBe(false);
    expect(canLeave('streamerbot', { ...fine, chatOnline: undefined })).toBe(false);
    expect(canLeave('streamerbot', { ...fine, chatOnline: false })).toBe(false);
    expect(canLeave('twitch', { ...fine, twitchLogin: '' })).toBe(false);
    expect(canLeave('chat', { installFound: false, chatOnline: undefined, twitchLogin: '' })).toBe(true);
  });
});
