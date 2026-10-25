// PROTOTYPE, throwaway (issue #25: "How the stream sees a race").
// Three radically different stream views of the same fake race, switchable via ?variant=A|B|C,
// the bottom bar, or the ← → keys. The race itself is fake: tanks drive straight lines between
// the map's start waypoints (through buildings, no pathfinding), and random interactions fire.
// Only the look is being judged here.

import { Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { Application } from 'pixi.js';
import { facingAngle, projectModelPoint } from './vendor/dev/voxelRender.js';

export type World = {
  app: Application;
  world: Container;
  things: Container;
  bodyTex: Texture[];
  turretTex: Texture[];
  pivot: [number, number, number];
  /** World pixel position of a fractional cell (x, y), at ground height. */
  toWorld: (x: number, y: number) => { x: number; y: number };
  courseCells: { x: number; y: number }[];
};

const params = new URLSearchParams(location.search);
const NAMES = ['xXRhinoKingXx', 'tankgirl_92', 'ChronoLegend', 'Boris', 'kirov_reporting', 'SovietBear', 'yuri_clone_7', 'MooseMcTank', 'BOT Volkov', 'BOT Zofia'];
const COLORS = ['#e33', '#39f', '#fc3', '#3c6', '#f6c', '#f93', '#9cf', '#c9f', '#aaa', '#888'];
const SPEED = Number(params.get('speed') ?? 3); // cells per second
const FINISH_TIMER = Number(params.get('finishTimer') ?? 30); // s; race rules say 60, shortened to see results sooner

type Racer = {
  name: string; color: string; bot: boolean; lane: number;
  dist: number; speedMul: number; boostUntil: number; stunUntil: number; immuneUntil: number; shieldUntil: number;
  finishedAt: number | null; place: number;
  c: Container; body: Sprite; tur: Sprite; wx: number; wy: number; facing: number; lastEvent: string;
};
type FeedLine = { t: number; text: string; target?: Racer };
export type Race = {
  phase: 'countdown' | 'racing' | 'results';
  t: number; startAt: number; firstFinish: number | null;
  laps: number; loopLen: number; total: number;
  racers: Racer[]; feed: FeedLine[];
  pts: { x: number; y: number }[];
  standings: () => Racer[];
  lap: (r: Racer) => number;
};

// ---------------------------------------------------------------------------
// the fake race

function courseLoop(cells: { x: number; y: number }[]) {
  // order the start waypoints by angle around their centre so they form a loop
  const cx = cells.reduce((a, c) => a + c.x, 0) / cells.length, cy = cells.reduce((a, c) => a + c.y, 0) / cells.length;
  // pulled 30% toward the centre: start waypoints sit at the map edge, where a chase cam sees black
  return [...cells].sort((a, b) => Math.atan2(a.y - cy, a.x - cx) - Math.atan2(b.y - cy, b.x - cx))
    .map((c) => ({ x: cx + (c.x - cx) * 0.7 + 0.5, y: cy + (c.y - cy) * 0.7 + 0.5 }));
}

function makeRace(w: World): Race {
  const pts = courseLoop(w.courseCells);
  const seg = pts.map((p, i) => Math.hypot(pts[(i + 1) % pts.length]!.x - p.x, pts[(i + 1) % pts.length]!.y - p.y));
  const loopLen = seg.reduce((a, b) => a + b, 0);
  const laps = Number(params.get('laps') ?? Math.max(1, Math.round((90 * SPEED) / loopLen)));
  const racers: Racer[] = NAMES.map((name, i) => {
    const body = new Sprite(w.bodyTex[0]); body.anchor.set(0.5);
    const tur = new Sprite(w.turretTex[0]); tur.anchor.set(0.5);
    const c = new Container(); c.addChild(body, tur); w.things.addChild(c);
    return {
      name, color: COLORS[i]!, bot: name.startsWith('BOT'), lane: (i % 5) - 2,
      dist: -Math.floor(i / 5) * 1.5, speedMul: 0.9 + Math.random() * 0.2, boostUntil: 0, stunUntil: 0, immuneUntil: 0, shieldUntil: 0,
      finishedAt: null, place: 0, c, body, tur, wx: 0, wy: 0, facing: 8, lastEvent: '',
    };
  }).sort(() => Math.random() - 0.5); // random start grid
  racers.forEach((r, i) => { r.lane = (i % 5) - 2; r.dist = -Math.floor(i / 5) * 1.5; });

  const at = (d: number) => {
    let rest = ((d % loopLen) + loopLen) % loopLen;
    for (let i = 0; i < pts.length; i++) {
      if (rest <= seg[i]! || i === pts.length - 1) {
        const a = pts[i]!, b = pts[(i + 1) % pts.length]!, f = Math.min(1, rest / seg[i]!);
        return { x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dx: (b.x - a.x) / seg[i]!, dy: (b.y - a.y) / seg[i]! };
      }
      rest -= seg[i]!;
    }
    throw new Error('unreachable');
  };

  const race: Race = {
    phase: 'countdown', t: 0, startAt: 3, firstFinish: null, laps, loopLen, total: loopLen * laps, racers, feed: [], pts,
    standings: () => [...racers].sort((a, b) =>
      (a.finishedAt ?? Infinity) - (b.finishedAt ?? Infinity) || b.dist - a.dist),
    lap: (r) => Math.min(laps, Math.max(1, Math.floor(r.dist / loopLen) + 1)),
  };

  const viewers = ['dave_from_chat', 'Lurker42', 'mod_anna', 'potato', 'GG_EZ', 'ra2_veteran', 'NightOwl'];
  const say = (text: string, target?: Racer) => { race.feed.unshift({ t: race.t, text, target }); race.feed.length = Math.min(race.feed.length, 8); if (target) target.lastEvent = text; };
  const hit = (from: string, verb: string, r: Racer) => {
    if (r.shieldUntil > race.t) return say(`${from} ${verb} → ${r.name} (shield held)`, r);
    if (r.immuneUntil > race.t) return say(`${from} ${verb} → ${r.name} (stun immune)`, r);
    r.stunUntil = race.t + 3; r.immuneUntil = race.t + 5;
    say(`${from} ${verb} → ${r.name} stunned`, r);
  };
  const interact = () => {
    const live = racers.filter((r) => r.finishedAt === null);
    if (!live.length) return;
    const r = live[(Math.random() * live.length) | 0]!;
    const v = viewers[(Math.random() * viewers.length) | 0]!;
    const roll = Math.random();
    if (roll < 0.25) { r.boostUntil = race.t + 3; say(`${v} !boost → ${r.name}`, r); }
    else if (roll < 0.4) { r.shieldUntil = race.t + 6; say(`${r.name} !shield`, r); }
    else if (roll < 0.55) hit(v, '!v3', r);
    else if (roll < 0.7) hit(v, '!missile', r);
    else if (roll < 0.85) hit(v, '!tesla', r);
    else {
      const misfire = Math.random() < 0.2;
      const d = loopLen * (misfire ? 0.05 + Math.random() * 0.05 : -(0.15 + Math.random() * 0.15));
      r.dist = Math.max(0, r.dist + d);
      say(`${v} !chrono → ${r.name} ${misfire ? 'misfire, jumped forward' : 'sent back'}`, r);
    }
  };

  let nextEvent = 5;
  (race as any).tick = (dt: number) => {
    race.t += dt;
    if (race.phase === 'countdown' && race.t >= race.startAt) race.phase = 'racing';
    if (race.phase === 'racing') {
      if (race.t > nextEvent) { interact(); nextEvent = race.t + 1.5 + Math.random() * 2.5; }
      for (const r of racers) {
        if (r.finishedAt !== null || r.stunUntil > race.t) continue;
        r.dist += SPEED * r.speedMul * (r.boostUntil > race.t ? 1.6 : 1) * dt;
        if (r.dist >= race.total) {
          r.finishedAt = race.t; r.place = racers.filter((o) => o.finishedAt !== null).length;
          race.firstFinish ??= race.t;
          say(`${r.name} finished P${r.place}`, r);
        }
      }
      const done = racers.every((r) => r.finishedAt !== null);
      if (done || (race.firstFinish !== null && race.t - race.firstFinish > FINISH_TIMER)) {
        race.standings().forEach((r, i) => (r.place = i + 1));
        race.phase = 'results'; (race as any).resultsAt = race.t;
      }
    }
    // draw the tanks
    for (const r of racers) {
      const p = at(Math.max(0, Math.min(r.dist, race.total)) - (r.dist < 0 ? -r.dist : 0));
      const ox = -p.dy * r.lane * 0.7, oy = p.dx * r.lane * 0.7; // lane offset, perpendicular to travel
      const sp = w.toWorld(p.x + ox, p.y + oy);
      r.wx = sp.x; r.wy = sp.y;
      const want = ((Math.atan2(p.dx, -p.dy) / (2 * Math.PI)) * 32 + 32) % 32;
      const diff = ((want - r.facing + 48) % 32) - 16;
      r.facing = (r.facing + Math.sign(diff) * Math.min(Math.abs(diff), 16 * dt) + 32) % 32;
      const f = Math.round(r.facing) % 32, tf = (f + Math.round(Math.sin(race.t + r.lane) * 2) + 32) % 32;
      r.body.texture = w.bodyTex[f]!; r.tur.texture = w.turretTex[tf]!;
      const ang = facingAngle(f), [px, py, pz] = w.pivot;
      const pp = projectModelPoint(px * Math.cos(ang) - py * Math.sin(ang), px * Math.sin(ang) + py * Math.cos(ang), pz);
      r.tur.position.set(pp.sx, pp.sy);
      r.c.position.set(sp.x, sp.y); r.c.zIndex = sp.y + 15;
      r.c.alpha = r.finishedAt !== null ? Math.max(0, 1 - (race.t - r.finishedAt)) : r.stunUntil > race.t ? 0.6 + 0.4 * Math.sin(race.t * 20) : 1; // finished tanks leave
    }
  };
  return race;
}

// ---------------------------------------------------------------------------
// shared bits: camera, labels, DOM helpers

const css = document.createElement('style');
css.textContent = `
  #sv { position: fixed; inset: 0; pointer-events: none; font: 600 22px/1.25 'Segoe UI', system-ui, sans-serif; color: #fff; z-index: 3; }
  #sv * { box-sizing: border-box; }
  .lbl { position: absolute; transform: translate(-50%, -100%); white-space: nowrap; }
  .sv-bar { position: fixed; bottom: 14px; left: 50%; transform: translateX(-50%); z-index: 9; pointer-events: auto; display: flex; gap: 10px; align-items: center;
    background: #ff0; color: #000; font: bold 14px monospace; padding: 6px 12px; border-radius: 999px; box-shadow: 0 2px 10px #0008; }
  .sv-bar button { font: bold 14px monospace; border: 0; background: #000; color: #ff0; border-radius: 999px; padding: 2px 10px; cursor: pointer; }
`;
document.head.appendChild(css);
const el = (tag: string, style: string, html = '') => { const e = document.createElement(tag); e.style.cssText = style; e.innerHTML = html; return e; };
const esc = (s: string) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!);

