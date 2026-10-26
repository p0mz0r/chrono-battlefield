import { clearUploads, savedPath, storeUploads, uploadedNames, useFolder } from './read.js';

// Install setup, used through OBS Interact. Any change reloads the page, which reopens the install.
const dialog = document.createElement('dialog');
dialog.id = 'setup';
dialog.innerHTML = `
<style>#setup input, #setup button { font: inherit; }</style>
<h2>Install setup</h2>
<ul class="problems"></ul>
<form method="dialog" class="path">
  <label>RA2 + Yuri's Revenge folder<br><input name="path" size="70" placeholder="C:\\Program Files (x86)\\Origin Games\\Command and Conquer Red Alert II"></label>
  <button value="use">Use this folder</button>
</form>
<p><label>Or upload <b>ra2.mix</b>, <b>ra2md.mix</b>, <b>expandmd01.mix</b> and the maps:<br>
  <input type="file" multiple></label></p>
<p class="stored"></p>
<p><button class="clear">Clear stored files</button> <button class="close">Close</button></p>`;
dialog.style.cssText = 'font:20px/1.5 sans-serif;background:#111;color:#ddd;border:1px solid #666;max-width:46em';
const $ = <T extends Element>(sel: string) => dialog.querySelector<T>(sel)!;
const pathInput = $<HTMLInputElement>('input[name=path]');
const fileInput = $<HTMLInputElement>('input[type=file]');

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
  report([`Storing ${fileInput.files!.length} files…`]);
  const missing = await storeUploads([...fileInput.files!]);
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
  report(problems);
  void showStored();
  if (!dialog.open) dialog.showModal();
}

/** `F2` reopens setup. */
export function bindSetupKey() {
  addEventListener('keydown', (e) => {
    if (e.key === 'F2') showSetup();
  });
}
