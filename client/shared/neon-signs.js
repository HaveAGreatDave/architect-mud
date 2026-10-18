// Hand-bent neon signs for GLASS, merged into NEON_ART (windshield.js) beside the traced Jolene's.
//
// Same run format as NEON_ART: a box `w` by `h` in the artwork's own units, baked `bake` pixels
// across, and a list of runs, each one colour of glass. Added here:
//
//   · `grp` on a run names the circuit it is on. A run with no `grp` is always lit at night.
//   · `seq` on the artwork is the flasher: a list of `{ on: [...grp], ms }` frames played in a loop.
//     A run whose circuit is off in the current frame is drawn as unlit glass, not left out, because
//     a dark tube is still a tube you can see from across the street.
//   · `dead: true` is a run that never lights: broken glass, or a transformer that went years ago.
//   · `glass` on the artwork (0..1) draws unlit tubes by day as pale glass, that far toward grey,
//     instead of as a dark line. Without it red neon on a red wall disappears at noon.
//
// Every frame is baked once and kept, so a sign costs its frame count in textures and nothing per
// frame after that. Keep `seq` short: five or six distinct frames is plenty.

// ── TUBE CAPITALS ──────────────────────────────────────────────────────────────────────────────
// Neon lettering is bent from one tube along the centreline of each stroke, so a letter is a path,
// not a glyph outline. A font's outline stroked would be a hollow double line. Each glyph is drawn
// in a box `s` tall and `GLYPH_W[ch] * s` wide, from its top-left corner, y down.
const GLYPH_W = { L: 0.52, I: 0.08, V: 0.62, E: 0.52, G: 0.62, R: 0.56, S: 0.56, X: 0.62, ' ': 0.34 };
const GLYPH = {
  L: (g, s) => { g.moveTo(0, 0); g.lineTo(0, s); g.lineTo(0.52 * s, s); },
  I: (g, s) => { g.moveTo(0.04 * s, 0); g.lineTo(0.04 * s, s); },
  V: (g, s) => { g.moveTo(0, 0); g.lineTo(0.31 * s, s); g.lineTo(0.62 * s, 0); },
  E: (g, s) => {
    g.moveTo(0.52 * s, 0); g.lineTo(0, 0); g.lineTo(0, s); g.lineTo(0.52 * s, s);
    g.moveTo(0, 0.5 * s); g.lineTo(0.4 * s, 0.5 * s);
  },
  G: (g, s) => {
    // Round the bowl anticlockwise from the top right, then in along the bar.
    g.moveTo(0.6 * s, 0.2 * s);
    g.bezierCurveTo(0.5 * s, -0.04 * s, 0.02 * s, -0.06 * s, 0, 0.5 * s);
    g.bezierCurveTo(0.02 * s, 1.06 * s, 0.6 * s, 1.06 * s, 0.62 * s, 0.56 * s);
    g.lineTo(0.34 * s, 0.56 * s);
  },
  R: (g, s) => {
    g.moveTo(0, s); g.lineTo(0, 0); g.lineTo(0.3 * s, 0);
    g.bezierCurveTo(0.6 * s, 0, 0.6 * s, 0.5 * s, 0.3 * s, 0.5 * s);
    g.lineTo(0, 0.5 * s);
    g.moveTo(0.28 * s, 0.5 * s); g.lineTo(0.56 * s, s);
  },
  S: (g, s) => {
    g.moveTo(0.54 * s, 0.14 * s);
    g.bezierCurveTo(0.42 * s, -0.04 * s, 0.02 * s, -0.04 * s, 0.03 * s, 0.25 * s);
    g.bezierCurveTo(0.04 * s, 0.5 * s, 0.56 * s, 0.44 * s, 0.56 * s, 0.74 * s);
    g.bezierCurveTo(0.56 * s, 1.04 * s, 0.1 * s, 1.04 * s, 0, 0.84 * s);
  },
  X: (g, s) => { g.moveTo(0, 0); g.lineTo(0.62 * s, s); g.moveTo(0.62 * s, 0); g.lineTo(0, s); },
};
const TRACK = 0.2;   // the gap between letters, as a fraction of the cap height
const tubeWidth = (word, s) => [...word].reduce((a, ch) => a + (GLYPH_W[ch] ?? 0.5) * s, 0) + (word.length - 1) * TRACK * s;
// A word in tube capitals, centred on `cx` with its cap line at `top`.
const tubeWord = (word, cx, top, s) => (g) => {
  let x = cx - tubeWidth(word, s) / 2;
  for (const ch of word) {
    const f = GLYPH[ch];
    if (f) { g.save(); g.translate(x, top); f(g, s); g.restore(); }
    x += ((GLYPH_W[ch] ?? 0.5) + TRACK) * s;
  }
};
// ⚠ `save`/`translate` INSIDE ONE PATH. The transform applies to the points as they are added, so
// the letters land where they should and the whole word still strokes as one path.

