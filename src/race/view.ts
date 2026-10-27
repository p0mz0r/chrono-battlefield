import { commandList, secondsLeft, standings, type Race, type Racer } from './race.js';

export type CameraMode = 'overview' | 'director';

const esc = (value: string) => value.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/** Fixed screen overlay; the battlefield and tank labels remain in Pixi's world. */
export function mountStreamView(): (race: Race, mode: CameraMode, focus?: Racer, reason?: string) => void {
  const root = document.createElement('div');
  root.id = 'stream-view';
  document.body.append(root);
  let previous = '';
  return (race, mode, focus, reason) => {
    const order = race.phase === 'results' ? race.results : standings(race);
    const byName = new Map(race.racers.map((r) => [r.name, r]));
    const lead = race.racers.find((r) => r.name === order[0]?.name);
    const lapSection = race.course.file.laps[0];
    const lap = lapSection && lead ? Math.min(lapSection.count, Math.max(1, Math.floor(Math.max(0, lead.next - lapSection.from) / (lapSection.to - lapSection.from + 1)) + 1)) : 1;
    const lapLabel = lapSection ? ` · LAP ${lap}/${lapSection.count}` : '';
    const rows = order.map((s, i) => {
      const r = byName.get(s.name);
      const status = s.finishTime !== undefined ? 'FINISHED' : r && r.stunUntil > race.frame ? 'STUNNED' : r && r.shieldUntil > race.frame ? 'SHIELDED' : r && r.boostUntil > race.frame ? 'BOOST' : '';
      return `<div class="standing${r === focus && mode === 'director' ? ' focused' : ''}"><strong>${i + 1}</strong><span class="standing-name">${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><span class="standing-status">${status}</span><b>${Math.floor(s.progress * 100)}%</b></div>`;
    }).join('');
    const commands = commandList(race);
    const headline = race.phase === 'join' ? `JOIN WINDOW · ${secondsLeft(race)} s` : race.phase === 'countdown' ? `${secondsLeft(race)}` : race.phase === 'racing' ? race.racers.some((r) => r.finishedAt !== undefined) ? `FINISH TIMER · ${secondsLeft(race)} s` : 'RACE LIVE' : race.phase === 'results' ? 'RESULTS' : 'RHINO RACE';
    const resultRows = race.phase === 'results' ? `<section class="results"><h1>RESULTS</h1><h2>${esc(race.course.file.name)}</h2>${order.map((s, i) => `<div class="result"><strong>${i + 1}</strong><span>${esc(s.name)}${s.bot ? ' <small>BOT</small>' : ''}</span><b>${s.finishTime === undefined ? 'DNF' : `${s.finishTime.toFixed(1)} s`}</b></div>`).join('')}</section>` : '';
    const html = `${race.phase === 'results' ? '' : `<section class="standings"><header>${esc(race.course.file.name)}${lapLabel}</header><div class="standings-head">POS <span>RACER</span> STATUS <b>PROGRESS</b></div>${rows}</section>`}
      <div class="phase">${headline}</div>
      ${race.phase === 'racing' && mode === 'director' && focus ? `<div class="lower-third"><strong>${order.findIndex((s) => s.name === focus.name) + 1}</strong><div>${esc(focus.name)}<small>${esc(reason ?? 'Leader')}</small></div></div>` : ''}
      ${commands.length ? `<div class="commands">${commands.map(esc).join(' &nbsp; ')}</div>` : ''}
      ${race.phase === 'racing' && race.feed.length ? `<div class="feed">${race.feed.map((line) => `<div>${esc(line)}</div>`).join('')}</div>` : ''}
      ${resultRows}`;
    if (html !== previous) { root.innerHTML = html; previous = html; }
  };
}
