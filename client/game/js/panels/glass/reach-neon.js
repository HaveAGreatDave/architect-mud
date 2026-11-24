// The Reach's neon: the artwork of each sign in the frontier town, drawn with the neon kit.
//
// Timber and neon is the Reach's look (docs/proposals/reach-rebuild.md), and every sign pairs one
// western shape with one piece of circuit board. The arms in models/the-reach.js hang these on their
// fronts with `bakeNeonArt(id, night)`; this file only says what each sign looks like.
//
// Colours: amber is the warm western one, cyan the circuit, magenta the accent.
import { registerNeonArt } from './neon-kit.js';

export const REACH_AMBER = '#ff9526';
export const REACH_CYAN = '#38e4ff';
export const REACH_MAGENTA = '#ff3fb4';
const GOLD = '#ffb347';
const WESTERN = 'Rye,Playbill,"Rockwell Extra Bold","Bookman Old Style",Rockwell,Georgia,serif';
const ROUND = '"Varela Round","Arial Rounded MT Bold","Segoe UI",sans-serif';

// ── SHAPES ───────────────────────────────────────────────────────────────────────────────────────

// A five-pointed star, as a closed run of tube.
function starPts(cx, cy, r) {
  const p = [];
  for (let i = 0; i < 10; i++) {
    const a = -Math.PI / 2 + (i * Math.PI) / 5, k = i % 2 ? 0.45 : 1;
    p.push([cx + Math.cos(a) * r * k, cy + Math.sin(a) * r * k]);
  }
  return p;
}
// A cog: square teeth round a rim, as one closed tube.
function gearPts(cx, cy, r, teeth = 8) {
  const p = [], ro = r * 1.28;
  for (let i = 0; i < teeth; i++) {
    const a0 = (i / teeth) * Math.PI * 2, s = (Math.PI * 2) / teeth;
    for (const [f, rr] of [[0, r], [0.18, r], [0.24, ro], [0.56, ro], [0.62, r]]) {
      const a = a0 + s * f;
      p.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]);
    }
  }
  return p;
}

// ── THE COYOTE'S REST ────────────────────────────────────────────────────────────────────────────
//
// David's mock-up is the reference (docs/proposals/img/reach-coyote-sign.webp, 1024 px square), and
// the badge is laid out in its frame: every point below is a pixel of the mock, and `M` maps it onto
// this sign, scaled about the centre so the mock's rope ring lands on ours. A round badge on a disc
// of boards: a rope ring held by four riveted iron plates, circuit traces inside the rope, COYOTE'S
// climbing across the top and REST to the right in a western face with the tube running amber into
// cyan, the coyote howling in amber with panel and circuit lines through it, a saguaro, a star,
// three cogs and a tuft of grass, and SALOON & OUTPOST / EST. 2065 under it. The bar opened in 2065.

// The mock's rope ring is 392 px across the radius; ours is 0.468 of the sign.
const MK = 0.468 / (392 / 1024);
const M = (x, y) => [0.5 + (x / 1024 - 0.5) * MK, 0.5 + (y / 1024 - 0.5) * MK];
const Mp = (pts) => pts.map(([x, y]) => M(x, y));