// A rounded frame cut into `n` dashes, every other one on circuit `a` and the rest on `b`: the
// two-circuit chaser every strip-club frame has, which reads as light running round the border.
function chaserFrame(x0, y0, x1, y1, r, n, c, glow, core, lw, a, b) {
  const pts = [];
  const W = x1 - x0, H = y1 - y0, per = 2 * (W + H - 4 * r) + 2 * Math.PI * r;
  const at = (t) => {   // a point at arc length t round the frame, clockwise from the top-left straight
    let d = ((t % per) + per) % per;
    const legs = [
      [W - 2 * r, (u) => [x0 + r + u, y0]],
      [Math.PI * r / 2, (u) => { const q = -Math.PI / 2 + u / r; return [x1 - r + r * Math.cos(q), y0 + r + r * Math.sin(q)]; }],
      [H - 2 * r, (u) => [x1, y0 + r + u]],
      [Math.PI * r / 2, (u) => { const q = u / r; return [x1 - r + r * Math.cos(q), y1 - r + r * Math.sin(q)]; }],
      [W - 2 * r, (u) => [x1 - r - u, y1]],
      [Math.PI * r / 2, (u) => { const q = Math.PI / 2 + u / r; return [x0 + r + r * Math.cos(q), y1 - r + r * Math.sin(q)]; }],
      [H - 2 * r, (u) => [x0, y1 - r - u]],
      [Math.PI * r / 2, (u) => { const q = Math.PI + u / r; return [x0 + r + r * Math.cos(q), y0 + r + r * Math.sin(q)]; }],
    ];
    for (const [len, f] of legs) { if (d <= len) return f(d); d -= len; }
    return [x0 + r, y0];
  };
  const seg = per / n;
  for (let i = 0; i < n; i++) pts.push({ t0: i * seg + seg * 0.18, t1: (i + 1) * seg - seg * 0.18, grp: i % 2 ? b : a });
  const dashes = (grp) => (g) => {
    for (const p of pts) {
      if (p.grp !== grp) continue;
      const [sx, sy] = at(p.t0); g.moveTo(sx, sy);
      for (let k = 1; k <= 6; k++) { const [qx, qy] = at(p.t0 + (p.t1 - p.t0) * k / 6); g.lineTo(qx, qy); }
    }
  };
  return [
    { c, glow, core, lw, grp: a, path: dashes(a) },
    { c, glow, core, lw, grp: b, path: dashes(b) },
  ];
}

const RED = { c: '#ff2a3c', glow: '#ff1030', core: '#ffe0e4' };
const PINK = { c: '#ff4fa8', glow: '#ff1e88', core: '#ffe4f2' };
const AMBER = { c: '#ffb43a', glow: '#ff8a10', core: '#fff0c8' };
const LEAF = { c: '#5ce07a', glow: '#22b84a', core: '#e2ffe8' };

