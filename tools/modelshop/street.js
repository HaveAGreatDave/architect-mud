// LOOK AT A REAL STREET, FROM A REAL SEAT.
//
// Every bench in this repo builds a SYNTHETIC city — `__glFrame`'s density sweep, `__glLeak`'s
// wall of warehouses, `__glBench`'s terrace. That is right for a measurement (a scene picked by
// hand picks the answer, which `__glFrame`'s own ⚠ records costing three wrong conclusions) and
// it is useless for the other question: **does Marrow Street look good?** You cannot answer that
// against a city of `bt: 'shop'` tiles, because the thing being judged is what a particular row
// of particular buildings does beside each other.
//
// So this paints the WORLD, at a grid coordinate, from a cab or a cockpit:
//
//   __street({ x: 916, y: 909, heading: 180 })      // Marrow Street, looking at the south side
//   __street({ x: 916, y: 909, heading: 180, hour: 2 })
//   __street({ at: 'In Hock We Trust' })            // stand in the road outside a named building
//   __streetHide()
//
// ⚠ THE CELLS ARE THE BAKED SNAPSHOT, NOT A SECOND DERIVATION. `client/game/flightsim-world.json`
// is written by `buildFlightSnapshot`, which calls the same `deriveSurfaceCell` a live flight
// streams to the cockpit — and that sharing exists precisely because the bake once kept its own
// copy and drifted twice, silently losing 144 street tiles and then every park feature. Deriving
// cells here from `content/zones` would be a THIRD copy and the same mistake a third time. The
// cost is that the file is only as fresh as the last `npm run snapshot:flight` — which is why
// `__street` prints its own age, rather than letting you read a month-old city as today's.
//
// ⚠ AND IT IS A PICTURE, NEVER A MEASUREMENT. No clock is frozen, no dial is pinned and no
// resolution is forced, because all three of those change what you are looking at. Nothing here
// should ever grow a number to compare across days; that is what the benches in glbench.js are,
// and they are deliberately a different file.
import { paintWindshield, RENDER_TUNE, tagArtwork, tagWordList } from '/client/game/js/panels/windshield.js';
import { installGL, glLastFrame } from '/client/game/js/panels/gl/install.js';

let _world = null, _uninstall = null, _canvas = null;

async function world() {
  if (_world) return _world;
  const res = await fetch('/api/world');
  if (!res.ok) throw new Error('no baked flight world (' + res.status + ') — run `npm run snapshot:flight`');
  _world = await res.json();
  return _world;
}

// The seat, as the canopy's own view object. Two of them, because a cab at eye height 0 and an
// aircraft at 0.5 tiles see completely different buildings — the truck sees the shopfront and the
// aeroplane sees the roof, and a strip judged only from the air ships broken doorways.
const SEATS = {
  cab: { cls: 'truck', height: 0, eyeH: 0.12, speed: 0.15, r: 14 },
  street: { cls: 'truck', height: 0, eyeH: 0.06, speed: 0, r: 14 },
  air: { cls: 'prop', height: 0.5, eyeH: undefined, speed: 0.4, r: 36 },
};

// ── ⚠ AND A SKY TO GO WITH THE WEATHER WORD ────────────────────────────────────────────────────
//
// `weather: 'rain'` used to buy the streaks, the gloom and the fog band and NOTHING ELSE, because
// `drawVolumetricClouds` returns on its own first line without a weather field and an aircraft
// position — and no harness in this repo passed either. So every picture this tool has ever drawn
// was of a street under an empty sky, which is a poor way to judge a rainy one and was no way at
// all to see the reflection of a cloud in a puddle.
//
// The shape is `__glClouds()`'s own CLOUD_FIELD with the cells parked around the seat rather than
// around tile 100,100. Coverage and cell type come off the weather word, so a caller still says
// `weather: 'storm'` and gets a storm.
const WX_SKY = {
  clear:  [0.10, ['cloud']],
  cloudy: [0.55, ['cloud', 'cloud', 'precip']],
  rain:   [0.55, ['precip', 'cloud', 'precip']],
  storm:  [0.65, ['storm', 'precip', 'cloud']],
  snow:   [0.55, ['precip', 'cloud', 'precip']],
  fog:    [0.40, ['cloud', 'cloud']],
  ash:    [0.45, ['cloud', 'precip']],
  dust:   [0.35, ['cloud', 'cloud']],
};
function skyField(wx, x, y) {
  const [baseCloud, kinds] = WX_SKY[wx] || WX_SKY.clear;
  return {
    tick: 30, bounds: { minX: x - 40, maxX: x + 40, minY: y - 40, maxY: y + 40 },
    wind: { dir: 220, kph: 18 }, baseCloud, precipFloor: 0, floorType: 'none',
    cells: kinds.map((k, i) => ({
      x: x + (i - 1) * 9, y: y - 12 + i * 8, r: 13 - i * 2, vx: 0.4 - i * 0.3, vy: 0.2 + i * 0.2,
      type: k, intensity: 0.9 - i * 0.1, precip: k === 'cloud' ? 'none' : 'rain',
    })),
  };
}

