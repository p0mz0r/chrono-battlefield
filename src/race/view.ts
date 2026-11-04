import { currentLap, type Shot } from './camera.js';
import { BIG_EVENTS, commandList, secondsLeft, standings, type Race } from './race.js';

export type CameraMode = 'overview' | 'director';

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Fixed screen overlay: standings, phase, event queue, commands, feed, results, and the director shot's lower third. Tank labels stay in Pixi. */
export function mountStreamView(): (race: Race, shot?: Shot) => void {
  const root = document.createElement('div');
  root.id = 'stream-view';
  document.body.append(root);
  let previous = '';
  return (race, shot) => {
    const focus = shot?.racer;
    const order = race.phase === 'results' ? race.results : standings(race);
    const byName = new Map(race.racers.map((r) => [r.name, r]));
    const lap = currentLap(race);
    const lapLabel = lap ? ` · LAP ${lap.lap}/${lap.count}` : '';
    const rows = order.map((s, i) => {
      const r = byName.get(s.name);
      return `<div class="standing${r && r === focus ? ' focused' : ''}"><strong>${i + 1}</strong><span class="standing-name">${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><b>${Math.floor(s.progress * 100)}%</b></div>`;
    }).join('');
    const commands = commandList(race);
    const headline = race.phase === 'join' ? `JOIN WINDOW · ${secondsLeft(race)} s` : race.phase === 'countdown' ? `${secondsLeft(race)}` : race.phase === 'racing' ? race.racers.some((r) => r.finishedAt !== undefined) ? `FINISH TIMER · ${secondsLeft(race)} s` : 'RACE LIVE' : race.phase === 'results' ? 'RESULTS' : race.phase === 'cancelled' ? 'Race cancelled' : 'RHINO RACE';
    const resultRows = race.phase === 'results' ? `<section class="results"><h1>RESULTS</h1><h2>${esc(race.course.file.name)}</h2>${order.map((s, i) => `<div class="result"><strong>${i + 1}</strong><span>${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><b>${s.finishTime === undefined ? 'DNF' : `${s.finishTime.toFixed(1)} s`}</b></div>`).join('')}<p class="next"><kbd>Enter</kbd> next race &nbsp; <kbd>S</kbd> race setup</p></section>` : '';
    const html = `${race.phase === 'results' ? '' : `<section class="standings"><header>${esc(race.course.file.name)}${lapLabel}</header><div class="standings-head">POS <span>RACER</span><b>PROGRESS</b></div>${rows}</section>`}
      <div class="phase">${headline}</div>
      ${race.paused ? '<div class="pause-banner">PAUSED</div>' : ''}
      ${race.phase === 'racing' && focus ? `<div class="lower-third"><strong>${order.findIndex((s) => s.name === focus.name) + 1}</strong><div>${esc(focus.name)}<small>${esc(shot!.reason)}</small></div></div>` : ''}
      ${race.phase === 'racing' && race.queue.length ? `<div class="queue">${race.queue.map((t) => `<span${t.lands === undefined ? '' : ' class="playing"'}>${esc(`${BIG_EVENTS[t.event].label} · ${t.by}`)}</span>`).join('')}</div>` : ''}
      ${commands.length ? `<div class="commands">${commands.map(esc).join(' &nbsp; ')}</div>` : ''}
      ${race.phase === 'racing' && race.feed.length ? `<div class="feed">${race.feed.map((line) => `<div>${esc(line)}</div>`).join('')}</div>` : ''}
      ${resultRows}`;
    if (html !== previous) { root.innerHTML = html; previous = html; }
  };
}
