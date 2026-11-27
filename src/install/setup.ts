import mark from '../../docs/brand/final/mark.png';
import settleImport from '../chat/settleAction.sb?raw';
import { SETTLE_ACTION } from '../chat/streamerBot.js';
import { missingRewards } from '../chat/twitch.js';
import { loginTwitch, logoutTwitch, twitchLogin } from '../chat/twitchLogin.js';
import '../panel.css';
import { RETIRED_REWARDS, REWARDS } from '../race/race.js';
import { savedPath, useFolder } from './read.js';
import { canLeave, wizardSteps, type RaceForms, type Step } from './wizard.js';

// Setup, in the game window (#161): a wizard, one step at a time, that opens by itself on the first start and on F2
// between races. A change that needs a reload reopens it on the same step.
/** The channel-point rewards the streamer makes: none while paid events are cheers only (#184). */
const rewards = Object.values(REWARDS);
const TITLES: Record<Step, string> = { install: 'Install', chat: 'Chat source', streamerbot: 'Streamer.bot', twitch: 'Twitch login', obs: 'OBS capture', courses: 'Courses', race: 'Race setup', keys: 'Keys', trial: 'Trial race' };
const dialog = document.createElement('dialog');
dialog.id = 'setup';
dialog.className = 'panel setup';
dialog.setAttribute('aria-label', 'Setup');
dialog.innerHTML = `<div class="inner"><header><img class="mark" src="${mark}" alt=""><h1>Setup</h1><small class="progress"></small></header>
<ol class="steps" aria-label="Setup steps"></ol><div class="scroll">
  <section data-step="install"><h2>Install <b class="chip install-chip"></b></h2>
    <p>The game reads its art, maps and sounds from your own Red Alert 2 + Yuri's Revenge install, in place. It looks for it by itself.</p>
    <ul class="problems report bad"></ul>
    <form method="dialog" class="path"><label for="setup-path">Your RA2 + Yuri's Revenge folder, the one with ra2.mix and ra2md.mix</label>
      <div class="row"><input id="setup-path" name="path" placeholder="C:\\Program Files (x86)\\Origin Games\\Command and Conquer Red Alert II"><button value="use">Use this folder</button></div></form>
  </section>
  <section data-step="chat"><h2>Chat source</h2>
    <p>Where viewers' chat commands and cheers come from. Pick one.</p>
    <fieldset class="chat tiles" aria-label="Chat source">
      <label class="tile"><input type="radio" name="chat" value=""><span>None<small>Bots fill every race. To try the game.</small></span></label>
      <label class="tile"><input type="radio" name="chat" value="streamerbot"><span>Streamer.bot<small>Chat from every platform it's connected to, plus Twitch cheers.</small></span></label>
      <label class="tile"><input type="radio" name="chat" value="twitch"><span>Twitch direct<small>No other app: log in to Twitch from here once.</small></span></label>
    </fieldset>
    <label class="show-chat"><input type="checkbox" name="show-chat"> Show chat on stream (off if you keep your own chat overlay)</label>
  </section>
  <section data-step="streamerbot"><h2>Streamer.bot <b class="chip chat-chip"></b></h2>
    <ol class="how">
      <li>In Streamer.bot, open Servers/Clients &gt; WebSocket Server, tick Auto Start, keep address 127.0.0.1 and port 8080, and click Start Server.</li>
      ${rewards.length ? `<li>Create these rewards with Streamer.bot's Create Reward button (rewards made in Twitch's dashboard can't be refunded). Click a field to copy it.</li>` : ''}
    </ol>
    ${rewards.length ? `<div class="pairs">${rewards.map((reward) => `<input class="copy" readonly value="${reward!.title}"><input class="copy" readonly value="${reward!.prompt}">`).join('')}</div>` : ''}
    <ol class="how" start="${rewards.length ? 3 : 2}"><li>Import the action <b>${SETTLE_ACTION}</b>: Import, paste this string.</li></ol>
    <div class="row import"><input class="copy" readonly value="${settleImport.trim()}" aria-label="${SETTLE_ACTION} import string"><button type="button" class="copy-import">Copy</button></div>
    <p class="hint">Next works once the game is connected.${rewards.length ? ' To check the rewards, redeem one now: between races the game refunds it.' : ''}</p>
    <p class="hint">Made the ${RETIRED_REWARDS.join(', ')} rewards for an earlier version? Delete them in Streamer.bot: those events are cheers only now, and the game refunds their redemptions.</p>
  </section>
  <section data-step="twitch"><h2>Twitch login <b class="chip twitch-chip"></b></h2>
    <p class="report bad">Do this off stream: the login code shows in this window, which OBS captures.</p>
    <p class="twitch-status"></p>
    <div class="row"><button type="button" class="twitch-login">Log in to Twitch</button><button type="button" class="twitch-logout" title="Also stops Twitch-direct chat">Log out of Twitch</button></div>
    <p class="twitch-code hint" hidden></p>
  </section>
  <section data-step="obs"><h2>OBS capture</h2>
    <ol class="how">
      <li>Video: Sources &gt; + &gt; Window Capture. Window: <b>[msedge.exe]: Rhino Race</b>. Capture method: Windows 10 (1903 and up). Untick Capture Cursor.</li>
      <li>Sound: Sources &gt; + &gt; Application Audio Capture, same window <b>[msedge.exe]: Rhino Race</b>. The game gets its own mixer channel.</li>
      <li>Fit it to the canvas: maximise this window on a 1920×1080 screen, or right-click the capture &gt; Transform &gt; Fit to screen.</li>
    </ol>
    <p class="hint">Leave this window open while streaming. Behind other windows is fine; minimised is not, OBS then shows black.</p>
  </section>
  <section data-step="courses"><h2>Courses</h2>
    <p>Course files in the <b>courses</b> folder beside rhino-race.exe, the ones that came with this release included, are imported at every start; one you Remove stays removed. To add a course someone sent you, put its .rhino-course.json file in that folder and restart, or import it here.</p>
    <div class="slot"></div>
  </section>
  <section data-step="race"><h2>Race setup</h2>
    <p>Race setup's choices. Change them later with <kbd>S</kbd> between races.</p>
    <div class="slot"></div>
  </section>
  <section data-step="keys"><h2>Keys</h2>
    <p>Click into the game window first; the keys work while it has focus.</p>
    <dl class="keylist">
      <dt><kbd>S</kbd></dt><dd>Race setup: course, timers, audience interactions, course import</dd>
      <dt><kbd>Enter</kbd></dt><dd>Start: opens the join window, viewers join with !rhino</dd>
      <dt><kbd>P</kbd></dt><dd>Pause / resume</dd>
      <dt><kbd>E</kbd> <kbd>E</kbd></dt><dd>End or cancel the race (twice within three seconds)</dd>
      <dt><kbd>C</kbd></dt><dd>Camera: Overview (drag to pan, wheel to zoom) / Director</dd>
      <dt><kbd>1</kbd>–<kbd>9</kbd> <kbd>0</kbd></dt><dd>Director: cut to the tank in that place (0 tenth)</dd>
      <dt><kbd>M</kbd></dt><dd>Mute (remembered)</dd>
      <dt><kbd>−</kbd> <kbd>+</kbd></dt><dd>Game volume down / up in 10% steps (remembered)</dd>
      <dt><kbd>F2</kbd></dt><dd>This setup, between races</dd>
    </dl>
  </section>
  <section data-step="trial"><h2>Trial race</h2>
    <p>Ten bots race on the chosen course. Chat can't reach it and it spends no cheer. Try <kbd>C</kbd>, <kbd>1</kbd>–<kbd>9</kbd> <kbd>0</kbd>, <kbd>P</kbd> and <kbd>E</kbd> <kbd>E</kbd>, and check the picture and sound in OBS.</p>
    <p>Or finish without one: <kbd>Enter</kbd> starts the first real race.</p>
  </section>
