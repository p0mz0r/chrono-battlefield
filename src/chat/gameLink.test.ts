import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { TICK_HZ, type CellGrid } from '../movement/index.js';
import { loadCourse, mapHash } from '../race/course.js';
import { chat, createRace, openJoinWindow, tickRace, type Race } from '../race/race.js';
import { connectGameLink, type Snapshot } from './gameLink.js';
import { twitchSession, type Fetch } from './twitchLogin.js';

const MAP = new TextEncoder().encode('[Map]\nTheater=TEMPERATE\n');
const OPEN: CellGrid = { width: 20, height: 10, speed: new Array(200).fill(1), level: new Array(200).fill(0), ramp: new Array(200).fill(0), blocked: new Array(200).fill(false), deck: new Array(200).fill(-1) };
const newRace = () => createRace(loadCourse({ name: 'Test', map: 'test.map', mapHash: mapHash(MAP), source: 'shipped', author: 'tests', link: '', startGrid: [[1, 1], [1, 3], [1, 5], [1, 7], [3, 1], [3, 3], [3, 5], [3, 7], [5, 1], [5, 3]], waypoints: [[10, 2]], laps: [], finish: [18, 2], bridges: [] }, MAP, OPEN), OPEN, 1);
/** House colours as the course art gives them: index 0 dark red, 1 a black that reads lifted toward white. */
const COLOURS = [0xc00000, 0x000000, 0x00ff00, 0x0000ff, 0xffff00, 0xff00ff, 0x00ffff, 0x808080, 0xffffff, 0x804000];

/** Stands in for the extension backend's socket: one per connection, open at once. */
class FakeSocket {
  static all: FakeSocket[] = [];
  readyState = 0;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onclose: ((e: { code: number }) => void) | null = null;
  onmessage: ((e: { data: string }) => void) | null = null;
  constructor(public url: string, public protocols: string[]) { FakeSocket.all.push(this); }
  send(data: string) { this.sent.push(data); }
  close() { this.drop(); }
  open() { this.readyState = 1; this.onopen?.(); }
  /** The backend accepts the token: open, then its greeting. */
  link() { this.open(); this.onmessage?.({ data: JSON.stringify({ type: 'linked' }) }); }
  /** The backend refuses the token: the socket still opens, then closes with the refusal code. */
  refuse() { this.open(); this.drop(4001); }
  drop(code = 1006) { if (this.readyState === 3) return; this.readyState = 3; this.onclose?.({ code }); }
  snapshots(): Snapshot[] { return this.sent.map((data) => JSON.parse(data)).filter((m) => m.type === 'snapshot').map((m) => m.snapshot); }
}
const last = () => FakeSocket.all.at(-1)!;

let storage: Map<string, string>, race: Race, link: ReturnType<typeof connectGameLink>, session: NonNullable<ReturnType<typeof twitchSession>>, access: string;
/** Twitch's id service: the stored token validates; a refresh hands out `acc-2`. */
/** Refreshes Twitch was asked for, and how it answers the next: a new pair, a refused refresh token, or unreachable. */
let refreshes = 0, twitch: 'up' | 'refuses' | 'down' = 'up';
const fetch: Fetch = async (url) => {
  if (!url.endsWith('/token')) return { ok: true, status: 200, json: async () => ({}) };
  refreshes++;
  if (twitch === 'down') throw new Error('network down');
  if (twitch === 'refuses') return { ok: false, status: 400, json: async () => ({ message: 'Invalid refresh token' }) };
  return { ok: true, status: 200, json: async () => ({ access_token: access = 'acc-2', refresh_token: 'ref-2' }) };
};
beforeEach(() => {
  vi.useFakeTimers();
  storage = new Map([['rhino-twitch-login', JSON.stringify({ access: 'acc-1', refresh: 'ref-1', userId: '427115971', login: 'p0mz0r' })]]);
  vi.stubGlobal('localStorage', { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value), removeItem: (key: string) => storage.delete(key) });
  FakeSocket.all = [];
  refreshes = 0;
  twitch = 'up';
  race = newRace();
  session = twitchSession({ fetch })!;
  link = connectGameLink(race, COLOURS, session, { url: 'wss://backend.test/game', Socket: FakeSocket });
  last().link();
});
afterEach(() => { link.close(); session.close(); vi.useRealTimers(); vi.unstubAllGlobals(); });

