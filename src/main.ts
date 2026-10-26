import { Application, Container, Sprite, Texture } from 'pixi.js';
import { CHUNK, bakeTerrain } from './battlefield/terrain.js';
import { openInstall, readInstall } from './install/read.js';
import { bindSetupKey, showSetup } from './install/setup.js';
import { loadMap, mountTheater } from './ra2/mount.js';

// Dev page: draws one battlefield's terrain, fitted to the window. `?map=<path inside the install>`.
const status = document.getElementById('status')!;

async function main() {
  bindSetupKey();
  const problems = await openInstall();
  if (problems.length) {
    status.textContent = 'RA2 + YR install not found';
    showSetup(problems);
    return;
  }
  const mapPath = new URLSearchParams(location.search).get('map') ?? 'Hills.mmx';
  const map = await loadMap(readInstall, mapPath);
  const vfs = await mountTheater(readInstall, map.theater);
  const terrain = bakeTerrain(map, vfs);

  const app = new Application();
  await app.init({ resizeTo: window, background: '#000' });
  document.body.prepend(app.canvas);
  const world = new Container();
  app.stage.addChild(world);
  for (const chunk of terrain.chunks) {
    const canvas = document.createElement('canvas');
    canvas.width = canvas.height = CHUNK;
    canvas.getContext('2d')!.putImageData(new ImageData(chunk.rgba, CHUNK, CHUNK), 0, 0);
    const sprite = new Sprite(Texture.from(canvas));
    sprite.position.set(chunk.x, chunk.y);
    world.addChild(sprite);
  }
  const fit = () => world.scale.set(Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
  fit();
  app.renderer.on('resize', fit);

  status.textContent = `${mapPath}: ${map.theater}, ${map.tiles.length} cells, ${terrain.missing} missing tiles`;
  document.body.dataset.ready = String(terrain.missing === 0);
}

main().catch((err: unknown) => {
  status.textContent = String(err);
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
  if (/^Missing install file/.test(String((err as Error)?.message))) showSetup([(err as Error).message]);
});
