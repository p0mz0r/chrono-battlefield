// Headless check of a dev page: node tools/shot.mjs <url> [--out shot.png] [--size 2560x1270] [--steps steps.mjs] [--wait s] [--video dir]
// `--steps` names a module whose default export `async (page) => {}` drives the page (Playwright API) before the shot.
// `--wait` waits that many seconds after the page is ready (and the steps); `--video` also records the run into that folder (.webm).
// Prints page errors and failed requests, so a clean run prints only the shot path.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { positionals: [url], values } = parseArgs({ allowPositionals: true, options: {
  out: { type: 'string', default: 'shot.png' }, size: { type: 'string', default: '2560x1270' }, steps: { type: 'string' }, wait: { type: 'string' }, video: { type: 'string' },
} });
if (!url) throw new Error('usage: node tools/shot.mjs <url> [--out shot.png] [--size 2560x1270] [--steps steps.mjs] [--wait s] [--video dir]');
const [width, height] = values.size.split('x').map(Number);
// SwiftShader: WebGL without a GPU, so Pixi renders headless.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const context = await browser.newContext({ viewport: { width, height }, recordVideo: values.video ? { dir: values.video, size: { width, height } } : undefined });
  const page = await context.newPage();
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  // Pixi reports a shader that fails to compile here, not as a page error.
  page.on('console', (m) => { if (m.type() === 'error') console.log(`console.error: ${m.text().slice(0, 2000)}`); });
  page.on('response', (res) => { if (res.status() >= 400) console.log(`${res.status()} ${res.url()}`); });
  page.on('dialog', (dialog) => { console.log(`${dialog.type()}: ${dialog.message()}`); void dialog.dismiss(); });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (values.steps) await (await import(pathToFileURL(resolve(values.steps)).href)).default(page);
  if (values.wait) {
    await page.waitForFunction(() => document.body.dataset.ready !== undefined, null, { timeout: 120000 });
    await page.waitForTimeout(Number(values.wait) * 1000);
  }
  await page.screenshot({ path: values.out });
  console.log(values.out);
  await context.close(); // finishes the video
  if (values.video) console.log(await page.video().path());
} finally {
  await browser.close();
}
