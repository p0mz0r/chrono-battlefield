import { Application, Container, Graphics, Sprite, Texture } from 'pixi.js';
import type { CellGrid } from './battlefield/grid.js';
import { importBattlefield, type Battlefield } from './battlefield/import.js';
import { CHUNK } from './battlefield/terrain.js';
import { readInstall } from './install/read.js';

// Dev page: draws one battlefield. `?map=<path inside the install>`; `?grid=1` or `G` overlays passability;
// `?cell=x,y&zoom=1` centres on a cell instead of fitting the whole battlefield.
const status = document.getElementById('status')!;
const params = new URLSearchParams(location.search);

const canvasTexture = (rgba: Uint8ClampedArray<ArrayBuffer>, width: number, height: number) => {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  canvas.getContext('2d')!.putImageData(new ImageData(rgba, width, height), 0, 0);
  return Texture.from(canvas);
};

/** Passability as movement sees it: red impassable or blocked, yellow slow, blue ramp, cyan high-bridge deck. */
function passability(grid: CellGrid, originX: number, originY: number): Graphics {
  const g = new Graphics();
  const diamond = (x: number, y: number, level: number) => {
    const sx = (x - y) * 30 - originX, sy = (x + y - level) * 15 - originY;
    return [sx + 30, sy, sx + 60, sy + 15, sx + 30, sy + 30, sx, sy + 15];
  };
  for (let i = 0; i < grid.width * grid.height; i++) {
    const x = i % grid.width, y = (i - x) / grid.width;
    const speed = grid.blocked[i] ? 0 : grid.speed[i]!;
    const color = speed === 0 ? 0xff2020 : speed < 1 ? 0xffd000 : grid.ramp[i] ? 0x3070ff : undefined;
    if (color !== undefined) g.poly(diamond(x, y, grid.level[i]!)).fill({ color, alpha: 0.4 });
    if (grid.deck[i]! >= 0) g.poly(diamond(x, y, grid.deck[i]!)).fill({ color: 0x00e0ff, alpha: 0.5 });
  }
  return g;
}

function draw(app: Application, battlefield: Battlefield) {
  const { terrain, images, objects, grid } = battlefield;
  const world = new Container();
  app.stage.addChild(world);
  for (const chunk of terrain.chunks) {
    const sprite = new Sprite(canvasTexture(chunk.rgba, CHUNK, CHUNK));
    sprite.position.set(chunk.x, chunk.y);
    world.addChild(sprite);
  }
  const textures = images.map((img) => canvasTexture(img.rgba, img.width, img.height));
  const things = new Container({ sortableChildren: true });
  for (const obj of objects) {
    const sprite = new Sprite(textures[obj.image]);
    sprite.position.set(obj.x, obj.y);
    sprite.zIndex = obj.z;
    things.addChild(sprite);
  }
  world.addChild(things);
  const overlay = passability(grid, terrain.originX, terrain.originY);
  overlay.visible = params.get('grid') === '1';
  world.addChild(overlay);
  addEventListener('keydown', (e) => { if (e.key === 'g' || e.key === 'G') overlay.visible = !overlay.visible; });

  const cell = params.get('cell')?.split(',').map(Number);
  const place = () => {
    if (cell) {
      const zoom = Number(params.get('zoom') ?? 1);
      world.scale.set(zoom);
      const [x = 0, y = 0] = cell;
      world.position.set(app.screen.width / 2 - ((x - y) * 30 - terrain.originX) * zoom, app.screen.height / 2 - ((x + y) * 15 - terrain.originY) * zoom);
    } else {
      world.scale.set(Math.min(app.screen.width / terrain.width, app.screen.height / terrain.height));
    }
  };
  place();
  app.renderer.on('resize', place);
}

async function main() {
  const mapPath = params.get('map') ?? 'Hills.mmx';
  const battlefield = await importBattlefield(readInstall, mapPath);
  const app = new Application();
  await app.init({ resizeTo: window, background: '#000' });
  document.body.prepend(app.canvas);
  draw(app, battlefield);
  const { grid } = battlefield;
  status.textContent = [
    `${mapPath}: ${battlefield.theater}, ${grid.width}×${grid.height} cells, ${battlefield.objects.length} objects, ` +
      `bridges ${grid.bridges.filter((b) => b.kind === 'high').length} high / ${grid.bridges.filter((b) => b.kind === 'low').length} low. G: passability`,
    ...battlefield.warnings.map((w) => `warning: ${w}`),
  ].join('\n');
  document.body.dataset.ready = 'true';
}

main().catch((err: unknown) => {
  status.textContent = String(err instanceof Error ? err.message : err);
  status.style.color = '#f66';
  document.body.dataset.ready = 'error';
});
