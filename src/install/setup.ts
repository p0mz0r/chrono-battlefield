import settleImport from '../chat/settleAction.sb?raw';
import { SETTLE_ACTION } from '../chat/streamerBot.js';
import { loginTwitch, missingRewards, twitchLogin } from '../chat/twitch.js';
import { REWARDS } from '../race/race.js';
import { savedPath, useFolder } from './read.js';

// Install setup, in the game window (F2). Any change reloads the page, which reopens the install.
const dialog = document.createElement('dialog');
dialog.id = 'setup';
dialog.innerHTML = `
<style>#setup input, #setup button { font: inherit; }</style>
<h2>Install setup</h2>
<ul class="problems"></ul>
<form method="dialog" class="path">
  <label>Your RA2 + Yuri's Revenge folder (the one with ra2.mix and ra2md.mix)<br><input name="path" size="70" placeholder="C:\\Program Files (x86)\\Origin Games\\Command and Conquer Red Alert II"></label>
  <button value="use">Use this folder</button>
</form>
<fieldset class="chat"><legend>Chat source</legend>
  <label><input type="radio" name="chat" value=""> None</label>
  <label><input type="radio" name="chat" value="streamerbot"> Streamer.bot (ws://127.0.0.1:8080)</label>
  <label><input type="radio" name="chat" value="twitch"> Twitch direct</label>
</fieldset>
<div class="rewards">
  <p>In Streamer.bot, create these rewards with its Create Reward button (rewards made in Twitch's dashboard can't be refunded), then import the action <b>${SETTLE_ACTION}</b> (Import, paste the string below). Click a field to select it for copying.</p>
  ${Object.values(REWARDS).map(({ title, prompt }) => `<p><input readonly size="14" value="${title}"> <input readonly size="60" value="${prompt}"></p>`).join('')}
  <p><input readonly size="77" value="${settleImport.trim()}"></p>
</div>
<div class="twitch">
  <p class="twitch-status"></p>
  <p><button class="twitch-login">Log in to Twitch</button> <span class="twitch-code"></span></p>
</div>
<p><button class="close">Close</button></p>`;
dialog.style.cssText = 'font:20px/1.5 sans-serif;background:#111;color:#ddd;border:1px solid #666;max-width:46em';
const $ = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
const pathInput = $<HTMLInputElement>('input[name=path]');
const chatInputs = [...dialog.querySelectorAll<HTMLInputElement>('input[name=chat]')];
const CHAT_KEY = 'rhino-chat-source';
for (const input of dialog.querySelectorAll<HTMLInputElement>('.rewards input')) input.addEventListener('focus', () => input.select());

/** The chat source picked in setup (ADR 0008): exactly one, or none. */
export const chatSource = (): '' | 'streamerbot' | 'twitch' => {
  const picked = localStorage.getItem(CHAT_KEY);
  return picked === 'streamerbot' || picked === 'twitch' ? picked : '';
};

$('.chat').addEventListener('change', (e) => {
  localStorage.setItem(CHAT_KEY, (e.target as HTMLInputElement).value);
  location.reload();
});

function report(problems: string[]) {
  $('.problems').replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  $<HTMLElement>('.problems').style.color = '#f88';
}

$('form.path').addEventListener('submit', async (e) => {
  e.preventDefault();
  report(['Checking…']);
  const problems = await useFolder(pathInput.value);
  if (problems.length) report(problems);
  else location.reload();
});

$('.close').addEventListener('click', () => dialog.close());

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
    await login.done;
    popup?.close();
    location.reload();
  } catch (err) {
    popup?.close();
    code.textContent = String((err as Error).message ?? err);
  }
});

/** Opens setup, listing what's wrong. */
export function showSetup(problems: string[] = []) {
  if (!dialog.isConnected) document.body.append(dialog);
  pathInput.value = savedPath();
  const source = chatSource();
  for (const input of chatInputs) input.checked = input.value === source;
  $<HTMLElement>('.rewards').hidden = source !== 'streamerbot';
  $<HTMLElement>('.twitch').hidden = source !== 'twitch';
  const login = twitchLogin(), missing = missingRewards();
  $('.twitch-status').textContent = !login ? `Not logged in. Log in once as the channel that streams; the game then creates its rewards. Set their cost and turn them on or off in Twitch's dashboard.`
    : missing.length ? `Logged in as ${login}. Rewards not created yet: ${missing.join(', ')}. If Twitch already has a reward with that title, delete or rename it, then reload.`
    : `Logged in as ${login}. The game's rewards are created: set their cost and turn them on or off in Twitch's dashboard.`;
  report(problems);
  if (!dialog.open) dialog.showModal();
}

/** `F2` reopens setup, while `allowed()` (not during a race). */
export function bindSetupKey(allowed: () => boolean) {
  addEventListener('keydown', (e) => {
    if (e.key === 'F2' && allowed()) showSetup();
  });
}
