import { clearUploads, installFiles, savedPath, storeUploads, uploadedNames, useFolder } from './read.js';

// Install setup, used through OBS Interact. Any change reloads the page, which reopens the install.
const dialog = document.createElement('dialog');
dialog.id = 'setup';
dialog.innerHTML = `
<style>#setup input, #setup button { font: inherit; }</style>
<h2>Install setup</h2>
<ul class="problems"></ul>
<p><label>Choose your RA2 + Yuri's Revenge folder. The game copies the files it needs (about 600 MB) into OBS's storage once.<br>
  <input type="file" webkitdirectory></label></p>
<form method="dialog" class="path">
  <label>Or type the folder's path (OBS only, reads it in place without copying)<br><input name="path" size="70" placeholder="C:\\Program Files (x86)\\Origin Games\\Command and Conquer Red Alert II"></label>
  <button value="use">Use this folder</button>
</form>
<p class="stored"></p>
<p><label>Chat source <select name="chat"><option value="">None (chronoChat events only)</option><option value="streamerbot">Streamer.bot (ws://127.0.0.1:8080)</option></select></label></p>
<p><button class="clear">Clear stored files</button> <button class="close">Close</button></p>`;
dialog.style.cssText = 'font:20px/1.5 sans-serif;background:#111;color:#ddd;border:1px solid #666;max-width:46em';
const $ = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
const pathInput = $<HTMLInputElement>('input[name=path]');
const fileInput = $<HTMLInputElement>('input[type=file]');
const chatInput = $<HTMLSelectElement>('select[name=chat]');
const CHAT_KEY = 'rhino-chat-source';

/** The chat source picked in setup (ADR 0008): exactly one, or none (only `chronoChat` page events). */
export const chatSource = (): '' | 'streamerbot' => localStorage.getItem(CHAT_KEY) === 'streamerbot' ? 'streamerbot' : '';

chatInput.addEventListener('change', () => {
  localStorage.setItem(CHAT_KEY, chatInput.value);
  location.reload();
});

function report(problems: string[]) {
  $('.problems').replaceChildren(...problems.map((p) => Object.assign(document.createElement('li'), { textContent: p })));
  $<HTMLElement>('.problems').style.color = '#f88';
}

async function showStored() {
  const names = await uploadedNames();
  $('.stored').textContent = names.length ? `Stored: ${names.join(', ')}` : 'No files stored.';
}

$('form.path').addEventListener('submit', async (e) => {
  e.preventDefault();
  report(['Checking…']);
  const problems = await useFolder(pathInput.value);
  if (problems.length) report(problems);
  else location.reload();
});

fileInput.addEventListener('change', async () => {
  if (import.meta.env.DEV) return report(['The dev page reads the install from RA2_DIR; a chosen folder is only used in OBS.']);
  const files = installFiles([...fileInput.files!]);
  report([`Storing ${files.length} files…`]);
  const missing = await storeUploads(files);
  await showStored();
  if (missing.length) report([`Still missing ${missing.join(', ')}`]);
  else location.reload();
});

$('.clear').addEventListener('click', async () => {
  await clearUploads();
  await showStored();
});
$('.close').addEventListener('click', () => dialog.close());

/** Opens setup, listing what's wrong. */
export function showSetup(problems: string[] = []) {
  if (!dialog.isConnected) document.body.append(dialog);
  pathInput.value = savedPath();
  chatInput.value = chatSource();
  report(problems);
  void showStored();
  if (!dialog.open) dialog.showModal();
}

/** `F2` reopens setup, while `allowed()` (not during a race). */
export function bindSetupKey(allowed: () => boolean) {
  addEventListener('keydown', (e) => {
    if (e.key === 'F2' && allowed()) showSetup();
  });
}
