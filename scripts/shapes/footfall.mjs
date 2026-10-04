// gl:footfall — trodden ground on the GLASS 2 floor (RENDER_TUNE.glWear, glGrain).
//
//   node scripts/shapes/footfall.mjs
//
// The floor shader draws mud, paths, ruts, puddles and rubbish from a fourth LUT plane that
// `footfallFill` in windshield.js derives from the window's cells. No headless harness can see the
// picture (every GL hook here records instead of drawing), so this checks the two halves that can
// go wrong in silence:
//
//   1. The derivation, on a small synthetic window: camps and lanes wear, doors get paths, the
//      desert past a town's last house doesn't, a beach stays sand, and the Curtain carries no path.
//   2. The plumbing: the plane is packed the way the shader unpacks it, and the floor writes uWear,
//      uGrain and uMud on every frame (a uniform keeps its last value), with world.js handing the
//      floor its mud level.
import { readFileSync } from 'node:fs';
import { loadWindshield } from './dom-stub.mjs';
import { createFloorLayer } from '../../client/game/js/panels/gl/floor.js';

const ws = await loadWindshield();
const problems = [];
const ok = (cond, msg) => { if (!cond) problems.push(msg); };

// ── 1. THE DERIVATION ─────────────────────────────────────────────────────────
//
//   y0  .  .  .  .  .  .  .  .  .      . turf     B building, door south
//   y1  .  .  .  .  .  .  .  .  .      - bare     b building, no door
//   y2  r  .  .  .  .  .  .  .  .      c camp     | Curtain (turf)
//   y3  r  B  B  B  b  .  .  .  .      r road     ~ water
//   y4  r  -  -  -  -  -  .  .  .
//   y5  r  .  c  c  c  |  .  .  .
//   y6  ~  -  B  .  .  .  .  .  .
//   y7  .  .  .  .  .  .  .  .  .
//   y8  -  -  -  -  -  -  -  -  -      bottom row: desert, three tiles from any building
const N = 9;
const turf = () => ({ kind: 'land', biome: 'parkland' });
const bare = () => ({ kind: 'land', biome: 'badlands' });
const map = Array.from({ length: N }, () => Array.from({ length: N }, turf));
for (let y = 2; y <= 5; y++) map[y][0] = { kind: 'land', biome: 'citycore', road: 1 };
for (let x = 1; x <= 3; x++) map[3][x] = { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'south' };
map[3][4] = { kind: 'land', biome: 'citycore', bt: 'ruin' };
for (let x = 1; x <= 5; x++) map[4][x] = bare();
for (let x = 2; x <= 4; x++) map[5][x] = { kind: 'land', biome: 'ash', mark: 'camp' };
map[5][5] = { kind: 'land', biome: 'parkland', cur: [1, 0] };
map[6][0] = { kind: 'land', biome: 'water' };
map[6][1] = bare();                                                  // beside a building and the water
map[6][2] = { kind: 'land', biome: 'citycore', bt: 'shop', ent: 'west' };
for (let x = 0; x < N; x++) map[8][x] = bare();
const LUT = map.map((row) => row.map((c) => [0, 0, 0, c.biome === 'water' ? 1 : 0, 0, 1, 0]));
ws.footfallFill(map, LUT, 100, 100);
const W = (x, y) => LUT[y][x][7] || 0, B = (x, y) => LUT[y][x][8] || 0, L = (x, y) => LUT[y][x][9] || 0;
const NB = 1, EB = 2, SB = 4, WB = 8;

ok(W(3, 5) === 1 && L(3, 5) === 1, `a camp tile should be fully worn and fully littered (wear ${W(3, 5)}, litter ${L(3, 5)}).`);
ok(W(2, 4) >= 0.6, `bare ground under a row of doors should be a lane (wear ${W(2, 4).toFixed(2)}).`);
ok(B(2, 4) & NB, 'a lane under a door facing it has no path north to that door.');
ok(B(2, 3) === SB, `a building's only path is out of its own door (bits ${B(2, 3)}, wanted ${SB}).`);
ok(B(4, 3) === 0, `a building with no door has no path (bits ${B(4, 3)}).`);
ok((B(2, 4) & EB) && (B(3, 4) & WB), 'two lane tiles side by side are not joined.');
ok(W(4, 8) < 0.1 && B(4, 8) === 0, `open desert three tiles from a building wore a lane (wear ${W(4, 8).toFixed(2)}, bits ${B(4, 8)}).`);
ok(B(5, 5) === 0, `a Curtain tile carries a path (bits ${B(5, 5)}): nobody walks through the wall.`);
ok(W(5, 5) <= 0.35, `a Curtain tile wore past its edge (wear ${W(5, 5).toFixed(2)}).`);
ok(W(1, 6) <= 0.3, `bare ground on the shore turned to mud (wear ${W(1, 6).toFixed(2)}): a beach stays sand.`);
ok(L(4, 8) === 0 && L(7, 0) === 0, 'rubbish lies on ground nobody lives on.');
ok(!LUT[6][0][8], 'water got a path.');