// The coyote, traced off the mock: standing, rump low, the back climbing to the shoulders, the neck
// up and the muzzle thrown back with the jaw open, the ear laid back along the skull, a ruff at the
// nape, the brush hanging behind in flames, the hocks bent, the chest furred. One closed run,
// clockwise from the forehead.
const COYOTE = [
  [602, 368], [590, 375], [548, 399], [566, 409], [590, 410],                          // the ear
  [570, 423], [556, 431], [548, 433], [552, 440], [545, 449],                          // the ruff
  [487, 466], [436, 477], [400, 491], [374, 513], [356, 542], [345, 568],              // back, rump
  [312, 601], [276, 623], [247, 637], [229, 653],                                      // the brush
  [250, 657], [244, 664], [268, 652], [266, 661], [288, 642], [290, 650], [310, 630], [322, 620],
  [320, 674], [312, 703], [312, 733], [349, 735], [343, 721], [338, 695], [345, 666], // far hind leg
  [374, 615], [400, 681], [418, 710], [429, 728], [433, 735], [473, 735], [458, 721], // near hind leg
  [436, 692], [422, 659], [436, 615], [458, 583], [502, 588], [531, 601],              // flank, belly
  [537, 644], [541, 692], [541, 735], [575, 735], [571, 716], [575, 660], [585, 604], // far foreleg
  [588, 620], [595, 692], [603, 735], [644, 735], [617, 700], [619, 660],              // near foreleg
  [627, 580], [638, 533], [648, 510], [662, 500], [655, 490], [668, 480], [660, 470], [666, 453], // chest fur
  [678, 418], [688, 399], [697, 386], [700, 375], [692, 370], [688, 359], [685, 341], // throat, jaw
  [677, 322], [665, 328], [651, 338], [636, 347], [616, 356],                          // nose, muzzle
];
// What's drawn inside the outline, as the mock draws it. The mouth line is what makes the head read
// in depth: the far side of the open mouth shows between it and the outline.
const COYOTE_LINES = [
  [[681, 342], [669, 380], [694, 377]],                     // the mouth
  [[568, 403], [590, 402], [596, 397]],                     // inside the ear
  [[623, 372], [633, 364], [640, 361], [634, 370], [623, 372]],   // the eye
  [[621, 378], [623, 410], [619, 458]],                     // face panels
  [[640, 374], [638, 410], [637, 424]],
  [[606, 600], [604, 700], [612, 728]],                     // the legs' inner lines
  [[553, 612], [552, 700], [558, 728]],
  [[331, 662], [325, 725]],
  [[425, 650], [445, 700], [455, 726]],
];
// The circuit in its body: angular panel lines, each ending in a pad.
const COYOTE_TRACES = [
  [[545, 470], [560, 505], [560, 560], [580, 585]],
  [[590, 470], [600, 520], [612, 545]],
  [[392, 525], [372, 570], [382, 615]],
  [[430, 500], [470, 520], [520, 520], [530, 545]],
];

