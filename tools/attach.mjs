// Attaches to the launcher's own Edge window, started with RHINO_RACE_DEBUG_PORT set (docs/agents/ra2-install.md):
// node tools/attach.mjs [--port 9333] [--reload] [--press F2,Enter] [--wait s] [--out shot.png]
// Prints page errors, console errors and failed requests from attach on; `--reload` reloads first to catch the load.
// `--press` sends page keys in order, `--wait` waits that many seconds after the page is ready, `--out` screenshots the page.
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { values } = parseArgs({ options: {
  port: { type: 'string', default: '9333' }, reload: { type: 'boolean' }, press: { type: 'string' }, wait: { type: 'string' }, out: { type: 'string' },
} });
const browser = await chromium.connectOverCDP(`http://127.0.0.1:${values.port}`);
try {
  const page = browser.contexts().flatMap((c) => c.pages()).find((p) => p.url().startsWith('http://127.0.0.1:27135/'));
  if (!page) throw new Error('No game page: is the launcher running with RHINO_RACE_DEBUG_PORT set?');
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  // "Failed to load resource" repeats a response or failure already printed below.
  page.on('console', (msg) => { if (msg.type() === 'error' && !msg.text().startsWith('Failed to load resource')) console.log(`console: ${msg.text()}`); });
  page.on('requestfailed', (req) => console.log(`failed: ${req.failure()?.errorText} ${req.url()}`));
  page.on('response', (res) => { if (res.status() >= 400 && !res.url().includes('/abs/')) console.log(`${res.status()} ${res.url()}`); });
  if (values.reload) await page.reload();
  await page.waitForFunction(() => document.body.dataset.ready !== undefined, null, { timeout: 120000 });
  console.log(`ready: ${await page.evaluate(() => document.body.dataset.ready)}`);
  for (const key of values.press?.split(',') ?? []) { await page.keyboard.press(key); await page.waitForTimeout(500); }
  if (values.wait) await page.waitForTimeout(Number(values.wait) * 1000);
  if (values.out) { await page.screenshot({ path: values.out }); console.log(values.out); }
} finally {
  await browser.close(); // only disconnects: the window stays open
}
