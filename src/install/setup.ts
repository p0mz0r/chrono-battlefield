import mark from '../../docs/brand/final/mark.png';
import settleImport from '../chat/settleAction.sb?raw';
import { SETTLE_ACTION } from '../chat/streamerBot.js';
import { loginTwitch, missingRewards, twitchLogin } from '../chat/twitch.js';
import '../panel.css';
import { REWARDS } from '../race/race.js';
import { savedPath, useFolder } from './read.js';

// Install setup, in the game window (F2), as three steps. A change reloads the page, which reopens the install; setup reopens with it.
const dialog = document.createElement('dialog');
dialog.id = 'setup';
dialog.className = 'panel setup';
dialog.setAttribute('aria-label', 'Install setup');
dialog.innerHTML = `<div class="inner"><header><img class="mark" src="${mark}" alt=""><h1>Install setup</h1><small>F2</small></header><div class="scroll">
  <section><h2>1 · Install <b class="chip install-chip"></b></h2>
    <ul class="problems report bad"></ul>
    <form method="dialog" class="path"><label for="setup-path">Your RA2 + Yuri's Revenge folder, the one with ra2.mix and ra2md.mix</label>
      <div class="row"><input id="setup-path" name="path" placeholder="C:\\Program Files (x86)\\Origin Games\\Command and Conquer Red Alert II"><button value="use">Use this folder</button></div></form>
  </section>
  <section><h2>2 · Chat source <b class="chip chat-chip"></b></h2>
    <fieldset class="chat tiles" aria-label="Chat source">
      <label class="tile"><input type="radio" name="chat" value=""><span>None</span></label>
      <label class="tile"><input type="radio" name="chat" value="streamerbot"><span>Streamer.bot<small>ws://127.0.0.1:8080</small></span></label>
      <label class="tile"><input type="radio" name="chat" value="twitch"><span>Twitch direct</span></label>
    </fieldset>
    <label class="show-chat"><input type="checkbox" name="show-chat"> Show chat on stream (off if you keep your own chat overlay)</label>
  </section>
  <section class="rewards"><h2>3 · Streamer.bot rewards</h2>
    <p>In Streamer.bot, create these rewards with its Create Reward button (rewards made in Twitch's dashboard can't be refunded), then import the action <b>${SETTLE_ACTION}</b>: Import, paste the string below. Click a field to copy it.</p>
    <div class="pairs">${Object.values(REWARDS).map(({ title, prompt }) => `<input class="copy" readonly value="${title}"><input class="copy" readonly value="${prompt}">`).join('')}</div>
    <div class="row import"><input class="copy" readonly value="${settleImport.trim()}" aria-label="${SETTLE_ACTION} import string"><button type="button" class="copy-import">Copy</button></div>
  </section>
  <section class="twitch"><h2>3 · Twitch login <b class="chip twitch-chip"></b></h2>
    <p class="twitch-status"></p>
    <div class="row"><button type="button" class="twitch-login">Log in to Twitch</button></div>
    <p class="twitch-code hint" hidden></p>
  </section>
</div><footer><button type="button" class="primary close">Close</button></footer></div>
<style>
  #setup::backdrop { background: #0009; }
  #setup .pairs { display: grid; grid-template-columns: 11em 1fr; gap: 6px; margin-bottom: 8px; }
  #setup :is(.path, .import) input { flex: 1; width: auto; }
  #setup .import input { font-family: Consolas, monospace; font-size: 13px; }
  #setup input.copy { cursor: copy; }
  #setup input.copied { border-color: var(--cyan); }
  #setup .show-chat { display: flex; align-items: center; gap: 8px; margin-top: 10px; cursor: pointer; }
  #setup .show-chat input { flex: none; width: 16px; height: 16px; margin: 0; box-shadow: none; accent-color: var(--cyan); }
</style>`;
const $ = <T extends HTMLElement>(sel: string) => dialog.querySelector<T>(sel)!;
const pathInput = $<HTMLInputElement>('input[name=path]');
const chatInputs = [...dialog.querySelectorAll<HTMLInputElement>('input[name=chat]')];
const CHAT_KEY = 'rhino-chat-source';
let chatOnline: (() => boolean | undefined) | undefined, installFound = false, painting: ReturnType<typeof setInterval> | undefined;