// The artwork, with the few numbers a comparison turns (the coyote's tube gauges, and which of its
// inside lines are drawn) as options, so variants can be laid side by side in a browser.
export function coyotesRestArt({ coyW = 0.010, lineW = 0.007, traceW = 0.004, skip = [], nameCy = 1.085, nameSize = 0.155, fill = 0.32 } = {}) { return (pen) => {
  const R = 0.485, RO = 0.468, RI = 0.43, C = 0.5;
  // The board: a disc of vertical planks, weathered, then the rope and the plates.
  pen.board((g, X, Y, S, shade) => {
    g.beginPath(); g.arc(X(C), Y(C), R * S, 0, Math.PI * 2); g.closePath();
    g.fillStyle = shade('#2b2018'); g.fill();
    g.save(); g.clip();
    for (let i = 0; i < 9; i++) {   // planks, each its own tone, and the seams between them
      const x0 = X(0.02 + i * 0.108);
      g.fillStyle = shade([38 + (i * 37) % 17, 28 + (i * 23) % 11, 20 + (i * 13) % 7]);
      g.fillRect(x0, 0, X(0.104), Y(1));
      g.fillStyle = shade('#120c08', 0.9); g.fillRect(x0 - 1, 0, 2, Y(1));
    }
    g.restore();
    // The rope: a tan band with the twist laid across it.
    g.lineWidth = (R - RI) * S * 0.86;
    g.strokeStyle = shade('#9c7446');
    g.beginPath(); g.arc(X(C), Y(C), ((RO + RI) / 2) * S, 0, Math.PI * 2); g.stroke();
    g.lineWidth = Math.max(1, S * 0.004); g.strokeStyle = shade('#4a321c', 0.9);
    const n = 120;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2, b = a + 0.05;
      g.beginPath();
      g.moveTo(X(C + Math.cos(a) * RI), Y(C + Math.sin(a) * RI));
      g.lineTo(X(C + Math.cos(b) * RO), Y(C + Math.sin(b) * RO));
      g.stroke();
    }
    // Four iron plates holding the rope at the quarters, each with two rivets.
    for (let q = 0; q < 4; q++) {
      const a = (q * Math.PI) / 2 - Math.PI / 2;
      g.save();
      g.translate(X(C + Math.cos(a) * ((RO + RI) / 2)), Y(C + Math.sin(a) * ((RO + RI) / 2)));
      g.rotate(a + Math.PI / 2);
      const w = S * 0.085, h = S * 0.062;
      g.fillStyle = shade('#5a4c44'); g.fillRect(-w / 2, -h / 2, w, h);
      g.strokeStyle = shade('#2a201c'); g.lineWidth = Math.max(1, S * 0.004); g.strokeRect(-w / 2, -h / 2, w, h);
      g.fillStyle = shade('#8a5a34', 0.6); g.fillRect(-w / 2, h * 0.1, w, h * 0.4);   // rust run
      for (const sx of [-0.28, 0.28]) {
        g.beginPath(); g.arc(sx * w, 0, S * 0.009, 0, Math.PI * 2);
        g.fillStyle = shade('#a89a8a'); g.fill();
      }
      g.restore();
    }
  });
  // Circuit inside the rope: four arcs broken at the plates, each end on a pad, and a stub or two
  // turning in toward the middle.
  const RC = 0.415;
  for (let q = 0; q < 4; q++) {
    const a0 = (q * Math.PI) / 2 - Math.PI / 2 + 0.2, a1 = a0 + Math.PI / 2 - 0.4, pts = [];
    for (let i = 0; i <= 24; i++) { const a = a0 + (a1 - a0) * (i / 24); pts.push([C + Math.cos(a) * RC, C + Math.sin(a) * RC]); }
    pen.tube(pts, { color: REACH_CYAN, w: 0.0065 });
    pen.pad(pts[0][0], pts[0][1], 0.008, { color: REACH_CYAN });
    pen.pad(pts[24][0], pts[24][1], 0.008, { color: REACH_CYAN });
  }
  // Cyan traces in the field, as the mock runs them behind the animal.
  for (const tr of [[[330, 395], [420, 370], [470, 380], [520, 350]], [[700, 650], [810, 625], [840, 625]], [[690, 455], [745, 440], [770, 450]]]) {
    const p = Mp(tr);
    pen.tube(p, { color: REACH_CYAN, w: 0.005 });
    pen.pad(p[p.length - 1][0], p[p.length - 1][1], 0.007, { color: REACH_CYAN });
  }
  // The saguaro, the star, the grass and the cogs, each where the mock puts it.
  pen.tube(Mp([[248, 615], [248, 470]]), { color: REACH_AMBER, w: 0.012 });
  pen.tube(Mp([[248, 572], [225, 572], [225, 522]]), { color: REACH_AMBER, w: 0.010 });
  pen.tube(Mp([[248, 556], [278, 556], [278, 502]]), { color: REACH_AMBER, w: 0.010 });
  { const [sx, sy] = M(318, 470); pen.tube(starPts(sx, sy, 0.034), { color: REACH_AMBER, w: 0.008, closed: true }); }
  pen.tube(Mp([[262, 740], [258, 705]]), { color: GOLD, w: 0.005 });
  pen.tube(Mp([[270, 740], [276, 712]]), { color: GOLD, w: 0.005 });
  pen.tube(Mp([[278, 740], [292, 722]]), { color: GOLD, w: 0.005 });
  for (const [x, y, r, t] of [[773, 408, 0.036, 8], [712, 712, 0.042, 8], [775, 672, 0.022, 6]]) {
    const [gx, gy] = M(x, y);
    pen.tube(gearPts(gx, gy, r, t), { color: REACH_AMBER, w: 0.007, closed: true });
    pen.ring(gx, gy, r * 0.4, { color: REACH_AMBER, w: 0.006 });
  }
  // The coyote, its lines, its circuit and the ground it stands on.
  // The coyote's glow comes first, under its tubes: what makes it read as one bright animal, as
  // the mock's does, rather than as wire.
  if (fill > 0) pen.glow(Mp(COYOTE), { color: '#ff8a1c', a: fill });
  pen.tube(Mp(COYOTE), { color: REACH_AMBER, color2: '#ffc04a', w: coyW, closed: true, id: 'coyote' });
  COYOTE_LINES.forEach((ln, i) => { if (!skip.includes(i)) pen.tube(Mp(ln), { color: REACH_AMBER, w: lineW }); });
  for (const tr of COYOTE_TRACES) {
    const p = Mp(tr);
    pen.tube(p, { color: '#ffb23a', w: traceW });
    pen.pad(p[p.length - 1][0], p[p.length - 1][1], 0.006, { color: '#ffb23a' });
  }
  pen.tube(Mp([[255, 748], [700, 748]]), { color: GOLD, w: 0.006 });
  // The name. COYOTE'S climbs across the top on a long curve; REST stands to the right of the howl.
  pen.text("COYOTE'S", 0.5, 0, { arc: { cx: 0.656, cy: nameCy, r: 0.9, a0: -0.17 }, size: nameSize, face: WESTERN, color: REACH_AMBER, color2: REACH_CYAN, run: [0.5, 0.92], w: 0.0105, maxW: 0.70, id: 'name' });
  { const [rx, ry] = M(785, 552); pen.text('REST', rx, ry, { size: 0.165, face: WESTERN, color: REACH_AMBER, color2: REACH_CYAN, run: [0.5, 0.92], w: 0.0105, maxW: 0.30, id: 'rest' }); }
  { const [tx, ty] = M(512, 786); pen.text('SALOON & OUTPOST', tx, ty, { size: 0.062, face: ROUND, color: REACH_CYAN, w: 0.0055, maxW: 0.42, track: 0.04 }); }
  { const [tx, ty] = M(512, 830); pen.text('EST. 2065', tx, ty, { size: 0.05, face: ROUND, color: GOLD, w: 0.005, maxW: 0.2, track: 0.08 }); }
}; }
registerNeonArt('reach.coyotesrest', coyotesRestArt(), { w: 1024, h: 1024 });

