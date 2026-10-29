// SPORTS CARD PHOTOS: the man on the card, shot in his own park and printed.
//
// The server draws every card (plugins/cards/sports.js) with an SVG photo, and stamps the photo
// with what a camera needs (`data-photo`: league, name, position, club, pose). This shoots that
// man in GLASS 2, the renderer the broadcasts use, so the card has the face, sweater and number
// he has on the air: Deadball's in the Grandstand's park (gl/ballpark.js), the CPhL's on the
// rink (gl/arena.js). Both key a man's face off his name, so nothing here picks a look.
//
// Then it prints him: the frame is separated into cyan, magenta, yellow and black and each is
// laid down as a rotated dot screen on card stock, a plate a little off register, with paper
// grain. That's what takes the cel render to a card: a picture that was printed, not drawn.
//
// ⚠ ONE SHOT AT A TIME, ONE RENDERER PER LEAGUE, MADE ON THE FIRST CARD. A park is a big build
// (its bowl, its city, its crowd), so it's made once and kept; the shots queue behind it. A
// renderer that won't build (no WebGL2) answers null and the card keeps its SVG.
// ⚠ THE CANVAS IS READ IN THE SAME TASK AS THE DRAW. Neither renderer keeps its drawing buffer
// unless asked (the park is asked; the rink's copy is taken straight after its render).

export const PHOTO_W = 300, PHOTO_H = 360;      // the card's photo window is 100 × 120
const SHOT_K = 2;                               // rendered at twice the print, for the screen

const cache = new Map();                        // key -> Promise<dataURL | null>
let chain = Promise.resolve();

export function photoKey(s) { return [s.league, s.name, s.team, s.pos, s.num, s.art, s.pose].join('|'); }

// The printed photo for a card's `data-photo` spec, as a data URL, or null if it can't be shot.
export function cardPhoto(spec) {
  const key = photoKey(spec);
  let p = cache.get(key);
  if (!p) {
    p = chain = chain.then(() => shoot(spec)).catch((err) => { console.warn('[cards] photo failed:', err?.message || err); return null; });
    cache.set(key, p);
  }
  return p;
}

async function shoot(spec) {
  const raw = spec.league === 'hockey' ? await rinkShot(spec) : await parkShot(spec);
  return raw ? printPhoto(raw, spec) : null;
}

// ── the clubs ──────────────────────────────────────────────────────────────────
// The kit comes off club-crest.js's store, which the broadcasts fill. A tablet opened before any
// broadcast has none, so the card's own club (the server sends it with the spec) goes in beside
// whatever's held, under no revision, so the next payload's stamp still fetches the real set.
async function holdClub(sport, club) {
  if (club?.name) (await import('./club-crest.js')).holdClub(sport, club);
}

// ── Deadball: the Grandstand ───────────────────────────────────────────────────
let park = null;
async function parkRenderer() {
  if (park) return park;
  park = (async () => {
    const { createBallparkRenderer } = await import('./gl/ballpark.js');
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W * SHOT_K; canvas.height = PHOTO_H * SHOT_K;
    const R = createBallparkRenderer(canvas, { preserve: true, crowd: 1, ads: ['DEADBALL', 'THE GRANDSTAND', 'DEADBALL', 'SEASON SET'] });
    if (!R) return null;
    // a day game: the card's sky, not the floods
    R.setHour?.(15);
    R.quality.exposure = 0.86;
    return { R, canvas };
  })();
  return park;
}

export const CAM = { dist: 6, headY: 5.45, rise: 0.25, fov: 22, three: 0.38, actPad: 1.22, actFov: 30, dof: 0, debug: false, last: null };
const ACTION_POSE = { swing: 'batLoad', pitch: 'pRelease', catch: 'catcher', field: 'infield', leap: 'outfield' };

