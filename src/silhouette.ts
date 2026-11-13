import { Filter, GlProgram, Texture, type Container } from 'pixi.js';
import { CHUNK } from './battlefield/terrain.js';

// Terrain is baked flat under the tanks (ADR 0002), so a tank behind a mesa would draw on top of it (#140).
// The bake's depth layer says which cell painted each pixel; where that cell stands in front of the tank and
// clearly higher, the tank's pixel is drawn as a house-colour silhouette instead, outlined, as in a spectator view.

const vertex = `
in vec2 aPosition;
out vec2 vTextureCoord;
out vec2 vScreen;
uniform vec4 uInputSize;
uniform vec4 uOutputFrame;
uniform vec4 uOutputTexture;
void main() {
  vec2 position = aPosition * uOutputFrame.zw + uOutputFrame.xy;
  vScreen = position;
  position.x = position.x * (2.0 / uOutputTexture.x) - 1.0;
  position.y = position.y * (2.0 * uOutputTexture.z / uOutputTexture.y) - uOutputTexture.z;
  gl_Position = vec4(position, 0.0, 1.0);
  vTextureCoord = aPosition * (uOutputFrame.zw * uInputSize.zw);
}`;

const fragment = `
in vec2 vTextureCoord;
in vec2 vScreen;
out vec4 finalColor;
uniform sampler2D uTexture;
uniform vec4 uInputSize;
uniform vec4 uWorld;
uniform vec4 uTank;
uniform vec3 uColour;
uniform sampler2D uDepth0;
uniform sampler2D uDepth1;
uniform sampler2D uDepth2;
uniform sampler2D uDepth3;
const float CHUNK = ${CHUNK}.0;

bool hidden() {
  // Battlefield px, relative to the 2×2 block of depth chunks around the tank.
  vec2 at = floor((vScreen - uWorld.xy) / uWorld.z) - uTank.zw;
  if (any(lessThan(at, vec2(0.0))) || any(greaterThanEqual(at, vec2(2.0 * CHUNK)))) return false;
  vec2 c = step(vec2(CHUNK), at), uv = (at - c * CHUNK + 0.5) / CHUNK;
  vec4 d = c.y < 0.5 ? (c.x < 0.5 ? texture(uDepth0, uv) : texture(uDepth1, uv))
                     : (c.x < 0.5 ? texture(uDepth2, uv) : texture(uDepth3, uv));
  vec3 v = floor(d.rgb * 255.0 + 0.5);
  // ponytail: two levels of margin, so a ramp's next cell doesn't flicker the hull; RA2's own cliffs are 4 levels.
  return v.b > 0.0 && v.r + v.g * 256.0 > uTank.x && v.b - 1.0 >= uTank.y + 2.0;
}

void main() {
  vec4 colour = texture(uTexture, vTextureCoord);
  if (colour.a == 0.0 || !hidden()) { finalColor = colour; return; }
  vec2 px = uInputSize.zw;
  float edge = min(min(texture(uTexture, vTextureCoord + vec2(px.x, 0.0)).a, texture(uTexture, vTextureCoord - vec2(px.x, 0.0)).a),
                   min(texture(uTexture, vTextureCoord + vec2(0.0, px.y)).a, texture(uTexture, vTextureCoord - vec2(0.0, px.y)).a));
  float alpha = colour.a * (edge < 0.5 ? 1.0 : 0.6);
  finalColor = vec4(uColour * alpha, alpha);
}`;

// highp: battlefield px run to thousands, past mediump's precision.
const program = GlProgram.from({ vertex, fragment, name: 'silhouette', preferredFragmentPrecision: 'highp' });

/** Depth chunks by their top-left, from `TerrainChunk.depth`, sampled nearest. */
export type DepthChunks = Map<string, Texture>;

export function depthTexture(bitmap: ImageBitmap): Texture {
  const texture = Texture.from(bitmap);
  texture.source.scaleMode = 'nearest';
  return texture;
}

/**
 * Draws the parts of a tank's view that higher terrain in front covers as a silhouette in `rgb`.
 * `place` runs every frame, once the world's camera and the tank are placed.
 */
export function silhouette(view: Container, depth: DepthChunks, rgb: number) {
  const filter = new Filter({
    glProgram: program,
    resources: {
      silhouette: {
        uWorld: { value: new Float32Array(4), type: 'vec4<f32>' },
        uTank: { value: new Float32Array(4), type: 'vec4<f32>' },
        uColour: { value: new Float32Array([(rgb >> 16) / 255, ((rgb >> 8) & 255) / 255, (rgb & 255) / 255]), type: 'vec3<f32>' },
      },
      uDepth0: Texture.EMPTY.source, uDepth1: Texture.EMPTY.source, uDepth2: Texture.EMPTY.source, uDepth3: Texture.EMPTY.source,
    },
    padding: 1,
  });
  view.filters = [filter];
  const uniforms = filter.resources.silhouette.uniforms;
  let block = '';
  /** `world`: the battlefield's on-screen position and scale; `x`, `y`: the tank's draw point in battlefield px; `cell` and `level`: where it stands. */
  return (world: { x: number; y: number; scale: number }, x: number, y: number, cell: { x: number; y: number }, level: number) => {
    // The block's top-left chunk is the one just up-left of the tank, so its sprite fits inside the block.
    const bx = Math.max(Math.floor((x - 128) / CHUNK), 0) * CHUNK, by = Math.max(Math.floor((y - 128) / CHUNK), 0) * CHUNK;
    if (block !== `${bx},${by}`) {
      block = `${bx},${by}`;
      [[0, 0], [1, 0], [0, 1], [1, 1]].forEach(([i, j], k) => {
        filter.resources[`uDepth${k}`] = (depth.get(`${bx + i! * CHUNK},${by + j! * CHUNK}`) ?? Texture.EMPTY).source;
      });
    }
    uniforms.uWorld.set([world.x, world.y, world.scale, 0]);
    uniforms.uTank.set([cell.x + cell.y, level, bx, by]);
    filter.resources.silhouette.update();
  };
}