/** The chat source picked in setup (ADR 0008): exactly one, or none. */
export const chatSource = (): '' | 'streamerbot' | 'twitch' => {
  const picked = localStorage.getItem(CHAT_KEY);
  return picked === 'streamerbot' || picked === 'twitch' ? picked : '';
};

const SHOW_CHAT_KEY = 'rhino-show-chat';
/** Whether the stream shows chat lines (#143): on unless the operator switched it off. */
export const showChat = () => localStorage.getItem(SHOW_CHAT_KEY) !== 'off';

/** The chat source's connection, for setup's status: `online` as `ChatSource.online`. */
export const watchChat = (online: () => boolean | undefined) => { chatOnline = online; };

/** Reloads to apply a change, and opens setup again after it: it closes only when the operator closes it. */
function reloadIntoSetup() {
  const url = new URL(location.href);
  url.searchParams.set('setup', '1');
  location.href = url.href;
}

const chip = (sel: string, text: string, state: '' | 'ok' | 'bad' = '') => Object.assign($(sel), { textContent: text, className: `chip ${sel.slice(1)} ${state}` });

function paintChat() {
  const online = chatOnline?.();
  if (!chatSource()) chip('.chat-chip', '');
  else if (!chatOnline) chip('.chat-chip', installFound ? 'Connecting…' : 'Waits for the install');
  else chip('.chat-chip', online === undefined ? 'Connecting…' : online ? 'Connected' : 'Offline', online === undefined ? '' : online ? 'ok' : 'bad');
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

$('.close').addEventListener('click', () => dialog.close());
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

/** Opens setup, listing what's wrong with the install. */
export function showSetup(problems: string[] = []) {
  if (!dialog.isConnected) document.body.append(dialog);
  pathInput.value = savedPath();
  installFound = !problems.length;
  chip('.install-chip', installFound ? 'Found' : 'Not found', installFound ? 'ok' : 'bad');
  const source = chatSource();
  for (const input of chatInputs) input.checked = input.value === source;
  $<HTMLInputElement>('input[name=show-chat]').checked = showChat();
  $('.rewards').hidden = source !== 'streamerbot';
  $('.twitch').hidden = source !== 'twitch';
  const login = twitchLogin(), missing = missingRewards();
  if (!login) chip('.twitch-chip', 'Not logged in', 'bad');
  else if (missing.length) chip('.twitch-chip', `${login} · rewards missing`, 'bad');
  else chip('.twitch-chip', `Logged in as ${login}`, 'ok');
  $('.twitch-status').textContent = !login ? `Log in once as the channel that streams; the game then creates its rewards. Set their cost and turn them on or off in Twitch's dashboard.`
    : missing.length ? `Logged in as ${login}. Rewards not created yet: ${missing.join(', ')}. If Twitch already has a reward with that title, delete or rename it, then reload.`
    : `Logged in as ${login}. The game's rewards are created: set their cost and turn them on or off in Twitch's dashboard.`;
  report(problems);
  paintChat();
  painting ??= setInterval(paintChat, 1000);
  if (!dialog.open) dialog.showModal();
}

/** `F2` reopens setup, while `allowed()` (not during a race); so does a reload setup asked for. */
export function bindSetupKey(allowed: () => boolean) {
  addEventListener('keydown', (e) => {
    if (e.key === 'F2' && allowed()) showSetup();
  });
  const url = new URL(location.href);
  if (url.searchParams.has('setup')) {
    url.searchParams.delete('setup');
    history.replaceState(null, '', url);
    showSetup();
  }
}
