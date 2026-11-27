import { currentLap, type Shot } from './camera.js';
import { armed, BIG_EVENTS, commandList, eventChips, HYPE, hypeLive, commandBoard, playingEvent, secondsLeft, standings, type Race } from './race.js';

export type CameraMode = 'overview' | 'director';

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** A house colour (0xRRGGBB), a dark one (black) lifted toward white so a name in it reads on near-black. */
export function readable(colour: number): number {
  const rgb = [colour >> 16, (colour >> 8) & 255, colour & 255];
  const lift = Math.max(0, 140 - (0.3 * rgb[0]! + 0.59 * rgb[1]! + 0.11 * rgb[2]!)) / 280;
  return rgb.reduce((out, v) => out << 8 | Math.round(v + (255 - v) * lift), 0);
}

/** House colour `colour` (an index into the course art's `colours`) as CSS, made `readable`. */
export const houseCss = (colours: number[], colour: number) => `#${readable(colours[colour]!).toString(16).padStart(6, '0')}`;

/** Where a knocked-back tank is drawn `t` (0–1) through its throw along `path`, in cells: fast at first, then slowing (cubic ease-out). */
export function thrownAt(path: { x: number; y: number }[], t: number): { x: number; y: number } {
  const legs = path.slice(1).map((p, i) => Math.hypot(p.x - path[i]!.x, p.y - path[i]!.y));
  let left = (1 - (1 - Math.min(Math.max(t, 0), 1)) ** 3) * legs.reduce((a, b) => a + b, 0);
  for (const [i, leg] of legs.entries()) {
    if (left <= leg && leg > 0) {
      const a = path[i]!, b = path[i + 1]!;
      return { x: a.x + (b.x - a.x) * left / leg, y: a.y + (b.y - a.y) * left / leg };
    }
    left -= leg;
  }
  return { ...path.at(-1)! };
}

