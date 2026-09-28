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
import { paintWindshield, RENDER_TUNE, tagArtwork, tagWordList, tagHandList, tagFaceList } from '/client/game/js/panels/windshield.js';
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
  // ⚠ AND ONE WITH NOTHING IN FRONT OF IT, WHICH IS THE ONE TO JUDGE A BUILDING FROM. The three
  // above are SEATS: each frames a vehicle, so a third of every shot is cab pillar, dash, canopy
  // frame or bonnet, and a reviewer comparing two facades is comparing them through a windscreen.
  // This is `freelook`'s camera — `external` + `hideOwnShip` + a `freeCam` view, the same shape the
  // staff camera hands the renderer — so the frame is all world and nothing else changes.
  free: { cls: 'prop', free: true, height: 0, eyeH: undefined, speed: 0, r: 22 },
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
      // ── THE FREE CAMERA ────────────────────────────────────────────────────────────────────
      // ⚠ `freeCam.x/y` IS AN OFFSET FROM THE MAP CENTRE AND NOT A TILE. Handing it a world
      // coordinate puts the camera four hundred tiles off the window and paints an empty desert,
      // which reads exactly like the seat not working. `off` is the sub-tile nudge for every other
      // seat, so it means the same thing here and `mapCenter` still carries the tile.
      // ⚠ AND `pitch` IS DEGREES HERE, because every other angle this tool takes is. `camPitch`
      // inside the renderer is radians; conflating the two tips the city fifty-seven times too far,
      // which is the trap `makeCam`'s own ⚠ is written about.
      ...(S.free ? {
        external: true, hideOwnShip: true,
        freeCam: {
          x: (opts.off && opts.off.x) || 0, y: (opts.off && opts.off.y) || 0,
          z: opts.eyeH ?? opts.height ?? 0.12,
          // ⚠ YAW IS DEGREES AND PITCH IS RADIANS TO THIS CAMERA. The yaw went in as radians, so every
          // free-seat shot faced within a few degrees of north whatever heading was asked for.
          yaw: heading || 0, pitch: (opts.pitch || 0) * Math.PI / 180,
          roll: 0, fov: opts.fov || 1,
        },
      } : {}),
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