async function parkShot(spec) {
  const P = await parkRenderer();
  if (!P) return null;
  const { R, canvas } = P;
  await holdClub('baseball', spec.club);
  const { castOf } = await import('./gl/ballpark.js');
  const { DEG } = await import('./diamond/geo.js');
  const pitcher = spec.pos === 'P';
  const team = spec.team || 'Deadball';
  // his club in the field or at bat, by his trade; the other side wears the house kit
  const p = pitcher
    ? { half: 'top', inning: 1, pitcher: spec.name, fieldingTeam: team, battingTeam: 'Visitors', batter: null, bats: 'R', throws: 'R', basesBefore: [false, false, false] }
    : { half: 'top', inning: 1, batter: spec.name, battingTeam: team, fieldingTeam: 'Home', pitcher: 'Home:P', bats: 'R', throws: 'R', basesBefore: [false, false, false] };
  const cast = castOf(p);
  R.setCast(cast, pitcher ? { home: team, away: 'Visitors' } : { home: 'Home', away: team });
  const man = cast.find((c) => c.id === spec.name);
  if (!man) return null;
  const action = spec.art === 'action';
  // a portrait is posed, standing square to the camera; an action shot is his trade's
  const pose = action ? (ACTION_POSE[spec.pose] || man.pose) : 'stand';
  const { POSES } = await import('./diamond/rig.js');
  const solved = { ...(POSES[pose] || POSES[man.pose])(), at: man.at, yaw: man.yaw, scale: man.scale, mirror: man.mirror };
  R.setPose(man.look.slot, solved);
  while (R.pending() && R.pump(200));
  R.setPose(man.look.slot, solved);
  // the camera. A portrait: at his head, a little off square. An action shot: the whole man,
  // framed on the box round his solved joints (a pose can put him metres off his mark, a pitcher
  // in his stride most of all), from between his chest and where he's looking.
  const s = man.scale || 1, yaw = man.yaw * DEG;
  const gaze = pitcher ? Math.PI : 0;                  // the plate is down -z, the mound up +z
  const turn = ((gaze - yaw + 3 * Math.PI) % (2 * Math.PI)) - Math.PI;
  const az = action ? yaw + turn * 0.35 : yaw + CAM.three;
  let focus, dist;
  if (action) {
    const { solvePose } = await import('./diamond/rig.js');
    const lo = [Infinity, Infinity, Infinity], hi = [-Infinity, -Infinity, -Infinity];
    for (const [k, v] of Object.entries(solvePose(solved).J)) {
      if (!Array.isArray(v) || /pole|dir|palm/.test(k)) continue;
      for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], v[i]); hi[i] = Math.max(hi[i], v[i]); }
    }
    hi[1] += 0.55 * s;                                 // the crown of his cap over the head joint
    lo[1] = Math.min(lo[1], man.at[1]);                // and his boots on the ground
    focus = [(lo[0] + hi[0]) / 2, (lo[1] + hi[1]) / 2, (lo[2] + hi[2]) / 2];
    // across the frame: the box's width seen from this side, at the photo's aspect
    const across = Math.abs((hi[0] - lo[0]) * Math.cos(az)) + Math.abs((hi[2] - lo[2]) * Math.sin(az));
    const need = Math.max(hi[1] - lo[1], across * PHOTO_H / PHOTO_W) * CAM.actPad;
    dist = need / 2 / Math.tan(CAM.actFov * Math.PI / 360);
  } else {
    focus = [man.at[0], man.at[1] + CAM.headY * s, man.at[2]];
    dist = CAM.dist * s;
  }
  const eye = [focus[0] + Math.sin(az) * dist, focus[1] + (action ? 0.8 : CAM.rise), focus[2] + Math.cos(az) * dist];
  R.render({ eye, at: focus, fov: action ? CAM.actFov : CAM.fov, near: 0.4, dof: CAM.dof, shadow: [focus, 9] });
  if (CAM.debug) CAM.last = copyOf(canvas);
  return copyOf(canvas);
}

// ── Cluster Puck: the rink ─────────────────────────────────────────────────────
export const RINK = { face: 0, three: 0.35, dist: 6, headY: 5.75, goalieY: 4.2, rise: 0.15, fov: 26, actDist: 15, actY: 3, actFov: 30 };
const RINK_ACT = { shot: ['slap', 0.5], check: ['check', 0.55], save: ['butterfly', 0.6] };
let rink = null;
async function rinkRenderer() {
  if (rink) return rink;
  rink = (async () => {
    const [T, S, A] = await Promise.all([import('./rink/textures.js'), import('./rink/sim.js'), import('./gl/arena.js')]);
    const canvas = document.createElement('canvas');
    canvas.width = PHOTO_W * SHOT_K; canvas.height = PHOTO_H * SHOT_K;
    const ice = T.createIce(document);
    const W = S.createWorld(ice, 'cardshot');
    W.crowd = 0.6;
    const R = A.createArenaRenderer(canvas, null, W, ice);
    if (!R) return null;
    R.quality.dpr = 1;
    return { R, W, canvas };
  })();
  return rink;
}