</div><footer><span class="keys"><kbd>F2</kbd> reopens setup between races</span><button type="button" class="back">Back</button>
  <button type="button" class="primary next">Next</button><button type="button" class="finish">Finish</button><button type="button" class="primary trial">Start a trial race</button></footer></div>
<style>
  #setup::backdrop { background: #0009; }
  #setup .steps { display: flex; flex-wrap: wrap; gap: 4px; margin: 0; padding: 10px 18px 0; list-style: none; counter-reset: step; }
  #setup .steps button { min-height: 26px; padding: 2px 9px; font-size: 12px; counter-increment: step; }
  #setup .steps button::before { content: counter(step) ' · '; color: var(--dim); }
  #setup .steps button[aria-current] { background: linear-gradient(#0f4658, #0a2a36); box-shadow: inset 0 0 0 1px var(--cyan); }
  #setup .how { margin: 0 0 10px; padding-left: 1.4em; }
  #setup .how li { margin-bottom: 6px; }
  #setup .tiles { grid-template-columns: repeat(3, 1fr); }
  #setup .slot .scroll { overflow: visible; padding: 0; }
  #setup .slot:empty::before { content: 'Waits for the install.'; color: var(--dim); }
  #setup .keylist { display: grid; grid-template-columns: 7em 1fr; gap: 6px 12px; margin: 0; }
  #setup .keylist dd { margin: 0; }
  #setup .pairs { display: grid; grid-template-columns: 11em 1fr; gap: 6px; margin-bottom: 8px; }
  #setup :is(.path, .import) input { flex: 1; width: auto; }
  #setup .import input { font-family: Consolas, monospace; font-size: 13px; }
  #setup input.copy { cursor: copy; }
  #setup input.copied { border-color: var(--cyan); }
  #setup .show-chat { display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer; }
  #setup .show-chat input { flex: none; width: 16px; height: 16px; margin: 0; box-shadow: none; accent-color: var(--cyan); }
  #setup footer .keys { flex: 1; }
