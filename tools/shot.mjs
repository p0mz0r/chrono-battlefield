// Headless check of a dev page: node tools/shot.mjs <url> [--out shot.png] [--size 2560x1270] [--steps steps.mjs]
// `--steps` names a module whose default export `async (page) => {}` drives the page (Playwright API) before the shot.
// Prints page errors and failed requests, so a clean run prints only the shot path.
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { chromium } from 'playwright-core';

const { positionals: [url], values } = parseArgs({ allowPositionals: true, options: {
  out: { type: 'string', default: 'shot.png' }, size: { type: 'string', default: '2560x1270' }, steps: { type: 'string' },
} });
if (!url) throw new Error('usage: node tools/shot.mjs <url> [--out shot.png] [--size 2560x1270] [--steps steps.mjs]');
const [width, height] = values.size.split('x').map(Number);
// SwiftShader: WebGL without a GPU, so Pixi renders headless.
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
try {
  const page = await browser.newPage({ viewport: { width, height } });
  page.on('pageerror', (error) => console.log(`pageerror: ${error.message}`));
  page.on('response', (res) => { if (res.status() >= 400) console.log(`${res.status()} ${res.url()}`); });
  page.on('dialog', (dialog) => { console.log(`${dialog.type()}: ${dialog.message()}`); void dialog.dismiss(); });
  await page.goto(url, { waitUntil: 'networkidle' });
  if (values.steps) await (await import(pathToFileURL(resolve(values.steps)).href)).default(page);
  await page.screenshot({ path: values.out });
  console.log(values.out);
} finally {
  await browser.close();
}