/** `a` is placed ahead of `b`: home first, else further along (ties don't arise here). */
const beats = (a: Race['racers'][number], b: Race['racers'][number]) => (a.finishedAt ?? Infinity) < (b.finishedAt ?? Infinity) || (a.finishedAt === b.finishedAt && a.progress > b.progress);
const tick = (seconds: number) => { for (let n = 0; n < seconds * TICK_HZ; n++) tickRace(race); };

describe('game link', () => {
  it('opens a socket to the backend with the operator\'s Twitch login, and sends a snapshot as it opens', () => {
    expect([last().url, last().protocols]).toEqual(['wss://backend.test/game', ['rhino-game', 'acc-1']]);
    expect(last().snapshots()).toEqual([{ show: true, phase: 'idle', countdown: 0, field: 0, interactions: ['boost', 'shield', 'missile', 'v3', 'tesla'], paid: ['chronosphere', 'kirov', 'desolator'], armed: false, racers: [] }]);
  });

  it('sends a change at most once a second', async () => {
    openJoinWindow(race, { joinSeconds: 60 });
    chat(race, { viewerId: 'twitch:1', name: 'Kane', text: '!rhino' });
    await vi.advanceTimersByTimeAsync(300);
    chat(race, { viewerId: 'twitch:2', name: 'Seth', text: '!rhino' });
    await vi.advanceTimersByTimeAsync(400);
    expect(last().snapshots()).toHaveLength(1); // only the one sent on opening
    await vi.advanceTimersByTimeAsync(300);
    expect(last().snapshots().slice(1).map((s) => [s.phase, s.countdown, s.field])).toEqual([['join', 60, 2]]);
  });

  it('re-sends the snapshot about every 5 s while nothing changes', async () => {
    await vi.advanceTimersByTimeAsync(4800);
    expect(last().snapshots()).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(last().snapshots()).toHaveLength(3);
  });

  it('lists only Twitch racers, with their place, progress, house colour and whether they finished', async () => {
    openJoinWindow(race, { joinSeconds: 1 });
    chat(race, { viewerId: 'youtube:9', name: 'Yuri', text: '!rhino' });
    chat(race, { viewerId: 'twitch:1', name: 'Kane', text: '!rhino' });
    chat(race, { viewerId: 'twitch:2', name: 'Seth', text: '!rhino' });
    tick(1 + 3); // join window, then 3-2-1
    while (!race.racers.some((r) => r.finishedAt !== undefined)) tick(1);
    await vi.advanceTimersByTimeAsync(1000);
    const { phase, field, racers } = last().snapshots().at(-1)!;
    // Join order gives the colours: Yuri dark red, Kane black (lifted to grey so it reads), Seth green.
    expect([phase, field, racers.map((r) => [r.id, r.colour]).sort()]).toEqual(['racing', 8, [['1', '#808080'], ['2', '#00ff00']]]);
    for (const r of racers) {
      const racer = race.racers.find((x) => x.viewerId === `twitch:${r.id}`)!;
      expect([r.finished, r.progress]).toEqual(racer.finishedAt !== undefined ? [true, 100] : [false, Math.floor(racer.progress / race.course.length * 100)]);
    }
    // A place counts every tank ahead, bots and other platforms' viewers included.
    const place = (id: string) => { const me = race.racers.find((r) => r.viewerId === `twitch:${id}`)!; return race.racers.filter((r) => beats(r, me)).length + 1; };
    expect(racers.map((r) => r.place)).toEqual(racers.map((r) => place(r.id)));
  });

  it('hides the rail during a trial race', async () => {
    race.trial = true;
    await vi.advanceTimersByTimeAsync(1000);
    expect(last().snapshots().at(-1)!.show).toBe(false);
  });

  it('reconnects with the refreshed token when the login\'s token goes bad, keeping the old link until the new one links', async () => {
    const old = last();
    await session.refresh();
    await vi.advanceTimersByTimeAsync(0);
    expect([old.readyState, FakeSocket.all.length, last().protocols[1], link.status()]).toEqual([1, 2, 'acc-2', 'linked']);
    last().link();
    expect(old.readyState).toBe(3);
  });

  it('reconnects after a drop, but not once a newer link for the channel has replaced it', async () => {
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    expect(FakeSocket.all).toHaveLength(2);
    last().open();
    last().drop(4000);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(FakeSocket.all).toHaveLength(2);
  });

  it('reconnects with growing waits, 1 s doubling to 30 s', async () => {
    const opened: number[] = [], start = Date.now();
    for (let n = 0; n < 7; n++) { last().drop(); const count = FakeSocket.all.length; while (FakeSocket.all.length === count) await vi.advanceTimersByTimeAsync(100); opened.push(Math.round((Date.now() - start) / 1000)); }
    expect(opened).toEqual([1, 3, 7, 15, 31, 61, 91]);
  });

  it('after a refusal refreshes the login and tries once more; a second refusal stops it trying', async () => {
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect([refreshes, FakeSocket.all.length, last().protocols[1], link.status()]).toEqual([1, 2, 'acc-2', 'offline']);
    last().refuse();
    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect([refreshes, FakeSocket.all.length, link.status()]).toEqual([1, 2, 'refused']);
  });

  it('spends no try on a refresh that never reached Twitch', async () => {
    twitch = 'down';
    last().refuse();
    await vi.advanceTimersByTimeAsync(1000);
    twitch = 'up';
    last().refuse(); // the old token again, after the wait
    await vi.advanceTimersByTimeAsync(0);
    expect([refreshes, FakeSocket.all.length, last().protocols[1]]).toEqual([2, 3, 'acc-2']);
  });

  it('stops as refused once Twitch refuses the refresh token itself', async () => {
    twitch = 'refuses';
    last().refuse();
    await vi.advanceTimersByTimeAsync(60_000);
    expect([FakeSocket.all.length, link.status(), link.offline()]).toEqual([1, 'refused', true]);
  });

  it('counts a refusal after a working link as the first one again', async () => {
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    last().link();
    last().drop();
    await vi.advanceTimersByTimeAsync(1000);
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    expect([refreshes, FakeSocket.all.length]).toEqual([2, 4]);
  });
});