async function rinkShot(spec) {
  const P = await rinkRenderer();
  if (!P) return null;
  const { R, W, canvas } = P;
  await holdClub('hockey', spec.club);
  const [{ kitFor }, { GOAL_X, MID_Y }] = await Promise.all([import('./rink/director.js'), import('./rink/geo.js')]);
  const colours = spec.club?.colours || null;
  W.kits.h = kitFor(colours, 'h', spec.team);
  W.kits.a = kitFor(null, 'a');
  const goalie = spec.pos === 'G';
  const man = goalie ? W.goalie.h : W.team.h[0];
  const surname = String(spec.name).split(/\s+/).pop();
  man.name = surname; man.num = spec.num;
  man.faceKey = spec.name;
  // settle the sheet so every body has joints, then stand him at centre ice, turned to the
  // camera, with everybody else down the far end. A goalie's save is made in his crease: he's
  // shot from the slot with his own net behind him, and everybody else goes the other way.
  for (let i = 0; i < 30; i++) W.step(1 / 60);
  const inNet = goalie && spec.art === 'action';
  const x = inNet ? GOAL_X[1] - 3 : 100, y = inNet ? MID_Y : 30, h = inNet ? Math.PI : RINK.face;
  const hold = () => {
    const others = [...W.team.a, ...W.team.h, W.goalie.a, W.goalie.h, ...W.officials, ...W.extras];
    others.forEach((b, i) => { if (b && b !== man) { b.x = (inNet ? 15 : 175) + (i % 4) * 3; b.y = 15 + (i % 9) * 6; } });
    man.x = x; man.y = y; man.vx = 0; man.vy = 0; man.h = h;
  };
  for (let i = 0; i < 4; i++) { hold(); W.step(1 / 60); }
  hold();
  // an action shot catches him mid-move: a slapper at the top of the wind-up, a check as it
  // lands, a goalie down in the butterfly. The act is held there for the render.
  const act = spec.art === 'action' && RINK_ACT[spec.pose];
  if (act) { W.act(man, act[0], 60); man.actT = act[1]; W.step(1 / 60); hold(); man.actT = act[1]; }
  // the camera: a seat (camera.js seatFrame), which is a free eye; yaw is from +y toward +x
  const action = spec.art === 'action';
  const dist = action ? RINK.actDist : RINK.dist, hy = action ? RINK.actY : goalie ? RINK.goalieY : RINK.headY;
  const az = h + RINK.three;
  const eye = [x + Math.cos(az) * dist, y + Math.sin(az) * dist, hy + RINK.rise];
  const dx = x - eye[0], dy = y - eye[1];
  R.seat = { eye, mode: 'free', yaw: Math.atan2(dx, dy), pitch: Math.atan2(RINK.rise, Math.hypot(dx, dy)), fov: action ? RINK.actFov : RINK.fov };
  W.cam.mode = 'winner'; W.cam.focus = [x, y];
  R.render(performance.now());
  if (CAM.debug) CAM.last = copyOf(canvas);
  return copyOf(canvas);
}

function copyOf(src) {
  const c = document.createElement('canvas');
  c.width = src.width; c.height = src.height;
  c.getContext('2d').drawImage(src, 0, 0);
  return c;
}

// ── the print ──────────────────────────────────────────────────────────────────
// Four plates on card stock. Each pixel of the print asks, per plate, which dot of that plate's
// rotated screen it's in, how big that dot is (the plate's coverage at the dot's centre, as area),
// and whether it falls inside it; the inks then multiply down onto the paper. The source is
// boosted a little first (contrast and saturation), as a separation for cheap stock is, so the
// dots don't wash the picture out.
const PLATES = [
  { ink: [0, 0.6, 0.86], angle: 15, dx: 0.6, dy: 0 },      // cyan
  { ink: [0.86, 0.12, 0.5], angle: 75, dx: 0, dy: 0.5 },  // magenta
  { ink: [1, 0.88, 0.08], angle: 0, dx: -0.4, dy: 0 },     // yellow
  { ink: [0.11, 0.1, 0.1], angle: 45, dx: 0, dy: 0 },     // black
];
const PAPER = [0.95, 0.92, 0.85];
export const PRINT_TUNE = { cell: 2.4, gain: 1.1, sat: 1.12, grain: 0.03, under: 0.18, screen: 0.5, rink: 1.45 };

