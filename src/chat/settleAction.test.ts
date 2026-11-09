import { readFileSync } from 'node:fs';
import { gunzipSync } from 'node:zlib';
import { describe, expect, it } from 'vitest';
import importString from './settleAction.sb?raw';
import { SETTLE_ACTION } from './streamerBot.js';

describe('Streamer.bot settle action import', () => {
  it('holds the one untriggered action the game calls, running the C# in the repo', () => {
    const bytes = Buffer.from(importString.trim(), 'base64');
    expect(bytes.subarray(0, 4).toString()).toBe('SBAE');
    const { actions } = JSON.parse(gunzipSync(bytes.subarray(4)).toString()).data;
    expect(actions).toHaveLength(1);
    expect(actions[0]).toMatchObject({ name: SETTLE_ACTION, enabled: true, triggers: [] });
    expect(actions[0].subActions.map((s: { type: number }) => s.type)).toEqual([99999]);
    const code = Buffer.from(actions[0].subActions[0].byteCode, 'base64').toString();
    expect(code.replaceAll('\r\n', '\n')).toBe(readFileSync('src/chat/settleAction.cs', 'utf8').replaceAll('\r\n', '\n'));
  });
});