describe('extension offline marker', () => {
  /** A link whose first socket is still opening. */
  const fresh = () => { link.close(); return link = connectGameLink(race, COLOURS, session, { url: 'wss://backend.test/game', Socket: FakeSocket }); };

  it('stays off while the first link is still opening, then shows once that attempt fails', () => {
    fresh();
    expect([link.status(), link.offline()]).toEqual(['opening', false]);
    last().drop();
    expect([link.status(), link.offline()]).toEqual(['offline', true]);
  });

  it('shows once an open link drops, and goes once it is linked again', async () => {
    expect([link.status(), link.offline()]).toEqual(['linked', false]);
    last().drop();
    expect(link.offline()).toBe(true);
    await vi.advanceTimersByTimeAsync(1000);
    last().link();
    expect(link.offline()).toBe(false);
  });

  it('stays on after a second refusal', async () => {
    last().refuse();
    await vi.advanceTimersByTimeAsync(0);
    last().refuse();
    expect(link.offline()).toBe(true);
  });

  it('never shows in a trial race', () => {
    race.trial = true;
    last().drop();
    expect(link.offline()).toBe(false);
  });

  it('never stops a race: one runs to its results with every link attempt failing', async () => {
    fresh();
    openJoinWindow(race, { joinSeconds: 1 });
    chat(race, { viewerId: 'twitch:1', name: 'Kane', text: '!rhino' });
    for (let s = 0; s < 600 && race.phase !== 'results'; s++) {
      if (last().readyState !== 3) last().drop();
      tick(1);
      await vi.advanceTimersByTimeAsync(1000);
    }
    expect([race.phase, race.results.length]).toEqual(['results', 8]);
  });
});