</style>`;
const $ = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
const pathInput = $<HTMLInputElement>('input[name=path]');
const chatInputs = [...dialog.querySelectorAll<HTMLInputElement>('input[name=chat]')];
const CHAT_KEY = 'rhino-chat-source', DONE_KEY = 'rhino-setup-done';
let chatOnline: (() => boolean | undefined) | undefined, installFound = false, painting: ReturnType<typeof setInterval> | undefined;
let step: Step = 'install';
let lent: RaceForms | undefined;

/** The chat source picked in setup (ADR 0008): exactly one, or none. */
export const chatSource = (): '' | 'streamerbot' | 'twitch' => {
  const picked = localStorage.getItem(CHAT_KEY);
  return picked === 'streamerbot' || picked === 'twitch' ? picked : '';
};

const SHOW_CHAT_KEY = 'rhino-show-chat';
/** Whether the stream shows chat lines (#143): on unless the operator switched it off. */
export const showChat = () => localStorage.getItem(SHOW_CHAT_KEY) !== 'off';

/** Whether the operator finished setup once for this Windows user; until then it opens by itself on every start. */
export const setupDone = () => localStorage.getItem(DONE_KEY) === '1';

/** The chat source's connection, for setup's status: `online` as `ChatSource.online`. */
export const watchChat = (online: () => boolean | undefined) => { chatOnline = online; };

/** Lends setup race setup's forms and trial race, once the battlefield is loaded. */
export function lendToSetup(forms: RaceForms) {
  lent = forms;
  if (dialog.open) render();
}

/** Reloads to apply a change, and opens setup again on this step after it: it closes only when the operator closes it. */
function reloadIntoSetup() {
  const url = new URL(location.href);
  url.searchParams.set('setup', step);
  location.href = url.href;
}

const chip = (sel: string, text: string, state: '' | 'ok' | 'bad' = '') => Object.assign($(sel), { textContent: text, className: `chip ${sel.slice(1)} ${state}` });

function paintChat() {
  const online = chatOnline?.();
  if (!chatSource()) chip('.chat-chip', '');
  else if (!chatOnline) chip('.chat-chip', installFound ? 'Connecting…' : 'Waits for the install');
  else chip('.chat-chip', online === undefined ? 'Connecting…' : online ? 'Connected' : 'Offline', online === undefined ? '' : online ? 'ok' : 'bad');
  $<HTMLButtonElement>('.next').disabled = !canLeave(step, { installFound, chatOnline: online, twitchLogin: twitchLogin() ?? '' });
  $<HTMLButtonElement>('.trial').disabled = !lent;
}

/** Shows `step` alone, with the step list (earlier steps reachable, every step once setup was finished) and its buttons. */
function render() {
  const steps = wizardSteps(chatSource());
  if (!steps.includes(step)) step = 'chat';
  const at = steps.indexOf(step);
  for (const section of dialog.querySelectorAll<HTMLElement>('section[data-step]')) section.hidden = section.dataset.step !== step;
  $('.progress').textContent = `Step ${at + 1} of ${steps.length}`;
  $('.steps').replaceChildren(...steps.map((s, i) => {
    const item = document.createElement('li'), button = document.createElement('button');
    Object.assign(button, { type: 'button', textContent: TITLES[s], disabled: i > at && !setupDone(), onclick: () => go(s) });
    if (s === step) button.setAttribute('aria-current', 'step');
    item.append(button);
    return item;
  }));
  if (lent && (step === 'courses' || step === 'race')) $(`[data-step=${step}] .slot`).append(lent[step]);
  $<HTMLButtonElement>('.back').disabled = at === 0;
  $('.next').hidden = step === 'trial';
  $('.finish').hidden = $('.trial').hidden = step !== 'trial';
  paintChat();
}

function go(to: Step) {
  step = to;
  render();
  $('.scroll').scrollTop = 0;
}

function report(problems: string[], bad = true) {
  const list = $('.problems');
  list.replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  list.classList.toggle('bad', bad);
}

$<HTMLInputElement>('input[name=show-chat]').addEventListener('change', (e) => {
  localStorage.setItem(SHOW_CHAT_KEY, (e.target as HTMLInputElement).checked ? 'on' : 'off');
  reloadIntoSetup();
});

$('.chat').addEventListener('change', (e) => {
  localStorage.setItem(CHAT_KEY, (e.target as HTMLInputElement).value);
  reloadIntoSetup();
});

$('form.path').addEventListener('submit', async (e) => {
  e.preventDefault();
  report(['Checking…'], false);
  chip('.install-chip', 'Checking…');
  const problems = await useFolder(pathInput.value);
  if (problems.length) { report(problems); chip('.install-chip', 'Not found', 'bad'); }
  else reloadIntoSetup();
});

for (const input of dialog.querySelectorAll<HTMLInputElement>('input.copy')) {
  input.addEventListener('focus', () => input.select());
  input.addEventListener('click', () => {
    input.select();
    void navigator.clipboard.writeText(input.value).then(() => {
      input.classList.add('copied');
      setTimeout(() => input.classList.remove('copied'), 1200);
    });
  });
}
$('.copy-import').addEventListener('click', async () => {
  const button = $('.copy-import');
  await navigator.clipboard.writeText($<HTMLInputElement>('.import input').value);
  button.textContent = 'Copied';
  setTimeout(() => { button.textContent = 'Copy'; }, 1500);
});

$('.back').addEventListener('click', () => { const steps = wizardSteps(chatSource()); go(steps[steps.indexOf(step) - 1]!); });
$('.next').addEventListener('click', () => { const steps = wizardSteps(chatSource()); go(steps[steps.indexOf(step) + 1]!); });
const finish = () => { localStorage.setItem(DONE_KEY, '1'); dialog.close(); };
$('.finish').addEventListener('click', finish);
$('.trial').addEventListener('click', () => { finish(); lent?.trial(); });
dialog.addEventListener('close', () => { clearInterval(painting); painting = undefined; });

$('.twitch-login').addEventListener('click', async () => {
  const code = $('.twitch-code');
  // Opened before the await, while the click still counts: browsers block a popup opened later.
  const popup = open('', 'twitch-login', 'popup,width=520,height=760');
  try {
    const login = await loginTwitch();
    // Twitch's link carries the code, so the window goes straight to Activate, then the scopes to authorize.
    if (popup) popup.location.href = login.uri;
    code.innerHTML = `${popup ? 'In the Twitch window, click Activate, then Authorize. No window? ' : ''}On any device, open <b>twitch.tv/activate</b> and enter <b></b>`;
    code.querySelector('b:last-child')!.textContent = login.code;
    code.hidden = false;
    await login.done;
    popup?.close();
    reloadIntoSetup();
  } catch (err) {
    popup?.close();
    code.textContent = String((err as Error).message ?? err);
    code.hidden = false;
  }
});

$('.twitch-logout').addEventListener('click', async () => {
  await logoutTwitch();
  reloadIntoSetup(); // stops Twitch-direct chat, which still holds the login
});

/** Opens setup on `at` (default: the install step if it has `problems`, else the step last shown), listing what's wrong with the install. */
export function showSetup(problems: string[] = [], at?: Step) {
  if (!dialog.isConnected) document.body.append(dialog);
  pathInput.value = savedPath();
  installFound = !problems.length;
  step = at ?? (installFound ? step : 'install');
  chip('.install-chip', installFound ? 'Found' : 'Not found', installFound ? 'ok' : 'bad');
  const source = chatSource();
  for (const input of chatInputs) input.checked = input.value === source;
  $<HTMLInputElement>('input[name=show-chat]').checked = showChat();
  const login = twitchLogin(), missing = missingRewards();
  $('.twitch-logout').hidden = !login;
  if (!login) chip('.twitch-chip', 'Not logged in', 'bad');
  else if (missing.length) chip('.twitch-chip', `${login} · rewards missing`, 'bad');
  else chip('.twitch-chip', `Logged in as ${login}`, 'ok');
  $('.twitch-status').textContent = !login ? `Log in once as the channel that streams.${rewards.length ? ` The game then creates its rewards. Set their cost and turn them on or off in Twitch's dashboard.` : ''}`
    : missing.length ? `Logged in as ${login}. Rewards not created yet: ${missing.join(', ')}. If Twitch already has a reward with that title, delete or rename it, then reload.`
    : `Logged in as ${login}.${rewards.length ? ` The game's rewards are created: set their cost and turn them on or off in Twitch's dashboard.` : ''}`;
  if (login) $('.twitch-status').textContent += ' Logging out also stops Twitch-direct chat.';
  report(problems);
  render();
  painting ??= setInterval(paintChat, 1000);
  if (!dialog.open) dialog.showModal();
}

/** `F2` reopens setup, while `allowed()` (not during a race); so does a reload setup asked for, on its step. */
export function bindSetupKey(allowed: () => boolean) {
  addEventListener('keydown', (e) => {
    if (e.key === 'F2' && allowed()) showSetup();
  });
  const url = new URL(location.href), at = url.searchParams.get('setup');
  if (at !== null) {
    url.searchParams.delete('setup');
    history.replaceState(null, '', url);
    showSetup([], (Object.keys(TITLES) as Step[]).find((s) => s === at));
  }
}