export function printPhoto(src, spec = {}) {
  const W = PHOTO_W, H = PHOTO_H, T = PRINT_TUNE;
  // the source at print size, boosted
  const s = document.createElement('canvas'); s.width = W; s.height = H;
  const sx = s.getContext('2d', { willReadFrequently: true });
  // the rink is lit for broadcast, not for print; it goes up a stop so the ice reads white
  sx.filter = `brightness(${spec.league === 'hockey' ? T.rink : 1}) contrast(${T.gain}) saturate(${T.sat})`;
  sx.drawImage(src, 0, 0, W, H);
  const S = sx.getImageData(0, 0, W, H).data;
  // the separation: CMY from the colour, black taken out of the three as grey-component replacement
  const sep = [new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H), new Float32Array(W * H)];
  for (let i = 0; i < W * H; i++) {
    const c = 1 - S[i * 4] / 255, m = 1 - S[i * 4 + 1] / 255, y = 1 - S[i * 4 + 2] / 255;
    const k = Math.min(c, m, y) * 0.9;
    sep[0][i] = c - k; sep[1][i] = m - k; sep[2][i] = y - k; sep[3][i] = k;
  }
  const at = (pl, x, y) => {
    const xi = Math.max(0, Math.min(W - 1, x | 0)), yi = Math.max(0, Math.min(H - 1, y | 0));
    return sep[pl][yi * W + xi];
  };
  const out = sx.createImageData(W, H), O = out.data;
  const cell = T.cell, rnd = seeded(spec.name || 'card');
  const trig = PLATES.map((p) => [Math.cos(p.angle * Math.PI / 180), Math.sin(p.angle * Math.PI / 180)]);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let r = PAPER[0], g = PAPER[1], b = PAPER[2];
      for (let pl = 0; pl < 4; pl++) {
        const P = PLATES[pl], [cs, sn] = trig[pl];
        const px = x + 0.5 + P.dx, py = y + 0.5 + P.dy;
        // into the screen's frame, to the dot's centre, and back out to read the plate there
        const u = (px * cs + py * sn) / cell, v = (-px * sn + py * cs) / cell;
        const cu = Math.floor(u) + 0.5, cv = Math.floor(v) + 0.5;
        const ox = (cu * cs - cv * sn) * cell, oy = (cu * sn + cv * cs) * cell;
        const val = at(pl, ox, oy);
        // a dot whose area is the coverage; past half the dots join, which the distance does itself
        const rad = Math.sqrt(val / Math.PI) * 1.02;
        const d = Math.hypot(u - cu, v - cv);
        let cover = Math.max(0, Math.min(1, (rad - d) * cell + 0.5));
        // a little of the plate as a flat tint under the dots, so the shadows hold together
        cover = Math.max(cover, val * T.under);
        if (cover <= 0) continue;
        r *= 1 - cover * (1 - P.ink[0]); g *= 1 - cover * (1 - P.ink[1]); b *= 1 - cover * (1 - P.ink[2]);
      }
      // the screen over the colour it was separated from, on the paper's tint: the dots read
      // as print without washing the picture out
      const k = T.screen, si = (y * W + x) * 4;
      r = r * k + (S[si] / 255) * PAPER[0] * (1 - k);
      g = g * k + (S[si + 1] / 255) * PAPER[1] * (1 - k);
      b = b * k + (S[si + 2] / 255) * PAPER[2] * (1 - k);
      const n = (rnd() - 0.5) * T.grain;
      const o = (y * W + x) * 4;
      O[o] = Math.max(0, Math.min(255, (r + n) * 255));
      O[o + 1] = Math.max(0, Math.min(255, (g + n) * 255));
      O[o + 2] = Math.max(0, Math.min(255, (b + n * 0.8) * 255));
      O[o + 3] = 255;
    }
  }
  sx.filter = 'none';
  sx.putImageData(out, 0, 0);
  return s.toDataURL('image/jpeg', 0.86);
}

function seeded(str) {
  let a = 2166136261;
  for (const ch of String(str)) { a ^= ch.charCodeAt(0); a = Math.imul(a, 16777619); }
  return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