// ── 2. THE PLANE, PACKED AS THE SHADER UNPACKS IT ─────────────────────────────
{
  const p = ws.floorLutBytes(LUT, N, 0, 0, null);
  ok(p.lut3 && p.lut3.length === N * N * 4, 'floorLutBytes hands the floor no footfall plane.');
  if (p.lut3) {
    const o = (4 * N + 2) * 4;   // the lane at 2,4
    ok(p.lut3[o] === Math.round(W(2, 4) * 255), `wear packed as ${p.lut3[o]}, not ${Math.round(W(2, 4) * 255)}.`);
    ok(p.lut3[o + 1] === (B(2, 4) & 15) * 16, `path bits packed as ${p.lut3[o + 1]}, not ${(B(2, 4) & 15) * 16} (the shader reads g * 255 / 16).`);
    ok(p.lut3[o + 2] === Math.round(L(2, 4) * 255), `litter packed as ${p.lut3[o + 2]}.`);
  }
}

// ── 3. THE FLOOR WRITES ITS SWITCHES EVERY FRAME ──────────────────────────────
function recordingGL() {
  const seen = new Map(), wrote = new Map();
  const real = {
    getUniformLocation: (_p, n) => { const t = { n }; seen.set(t, n); return t; },
    getAttribLocation: () => 0, getShaderParameter: () => true, getProgramParameter: () => true,
    getShaderInfoLog: () => '', getProgramInfoLog: () => '',
    createShader: () => ({}), createProgram: () => ({}), createVertexArray: () => ({}),
    createTexture: () => ({}), createBuffer: () => ({}), isContextLost: () => false,
  };
  const setU = (loc, ...v) => { if (loc && seen.has(loc)) wrote.set(seen.get(loc), v.length === 1 ? v[0] : v); };
  const gl = new Proxy({}, {
    get(_t, k) {
      if (typeof k !== 'string') return undefined;
      if (k in real) return real[k];
      if (/^[A-Z][A-Z0-9_]*$/.test(k)) return k.length;
      if (k.startsWith('uniform')) return setU;
      return () => {};
    },
  });
  return { gl, wrote, asked: () => [...seen.values()] };
}
{
  const f = recordingGL();
  const floor = createFloorLayer(f.gl);
  for (const u of ['uLut3', 'uWear', 'uGrain', 'uMud']) ok(f.asked().includes(u), `floor.js never asks for ${u}.`);
  const base = { n: 4, lut0: new Uint8Array(64), lut1: new Uint8Array(64), hor: [0, 0, 0], fogCol: [0, 0, 0] };
  floor.draw({ ...base, wear: 0.4, grain: 0.7, mud: 0.5 });
  ok(f.wrote.get('uWear') === 0.4 && f.wrote.get('uGrain') === 0.7 && f.wrote.get('uMud') === 0.5,
    `the floor didn't write the switches it was handed (wear ${f.wrote.get('uWear')}, grain ${f.wrote.get('uGrain')}, mud ${f.wrote.get('uMud')}).`);
  floor.draw({ ...base });
  ok(f.wrote.get('uMud') === 0, 'the floor skipped uMud on a dry frame: the last shower would stand in the mud for the session.');
  ok(f.wrote.get('uWear') === 1 && f.wrote.get('uGrain') === 1, 'an unset switch should read as on, the RENDER_TUNE default.');
  floor.draw({ ...base, wear: 0, grain: 0 });
  ok(f.wrote.get('uWear') === 0 && f.wrote.get('uGrain') === 0, 'glWear/glGrain 0 did not reach the shader.');
}

// ── 4. THE HAND-OFFS ──────────────────────────────────────────────────────────
{
  const world = readFileSync(new URL('../../client/game/js/panels/gl/world.js', import.meta.url), 'utf8');
  ok(/fl\.mud\s*=/.test(world), 'world.js never hands the floor its mud level, so puddles in the mud never grow in the rain.');
  const wsrc = readFileSync(new URL('../../client/game/js/panels/windshield.js', import.meta.url), 'utf8');
  ok(/wear:\s*TUNE\.glWear/.test(wsrc) && /grain:\s*TUNE\.glGrain/.test(wsrc), 'FLOOR_STATE no longer carries glWear/glGrain.');
  ok(/footfallFill\(map, LUT/.test(wsrc), 'groundLUT no longer runs footfallFill.');
  ok(ws.RENDER_TUNE.glWear === 1 && ws.RENDER_TUNE.glGrain === 1, 'glWear/glGrain are not on by default.');
}

if (problems.length) {
  console.error('✗ footfall:\n  - ' + problems.join('\n  - '));
  process.exit(1);
}
console.log('✓ footfall: camps and lanes wear, doors get paths, desert, beach and Curtain stay clear; the plane packs as the shader reads it and the floor writes its switches every frame.');