type Cam = { x: number; y: number; s: number };
function applyCam(w: World, cam: Cam, target: Cam, dt: number, snap = false) {
  const k = snap ? 1 : 1 - Math.exp(-dt * 3);
  cam.x += (target.x - cam.x) * k; cam.y += (target.y - cam.y) * k; cam.s += (target.s - cam.s) * k;
  w.world.scale.set(cam.s);
  w.world.position.set(w.app.screen.width / 2 - cam.x * cam.s, w.app.screen.height / 2 - cam.y * cam.s);
}
const screenOf = (w: World, x: number, y: number) => ({ x: w.world.x + x * w.world.scale.x, y: w.world.y + y * w.world.scale.y });

function courseBounds(w: World, race: Race) {
  const ps = race.pts.map((p) => w.toWorld(p.x, p.y));
  const x0 = Math.min(...ps.map((p) => p.x)), x1 = Math.max(...ps.map((p) => p.x));
  const y0 = Math.min(...ps.map((p) => p.y)), y1 = Math.max(...ps.map((p) => p.y));
  return { x0, x1, y0, y1, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2 };
}

function countdown(race: Race) {
  const left = Math.ceil(race.startAt - race.t);
  return race.phase === 'countdown' ? (left > 0 ? String(left) : 'GO') : race.t - race.startAt < 1 ? 'GO' : '';
}