export const NEON_SIGNS = {
  // ── THE CHERRY PIT ───────────────────────────────────────────────────────────────────────────
  // The room description is the brief: "the cherry in pink neon over the door has lost its stem and
  // half its lower curve, so what actually buzzes up there is a lopsided circle." So the stem and
  // the leaf are dark glass and so is the bottom-right of the fruit. The rest of the cherry buzzes
  // and stutters, the shine winks, and once a cycle the dead stem catches for a blink, which is the
  // tube trying. The name beside it is the one circuit in the place that has never failed.
  cherrypit: (() => {
    const CX = 92, CY = 120, R = 58;
    const arc = (a0, a1, r = R) => (g) => { g.moveTo(CX + r * Math.cos(a0), CY + r * Math.sin(a0)); g.arc(CX, CY, r, a0, a1); };
    const P = Math.PI;
    return {
      w: 440, h: 200, bake: 560, glass: 0.55,
      runs: [
        // Dead glass first, so the lit tubes' halo lands on top of it.
        { ...RED, lw: 7, dead: true, path: arc(0.12 * P, 0.62 * P) },   // the lower curve, gone
        { ...LEAF, lw: 6, dead: true, path: (g) => {                    // the leaf, gone
          g.moveTo(112, 34); g.quadraticCurveTo(150, 6, 172, 30); g.quadraticCurveTo(138, 52, 112, 34);
        } },
        { ...LEAF, lw: 6, grp: 'stem', path: (g) => {                   // the stem: dead, except when it isn't
          g.moveTo(CX + 2, CY - R + 4); g.quadraticCurveTo(CX + 4, 40, 128, 14);
        } },
        // The fruit: from the bottom-left round over the top and down to the right, with the dimple
        // where the stem goes in.
        { ...RED, lw: 7, grp: 'body', path: (g) => {
          g.moveTo(CX + R * Math.cos(0.62 * P), CY + R * Math.sin(0.62 * P));
          g.arc(CX, CY, R, 0.62 * P, 1.44 * P);
          g.quadraticCurveTo(CX - 4, CY - R + 2, CX + 2, CY - R + 10);
          g.quadraticCurveTo(CX + 8, CY - R + 2, CX + R * Math.cos(1.56 * P), CY + R * Math.sin(1.56 * P));
          g.arc(CX, CY, R, 1.56 * P, 2.12 * P);
        } },
        { c: '#ffd0e4', glow: '#ff6aa8', core: '#ffffff', lw: 5, grp: 'shine', path: arc(1.06 * P, 1.32 * P, 36) },
        // The name: a small "the" and the rest in script. Sacramento is a monoline script, so its
        // stroke is close enough to the centreline of a bent tube.
        { ...PINK, lw: 2.2, word: 'the', x: 246, y: 80, size: 40 },
        { ...PINK, lw: 2.6, word: 'Cherry Pit', x: 300, y: 146, size: 70 },
      ],
      seq: [
        { on: ['body', 'shine'], ms: 2200 },
        { on: [], ms: 70 },
        { on: ['body', 'shine'], ms: 120 },
        { on: [], ms: 60 },
        { on: ['body'], ms: 900 },
        { on: ['body', 'shine'], ms: 1500 },
        { on: ['body', 'shine', 'stem'], ms: 90 },
        { on: ['body', 'shine'], ms: 1300 },
      ],
    };
  })(),

  // ── LIVE GIRLS ───────────────────────────────────────────────────────────────────────────────
  // Two words on two circuits inside a two-circuit chaser. LIVE comes on, then GIRLS, the frame runs
  // the whole time, and every so often the lot flashes twice and holds.
  livegirls: (() => {
    const s1 = 54, s2 = 54;
    return {
      w: 300, h: 190, bake: 420, glass: 0.55,
      runs: [
        ...chaserFrame(10, 10, 290, 180, 22, 22, AMBER.c, AMBER.glow, AMBER.core, 5, 'a', 'b'),
        { ...RED, lw: 7, grp: 'live', path: tubeWord('LIVE', 150, 30, s1) },
        { ...PINK, lw: 7, grp: 'girls', path: tubeWord('GIRLS', 150, 30 + s1 + 22, s2) },
      ],
      seq: [
        { on: ['a', 'live'], ms: 450 },
        { on: ['b', 'live', 'girls'], ms: 450 },
        { on: ['a', 'live', 'girls'], ms: 450 },
        { on: ['b', 'live', 'girls'], ms: 450 },
        { on: ['a'], ms: 160 },
        { on: ['b', 'live', 'girls'], ms: 160 },
        { on: ['a'], ms: 160 },
        { on: ['b', 'live', 'girls'], ms: 450 },
        { on: ['a', 'live', 'girls'], ms: 450 },
        { on: ['b'], ms: 450 },
      ],
    };
  })(),

  // ── XXX ──────────────────────────────────────────────────────────────────────────────────────
  // One letter at a time, all three, gone, back. Each X is its own circuit.
  xxx: (() => {
    const s = 70, top = 16;
    const x = (i) => (g) => { g.save(); g.translate(32 + i * 86, top); GLYPH.X(g, s); g.restore(); };
    return {
      w: 280, h: 102, bake: 360, glass: 0.55,
      runs: [
        { ...RED, lw: 8, grp: 'x1', path: x(0) },
        { ...RED, lw: 8, grp: 'x2', path: x(1) },
        { ...RED, lw: 8, grp: 'x3', path: x(2) },
      ],
      seq: [
        { on: ['x1'], ms: 380 },
        { on: ['x1', 'x2'], ms: 380 },
        { on: ['x1', 'x2', 'x3'], ms: 1000 },
        { on: [], ms: 180 },
        { on: ['x1', 'x2', 'x3'], ms: 180 },
        { on: [], ms: 180 },
        { on: ['x1', 'x2', 'x3'], ms: 1600 },
        { on: [], ms: 500 },
      ],
    };
  })(),
};