// ── THE COYOTE'S REST, SMALL SIGNS ───────────────────────────────────────────────────────────────
//
// A round lightbox for the porch, hung under the gallery either side of the door: a pale disc with
// COLD BEER round a bottle, the painted plate kind of light rather than tube.
registerNeonArt('reach.colddisc', (pen) => {
  pen.board((g, X, Y, S, shade) => {
    g.beginPath(); g.arc(X(0.5), Y(0.5), S * 0.47, 0, Math.PI * 2);
    g.fillStyle = shade('#2a2320'); g.fill();
    g.beginPath(); g.arc(X(0.5), Y(0.5), S * 0.42, 0, Math.PI * 2);
    g.fillStyle = pen.lit ? 'rgba(236,228,206,1)' : shade('#cdc3a8'); g.fill();
    g.beginPath(); g.arc(X(0.5), Y(0.5), S * 0.42, 0, Math.PI * 2);
    g.lineWidth = S * 0.03; g.strokeStyle = pen.lit ? '#c8321e' : shade('#8a2a1c'); g.stroke();
    // the bottle, painted
    g.fillStyle = pen.lit ? '#6a3a18' : shade('#5a3418');
    g.beginPath(); g.moveTo(X(0.46), Y(0.22)); g.lineTo(X(0.54), Y(0.22)); g.lineTo(X(0.54), Y(0.36));
    g.quadraticCurveTo(X(0.62), Y(0.42), X(0.61), Y(0.5)); g.lineTo(X(0.61), Y(0.78)); g.lineTo(X(0.39), Y(0.78));
    g.lineTo(X(0.39), Y(0.5)); g.quadraticCurveTo(X(0.38), Y(0.42), X(0.46), Y(0.36)); g.closePath(); g.fill();
    g.fillStyle = pen.lit ? '#f2e2b0' : shade('#d8c89a'); g.fillRect(X(0.40), Y(0.52), X(0.20), Y(0.14));
  });
  pen.text('COLD', 0.5, 0.0, { arc: { cx: 0.5, cy: 0.5, r: 0.3 }, size: 0.15, face: WESTERN, color: '#d83a22', w: 0.012, maxW: 0.5 });
}, { w: 256, h: 256 });

// A holo screen beside the door: a cyan panel with a pint drawn on it in light, scan lines and a
// frame. Unlit it's a dark screen with the frame.
registerNeonArt('reach.holopint', (pen) => {
  pen.board((g, X, Y, S, shade) => {
    g.fillStyle = shade('#1c2024'); g.fillRect(0, 0, X(1), Y(1));
    if (pen.lit) {
      const gr = g.createLinearGradient(0, 0, 0, Y(1));
      gr.addColorStop(0, 'rgba(40,200,240,0.55)'); gr.addColorStop(1, 'rgba(20,90,140,0.4)');
      g.fillStyle = gr; g.fillRect(X(0.06), Y(0.05), X(0.88), Y(0.9));
      g.fillStyle = 'rgba(180,250,255,0.10)';
      for (let y = 0.06; y < 0.95; y += 0.035) g.fillRect(X(0.06), Y(y), X(0.88), Math.max(1, Y(0.008)));
    } else {
      g.fillStyle = shade('#283038'); g.fillRect(X(0.06), Y(0.05), X(0.88), Y(0.9));
    }
  });
  // the pint: glass, foam and the handle, in pale cyan light
  pen.tube([[0.32, 0.30], [0.36, 0.80], [0.64, 0.80], [0.68, 0.30]], { color: '#bff6ff', w: 0.03 });
  pen.tube([[0.30, 0.30], [0.36, 0.20], [0.46, 0.24], [0.54, 0.18], [0.64, 0.22], [0.70, 0.30]], { color: '#ffffff', w: 0.026, smooth: true });
  pen.tube([[0.68, 0.40], [0.80, 0.42], [0.80, 0.62], [0.66, 0.66]], { color: '#bff6ff', w: 0.026 });
  pen.text('ON TAP', 0.5, 0.91, { size: 0.09, face: ROUND, color: REACH_CYAN, w: 0.012, maxW: 0.7 });
}, { w: 256, h: 384 });