function findNamed(w, name) {
  const want = String(name).toLowerCase();
  for (const [k, c] of Object.entries(w.cells)) {
    if (c.bn && c.bn.toLowerCase() === want) {
      const [x, y] = k.split(',').map(Number);
      return { x, y, cell: c };
    }
  }
  return null;
}

// Where you stand to LOOK AT a building: one tile off it, on the side its entrance faces, pointing
// back at it. The tile a building's door opens onto is the only place its frontage is the thing you
// see — which is the whole reason `ent` is on the cell in the first place.
const BACK_OFF = { north: [0, -1, 180], south: [0, 1, 0], east: [1, 0, 270], west: [-1, 0, 90] };

export async function street(opts = {}) {
  const w = await world();
  let { x, y, heading = 0, at = null, seat = 'cab', hour = 13, weather = 'clear',
    W = 1100, H = 620, back = 1, left = 0, show = true, gl = 1 } = opts;

  if (at) {
    const found = findNamed(w, at);
    if (!found) { console.warn('__street: no building named ' + JSON.stringify(at)); return null; }
    const [dx, dy, hd] = BACK_OFF[found.cell.ent] || [0, -1, 180];
    x = found.x + dx * back + (dy ? left : 0);
    y = found.y + dy * back + (dx ? left : 0);
    heading = hd;
    console.log('__street: ' + at + ' at ' + found.x + ',' + found.y
      + ' (' + found.cell.bt + ', entrance ' + found.cell.ent + ') — standing at ' + x + ',' + y);
  }
  if (x == null || y == null) { console.warn('__street: pass {x, y} or {at}'); return null; }

  const S = SEATS[seat] || SEATS.cab;
  const R = opts.r || S.r, N = R * 2 + 1;
  const bare = { kind: 'land', biome: 'badlands', flr: 0 };
  // ⚠ `cells` PATCHES THE SNAPSHOT AND DOES NOT WRITE TO IT — see the ⚠ at the top of this file.
  // The baked world is as fresh as the last snapshot, so a building renamed or re-typed in
  // content/ since then still answers to its old name here. This is how you look at the change
  // anyway: `{ cells: { '916,910': { bn: 'Cash & Carrion' } } }` merges onto the cell for this
  // render only. It is a viewer, so nothing it does can reach the file.
  const patch = opts.cells || null;
  const map = Array.from({ length: N }, (_, j) => Array.from({ length: N }, (_, i) => {
    const k = (x + i - R) + ',' + (y + j - R);
    const c = w.cells[k];
    if (!c) return bare;
    return (patch && patch[k]) ? { ...c, ...patch[k] } : c;
  }));

  if (!_canvas) {
    _canvas = document.createElement('canvas');
    _canvas.id = '__street';
    _canvas.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;border:1px solid #000;box-shadow:0 8px 40px rgba(0,0,0,.6)';
    document.body.append(_canvas);
    _uninstall = installGL(() => _canvas);
  }
  _canvas.width = W; _canvas.height = H;
  _canvas.style.width = W + 'px'; _canvas.style.height = H + 'px';
  _canvas.style.display = show ? '' : 'none';
  _canvas.style.left = (opts.left_px ?? 8) + 'px';
  _canvas.style.top = (opts.top_px ?? 8) + 'px';

  const wasGl = RENDER_TUNE.gl, wasFloor = RENDER_TUNE.glFloor;
  RENDER_TUNE.gl = gl; RENDER_TUNE.glFloor = gl;
  try {
    paintWindshield('__street', {
      cls: S.cls, phase: 'cruise', worldBlend: 1,
      // ⚠ EYE HEIGHT IS THE KNOB THAT DECIDES WHAT YOU ARE JUDGING. A cab sits at 0.12 and sees a
      // shopfront; lift it to 0.4 and you are judging rooflines from a place no player stands. It
      // is here because a 3/4 view is how you read a whole terrace, and it is named `eyeH` rather
      // than `zoom` so nobody mistakes it for one.
      height: opts.height ?? S.height, eyeH: opts.eyeH ?? S.eyeH, speed: S.speed,
      hour, weather, map, heading,
      // ⚠ THE CENTRE IS A TILE AND THE OFFSET IS WHERE YOU STAND INSIDE IT. A fractional `y` would
      // miss every cell (the snapshot is keyed on integers) and paint an empty world, so standing
      // half a tile back from a shopfront is `off: { y: -0.5 }`, never `y: 909.5`.
      mapCenter: { x, y }, mapOffset: opts.off || { x: 0, y: 0 },
      // ⚠ BOTH, OR NEITHER COUNTS. The deck needs the field AND the ship's world position; with
      // either missing it returns on its first line and the sky is empty with nothing to say so.
      wxField: opts.wxField === null ? null : (opts.wxField || skyField(weather, x, y)), acX: x, acY: y,
      tune: { gl },
      // ⚠ THE SEAT AS THE DRIVER ACTUALLY HAS IT, WHICH THIS TOOL COULD NOT SHOW UNTIL NOW. A view
      // field this file does not name is a field the picture cannot contain — and the one that cost a
      // whole session is `landingLight`, the headlight switch. `headlightWash` washes every building
      // frontage in a 34-tile cone and it is gated on that flag, so every street this tool has ever
      // drawn was of a truck driving at night with its lamps off. A glare reported from the cab was
      // then unreproducible here, which reads as the reporter being wrong rather than as the harness
      // being blind. Spread last, so a caller can override anything above it.
      ...(opts.view || {}),
    });
  } finally { RENDER_TUNE.gl = wasGl; RENDER_TUNE.glFloor = wasFloor; }

  const L = glLastFrame() || {};
  const info = { x, y, heading, seat, hour, weather, faces: L.faces || 0, lights: L.lights || 0, decals: L.decals || 0, wet: L.wet || 0 };
  console.log('__street', JSON.stringify(info));
  return info;
}