type Variant = { key: string; name: string; mount: (root: HTMLElement, w: World, race: Race) => (dt: number) => void };

// ---------------------------------------------------------------------------
// A: broadcast overview. Fixed camera on the whole course, course line drawn,
// a sports-style standings tower down the left, small number chips on tanks.

const A: Variant = {
  key: 'A', name: 'Overview + standings tower',
  mount(root, w, race) {
    const b = courseBounds(w, race);
    const cam = { x: b.cx, y: b.cy, s: Math.min((w.app.screen.width - 520) / (b.x1 - b.x0 + 200), (w.app.screen.height - 120) / (b.y1 - b.y0 + 200)) };
    cam.x -= 180 / cam.s; // leave room for the tower
    const line = new Graphics();
    const ps = race.pts.map((p) => w.toWorld(p.x, p.y));
    line.poly(ps.flatMap((p) => [p.x, p.y]), true).stroke({ width: 6, color: 0xffee88, alpha: 0.55 });
    ps.forEach((p, i) => line.circle(p.x, p.y, i === 0 ? 22 : 12).fill({ color: i === 0 ? 0xffffff : 0xffee88, alpha: 0.8 }));
    w.world.addChildAt(line, 1);

    const tower = el('div', 'position:absolute; left:24px; top:24px; width:360px; background:#000b; border-left:6px solid #c00;');
    const feed = el('div', 'position:absolute; right:24px; bottom:70px; width:520px; font-size:18px; text-align:right;');
    const big = el('div', 'position:absolute; inset:0; display:grid; place-content:center; font-size:200px; font-weight:900; text-shadow:0 0 30px #000;');
    const labels = el('div', 'position:absolute; inset:0;');
    root.append(labels, tower, feed, big);
    const chips = new Map(race.racers.map((r) => { const c = el('div', 'font-size:16px; padding:1px 6px; border-radius:4px; color:#000; margin-top:-40px;'); c.className = 'lbl'; labels.append(c); return [r, c]; }));

    return (dt) => {
      applyCam(w, cam, cam, dt, true);
      const st = race.standings();
      tower.innerHTML = `<div style="padding:8px 12px; background:#c00; font-size:20px;">RHINO RACE · LAP ${Math.min(race.laps, Math.max(...st.map(race.lap)))}/${race.laps}</div>` +
        st.map((r, i) => `<div style="display:flex; gap:10px; padding:5px 12px; ${r.finishedAt !== null ? 'opacity:.55' : ''}">
          <b style="width:28px">${i + 1}</b><span style="width:8px; background:${r.color}"></span>
          <span style="flex:1; overflow:hidden; text-overflow:ellipsis">${esc(r.name)}</span>
          <span style="font-size:16px; opacity:.8">${r.finishedAt !== null ? '🏁' : r.stunUntil > race.t ? '⚡' : r.shieldUntil > race.t ? '🛡' : `L${race.lap(r)}`}</span></div>`).join('');
      feed.innerHTML = race.feed.slice(0, 5).map((f, i) => `<div style="opacity:${1 - i * 0.18}; background:#000a; display:inline-block; padding:3px 10px; margin:2px 0;">${esc(f.text)}</div>`).join('<br>');
      for (const [r, c] of chips) {
        const p = screenOf(w, r.wx, r.wy); c.style.left = `${p.x}px`; c.style.top = `${p.y}px`;
        c.style.background = r.color; c.style.opacity = String(r.c.alpha); c.textContent = String(st.indexOf(r) + 1);
      }
      big.textContent = countdown(race);
      if (race.phase === 'results') {
        big.style.cssText = 'position:absolute; inset:0; display:grid; place-content:center; background:#000d;';
        big.innerHTML = `<div style="font-size:48px; text-align:center; margin-bottom:20px;">RESULTS</div>` + race.standings().map((r, i) =>
          `<div style="display:flex; gap:24px; font-size:${i < 3 ? 34 : 24}px; padding:4px 0; width:640px;"><b style="width:60px">${i + 1}.</b><span style="flex:1; color:${r.color}">${esc(r.name)}</span><span style="opacity:.7">${r.finishedAt !== null ? `${(r.finishedAt - race.startAt).toFixed(1)} s` : 'DNF'}</span></div>`).join('');
      }
    };
  },
};

