import { currentLap, type Shot } from './camera.js';
import { armed, BIG_EVENTS, commandList, eventChips, HYPE, hypeLive, playingEvent, secondsLeft, standings, type Race } from './race.js';

export type CameraMode = 'overview' | 'director';

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** `text`, escaped, with every racer's name in its house colour. A name counts only as a whole word (`Kane`, not inside `Kane#2`). */
export function paintNames(text: string, names: Map<string, string>): string {
  if (!names.size) return esc(text);
  const words = [...names.keys()].sort((a, b) => b.length - a.length).map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
  return text.split(new RegExp(`(?<=^|\\s)(${words.join('|')})(?=$|\\s|:)`)).map((part, i) => i % 2 ? `<span style="color:${names.get(part)}">${esc(part)}</span>` : esc(part)).join('');
}

/** Fixed screen overlay: standings, phase or event banner, hype meter and event queue, commands, feed, results, the director shot's lower third and the "chat offline" marker. Tank labels stay in Pixi. */
export function mountStreamView(colours: number[]): (race: Race, shot?: Shot, chatOffline?: boolean) => void {
  const root = document.createElement('div');
  root.id = 'stream-view';
  document.body.append(root);
  let previous = '';
  // A house colour as CSS, a dark one (AlliedLoad's pure blue) lifted toward white so names read on the near-black panels.
  const css = (colour: number) => {
    const c = colours[colour % colours.length]!, rgb = [c >> 16, (c >> 8) & 255, c & 255];
    const lift = Math.max(0, 140 - (0.3 * rgb[0]! + 0.59 * rgb[1]! + 0.11 * rgb[2]!)) / 280;
    return `rgb(${rgb.map((v) => Math.round(v + (255 - v) * lift)).join(' ')})`;
  };
  return (race, shot, chatOffline = false) => {
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
    const commands = commandList(race);
    const headline = race.phase === 'join' ? `JOIN WINDOW · ${secondsLeft(race)} s` : race.phase === 'countdown' ? `${secondsLeft(race)}` : race.phase === 'racing' ? race.racers.some((r) => r.finishedAt !== undefined) ? `FINISH TIMER · ${secondsLeft(race)} s` : 'RACE LIVE' : race.phase === 'results' ? 'RESULTS' : race.phase === 'cancelled' ? 'Race cancelled' : 'RHINO RACE';
    const resultRows = race.phase === 'results' ? `<section class="results"><h1>RESULTS</h1><h2>${esc(race.course.file.name)}</h2>${order.map((s, i) => `<div class="result"><strong>${i + 1}</strong><span style="color:${css(s.colour)}">${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><b>${s.finishTime === undefined ? 'DNF' : `${s.finishTime.toFixed(1)} s`}</b></div>`).join('')}<p class="next"><kbd>Enter</kbd> next race &nbsp; <kbd>S</kbd> race setup</p></section>` : '';
    // The event banner replaces the headline from a big event's turn until it lands.
    const playing = playingEvent(race);
    const hype = !hypeLive(race) ? '' : armed(race) ? `<span class="hype armed">NUKE ${race.hype.calls.size}/${HYPE.calls}</span>`
      : `<span class="hype" style="--fill:${Math.round(race.hype.points / HYPE.full * 100)}%">HYPE</span>`;
    const chips = eventChips(race);
    const timer = race.racers.some((r) => r.finishedAt !== undefined) ? `<small>FINISH TIMER · ${secondsLeft(race)} s</small>` : '';
    const html = `${race.phase === 'results' ? '' : `<section class="standings"><header>${esc(race.course.file.name)}${lapLabel}</header><div class="standings-head">POS <span>RACER</span><b>PROGRESS</b></div>${rows}</section>`}
      ${playing ? `<div class="phase event-banner">${esc(`${BIG_EVENTS[playing.event].label} · ${playing.by}`)}${playing.callers.length ? `<small>${esc(playing.callers.join(' · '))}</small>` : ''}${timer}</div>` : `<div class="phase">${headline}</div>`}
      ${race.paused ? '<div class="pause-banner">PAUSED</div>' : ''}
      ${race.phase === 'racing' && focus ? `<div class="lower-third" style="--house:${css(focus.colour)}"><strong>${order.findIndex((s) => s.name === focus.name) + 1}</strong><div>${esc(focus.name)}<small>${esc(shot!.reason)}</small></div></div>` : ''}
      ${race.phase === 'racing' || chips.length ? `<div class="queue">${race.phase === 'racing' ? hype : ''}${chips.map((c) => `<span${c.playing ? ' class="playing"' : ''}>${esc(c.label)}</span>`).join('')}</div>` : ''}
      ${commands.length ? `<div class="commands">${commands.map(esc).join(' &nbsp; ')}</div>` : ''}
      ${race.phase === 'racing' && race.feed.length ? `<div class="feed">${race.feed.map((line) => `<div>${paintNames(line, colourOf)}</div>`).join('')}</div>` : ''}
      ${chatOffline ? '<div class="chat-offline">CHAT OFFLINE</div>' : ''}
      ${resultRows}`;
    if (html !== previous) { root.innerHTML = html; previous = html; }
  };
}