/** `text`, escaped, with every racer's name in its house colour. A name counts only as a whole word (`Kane`, not inside `Kane#2`). */
export function paintNames(text: string, names: Map<string, string>): string {
  if (!names.size) return esc(text);
  const words = [...names.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.split(new RegExp(`(?<=^|\\s)(${words.join('|')})(?=$|\\s|:)`)).map((part, i) => i % 2 ? `<span style="color:${names.get(part)}">${esc(part)}</span>` : esc(part)).join('');
}

/** Fixed screen overlay: standings, chat (unless `showChat` is off), the command board (pointing to the Twitch extension when `extension` is on), phase or event banner, hype meter and event queue, commands, feed, results, the director shot's lower third and the "chat offline" and "extension offline" markers. Tank labels stay in Pixi. */
export function mountStreamView(colours: number[], showChat = true, extension = false): (race: Race, shot?: Shot, chatOffline?: boolean, extensionOffline?: boolean) => void {
  const root = document.createElement('div');
  root.id = 'stream-view';
  document.body.append(root);
  let previous = '';
  const css = (colour: number) => houseCss(colours, colour);
  return (race, shot, chatOffline = false, extensionOffline = false) => {
    const focus = shot?.racer;
    const order = race.phase === 'results' ? race.results : standings(race);
    const byName = new Map(race.racers.map((r) => [r.name, r]));
    const colourOf = new Map(race.racers.map((r) => [r.name, css(r.colour)]));
    const lap = currentLap(race);
    const lapLabel = lap ? ` · LAP ${lap.lap}/${lap.count}` : '';
    const rows = order.map((s, i) => {
      const r = byName.get(s.name);
      return `<div class="standing${r && r === focus ? ' focused' : ''}"><strong>${i + 1}</strong><span class="standing-name" style="color:${css(s.colour)}">${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><b>${Math.floor(s.progress * 100)}%</b></div>`;
    }).join('');
    const commands = commandList(race), board = commandBoard(race);
    const headline = race.phase === 'join' ? `JOIN WINDOW · ${secondsLeft(race)} s` : race.phase === 'countdown' ? `${secondsLeft(race)}` : race.phase === 'racing' ? race.racers.some((r) => r.finishedAt !== undefined) ? `${race.trial ? 'TRIAL · ' : ''}FINISH TIMER · ${secondsLeft(race)} s` : race.trial ? 'TRIAL RACE' : 'RACE LIVE' : race.phase === 'results' ? 'RESULTS' : race.phase === 'cancelled' ? 'Race cancelled' : 'RHINO RACE';
    const resultRows = race.phase === 'results' ? `<section class="results"><h1>${race.trial ? 'TRIAL RESULTS' : 'RESULTS'}</h1><h2>${esc(race.course.file.name)}</h2>${order.map((s, i) => `<div class="result"><strong>${i + 1}</strong><span style="color:${css(s.colour)}">${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><b>${s.finishTime === undefined ? 'DNF' : `${s.finishTime.toFixed(1)} s`}</b></div>`).join('')}<p class="next"><kbd>Enter</kbd> next race &nbsp; <kbd>S</kbd> race setup</p></section>` : '';
    // The event banner replaces the headline from a big event's turn until it lands.
    const playing = playingEvent(race);
    const hype = !hypeLive(race) ? '' : armed(race) ? `<span class="hype armed">NUKE ${race.hype.calls.size}/${HYPE.calls}</span>`
      : `<span class="hype" style="--fill:${Math.round(race.hype.points / HYPE.full * 100)}%">HYPE</span>`;
    const chips = eventChips(race);
    const timer = race.racers.some((r) => r.finishedAt !== undefined) ? `<small>FINISH TIMER · ${secondsLeft(race)} s</small>` : '';
    // A viewer racing now is named in their house colour.
    const house = new Map(race.racers.map((r) => [r.viewerId, css(r.colour)]));
    const chatLines = showChat ? race.chatLog.map((line) => `<div><b${house.has(line.viewerId) ? ` style="color:${house.get(line.viewerId)}"` : ''}>${esc(line.name)}</b> ${esc(line.text)}</div>`).join('') : '';
    const html = `<div class="left">${race.phase === 'results' ? '' : `<section class="standings"><header>${esc(race.course.file.name)}${lapLabel}</header><div class="standings-head">POS <span>RACER</span><b>PROGRESS</b></div>${rows}</section>`}
      ${chatLines ? `<section class="chat">${chatLines}</section>` : ''}</div>
      ${playing ? `<div class="phase event-banner">${esc(`${BIG_EVENTS[playing.event].label} · ${playing.by}`)}${playing.callers.length ? `<small>${esc(playing.callers.join(' · '))}</small>` : ''}${timer}</div>` : `<div class="phase">${headline}</div>`}
      ${race.paused ? '<div class="pause-banner">PAUSED</div>' : ''}
      ${race.phase === 'racing' && focus ? `<div class="lower-third" style="--house:${css(focus.colour)}"><strong>${order.findIndex((s) => s.name === focus.name) + 1}</strong><div>${esc(focus.name)}<small>${esc(shot!.reason)}</small></div></div>` : ''}
      ${race.phase === 'racing' || chips.length ? `<div class="queue">${race.phase === 'racing' ? hype : ''}${chips.map((c) => `<span${c.playing ? ' class="playing"' : ''}>${esc(c.label)}</span>`).join('')}</div>` : ''}
      ${board.length ? `<div class="commands command-board"><header>CHAT COMMANDS</header>${board.map((g) => `<div><b>${esc(g.heading)}</b><span>${g.commands.map((c) => `<i>${esc(c)}</i>`).join('')}</span></div>`).join('')}${extension ? '<p>No typing? Tap the buttons in the Twitch extension.</p>' : ''}</div>`
        : commands.length ? `<div class="commands">${commands.map(esc).join(' &nbsp; ')}</div>` : ''}
      ${race.phase === 'racing' && race.feed.length ? `<div class="feed">${race.feed.map((line) => `<div>${paintNames(line, colourOf)}</div>`).join('')}</div>` : ''}
      ${chatOffline || extensionOffline ? `<div class="offline">${extensionOffline ? '<span>EXTENSION OFFLINE</span>' : ''}${chatOffline ? '<span>CHAT OFFLINE</span>' : ''}</div>` : ''}
      ${resultRows}`;
    if (html !== previous) { root.innerHTML = html; previous = html; }
  };
}