export function streetHide() {
  if (_canvas) _canvas.style.display = 'none';
}

// ── `__tagSheet()` — every piece the city can paint, side by side ────────────────────────────
//
// The sibling of `__street` for the one adornment you cannot judge from a street: a throw-up is
// a couple of dozen pixels on a shopfront, and the thing being decided about it — is this legible,
// does the cloud read, is the outline heavy enough — is decided at the size it is BAKED, not at
// the size it is drawn. Standing in front of the one building wearing a given word and squinting
// is not a review, and there are twenty-five words and three colour schemes.
//
//   __tagSheet()                              // the house word list, three schemes, by day
//   __tagSheet({ night: 1, colour: '#5fd0ff' })
//   __tagSheet({ words: ['COLDWATER LIES'], scale: 1 })   // a player's own can, unshrunk
//   __tagSheetHide()
//
// ⚠ IT IS THE REAL BAKE AND NOT A PREVIEW OF ONE. `tagArtwork` is `bakeTagText` with the runs left
// out, so what is on this sheet is the canvas the decal layer uploads — there is no second painter
// here to disagree with the wall.
let _sheet = null;
export function tagSheet(opts = {}) {
  const { colour = '#ff6a4a', night = 0, marks = 3, cols = 5, scale = 0.5, pad = 10 } = opts;
  const words = opts.words || tagWordList();
  // One row per colour scheme, because the scheme is picked off the variant and an author choosing
  // `v` is choosing between them without being told so.
  const cells = [];
  for (let s = 0; s < 3; s++) for (let i = 0; i < words.length; i++) {
    const tex = tagArtwork(words[i], colour, s + i * 3, night, marks);
    if (tex) cells.push({ tex, label: words[i] + ' · v' + (s + i * 3) });
  }
  if (!cells.length) return null;
  const cw = Math.max(...cells.map((c) => c.tex.width)) * scale + pad * 2;
  const ch = Math.max(...cells.map((c) => c.tex.height)) * scale + pad * 2 + 14;
  const rows = Math.ceil(cells.length / cols);
  if (!_sheet) {
    _sheet = document.createElement('canvas');
    _sheet.id = '__tagsheet';
    _sheet.style.cssText = 'position:fixed;left:8px;top:8px;z-index:99999;border:1px solid #000;box-shadow:0 8px 40px rgba(0,0,0,.6)';
    document.body.append(_sheet);
  }
  _sheet.style.display = '';
  _sheet.width = cw * cols; _sheet.height = ch * rows;
  const g = _sheet.getContext('2d');
  // ⚠ A WALL, NOT A PAGE. Paint is judged against what it is sprayed on — on white every outline
  // looks heavy and every cloud looks weak — so the sheet is the colour of a dim brick frontage.
  g.fillStyle = night ? '#241d1a' : '#4a3a31';
  g.fillRect(0, 0, _sheet.width, _sheet.height);
  g.font = '10px system-ui, sans-serif';
  g.textBaseline = 'top';
  cells.forEach((c, i) => {
    const x = (i % cols) * cw, y = Math.floor(i / cols) * ch;
    g.drawImage(c.tex, x + pad, y + pad, c.tex.width * scale, c.tex.height * scale);
    g.fillStyle = 'rgba(255,255,255,0.55)';
    g.fillText(c.label, x + pad, y + ch - 13);
  });
  console.log('__tagSheet: ' + cells.length + ' piece(s), ' + cw.toFixed(0) + 'x' + ch.toFixed(0) + ' each');
  return _sheet;
}
export function tagSheetHide() { if (_sheet) _sheet.style.display = 'none'; }

if (typeof window !== 'undefined') {
  window.__street = street;
  window.__streetHide = streetHide;
  window.__tagSheet = tagSheet;
  window.__tagSheetHide = tagSheetHide;
}