// ── `__redtail()` — WATCH A RED-TAIL TAKE SOMETHING ───────────────────────────────────────────
//
// A strike is a few seconds once a cycle, somewhere in the wastes, so the chance of meeting one by
// flying about is poor. This finds a red-tail in the baked world, finds its next strike from now,
// PINS THE CLOCK to a moment in it and stands a free camera a little way off the target.
//
//   __redtail()                      // one second in: the hawk on the critter
//   __redtail({ t: -1 })             // a second before: the critter still there, the hawk up
//   __redtail({ t: 2.5 })            // climbing away (the critter gone, if it was a kill)
//   __redtail({ pick: 3, back: 2 })  // another hawk; stand further off
//
// ⚠ THE PREY LIST IS BUILT THE WAY THE RENDERER BUILDS IT (critter ground, not built, not road,
// not raised), or the strike this finds is not the strike the frame draws.
export async function redtail(opts = {}) {
  const w = await world();
  const B = await import('/client/shared/birds.js');
  const cellAt = (x, y) => w.cells[x + ',' + y];
  const preyFor = (h, t) => {
    const out = [];
    for (let y = h.ay - 3; y <= h.ay + 3; y++) for (let x = h.ax - 3; x <= h.ax + 3; x++) {
      const c = cellAt(x, y);
      if (c && !c.bt && !c.road && !c.hi && B.critterGround(c.biome)) out.push(...B.crittersAt(x, y, t));
    }
    return out;
  };
  const hawks = [];
  for (const [k, c] of Object.entries(w.cells)) {
    if (c.bt || !c.biome) continue;
    const [x, y] = k.split(',').map(Number);
    if (B.speciesAt(c.biome, x, y, { road: !!c.road }) === 'hawk') { const f = B.flockAt(x, y, 1, 'hawk'); if (f) hawks.push(f); }
  }
  hawks.sort((a, b) => (a.ax - b.ax) || (a.ay - b.ay));
  const start = opts.from || Date.now();
  const order = hawks.map((h, i) => hawks[(i + (opts.pick || 0)) % hawks.length]);
  let found = null;
  for (const h of order) {
    for (let t = start; t < start + 12 * 3600e3; t += 500) {
      const s = B.groundStrike(h, t, preyFor(h, t));
      if (s && s.age < 0.5) { found = { h, s, t0: t - s.age * 1000 }; break; }
    }
    if (found) break;
  }
  if (!found) { console.warn('__redtail: no red-tail strike found in twelve hours'); return null; }
  const { h, s, t0 } = found;
  const at = t0 + (opts.t ?? 1) * 1000;
  // Stand `back` tiles off the target, looking at it.
  const hd = opts.heading ?? 0, back = opts.back ?? 1.2;
  const cx = s.x + Math.sin(hd * Math.PI / 180) * back, cy = s.y + Math.cos(hd * Math.PI / 180) * back;
  // ⚠ THE MAP CENTRE IS WHERE THE (HIDDEN) OWN CRAFT IS, AND BIRDS GET OUT OF ITS WAY (birdEvade).
  // Centred on the camera, the craft sits on the strike and shoves the hawk off its own target; so
  // the centre is put a few tiles off and the free camera carries the whole offset back.
  const X = Math.round(cx) + 4, Y = Math.round(cy) + 4;
  const realNow = Date.now;
  Date.now = () => at;
  let info;
  try {
    // ⚠ THE SUB-TILE OFFSET GOES IN THE FREE CAMERA ONLY. `street()` hands `off` to both the free
    // camera and the map offset, and the renderer adds the two, so passing it there puts the eye
    // twice as far off the tile as asked.
    info = await street({ ...opts, seat: 'free', x: X, y: Y, heading: hd, hour: opts.hour ?? 13,
      // ⚠ AND THE HIDDEN VEHICLE IS A PARKED TRUCK, NOT THE FREE SEAT'S AEROPLANE: birds dodge an
      // aircraft (birdEvade), so an invisible one near the strike pushes the hawk off its target.
      view: { cls: 'truck', speed: 0, freeCam: { x: cx - X, y: cy - Y, z: opts.eyeH ?? 0.06, yaw: hd,   // ⚠ DEGREES: the free camera here reads its yaw in degrees
        pitch: (opts.pitch ?? 0) * Math.PI / 180, roll: 0, fov: opts.fov || 1 } } });   // pitch in DEGREES here, radians to the camera
  } finally { Date.now = realNow; }
  const out = { hawk: h.ax + ',' + h.ay, kind: s.prey.kind, kill: s.hit, strikeAt: new Date(t0).toISOString(),
    t: opts.t ?? 1, target: [+s.x.toFixed(2), +s.y.toFixed(2)], camera: [+cx.toFixed(2), +cy.toFixed(2)], ...info };
  console.log('__redtail', JSON.stringify(out));
  return out;
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
//   __tagSheet()                              // the house word list, one row per HAND, by day
//   __tagSheet({ night: 1, colour: '#5fd0ff' })
//   __tagSheet({ words: ['COLDWATER LIES'], scale: 1 })   // a player's own can, unshrunk
//   __tagSheet({ hand: 'roller' })            // one hand only, every word
//   __tagSheet({ hands: false })              // back to three rows of colour SCHEMES
//   __tagSheet({ faces: true })               // one row per throw-up letterform: bubble, round, block, sharp
//   __tagSheet({ face: 'sharp' })             // every throw-up in one letterform
//   __tagSheetHide()
//
// ⚠ THE ROWS ARE HANDS NOW AND WERE COLOUR SCHEMES. Both are chosen off the same `variant`, so a
// sheet laid out by scheme visits whichever hands that arithmetic happens to land on and silently
// shows four of one and none of another — which is exactly how a hand that bakes nothing would get
// signed off. Naming them is why `tagHandList` is exported.
//
// ⚠ IT IS THE REAL BAKE AND NOT A PREVIEW OF ONE. `tagArtwork` is `bakeTagText` with the runs left
// out, so what is on this sheet is the canvas the decal layer uploads — there is no second painter
// here to disagree with the wall.
let _sheet = null;
export function tagSheet(opts = {}) {
  const { colour = '#ff6a4a', night = 0, marks = 3, cols = 5, scale = 0.5, pad = 10 } = opts;
  const words = opts.words || tagWordList();
  const cells = [];
  if (opts.hands === false) {
    // One row per colour scheme, because the scheme is picked off the variant and an author
    // choosing `v` is choosing between them without being told so.
    for (let s = 0; s < 3; s++) for (let i = 0; i < words.length; i++) {
      const tex = tagArtwork(words[i], colour, s + i * 3, night, marks, opts.hand || 'throw', opts.face || null);
      if (tex) cells.push({ tex, label: words[i] + ' · v' + (s + i * 3) });
    }
  } else if (opts.faces || opts.face) {
    // One row per letterform. A face only exists on the throw-up, so naming one makes every
    // cell a throw-up whatever the variant would have rolled.
    const faces = opts.face ? [opts.face] : tagFaceList();
    for (const f of faces) for (let i = 0; i < words.length; i++) {
      const tex = tagArtwork(words[i], colour, i * 3, night, marks, 'throw', f);
      if (tex) cells.push({ tex, label: f + ' · ' + words[i] });
    }
  } else {
    const hands = opts.hand ? [opts.hand] : tagHandList();
    for (const h of hands) for (let i = 0; i < words.length; i++) {
      const tex = tagArtwork(words[i], colour, i * 3, night, marks, h);
      if (tex) cells.push({ tex, label: h + ' · ' + words[i] });
    }
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

// ── A CANVAS, ON DISK — `__shot('name')` ──────────────────────────────────────────────────────
//
// The browser half of the server's /api/shot. It defaults to the street canvas because a
// look-decision is almost always about the street; pass a canvas or a selector for anything else.
//
// ⚠ AWAIT IT. `toBlob` is asynchronous, so a caller that fires and reloads the page pulls the
// document out from under an unfinished encode — which lands as a truncated PNG rather than as an
// error, and a truncated PNG of last night's config is indistinguishable from this one's until you
// open it.
export async function shot(name = 'shot', el = null) {
  const c = typeof el === 'string' ? document.querySelector(el) : (el || _canvas || document.querySelector('canvas'));
  if (!c) { console.warn('__shot: no canvas to shoot'); return null; }
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  const res = await fetch('/api/shot?name=' + encodeURIComponent(name), {
    method: 'POST', headers: { 'content-type': 'image/png' }, body: blob });
  const out = await res.json();
  console.log('__shot: ' + (out.file || out.error));
  return out;
}

if (typeof window !== 'undefined') {
  window.__street = street;
  window.__redtail = redtail;
  window.__streetHide = streetHide;
  window.__tagSheet = tagSheet;
  window.__tagSheetHide = tagSheetHide;
  window.__shot = shot;
}
