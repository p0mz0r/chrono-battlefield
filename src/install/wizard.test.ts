import { describe, expect, it } from 'vitest';
import { HelixError, TWITCH_CLIENT_ID } from '../chat/twitchLogin.js';
import { canLeave, EXTENSION_ID, opensOnExtension, overlaySlot, wizardSteps } from './wizard.js';

describe('setup wizard', () => {
  it("shows the chat source step only for the source picked, then the Twitch extension's", () => {
    expect(wizardSteps('')).toEqual(['install', 'chat', 'obs', 'courses', 'race', 'keys', 'trial']);
    expect(wizardSteps('streamerbot')).toEqual(['install', 'chat', 'streamerbot', 'extension', 'obs', 'courses', 'race', 'keys', 'trial']);
    expect(wizardSteps('twitch')).toEqual(['install', 'chat', 'twitch', 'extension', 'obs', 'courses', 'race', 'keys', 'trial']);
  });
  it('moves on from the install, Streamer.bot and Twitch only once they work', () => {
    const fine = { installFound: true, chatOnline: true, twitchLogin: 'kane' };
    expect(['install', 'streamerbot', 'twitch', 'obs'].map((step) => canLeave(step as never, fine))).toEqual([true, true, true, true]);
    expect(canLeave('install', { ...fine, installFound: false })).toBe(false);
    expect(canLeave('streamerbot', { ...fine, chatOnline: undefined })).toBe(false);
    expect(canLeave('streamerbot', { ...fine, chatOnline: false })).toBe(false);
    expect(canLeave('twitch', { ...fine, twitchLogin: '' })).toBe(false);
    expect(canLeave('chat', { installFound: false, chatOnline: undefined, twitchLogin: '' })).toBe(true);
    expect(canLeave('extension', { installFound: true, chatOnline: false, twitchLogin: '' })).toBe(true);
  });
  it("opens by itself on the Twitch extension's step once after the update, for a finished setup with a chat source", () => {
    expect(opensOnExtension({ source: 'streamerbot', setupDone: true, extensionSeen: false })).toBe(true);
    expect(opensOnExtension({ source: 'twitch', setupDone: true, extensionSeen: false })).toBe(true);
    expect(opensOnExtension({ source: 'twitch', setupDone: true, extensionSeen: true })).toBe(false); // left off: never again
    expect(opensOnExtension({ source: '', setupDone: true, extensionSeen: false })).toBe(false); // no step to open on
    expect(opensOnExtension({ source: 'twitch', setupDone: false, extensionSeen: false })).toBe(false); // the whole wizard opens anyway
  });

  describe("the Twitch extension's check", () => {
    /** Twitch answering Get User Active Extensions with `overlay` as the channel's overlay slots, recording what was asked. */
    const twitch = (overlay: unknown, status = 200) => {
      const asked: { url: string; headers?: Record<string, string> }[] = [];
      const fetch = async (url: string, init?: { headers?: Record<string, string> }) => {
        asked.push({ url, headers: init?.headers });
        return { ok: status === 200, status, json: async () => ({ data: { panel: {}, overlay, component: {} } }) };
      };
      return { fetch, asked };
    };

    it("ticks once ours is active in the overlay slot, asking with the operator's own token", async () => {
      const { fetch, asked } = twitch({ 1: { active: true, id: EXTENSION_ID, version: '0.0.1', name: 'Rhino Race' } });
      expect(await overlaySlot('tok', fetch)).toEqual({ ours: true });
      expect(asked).toEqual([{ url: 'https://api.twitch.tv/helix/users/extensions', headers: { Authorization: 'Bearer tok', 'Client-Id': TWITCH_CLIENT_ID } }]);
    });
    it('stays unticked while the slot is empty', async () => {
      expect(await overlaySlot('tok', twitch({ 1: { active: false } }).fetch)).toEqual({ ours: false });
    });
    it('names another extension holding the slot', async () => {
      expect(await overlaySlot('tok', twitch({ 1: { active: true, id: 'someoneelse', version: '2.1', name: 'Stream Racer' } }).fetch)).toEqual({ ours: false, other: 'Stream Racer' });
    });
    it("fails when Twitch refuses", async () => {
      await expect(overlaySlot('tok', twitch({}, 401).fetch)).rejects.toEqual(new HelixError(401));
    });
  });
});