// ---------------------------------------------------------------------------
// B: follow the leader. Camera chases the leading tank up close, minimap with the whole course,
// horizontal position ticker across the top, big name tags over every tank.

const B: Variant = {
  key: 'B', name: 'Chase cam + minimap',
  mount(root, w, race) {
    const cam = { x: 0, y: 0, s: Number(params.get('zoom') ?? 1.2) };
    let first = true;
    const ticker = el('div', 'position:absolute; left:0; right:0; top:0; display:flex; gap:4px; padding:8px; background:linear-gradient(#000e,#0000); font-size:18px;');
    const mini = document.createElement('canvas'); mini.width = 340; mini.height = 240;
    mini.style.cssText = 'position:absolute; right:24px; top:70px; background:#000a; border:2px solid #fff4; border-radius:8px;';
    const feed = el('div', 'position:absolute; left:24px; bottom:24px; width:560px; font-size:20px;');
    const big = el('div', 'position:absolute; inset:0; display:grid; place-content:center; font-size:200px; font-weight:900; text-shadow:0 0 30px #000;');
    const labels = el('div', 'position:absolute; inset:0;');
    root.append(labels, ticker, mini, feed, big);
    const tags = new Map(race.racers.map((r) => { const c = el('div', 'margin-top:-44px; text-align:center; text-shadow:0 0 4px #000, 0 0 2px #000;'); c.className = 'lbl'; labels.append(c); return [r, c]; }));
    const ctx = mini.getContext('2d')!;
    const b = courseBounds(w, race);
    const ms = Math.min((mini.width - 30) / (b.x1 - b.x0), (mini.height - 30) / (b.y1 - b.y0));
    const m = (x: number, y: number) => [mini.width / 2 + (x - b.cx) * ms, mini.height / 2 + (y - b.cy) * ms] as const;

    return (dt) => {
      const st = race.standings();
      const lead = race.phase === 'results' ? null : st.find((r) => r.finishedAt === null) ?? st[0]!;
      const fin = w.toWorld(race.pts[0]!.x, race.pts[0]!.y);
      applyCam(w, cam, lead ? { x: lead.wx, y: lead.wy, s: cam.s } : { x: fin.x, y: fin.y, s: cam.s }, dt, first); first = false;
      ticker.innerHTML = `<span style="padding:4px 10px; background:#c00">LAP ${lead ? race.lap(lead) : race.laps}/${race.laps}</span>` +
        st.map((r, i) => `<span style="padding:4px 10px; background:#000a; border-bottom:4px solid ${r.color}; ${r.finishedAt !== null ? 'opacity:.5' : ''}">${i + 1} ${esc(r.name.slice(0, 10))}</span>`).join('');
      ctx.clearRect(0, 0, mini.width, mini.height);
      ctx.strokeStyle = '#ffee8899'; ctx.lineWidth = 4; ctx.beginPath();
      race.pts.forEach((p, i) => { const q = w.toWorld(p.x, p.y); const [x, y] = m(q.x, q.y); i ? ctx.lineTo(x, y) : ctx.moveTo(x, y); });
      ctx.closePath(); ctx.stroke();
      for (const r of race.racers) {
        if (r.c.alpha < 0.05) continue;
        const [x, y] = m(r.wx, r.wy); ctx.fillStyle = r.color; ctx.beginPath(); ctx.arc(x, y, r === lead ? 8 : 5, 0, 7); ctx.fill();
      }
      for (const [r, c] of tags) {
        const p = screenOf(w, r.wx, r.wy); c.style.left = `${p.x}px`; c.style.top = `${p.y}px`; c.style.opacity = String(r.c.alpha);
        c.innerHTML = `<span style="color:${r.color}">${st.indexOf(r) + 1}</span> ${esc(r.name)}<br><span style="font-size:15px; opacity:.85">${r.stunUntil > race.t ? '⚡ STUNNED' : r.shieldUntil > race.t ? '🛡 shield' : r.boostUntil > race.t ? '» boost' : `lap ${race.lap(r)}/${race.laps}`}</span>`;
      }
      feed.innerHTML = race.phase === 'results' ? '' : race.feed.slice(0, 4).map((f) => `<div style="background:#000a; padding:3px 10px; margin:3px 0; border-left:4px solid ${f.target?.color ?? '#fff'}">${esc(f.text)}</div>`).join('');
      big.textContent = countdown(race);
      if (race.phase === 'results') {
        const [p1, p2, p3, ...rest] = race.standings();
        const card = (r: Racer | undefined, n: number, h: number) => r ? `<div style="text-align:center; width:300px;"><div style="font-size:30px; color:${r.color}">${esc(r.name)}</div>
          <div style="height:${h}px; background:#000c; border-top:6px solid ${r.color}; font-size:80px; font-weight:900; display:grid; place-content:center;">${n}</div></div>` : '';
        big.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column; justify-content:flex-end; align-items:center; padding-bottom:60px; background:linear-gradient(#0000 30%, #000c);';
        big.innerHTML = `<div style="display:flex; align-items:flex-end; gap:12px;">${card(p2, 2, 180)}${card(p1, 1, 260)}${card(p3, 3, 130)}</div>
          <div style="font-size:18px; margin-top:16px; opacity:.85">${rest.map((r) => `${r.place}. ${esc(r.name)}`).join(' · ')}</div>`;
      }
    };
  },
};

// ---------------------------------------------------------------------------
// C: TV director. Camera hard-cuts between racers (leader, the closest battle, whoever just got hit),
// one lower-third card for the racer on screen, only a top-5 box otherwise. No course line.

const C: Variant = {
  key: 'C', name: 'Director cuts + lower third',
  mount(root, w, race) {
    const b = courseBounds(w, race);
    const cam = { x: b.cx, y: b.cy, s: 1.5 };
    let focus: Racer | null = null, why = '', cutAt = -99, seenFeed = 0;
    const top5 = el('div', 'position:absolute; right:24px; top:24px; width:300px; background:#000b; font-size:18px;');
    const lower = el('div', 'position:absolute; left:80px; bottom:80px; display:flex; align-items:stretch; min-width:620px;');
    const flash = el('div', 'position:absolute; inset:0; background:#fff; opacity:0;');
    const big = el('div', 'position:absolute; inset:0; display:grid; place-content:center; font-size:200px; font-weight:900; text-shadow:0 0 30px #000;');
    const tag = el('div', 'margin-top:-50px; font-size:18px; padding:2px 8px; background:#000a;'); tag.className = 'lbl';
    root.append(flash, tag, top5, lower, big);
    const cut = (r: Racer, reason: string) => { focus = r; why = reason; cutAt = race.t; flash.style.transition = 'none'; flash.style.opacity = '0.35'; requestAnimationFrame(() => { flash.style.transition = 'opacity .4s'; flash.style.opacity = '0'; }); };
    let revealed = 0, revealAt = 0;

    return (dt) => {
      const st = race.standings();
      const live = st.filter((r) => r.finishedAt === null);
      // newest hit pulls the camera, else every 7 s alternate leader / closest battle
      if (race.feed.length && race.feed[0]!.t > seenFeed) { seenFeed = race.feed[0]!.t; if (race.feed[0]!.target && race.t - cutAt > 2.5 && race.feed[0]!.target!.finishedAt === null) cut(race.feed[0]!.target!, race.feed[0]!.text); }
      if (live.length && (!focus || focus.finishedAt !== null || race.t - cutAt > 7)) {
        if (why.startsWith('Leader') && live.length > 1) {
          let bi = 0; for (let i = 1; i < live.length - 1; i++) if (live[i]!.dist - live[i + 1]!.dist < live[bi]!.dist - live[bi + 1]!.dist) bi = i;
          cut(live[bi + 1]!, `Battle for P${st.indexOf(live[bi]!) + 1}`);
        } else cut(live[0]!, 'Leader');
      }
      const tgt = focus && race.phase !== 'results' ? { x: focus.wx, y: focus.wy, s: cam.s } : cam;
      applyCam(w, cam, tgt, dt, race.t - cutAt < 0.05);
      top5.innerHTML = `<div style="padding:6px 10px; background:#fff; color:#000">TOP 5</div>` + st.slice(0, 5).map((r, i) =>
        `<div style="display:flex; padding:4px 10px; ${r === focus ? 'background:#fff3' : ''}"><b style="width:26px">${i + 1}</b><span style="flex:1; color:${r.color}">${esc(r.name)}</span>${r.finishedAt !== null ? '🏁' : ''}</div>`).join('') +
        (focus && st.indexOf(focus) >= 5 ? `<div style="display:flex; padding:4px 10px; background:#fff3; border-top:1px solid #fff4"><b style="width:26px">${st.indexOf(focus) + 1}</b><span style="flex:1; color:${focus.color}">${esc(focus.name)}</span></div>` : '');
      if (focus && race.phase !== 'results') {
        const p = screenOf(w, focus.wx, focus.wy); tag.style.left = `${p.x}px`; tag.style.top = `${p.y}px`; tag.textContent = '▼'; tag.style.color = focus.color;
        lower.innerHTML = `<div style="background:${focus.color}; color:#000; font-size:64px; font-weight:900; padding:0 22px; display:grid; place-content:center;">${st.indexOf(focus) + 1}</div>
          <div style="background:#000d; padding:10px 20px; flex:1;"><div style="font-size:36px">${esc(focus.name)}</div>
          <div style="font-size:18px; opacity:.85">${esc(why)} · lap ${race.lap(focus)}/${race.laps}${focus.lastEvent && focus.lastEvent !== why ? ` · last: ${esc(focus.lastEvent)}` : ''}</div></div>`;
      } else lower.innerHTML = '';
      big.textContent = countdown(race);
      if (race.phase === 'results') {
        // reveal from last place to first, one every 1.2 s
        const order = race.standings().reverse();
        if (revealed < order.length && race.t > revealAt) { revealed++; revealAt = race.t + (revealed >= order.length - 3 ? 2 : 1.2); }
        big.style.cssText = 'position:absolute; inset:0; display:flex; flex-direction:column-reverse; justify-content:center; align-items:center; background:#000d;';
        big.innerHTML = order.slice(0, revealed).map((r) => `<div style="font-size:${r.place === 1 ? 56 : r.place <= 3 ? 36 : 24}px; padding:3px; color:${r.place === 1 ? r.color : '#fff'}">${r.place}. ${esc(r.name)}</div>`).join('');
      }
    };
  },
};

// ---------------------------------------------------------------------------
// switcher

export function runStreamView(w: World) {
  const variants = [A, B, C];
  let race = makeRace(w);
  let idx = Math.max(0, variants.findIndex((v) => v.key === (params.get('variant') ?? 'A').toUpperCase()));
  let root: HTMLElement | null = null, update: ((dt: number) => void) | null = null;
  const bar = el('div', '');
  bar.className = 'sv-bar';
  if (params.get('bar') !== '0') document.body.append(bar);

  const mount = () => {
    root?.remove();
    w.world.children.filter((c) => c instanceof Graphics).forEach((c) => c.destroy()); // variant overlays (course line)
    root = el('div', ''); root.id = 'sv'; document.body.append(root);
    update = variants[idx]!.mount(root, w, race);
    const v = variants[idx]!;
    bar.innerHTML = `<button data-d="-1">◀</button> PROTOTYPE ${v.key} (${v.name}) <button data-d="1">▶</button> <button data-r>restart race</button>`;
    const u = new URL(location.href); u.searchParams.set('variant', v.key); history.replaceState(null, '', u);
  };
  const go = (d: number) => { idx = (idx + d + variants.length) % variants.length; mount(); };
  const restart = () => { race.racers.forEach((r) => r.c.destroy()); race = makeRace(w); mount(); };
  bar.addEventListener('click', (e) => {
    const b = (e.target as HTMLElement).closest('button'); if (!b) return;
    if (b.dataset.d) go(Number(b.dataset.d)); else restart();
  });
  addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).closest('input, textarea, [contenteditable]')) return;
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'r') restart();
  });
  for (let t = Number(params.get('skip') ?? 0); t > 0 && !(race.phase === 'results' && race.t - (race as any).resultsAt > 12); t -= 0.05) (race as any).tick(0.05); // fast-forward for screenshots
  mount();
  w.app.ticker.add((tk) => {
    const dt = Math.min(0.1, tk.deltaMS / 1000);
    (race as any).tick(dt);
    update?.(dt);
    if (race.phase === 'results' && race.t - (race as any).resultsAt > 20) restart(); // loop forever, handy in OBS
  });
  return race;
}
