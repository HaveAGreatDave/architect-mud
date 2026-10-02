// AUTHORED_DETAIL: how each detail kind draws.
//
// A model's `detail` list hangs parts on its surfaces (a pipe, a run of pilasters, a sign board,
// neon art), and detailLayer in windshield.js draws them for any model, hand-written arm or
// authored. The kinds are declared once in DETAIL_SCHEMA (client/shared/building-model-schema.js);
// this file is how each one draws, with the neon-art textures and the colour helpers they use.
// Moved out of windshield.js on 2026-10-01.
import {
  DETAIL_LIFT, FACE_EPS, MESH_SINK, NEON_ART, RENDER_TUNE, SHAPE_SINK, SIGN_BOARD_OUT, STROKE_SINK,
  TAG_WALL_MARGIN, TUNE, WALL_COL, bakeSignText, bakeTagText, bracketCol, clamp, dRand, detailQuad,
  dripStain, emitLightRunner, emitSurfaceText, faceY, glowPool, hexRgb, mix, nearOrMesh, powerNight,
  rgb, signLabel, tagHandFor, tagWordFor, texCanvas, wallSpanAt,
} from '../windshield.js';
import { DETAIL_SCHEMA } from '../../../../shared/building-model-schema.js';

const _neonArtTex = new Map();
function neonArtTex(name, lit) {
  const art = NEON_ART[name];
  if (!art) return null;
  const key = name + '|' + (lit ? 1 : 0);
  let c = _neonArtTex.get(key);
  if (c) return c;
  const pad = 14, S = (art.bake || art.w) / art.w;
  c = texCanvas(Math.round(art.w * S) + pad * 2, Math.round(art.h * S) + pad * 2);
  const g = c.getContext(String.fromCharCode(50, 100));
  g.translate(pad, pad); g.scale(S, S);
  g.lineCap = 'round'; g.lineJoin = 'round';
  const stroke = (run, col, lw, blur) => {
    // `shadowBlur` is in canvas pixels and ignores the transform, so it is scaled here.
    g.strokeStyle = col; g.fillStyle = col; g.lineWidth = lw; g.shadowColor = blur ? (run.glow || run.c) : 'transparent'; g.shadowBlur = blur * S;
    if (run.word) {
      g.font = neonScriptFont(run.size); g.textAlign = 'center'; g.textBaseline = 'alphabetic';
      g.strokeText(run.word, run.x, run.y);
    } else { g.beginPath(); run.path(g); g.stroke(); }
  };
  for (const run of art.runs) {
    if (lit) {
      g.globalAlpha = 0.4; stroke(run, run.glow || run.c, run.lw * 2.4, 22); g.globalAlpha = 1;   // the halo
      stroke(run, run.c, run.lw, 5);                                                                // the tube
      stroke(run, run.core || 'rgba(255,248,236,0.85)', Math.max(1 / S, run.lw * 0.42), 0);         // the core
    } else {
      stroke(run, 'rgba(30,26,24,0.55)', run.lw + 2, 0);   // the tube's own shadow on the wall
      stroke(run, neonDim(run.c, 0.55), run.lw, 0);
    }
  }
  c._lit = lit ? 1 : 0;
  _neonArtTex.set(key, c);
  return c;
}
function neonScriptFont(px) { return `${Math.round(px)}px Sacramento,"Segoe Script","Brush Script MT",cursive`; }
function neonDim(hex, k) {
  const n = parseInt(hex.slice(1), 16);
  return `rgb(${Math.round(((n >> 16) & 255) * k)},${Math.round(((n >> 8) & 255) * k)},${Math.round((n & 255) * k)})`;
}

export const AUTHORED_DETAIL = {
  // A neon picture on stand-off rails. The rails are metal and go in the mesh; the glass is a baked
  // canvas mapped onto the wall exactly as sign lettering is, so it takes the same fit and bloom.
  neonArt: (c, d) => {
    const half = c.V(d.half), hh = c.V(d.hh), z = c.V(d.z), y = faceY(c.ly), out = c.ly < 0 ? -1 : 1;
    const rail = shadeOf('infra', 0.9);
    for (const f of [-0.55, 0.55]) {
      const zz = z + hh * f, t = hh * 0.025, L = c.lx - half * 0.9, R = c.lx + half * 0.9;
      detailQuad(c.ctx, c.cam, c.F, [[L, y, zz + t], [R, y, zz + t], [R, y, zz - t], [L, y, zz - t]], rail, c.alpha, { lift: DETAIL_LIFT });
    }
    const tex = neonArtTex(d.art, powerNight(c.night) ? 1 : 0);
    if (!tex) return;
    const yT = y + out * SIGN_BOARD_OUT * 0.6;
    const pts = [[c.lx - half, yT, z + hh], [c.lx + half, yT, z + hh], [c.lx + half, yT, z - hh], [c.lx - half, yT, z - hh]];
    const w = pts.map(([lx, ly, z2]) => { const [wx, wy] = c.F(lx, ly); return c.cam.proj(wx, wy, z2); });
    if (w.every((q) => q.f > 0.12)) emitSurfaceText(c.ctx, c.cam, w, tex, false, c.alpha, DETAIL_LIFT * 2, false, FACE_EPS * 2);
  },

  // A pipe: two flat strips at right angles, which reads as a round pipe from any angle a wall is
  // seen from and costs two quads instead of a drum.
  pipe: (c, d) => {
    const r = c.V(d.r), z0 = c.V(d.z0), z1 = c.V(d.z1), y = faceY(c.ly);
    const col = shadeOf(d.pal || c.pal, 0.86), lit = shadeOf(d.pal || c.pal, 1.06);
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - r, y, z1], [c.lx + r, y, z1], [c.lx + r, y, z0], [c.lx - r, y, z0]], col, c.alpha, { lift: DETAIL_LIFT });
    detailQuad(c.ctx, c.cam, c.F, [[c.lx, y - r, z1], [c.lx, y + r, z1], [c.lx, y + r, z0], [c.lx, y - r, z0]], lit, c.alpha, { lift: DETAIL_LIFT * 1.5 });
  },
  // ── THE PILASTERS: WHAT MAKES A FACADE A FACADE AND NOT A SLAB ─────────────────────────────────
  //
  // Everything else on this list is bolted ONTO a wall — a pipe, a board, a vent, a cable — and
  // this file's own note under `windowBay` already says why that is not enough: "a flat wall
  // wearing forty greebles is a flat wall". What the city had no word for at all is the oldest
  // move in tall architecture: a rank of vertical fins standing proud of the frontage, running from
  // the plinth to the crown, with the glazing set back between them.
  //
  // It is the single most characteristic thing about both halves of what this game looks like.
  // ART DECO is that rhythm in stone — the pier-and-spandrel front, unbroken verticals gathered
  // into a stepped capital at the top. The CYBERPUNK skyline is the same rhythm with the light
  // switched on: a lit channel up every fin, so a tower reads as a bundle of vertical lines after
  // dark rather than as a dark rectangle with some windows in it. One part draws both, because they
  // ARE one part — what changes is the cap and whether the runner is lit.
  //
  // ⚠ THE LIGHT IS A STROKE AND THE FIN IS GEOMETRY, WHICH IS THE WHOLE COST STORY. A lit line up a
  // pier through `emitLightRunner` is a quad in the stroke layer on the GPU and one polyline on the
  // canvas — the cheapest bright thing this renderer has — where a glowing FACE would be a mesh
  // quad per fin per building, on every building in the city. So the geometry is rationed hard
  // (a front face always, its two returns in the mesh only, a cap when one is asked for) and the
  // part that actually reads at range costs almost nothing.
  //
  // ⚠ THE RETURNS ARE THE DIFFERENCE BETWEEN A FIN AND A STRIPE, and they are mesh-only for the
  // same bargain `bars` and the blade's spine already strike: square on, a front face alone is
  // indistinguishable from paint, and off square the returns are what give the frontage depth. On
  // the 2-D fallback a pier is a painted pilaster, which is what a painted pilaster looks like.
  //
  // ⚠ ONE PART, `n` FINS — the `bollard` rule, and here it is not a preference. Every fin on a
  // facade is a claim on `KIT_MAX`, and a rank of five spending five slots would eat the fire
  // escape, the roof plant and the name board (see the ⚠ on `winSpent`). A rhythm is also the one
  // thing that is meaningless at a count of one.
  pilaster: (c, d) => {
    const w = c.V(d.w), z0 = c.V(d.z0), z1 = c.V(d.z1);
    if (!(z1 > z0) || !(w > 0)) return;
    const out = d.out ? c.V(d.out) : w * 0.8;
    const step = d.step ? c.V(d.step) : w * 4;
    const n = clamp(Math.round(d.n || 1), 1, 9);
    const sgn = c.ly < 0 ? -1 : 1;
    const y0 = faceY(c.ly), y1 = y0 + sgn * out;
    const P = d.pal || c.pal;
    // ⚠ THE FIN IS LIGHTER THAN ITS WALL AND THE REVEAL BESIDE IT IS DARKER, which is the whole
    // read. A pier in the wall's own key is the wall, and the rhythm only exists because the eye
    // has a light face and a shadowed flank to tell apart — the same argument `trimPalFor` makes
    // about a surround being shaded off the wall's key and coming out as paint.
    // ⚠ AND THE STEP HAS TO BE A REAL ONE. At 1.14 over 0.56 the rank measured correctly in the
    // mesh and was invisible on the building: most of this city is faced in something dark, and a
    // seventh of near-black is near-black. What a stone pier on a brick front actually is — the
    // limestone against the brick — is a value contrast you can see from across the road.
    const face = shadeOf(P, 1.32), flank = shadeOf(P, 0.42), capCol = shadeOf(P, 1.46);
    const L = { lift: DETAIL_LIFT * 1.25 };
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || L);
    // ── ⚠ A QUAD'S NORMAL IS ITS WINDING, AND THIS ONE WAS WOUND FOR ONE SIDE OF THE BUILDING ──
    //
    // `emitFlat` takes the mesh normal off the polygon itself (Newell) and never flips it, so a fin
    // written for a +y wall claims a +y normal wherever it is put. That is INTO the building on a
    // back wall or on the left-hand flank, and GLASS 2 shades a face by its normal — so the rank
    // comes out lit as though it were turned away from the light, on the elevations where the rank
    // is the only thing there is to look at.
    //
    // It was unreachable while section 1b was the only caller: a front rank stands at `fy`, and
    // `fy` is the front face of the biggest box, which is positive on a centred mass. 1e puts a
    // rank on the back and on a flank, so it is reachable now.
    //
    // ⚠ AND IT IS SOLVED RATHER THAN REASONED THROUGH. These four quads lie in three different
    // planes, and hand-deriving which of them to reverse is exactly the kind of sign argument this
    // file keeps losing — two of them already disagreed with their own `cullN` before this change:
    // the +x return has claimed a −x normal since the part was written, on every building in the
    // city. Handing each quad the direction it is meant to face and letting one function fix the
    // winding is the only version nobody has to re-derive.
    //
    // ⚠ IN THE LOCAL FRAME, WHICH IS SAFE BECAUSE `c.F` IS A ROTATION ABOUT Z. `detailQuad` maps
    // these points to world in order, so reversing here reverses there, and a rotation cannot
    // change the sign of the dot product this tests.
    const facing = (pts, nx, ny, nz) => {
      let ax = 0, ay = 0, az = 0;
      for (let i = 0; i < pts.length; i++) {
        const a = pts[i], b = pts[(i + 1) % pts.length];
        ax += (a[1] - b[1]) * (a[2] + b[2]);
        ay += (a[2] - b[2]) * (a[0] + b[0]);
        az += (a[0] - b[0]) * (a[1] + b[1]);
      }
      return (ax * nx + ay * ny + az * nz) >= 0 ? pts : pts.slice().reverse();
    };
    // A capital: the fin steps OUT and stops, rather than running into the coping. Deco's own
    // answer to where a vertical ends, and the thing that keeps a lit runner from appearing to leak
    // off the top of the building.
    const cap = d.cap ? Math.min((z1 - z0) * 0.09, w * 2.2) : 0;
    for (let i = 0; i < n; i++) {
      const x = c.lx + (i - (n - 1) / 2) * step;
      const zt = z1 - cap;
      Q(facing([[x - w, y1, zt], [x + w, y1, zt], [x + w, y1, z0], [x - w, y1, z0]], 0, sgn, 0), face, c.alpha);
      if (nearOrMesh()) for (const sx of [-1, 1]) {
        // The return faces along its own side of the fin — which is what `cullN` has always said,
        // in the same basis, and what the winding did not.
        Q(facing([[x + sx * w, y0, zt], [x + sx * w, y1, zt], [x + sx * w, y1, z0], [x + sx * w, y0, z0]], sx, 0, 0), flank, c.alpha,
          { lift: DETAIL_LIFT * 1.25, cullN: [sx * c.E[1], -sx * c.E[0]] });
      }
      if (cap > 0) {
        const cw = w * 1.45, co = out * 1.25, y2 = y0 + sgn * co;
        Q(facing([[x - cw, y2, z1], [x + cw, y2, z1], [x + cw, y2, zt], [x - cw, y2, zt]], 0, sgn, 0), capCol, c.alpha, { lift: DETAIL_LIFT * 1.45 });
        // The capital's weathering: it is the one surface on a fin that faces the sky.
        Q(facing([[x - cw, y0, z1], [x + cw, y0, z1], [x + cw, y2, z1], [x - cw, y2, z1]], 0, 0, 1), shadeOf(P, 1.02), c.alpha, { lift: DETAIL_LIFT * 1.45 });
      }
      // ── AND THE LIGHT ON IT ────────────────────────────────────────────────────────────────
      //
      // ⚠ THE RUNNER STOPS AT THE CAPITAL AND STARTS ABOVE THE PLINTH. A line of light that runs
      // into the coping at one end and into the pavement at the other reads as a seam in the
      // rendering rather than as a fitting somebody installed.
      //
      // ⚠ `glowFrom` IS WHAT MAKES ONE PART DRAW BOTH PERIODS. At 0 it is the full-height neon run
      // up every fin, which is the modern skyline; high up it is a lit CROWN — the top fifth of
      // each pier picked out, which is what a 1930s tower does with its verticals and the reason
      // those buildings still read from a mile off after dark. Same geometry, same stroke, same
      // cost; a second kind for "the same fin with a shorter light on it" would be the `wallName`
      // mistake `signBoard` already records.
      if (d.glow) {
        const rgb = hexRgb(d.glow).join(',');
        const inset = (z1 - z0) * 0.05;
        const lo = z0 + inset, hi = zt - inset;
        const gz = lo + (hi - lo) * clamp(d.glowFrom || 0, 0, 0.9);
        const W = [[x, y1, gz], [x, y1, hi]]
          .map(([lx, ly, lz]) => { const [wx, wy] = c.F(lx, ly); return [wx, wy, lz]; });
        // The halo only where a sink will take it, exactly as `neonRun` reasons about `shadowBlur`.
        const halo = (MESH_SINK || (STROKE_SINK && TUNE.glDeco)) ? rgb : null;
        emitLightRunner(c.ctx, c.cam, W, `rgba(${rgb},${c.night ? 0.92 : 0.30})`, c.alpha, c.night, halo, DETAIL_LIFT * 1.6);
      }
    }
  },

  // ── A RUN OF NEON TUBE ─────────────────────────────────────────────────────────────────────
  //
  // The one thing every reference photograph of this kind of city has on every building and GLASS
  // had nowhere to put: architectural light. Not a sign — it spells nothing — which is exactly why
  // it reaches the whole city rather than only the buildings with a name worth setting in type.
  // `models:quality` says 26 of 173 are two mass segments or fewer, a box and a lid, and a box with
  // a lit line round it is a different building; a box with a name board on it is a box with a name
  // board on it.
  //
  // ⚠ IT IS A RACEWAY AND A TUBE, TWO THINGS, AND THE RACEWAY IS NOT DECORATION. Neon is mounted on
  // a channel, so by DAY this reads as a dark strip on the wall and only after dark as light — which
  // is what stops a daylight city looking like it is covered in switched-off jewellery. It is also
  // what lets the part exist at all: `authoredDetailSmoke` records into MESH_SINK and a stroke puts
  // nothing there, so a tube with no housing is "declared, dispatched, and silent" to that gate, for
  // exactly the reason the schema's own note gives for keeping `facadeGlow` out of it.
  //
  // ⚠ AND THE TUBE TAKES A HAIR OF LIFT, NEVER `DECO_LIFT`. `emitLightRunner`'s default is 0.6 of a
  // tile toward the eye, which is right for the corner runners on Halcyon — they trace a tower's own
  // edges and have to clear its walls — and catastrophic here: this is already bolted to the outside
  // of the facade, so 0.6 walks it into the building across the street. Same lesson as the street
  // lamp, same fix.
  neonRun: (c, d) => {
    const half = c.V(d.half), z = c.V(d.z), drop = d.drop ? c.V(d.drop) : 0;
    const y = faceY(c.ly), r = Math.max(0.004, half * 0.018);
    const col = d.color || c.neon || '#5cd6ff';
    const rgb = hexRgb(col).join(',');
    // ⚠ AND THE WHOLE FITTING IS A GLASS 2 FEATURE, WITH A ONE-LINE VERSION FOR THE FALLBACK.
    // `framecost` holds the 2-D renderer to a 2% budget and the channel plus the returns is six
    // primitives on every building within `detailNear` — enough on its own to tip a tree that was
    // already sitting at +1.8%. On the GPU none of it is charged: `FLAT_OFF` sends the channel to
    // the mesh and the tube is a quad. So with a sink the part is drawn in full, and without one it
    // is the horizontal tube alone — the bit that carries the whole idea.
    // ⚠ `MESH_SINK` IS HALF THE TEST AND LEAVING IT OUT DELETED THE PART FROM THE MESH. A capture
    // opens the MESH sink and no stroke sink, so a gate that only asks about strokes answers "lean"
    // while building the very geometry GLASS 2 will draw — the channel never reaches the mesh, and
    // `shapes:smoke` says so in the one way that would otherwise be silent: both required fields
    // "change nothing when removed", because nothing was recorded at all.
    const rich = MESH_SINK || (STROKE_SINK && TUNE.glDeco);
    if (rich) {
      // The channel it is mounted on, in the wall's own shadow colour.
      const chan = (x0, x1, za, zb) => detailQuad(c.ctx, c.cam, c.F,
        [[x0 - r, y, zb + r], [x1 + r, y, zb + r], [x1 + r, y, za - r], [x0 - r, y, za - r]],
        shadeOf(d.pal || c.pal, 0.42), c.alpha, { lift: DETAIL_LIFT });
      chan(c.lx - half, c.lx + half, z, z);
      if (drop > 0) { chan(c.lx - half, c.lx - half, z - drop, z); chan(c.lx + half, c.lx + half, z - drop, z); }
    }
    // …and the tube in it. One polyline, so the corners are mitred rather than butted.
    const P = [];
    if (drop > 0 && rich) P.push([c.lx - half, y, z - drop]);
    P.push([c.lx - half, y, z], [c.lx + half, y, z]);
    if (drop > 0 && rich) P.push([c.lx + half, y, z - drop]);
    const W = P.map(([lx, ly, pz]) => { const [wx, wy] = c.F(lx, ly); return [wx, wy, pz]; });
    // ⚠ THE HALO IS A GLASS 2 FEATURE AND THE BLOOM IS OFF ON THE CANVAS. On the GPU a glow is one
    // more additive quad and costs nothing; on the 2-D painter it is `shadowBlur`, which is the
    // single most expensive call canvas2d has. `framecost` measured it immediately — 18 → 24 blur
    // passes on the near cab night frame, +33%, and it failed the budget. Handing `glowRGB` only
    // when there is a stroke sink to take it makes the tube a plain bright line on the fallback
    // renderer and a lit one on the GPU, which is the same bargain `lodAdorn` already strikes.
    const glow = rich ? rgb : null;
    emitLightRunner(c.ctx, c.cam, W, `rgba(${rgb},${c.night ? 0.95 : 0.4})`, c.alpha, c.night, glow, DETAIL_LIFT * 1.5);
  },
  // A mechanical box: a top and one side, which is all of it that is ever visible from outside.
  // ── THE STREET ITSELF, WHICH GLASS HAD NOTHING FOR ─────────────────────────────────────────────
  //
  // Every neon reference is half building and half PAVEMENT: a lamp on a gooseneck, a lit vending
  // machine against the wall, bollards along the kerb. GLASS could draw a thirty-storey tower and
  // had no way to say "and there is a lamp post outside it", so the ground floor of every building
  // in the city met the road with nothing in between.
  //
  // ⚠ THESE ARE BUILDING PARTS, NOT SCATTER, and that is the decision that makes them cheap. Ground
  // scatter is placed per TILE by the terrain pass and knows nothing about what is standing on the
  // tile; a part knows its building's footprint, its entrance and its palette, so it can be put
  // against the right wall, at the right end, facing the right way — and it inherits the screen-size
  // gate, the near-tier distance gate and the mesh capture for free.

  // A lamp on a gooseneck arm — the single most recognisable object on a street, and the one the
  // reference photographs all have. The arm is stepped rather than curved: at the size this is ever
  // drawn, three segments and a round head read as a gooseneck and a real arc costs a path.
  streetLamp: (c, d) => {
    const z0 = c.V(d.z0 ?? [0, 0, 0]), z1 = c.V(d.z1), out = c.V(d.out ?? [0, 0, 0.1]);
    const r = Math.max(c.V(d.r ?? [0, 0, 0.012]), 0.004);
    const P = d.pal || c.pal, post = shadeOf(P, 0.5), lit = shadeOf(P, 0.86);
    const Q = (pts, fill, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, c.alpha, o || {});
    // The column: two crossed quads. A four-sided box at this width is four quads for a silhouette
    // a cross gives in two, and nothing is ever close enough to a lamp post to catch it out.
    Q([[c.lx - r, c.ly, z1], [c.lx + r, c.ly, z1], [c.lx + r, c.ly, z0], [c.lx - r, c.ly, z0]], post, {});
    Q([[c.lx, c.ly - r, z1], [c.lx, c.ly + r, z1], [c.lx, c.ly + r, z0], [c.lx, c.ly - r, z0]], post, {});
    // The gooseneck, stepping out along the entrance normal and dropping as it goes.
    const sgn = d.flip ? -1 : 1, steps = [[0.30, 0.055], [0.72, 0.085], [1, 0.06]];
    let px = c.lx, pz = z1;
    for (const [t, drop] of steps) {
      const nx = c.lx + sgn * out * t, nz = z1 - (z1 - z0) * drop;
      Q([[px, c.ly - r * 0.7, pz], [nx, c.ly - r * 0.7, nz], [nx, c.ly + r * 0.7, nz], [px, c.ly + r * 0.7, pz]], post, {});
      px = nx; pz = nz;
    }
    // The head, and the light it throws. ⚠ The glow is a SPRITE — it rides SPRITE_SINK like every
    // other light in GLASS, so GLASS 2 depth-tests it and the city walls catch its wash, rather than
    // it being a painted blob this one part invented.
    const hw = r * 3.2, hd = r * 2.2;
    Q([[px - hw, c.ly - hd, pz], [px + hw, c.ly - hd, pz], [px + hw, c.ly + hd, pz], [px - hw, c.ly + hd, pz]], post, {});
    Q([[px - hw, c.ly - hd, pz - r * 1.4], [px + hw, c.ly - hd, pz - r * 1.4], [px + hw, c.ly + hd, pz - r * 1.4], [px - hw, c.ly + hd, pz - r * 1.4]], lit, {});
    if (c.night > 0.15) {
      const [wx, wy] = c.F(px, c.ly);
      glowPool(c.ctx, c.cam, wx, wy, pz - r * 1.4, d.rgb || '255,214,150', (d.s ?? 26) * c.night, c.alpha);
    }
  },

  // A lit machine standing against the wall — the purple vending machine in the reference, and the
  // thing that says a shopfront is open at four in the morning.
  vendingMachine: (c, d) => {
    const w = c.V(d.w ?? [0, 0, 0.032]), dp = c.V(d.d ?? [0, 0, 0.022]);
    const hh = c.V(d.hh ?? [0, 0, 0.05]), z = c.V(d.z ?? [0, 0, 0]);
    const P = d.pal || c.pal, body = shadeOf(P, 0.44), top = shadeOf(P, 0.66);
    const face = d.glow || '#c060e0', y = c.ly;
    const Q = (pts, fill, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, c.alpha, o || {});
    Q([[c.lx - w, y - dp, z + hh], [c.lx + w, y - dp, z + hh], [c.lx + w, y + dp, z + hh], [c.lx - w, y + dp, z + hh]], top, {});
    for (const sx of [-1, 1]) {
      Q([[c.lx + sx * w, y - dp, z + hh], [c.lx + sx * w, y + dp, z + hh], [c.lx + sx * w, y + dp, z], [c.lx + sx * w, y - dp, z]], body,
        { cullN: [sx * c.E[1], -sx * c.E[0]] });
    }
    // The glazed front, and a dark surround so it reads as a window in a cabinet rather than as a
    // coloured slab. Out along the face by FACE_EPS for the same reason every proud part is.
    const yf = y + dp, ye = yf + FACE_EPS;
    Q([[c.lx - w, yf, z + hh], [c.lx + w, yf, z + hh], [c.lx + w, yf, z], [c.lx - w, yf, z]], body, {});
    Q([[c.lx - w * 0.76, ye, z + hh * 0.9], [c.lx + w * 0.76, ye, z + hh * 0.9], [c.lx + w * 0.76, ye, z + hh * 0.22], [c.lx - w * 0.76, ye, z + hh * 0.22]], face,
      { lift: DETAIL_LIFT, stroke: 'rgba(0,0,0,0.45)', lw: 1 });
    if (c.night > 0.15) {
      const [wx, wy] = c.F(c.lx, yf);
      glowPool(c.ctx, c.cam, wx, wy, z + hh * 0.55, d.rgb || '190,110,230', (d.s ?? 14) * c.night, c.alpha);
    }
  },

  // A row of posts along the kerb. One authored part, `count` of them, because a single bollard is
  // a mistake and a row is street furniture.
  bollard: (c, d) => {
    const r = Math.max(c.V(d.r ?? [0, 0, 0.009]), 0.003);
    const hh = c.V(d.hh ?? [0, 0, 0.022]), z = c.V(d.z ?? [0, 0, 0]);
    const n = Math.max(1, Math.min(8, d.count || 3)), step = c.V(d.step ?? [0, 0, 0.07]);
    const P = d.pal || c.pal, post = shadeOf(P, 0.54), cap = shadeOf(P, 0.8);
    const Q = (pts, fill, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, c.alpha, o || {});
    for (let i = 0; i < n; i++) {
      const x = c.lx + (i - (n - 1) / 2) * step;
      Q([[x - r, c.ly, z + hh], [x + r, c.ly, z + hh], [x + r, c.ly, z], [x - r, c.ly, z]], post, {});
      Q([[x, c.ly - r, z + hh], [x, c.ly + r, z + hh], [x, c.ly + r, z], [x, c.ly - r, z]], post, {});
      // The reflective band every bollard has, which is most of what makes it read as one.
      if (d.band) {
        const zb = z + hh * 0.72;
        Q([[x - r * 1.08, c.ly, zb], [x + r * 1.08, c.ly, zb], [x + r * 1.08, c.ly, zb - hh * 0.14], [x - r * 1.08, c.ly, zb - hh * 0.14]], d.band, { lift: DETAIL_LIFT });
      }
      Q([[x - r, c.ly - r, z + hh], [x + r, c.ly - r, z + hh], [x + r, c.ly + r, z + hh], [x - r, c.ly + r, z + hh]], cap, {});
    }
  },

  // ── BINS AND CRATES AGAINST A WALL ─────────────────────────────────────────────────────────
  //
  // The pavement meets the building on a clean line everywhere in Coldwater, and no real street
  // does: there is always something shoved against the wall by a service door. It is the cheapest
  // possible thing at knee height — a box and a lid each — and knee height is the one band of the
  // picture a player on foot cannot avoid looking at.
  //
  // ⚠ THEY LEAN AND THEY DIFFER, off `dRand` rather than off a loop index. A row of identical boxes
  // at identical spacing reads as a fence or a wall base; what reads as rubbish is the same object
  // at three sizes, none of them square to the kerb. Seeded, so a building keeps its own bins for
  // ever — `models:diff` asserts two renders are identical and a jitter would fail it.
  //
  // ⚠ AND THE LID IS ITS OWN COLOUR, because that is the whole read at distance. A bin is a dark
  // box with a lighter top; drop the lid tone and at ten tiles it is a smudge on the pavement.
  binStack: (c, d) => {
    const w = c.V(d.w), dp = d.d ? c.V(d.d) : w * 0.8;
    const hh = d.hh ? c.V(d.hh) : w * 1.6, z = c.V(d.z);
    const n = clamp(Math.round(d.n || 3), 1, 6);
    const P = d.pal || c.pal, body = shadeOf(P, 0.46), side = shadeOf(P, 0.33);
    const lid = d.lid || shadeOf(P, 0.78);
    const Q = (pts, fill, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, c.alpha, o || {});
    for (let i = 0; i < n; i++) {
      const j = dRand(0, 300 + i * 7);           // the per-bin variation, deterministic
      const bw = w * (0.72 + j * 0.5), bh = hh * (0.7 + ((i * 3) % 4) / 4 * 0.5);
      const x = c.lx + (i - (n - 1) / 2) * w * 2.3 + (j - 0.5) * w * 0.4;
      const y = c.ly + (j - 0.5) * dp * 0.5;
      const zt = z + bh;
      Q([[x - bw, y - dp, zt], [x + bw, y - dp, zt], [x + bw, y + dp, zt], [x - bw, y + dp, zt]], lid, {});   // the lid
      for (const [sx, sy] of [[0, 1], [0, -1], [1, 0], [-1, 0]]) {
        const ax = sx ? x + sx * bw : x - bw, ay = sy ? y + sy * dp : y - dp;
        const bx = sx ? x + sx * bw : x + bw, byy = sy ? y + sy * dp : y + dp;
        Q([[ax, ay, zt], [bx, byy, zt], [bx, byy, z], [ax, ay, z]], sy ? body : side,
          { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
      }
    }
  },

  acUnit: (c, d) => {
    const w = c.V(d.w), dp = d.d ? c.V(d.d) : w * 0.7, hh = d.hh ? c.V(d.hh) : w * 0.55, z = c.V(d.z);
    dripStain(c, d, c.lx, faceY(c.ly), z, w);
    const top = shadeOf(d.pal || c.pal, 1.1), side = shadeOf(d.pal || c.pal, 0.72);
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - w, c.ly - dp, z + hh], [c.lx + w, c.ly - dp, z + hh], [c.lx + w, c.ly + dp, z + hh], [c.lx - w, c.ly + dp, z + hh]], top, c.alpha, {});
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ax = sx ? c.lx + sx * w : c.lx - w, ay = sy ? c.ly + sy * dp : c.ly - dp;
      const bx = sx ? c.lx + sx * w : c.lx + w, by = sy ? c.ly + sy * dp : c.ly + dp;
      detailQuad(c.ctx, c.cam, c.F, [[ax, ay, z + hh], [bx, by, z + hh], [bx, by, z], [ax, ay, z]], side, c.alpha, { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
    }
  },
  // A louvred panel: one quad and three lines, flat on the face.
  vent: (c, d) => {
    const w = c.V(d.w), hh = d.hh ? c.V(d.hh) : w, z = c.V(d.z), y = faceY(c.ly);
    dripStain(c, d, c.lx, y, z - hh, w);
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - w, y, z + hh], [c.lx + w, y, z + hh], [c.lx + w, y, z - hh], [c.lx - w, y, z - hh]],
      shadeOf(d.pal || c.pal, 0.6), c.alpha, { lift: DETAIL_LIFT, stroke: "rgba(0,0,0,0.35)", lw: 1 });
    for (let i = 1; i <= 3; i++) {
      const zz = z - hh + (2 * hh) * (i / 4), yy = y + (y < 0 ? -FACE_EPS : FACE_EPS);
      detailQuad(c.ctx, c.cam, c.F, [[c.lx - w * 0.9, yy, zz], [c.lx + w * 0.9, yy, zz], [c.lx + w * 0.9, yy, zz - hh * 0.08], [c.lx - w * 0.9, yy, zz - hh * 0.08]],
        shadeOf(d.pal || c.pal, 0.42), c.alpha, { lift: DETAIL_LIFT * 1.4 });
    }
  },
  // A balcony: a slab out from the face, and a rail above it drawn as one thin band.
  balcony: (c, d) => {
    const half = c.V(d.half), out = c.V(d.out), z = c.V(d.z), rail = d.rail ? c.V(d.rail) : 0;
    const slab = shadeOf(d.pal || c.pal, 0.95), under = shadeOf(d.pal || c.pal, 0.5);
    const y0 = c.ly, y1 = c.ly + out;
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, y0, z], [c.lx + half, y0, z], [c.lx + half, y1, z], [c.lx - half, y1, z]], slab, c.alpha, {});
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, y1, z], [c.lx + half, y1, z], [c.lx + half, y1, z - out * 0.18], [c.lx - half, y1, z - out * 0.18]], under, c.alpha, {});
    if (rail > 0) {
      detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, y1, z + rail], [c.lx + half, y1, z + rail], [c.lx + half, y1, z + rail * 0.72], [c.lx - half, y1, z + rail * 0.72]],
        shadeOf(d.pal || c.pal, 1.15), c.alpha * 0.9, {});
    }
    // ── AND WHAT CARRIES THE SLAB ──────────────────────────────────────────────────────────────
    //
    // ⚠ THE MOST-INSTANCED PROJECTING PART IN THE CITY, at 472 of them. A balcony is a slab out
    // from a wall with an underside already drawn and nothing under that underside, so a residential
    // block reads as a stack of shelves. Two brackets is what a real one has, and on a facade
    // wearing three floors of them it is the detail that turns a flat elevation into a building.
    //
    // ⚠ A TRIANGLE, NOT A QUAD — three points through `emitFlat`, which meshes as one triangle
    // rather than two. A bracket IS a right triangle: wall at the slab, out to the edge, back down
    // the wall. Drawing it as a box would cost double for a shape nobody would read as a bracket.
    if (nearOrMesh()) {
      const brk = bracketCol(), drop = out * 0.62;
      for (const sx of [-1, 1]) {
        const bx = c.lx + sx * half * 0.74;
        detailQuad(c.ctx, c.cam, c.F, [[bx, y0, z], [bx, y1, z], [bx, y0, z - drop]], brk, c.alpha, { lift: DETAIL_LIFT * 1.2 });
      }
    }
  },
  // A fire escape: landings down a face, a rail on each, and the flights zigzagging between them.
  // ⚠ Everything is on the OUTER plane (y1) or above it, because a flight that shares its wall’s
  // plane z-fights it — the same reason FACE_EPS exists — and a landing is the one part here that
  // is genuinely horizontal, so it gets the slab-and-underside pair a balcony gets.
  fireEscape: (c, d) => {
    const half = c.V(d.half), out = c.V(d.out), z0 = c.V(d.z0), z1 = c.V(d.z1);
    const n = clamp(Math.round(d.flights || 3), 1, 8);
    const y0 = c.ly, y1 = c.ly + out, step = (z1 - z0) / n;
    const slab = shadeOf(d.pal || c.pal, 0.58), under = shadeOf(d.pal || c.pal, 0.32), rail = shadeOf(d.pal || c.pal, 0.92);
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || {});
    for (let i = 0; i <= n; i++) {
      const z = z0 + step * i;
      Q([[c.lx - half, y0, z], [c.lx + half, y0, z], [c.lx + half, y1, z], [c.lx - half, y1, z]], slab, c.alpha);
      Q([[c.lx - half, y1, z], [c.lx + half, y1, z], [c.lx + half, y1, z - step * 0.06], [c.lx - half, y1, z - step * 0.06]], under, c.alpha);
      if (i === n) break;
      const rh = step * 0.4;
      Q([[c.lx - half, y1, z + rh], [c.lx + half, y1, z + rh], [c.lx + half, y1, z + rh * 0.66], [c.lx - half, y1, z + rh * 0.66]], rail, c.alpha * 0.9);
      // The flight itself, slanted, and alternating side so it reads as a zigzag rather than a ladder.
      const sx = (i % 2) ? 1 : -1, t = step * 0.12;
      Q([[c.lx - sx * half, y1, z], [c.lx + sx * half, y1, z + step], [c.lx + sx * half, y1, z + step - t], [c.lx - sx * half, y1, z - t]], rail, c.alpha * 0.85);
    }
  },
  // A water tank on legs: four thin uprights, four sides and a lid. Aimed at the view this game
  // spends most of its time in — from the air a flat roof is the biggest surface a building has.
  roofTank: (c, d) => {
    const r = c.V(d.r), hh = c.V(d.hh), z = c.V(d.z), legs = hh * 0.42;
    const body = shadeOf(d.pal || c.pal, 0.8), lid = shadeOf(d.pal || c.pal, 1.14), leg = shadeOf(d.pal || c.pal, 0.46);
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || {});
    for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = c.lx + ax * r * 0.66, ly = c.ly + ay * r * 0.66, t = r * 0.1;
      Q([[lx - t, ly, z + legs], [lx + t, ly, z + legs], [lx + t, ly, z], [lx - t, ly, z]], leg, c.alpha);
    }
    const zb = z + legs, zt = zb + hh;
    Q([[c.lx - r, c.ly - r, zt], [c.lx + r, c.ly - r, zt], [c.lx + r, c.ly + r, zt], [c.lx - r, c.ly + r, zt]], lid, c.alpha);
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ax = sx ? c.lx + sx * r : c.lx - r, ay = sy ? c.ly + sy * r : c.ly - r;
      const bx = sx ? c.lx + sx * r : c.lx + r, by = sy ? c.ly + sy * r : c.ly + r;
      Q([[ax, ay, zt], [bx, by, zt], [bx, by, zb], [ax, ay, zb]], body, c.alpha, { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
    }
  },
  // ── THE STAIR HEAD ─────────────────────────────────────────────────────────────────────────
  //
  // ⚠ THE ONE OBJECT EVERY FLAT ROOF IN THE WORLD HAS, AND THE CITY HAD NO WORD FOR IT. Something
  // has to bring the stairs up through the deck, and whatever it is has a door in it and a lid over
  // it. It is the thing that says a roof is a PLACE — somebody comes up here — where a tank and a
  // condenser only say a roof is a shelf. Measured before this existed, the derived kit put 3.15
  // objects on an average deck and every one of them was plant.
  //
  // ⚠ IT IS ALSO THE PART THAT FIXES THE SILHOUETTE, which is why it is a box and not a decal. From
  // the air a bare deck reads as a lid whatever is painted on it; a bulkhead standing a third of a
  // storey proud of the parapet breaks the roofline of every building that gets one, and that is
  // what the skyline of this city has been missing. See the ⚠ in the kit's roof section.
  roofBulkhead: (c, d) => {
    const w = c.V(d.w), dp = d.d ? c.V(d.d) : w * 0.78, hh = c.V(d.hh), z = c.V(d.z);
    // ⚠ A BULKHEAD IS FINISHED IN THE ROOF'S MATERIAL, NOT THE WALL'S, so it is DARKER than the
    // building under it rather than brighter. The obvious shading — walls 0.74, a bright 1.12 lid,
    // which is what every other box-shaped part in this list uses — puts a near-white slab on top
    // of a dark deck, and at the range this reads from that is a skylight rather than a stair. The
    // cap stays a touch above the walls so the lip still catches an edge.
    const wall = shadeOf(d.pal || c.pal, 0.66), cap = shadeOf(d.pal || c.pal, 0.86);
    const zt = z + hh;
    const Q = (pts, fill, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, c.alpha, o || {});
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ax = sx ? c.lx + sx * w : c.lx - w, ay = sy ? c.ly + sy * dp : c.ly - dp;
      const bx = sx ? c.lx + sx * w : c.lx + w, by = sy ? c.ly + sy * dp : c.ly + dp;
      Q([[ax, ay, zt], [bx, by, zt], [bx, by, z], [ax, ay, z]], wall,
        { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
    }
    // ⚠ THE LID OVERSAILS, and that is the whole difference between a stair head and a crate. A
    // roof covering has to be dressed over the edge of what it covers or the water runs down the
    // inside of the wall, so every one of these in the world wears a lip — and at the size this
    // draws, the lip's own shadow line is most of what makes it read as built rather than dropped.
    const lip = Math.max(w * 0.1, 0.0015);
    Q([[c.lx - w - lip, c.ly - dp - lip, zt], [c.lx + w + lip, c.ly - dp - lip, zt],
       [c.lx + w + lip, c.ly + dp + lip, zt], [c.lx - w - lip, c.ly + dp + lip, zt]], cap);
    // The door, on the face looking back down the building's own front — a fitting a player in a
    // cab never sees and a pilot always does, so it is placed for the seat that reads it.
    const dy = c.ly - dp - FACE_EPS;
    const dw = Math.min(w * 0.5, dp * 0.9), dh = hh * 0.62;
    Q([[c.lx - dw, dy, z + dh], [c.lx + dw, dy, z + dh], [c.lx + dw, dy, z], [c.lx - dw, dy, z]],
      shadeOf(d.pal || c.pal, 0.30), { lift: DETAIL_LIFT });
    // And the extract grille over it — a stair head is also where the riser vents.
    Q([[c.lx - dw * 0.8, dy, zt - hh * 0.12], [c.lx + dw * 0.8, dy, zt - hh * 0.12],
       [c.lx + dw * 0.8, dy, zt - hh * 0.28], [c.lx - dw * 0.8, dy, zt - hh * 0.28]],
      shadeOf(d.pal || c.pal, 0.46), { lift: DETAIL_LIFT });
  },
  // A cable, sagging. Eight short quads following a parabola — zero at the ends, `sag` at the
  // middle — which is close enough to a catenary at this size that nothing could tell, and is one
  // multiply instead of a cosh. The one curve in a city made of straight lines.
  cableRun: (c, d) => {
    const half = c.V(d.half), sag = c.V(d.sag), z = c.V(d.z), r = c.V(d.r), y = faceY(c.ly);
    const col = shadeOf(d.pal || c.pal, 0.26);
    const N = 8;
    let px = c.lx - half, pz = z;
    for (let i = 1; i <= N; i++) {
      const t = i / N, x = c.lx - half + 2 * half * t, zz = z - sag * 4 * t * (1 - t);
      detailQuad(c.ctx, c.cam, c.F, [[px, y, pz + r], [x, y, zz + r], [x, y, zz - r], [px, y, pz - r]], col, c.alpha, { lift: DETAIL_LIFT });
      px = x; pz = zz;
    }
  },
  // A roller shutter, slats and all: the ground floor of a street that is shut, which at the
  // hours this game is mostly played is most of it.
  shutter: (c, d) => {
    const half = c.V(d.half), hh = c.V(d.hh), z = c.V(d.z), y = faceY(c.ly);
    const body = shadeOf(d.pal || c.pal, 0.5), slat = shadeOf(d.pal || c.pal, 0.64);
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, y, z + hh], [c.lx + half, y, z + hh], [c.lx + half, y, z - hh], [c.lx - half, y, z - hh]],
      body, c.alpha, { lift: DETAIL_LIFT, stroke: "rgba(0,0,0,0.42)", lw: 1 });
    const yy = y + (y < 0 ? -FACE_EPS : FACE_EPS);
    for (let i = 1; i < 7; i++) {
      const zz = z - hh + (2 * hh) * (i / 7);
      detailQuad(c.ctx, c.cam, c.F, [[c.lx - half * 0.96, yy, zz], [c.lx + half * 0.96, yy, zz], [c.lx + half * 0.96, yy, zz - hh * 0.06], [c.lx - half * 0.96, yy, zz - hh * 0.06]],
        slat, c.alpha, { lift: DETAIL_LIFT * 1.4 });
    }
    // -- `bay`: THE SAME SHUTTER, READING AS A DOOR SOMETHING DRIVES THROUGH ------------------
    //
    // A slatted rectangle is a shut shop. A LOADING BAY is that rectangle plus the three fittings
    // that say a vehicle goes through it: the roller housing the curtain winds into, the guide
    // channels it runs in, and the heavy bottom rail that meets the ground. Without them a works
    // frontage is a wall with a slightly different patch of wall on it, which is the report this
    // flag exists to answer -- "doesn't even have a proper entrance".
    //
    // ⚠ IT IS A FLAG AND NOT A NEW KIND, AND IT IS OFF BY DEFAULT, so every hand-authored
    // shutter in the registry (the pawnbroker, the two vacant units, the shut-up shopfront) is
    // byte-identical to the one that shipped. A shop's shutter is not a loading bay and nothing
    // is gained by giving it a drum.
    //
    // ⚠ FLAT QUADS IN THE PLANE OF THE CURTAIN, NEVER PROUD OF IT. A housing that stood out
    // from the wall would need a soffit and two returns -- that is `windowBay`'s job and four
    // times the faces, for one of the most-instanced parts the works kit places.
    if (!d.bay) return;
    const rail = shadeOf(d.pal || c.pal, 0.3), housing = shadeOf(d.pal || c.pal, 0.86);
    const hd = Math.max(hh * 0.2, 0.004);          // the drum housing, above the opening
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half * 1.06, yy, z + hh + hd], [c.lx + half * 1.06, yy, z + hh + hd], [c.lx + half * 1.06, yy, z + hh], [c.lx - half * 1.06, yy, z + hh]],
      housing, c.alpha, { lift: DETAIL_LIFT * 1.2, stroke: "rgba(0,0,0,0.42)", lw: 1 });
    const gw = Math.max(half * 0.055, 0.003);      // the guide channels the curtain runs in
    for (const sg of [-1, 1]) {
      const gx = c.lx + sg * (half + gw);
      detailQuad(c.ctx, c.cam, c.F, [[gx - gw, yy, z + hh + hd], [gx + gw, yy, z + hh + hd], [gx + gw, yy, z - hh], [gx - gw, yy, z - hh]],
        rail, c.alpha, { lift: DETAIL_LIFT * 1.2 });
    }
    // The bottom rail: heavier than a slat, and the one part of a roller door that meets the
    // ground -- which is what reads as a threshold from a truck cab at eye height 0.
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, yy, z - hh + hh * 0.12], [c.lx + half, yy, z - hh + hh * 0.12], [c.lx + half, yy, z - hh], [c.lx - half, yy, z - hh]],
      rail, c.alpha, { lift: DETAIL_LIFT * 1.4 });
  },
  // A spray of aerials on a roof, at mixed heights and angles off one anchor. Seeded off the
  // index rather than random, so a building keeps the same skyline every frame.
  antennaCluster: (c, d) => {
    const r = c.V(d.r), hh = c.V(d.hh), z = c.V(d.z), n = clamp(Math.round(d.n || 5), 2, 9);
    const col = shadeOf(d.pal || c.pal, 0.95);
    for (let i = 0; i < n; i++) {
      const a2 = (i / n) * Math.PI * 2 + 0.7, rr = r * (0.3 + 0.7 * (((i * 7) % 5) / 5));
      const ax = c.lx + Math.cos(a2) * rr, ay = c.ly + Math.sin(a2) * rr;
      const t = Math.max(r * 0.045, 0.004), hgt = hh * (0.45 + 0.55 * (((i * 3) % 4) / 4));
      detailQuad(c.ctx, c.cam, c.F, [[ax - t, ay, z + hgt], [ax + t, ay, z + hgt], [ax + t, ay, z], [ax - t, ay, z]], col, c.alpha * 0.95, {});
    }
  },
  // A pipe run ACROSS a face: the same two crossed strips `pipe` uses, turned on their side.
  conduit: (c, d) => {
    const r = c.V(d.r), half = c.V(d.half), z = c.V(d.z), y = faceY(c.ly);
    const col = shadeOf(d.pal || c.pal, 0.86), lit = shadeOf(d.pal || c.pal, 1.06);
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, y, z + r], [c.lx + half, y, z + r], [c.lx + half, y, z - r], [c.lx - half, y, z - r]], col, c.alpha, { lift: DETAIL_LIFT });
    detailQuad(c.ctx, c.cam, c.F, [[c.lx - half, y - r, z], [c.lx + half, y - r, z], [c.lx + half, y + r, z], [c.lx - half, y + r, z]], lit, c.alpha, { lift: DETAIL_LIFT * 1.5 });
  },
  // ── THE TWO PARTS A CYLINDER CAN WEAR ────────────────────────────────────────────────────────
  //
  // ⚠ EVERY OTHER KIND ON THIS LIST IS BOLTED TO A FLAT WALL, AND A QUARTER OF THIS CITY HAS NONE.
  // `derivedTrim`'s candidate loop is `if (sg.kind !== 'box' || sg.yaw) continue`, so a building
  // whose mass is drums is invisible to the entire derived kit — no plinth, no crown course, no
  // pier rank, no name board. Measured: five of the ten models in the whole 267-model registry
  // with no trim at all are drum-mass towers in one quarter. That is most of what reads as clay,
  // because a smooth cylinder has nothing on it to judge its size by.
  //
  // A COLLAR — a band round a drum, `parapet`'s own job on a curve. It is the cheapest thing that
  // gives a cylinder a scale you can count storeys against, which is exactly what `chrome_tower`'s
  // arm says in prose while hand-placing three of them.
  collar: (c, d) => {
    const r = c.V(d.r), z = c.V(d.z), hh = d.hh ? c.V(d.hh) : r * 0.06, N = Math.max(8, d.n || 16);
    const cap = shadeOf(d.pal || c.pal, 1.20), face = shadeOf(d.pal || c.pal, 0.76);
    // ⚠ THE RETURN IS DRAWN INWARD FROM THE BAND, NOT OUTWARD FROM THE DRUM. A collar oversails,
    // so its top surface runs from its own outer radius back to the shaft — drawn the other way it
    // is a shelf hanging in the air with a gap between it and the building.
    const back = Math.min(r * 0.9, hh * 1.6);
    for (let i = 0; i < N; i++) {
      const a0 = i / N * 6.2832, a1 = (i + 1) / N * 6.2832, am = (a0 + a1) / 2;
      const nx = Math.cos(am), ny = Math.sin(am);
      const x0 = c.lx + Math.cos(a0) * r, y0 = c.ly + Math.sin(a0) * r;
      const x1 = c.lx + Math.cos(a1) * r, y1 = c.ly + Math.sin(a1) * r;
      const i0x = c.lx + Math.cos(a0) * (r - back), i0y = c.ly + Math.sin(a0) * (r - back);
      const i1x = c.lx + Math.cos(a1) * (r - back), i1y = c.ly + Math.sin(a1) * (r - back);
      const cull = [nx * c.E[1] + ny * c.E[0], ny * c.E[1] - nx * c.E[0]];
      detailQuad(c.ctx, c.cam, c.F, [[x0, y0, z + hh], [x1, y1, z + hh], [x1, y1, z], [x0, y0, z]], face, c.alpha, { cullN: cull });
      detailQuad(c.ctx, c.cam, c.F, [[x0, y0, z + hh], [x1, y1, z + hh], [i1x, i1y, z + hh], [i0x, i0y, z + hh]], cap, c.alpha, {});
    }
  },
  // A RANK OF FINS ROUND A DRUM — `pilaster` on a curve, and the only part in this vocabulary that
  // changes a cylinder's SILHOUETTE rather than decorating its surface. ⚠ NEVER LIT: a line of
  // light up a fin is advertising, and this goes on every elevation of a round tower including the
  // one nobody can see. Same rule §1e states for the back of a box.
  drumfin: (c, d) => {
    const r = c.V(d.r), z0 = c.V(d.z0), z1 = c.V(d.z1), n = Math.max(3, d.n || 12);
    const out = d.out ? c.V(d.out) : r * 0.055, hw = d.hw ? c.V(d.hw) : r * 0.035;
    const lit = shadeOf(d.pal || c.pal, 1.14), side = shadeOf(d.pal || c.pal, 0.70);
    for (let i = 0; i < n; i++) {
      const a = (i + 0.5) / n * 6.2832, ca = Math.cos(a), sa = Math.sin(a);
      // Tangential, so a fin stands ACROSS the curve rather than pointing at its own centre.
      const tx = -sa, ty = ca;
      const ox = c.lx + ca * (r + out), oy = c.ly + sa * (r + out);
      const bx = c.lx + ca * r, by = c.ly + sa * r;
      const cull = [ca * c.E[1] + sa * c.E[0], sa * c.E[1] - ca * c.E[0]];
      // The face you see, and one flank to catch the shadow. The second flank is never visible at
      // the same time as the first on a convex hull, so it is not drawn.
      detailQuad(c.ctx, c.cam, c.F, [[ox - tx * hw, oy - ty * hw, z1], [ox + tx * hw, oy + ty * hw, z1],
        [ox + tx * hw, oy + ty * hw, z0], [ox - tx * hw, oy - ty * hw, z0]], lit, c.alpha, { cullN: cull });
      detailQuad(c.ctx, c.cam, c.F, [[ox + tx * hw, oy + ty * hw, z1], [bx + tx * hw, by + ty * hw, z1],
        [bx + tx * hw, by + ty * hw, z0], [ox + tx * hw, oy + ty * hw, z0]], side, c.alpha, {});
    }
  },
  // A coping band round the top of a mass. The cheapest thing on this list and the one that does
  // most: a bare lid is the single commonest reason a roof reads as unfinished from the air.
  parapet: (c, d) => {
    const half = c.V(d.half), z = c.V(d.z), hh = d.hh ? c.V(d.hh) : half * 0.12;
    const cap = shadeOf(d.pal || c.pal, 1.18), face = shadeOf(d.pal || c.pal, 0.78);
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ax = sx ? c.lx + sx * half : c.lx - half, ay = sy ? c.ly + sy * half : c.ly - half;
      const bx = sx ? c.lx + sx * half : c.lx + half, by = sy ? c.ly + sy * half : c.ly + half;
      detailQuad(c.ctx, c.cam, c.F, [[ax, ay, z + hh], [bx, by, z + hh], [bx, by, z], [ax, ay, z]], face, c.alpha, { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
      detailQuad(c.ctx, c.cam, c.F, [[ax, ay, z + hh], [bx, by, z + hh], [bx - sx * hh, by - sy * hh, z + hh], [ax - sx * hh, ay - sy * hh, z + hh]], cap, c.alpha, {});
    }
    // ── AND WHAT RUNS DOWN THE WALL UNDER IT ────────────────────────────────────────────────
    //
    // ⚠ THE ROOF EDGE IS WHERE A BUILDING GETS DIRTY, AND IT IS THE ONLY STREAK THE STREET SEES.
    // Rust bleed under the roof PLANT is the obvious place to put this and it is the wrong one: a
    // tank stands in the middle of a deck, so its stain is on a surface nobody at eye height will
    // ever look at. Water comes off the coping carrying whatever the roof is made of, and that runs
    // down the facade — which is the mark on every grubby building in every reference board.
    //
    // ⚠ NARROW STREAKS, NOT ONE WIDE WASH. A coping sheds at its low points, so what appears is two
    // or three thin runs at intervals. The tapering stain `dripStain` draws is what comes out of a
    // single opening; the full width of a parapet it would read as a tide mark.
    //
    // ⚠ FRONT FACE ONLY, AND RATIONED BY THE KIT. `parapet` is the most-instanced part in the whole
    // vocabulary — four sides at three streaks each is twelve quads a ring, three quarters of them
    // facing away from the street.
    if (d.bleed) {
      const run = half * (0.55 + 0.45 * d.bleed), yb = c.ly + half;
      for (const t of [-0.56, 0.07, 0.61]) {
        const x = c.lx + half * t, tw = Math.max(half * 0.045, 0.0015);
        detailQuad(c.ctx, c.cam, c.F,
          [[x - tw, yb, z], [x + tw, yb, z], [x + tw * 0.45, yb, z - run], [x - tw * 0.45, yb, z - run]],
          'rgba(78,50,30,0.26)', c.alpha, { lift: DETAIL_LIFT * 0.5 });
      }
    }
  },

  // ── A TAG ──────────────────────────────────────────────────────────────────────────────────
  //
  // Spray paint, and it is a PIECE — a word, in bubble letters, with a cloud behind it. See
  // bakeTagText, which is the whole of what it looks like and is shared with the paint a player
  // puts up themselves, so there is one idea in this game of what graffiti is.
  //
  // ⚠ THIS USED TO BE A HANDFUL OF SWEEPING STROKES AND THE NOTE SAID SO ON PURPOSE: "a legible
  // word would need a bake, a font and an ink decision, and at the range this reads from nobody
  // resolves letters anyway". Both halves turned out to be wrong. `drawWallTags` had to build that
  // bake for the player's own can, so the machinery was already here and free; and the range is a
  // truck cab two tiles from a shopfront, where a word is perfectly legible and four coloured
  // slashes read as a rendering fault. What reference photographs of a wall actually have on them
  // is somebody's NAME, which is the one thing abstract strokes cannot say.
  //
  // ⚠ IT IS A DECAL AND NOT GEOMETRY, WHICH IS WHY IT LEAVES THE MESH. `tileMesh` memoises per model
  // per scale, so anything captured there is shared by every tile drawing that model — fine for a
  // pipe and wrong for paint, and it is the same argument the `$name` board makes one entry down.
  //
  // ⚠ AND IT IS CLAMPED TO THE WALL IT IS ON. `cx` and `w` scale with `fh` and the mass they are
  // painted on does NOT, because `segFit` caps a box's half-width at 0.44 — so on a wide-footprint
  // roll the wall stops and the paint does not. Velk's Pre-Owned wore a tag with two fifths of it
  // hanging in clear air off the corner of the building, and no gate could see it: it drew
  // perfectly, every frame, identically. See wallSpanAt.
  tag: (c, d) => {
    if (SHAPE_SINK || MESH_SINK) return;      // a bake allocates a canvas — see the ⚠ above
    const wRaw = c.V(d.w), hh = d.hh ? c.V(d.hh) : wRaw * 0.55, z = c.V(d.z);
    if (!(wRaw > 0) || !(hh > 0)) return;
    const v = d.v | 0;
    const tex = bakeTagText(d.word || tagWordFor(v), null, d.color || '#b8f03a',
      c.night > 0.5 ? 1 : 0, v, d.n, d.hand || tagHandFor(v), d.face || null);
    if (!tex) return;
    // ⚠ FAILS CLOSED, WHICH IS THE OPPOSITE OF `massExtent`'s RULE AND FOR THE OPPOSITE REASON.
    // There, an unknown shape guesses LONG, because a tag buried inside a wall looks exactly like
    // the feature not being wired up. Here the answer is already known — this is the model's own
    // captured shape — so a piece that will not fit on the wall it is authored on is a piece on the
    // wrong wall, and shrinking it to a smear on a crane leg is worse than not painting it.
    // `anchored` names it at build time, so nothing disappears quietly.
    let cx = c.lx, w = wRaw;
    const span = wallSpanAt(c.m, c.seed, c.fh, c.h, c.ly, d.face === 'x', z - hh, z + hh, c.lx);
    if (span) {
      w = Math.min(w, (span.hi - span.lo) * 0.5 - TAG_WALL_MARGIN);
      if (!(w > wRaw * 0.4)) return;
      cx = clamp(cx, span.lo + TAG_WALL_MARGIN + w, span.hi - TAG_WALL_MARGIN - w);
    }
    const y = faceY(c.ly);
    const pts = [[cx - w, y, z + hh], [cx + w, y, z + hh], [cx + w, y, z - hh], [cx - w, y, z - hh]]
      .map(([lx, ly, lz]) => { const [wx, wy] = c.F(lx, ly); return c.cam.proj(wx, wy, lz); });
    if (!pts.every((q) => q && q.f > 0.12)) return;
    // ⚠ `onCanvas` IS FALSE AND `pull` IS THE DEFAULT HAIR — the same call `drawWallTags` makes, for
    // the same reason. There is no board under a tag: the paint is on the wall, the wall is in the
    // mesh, and the lettering only has to clear its own brickwork by a tie-breaker.
    emitSurfaceText(c.ctx, c.cam, pts, tex, false, c.alpha * 0.94, DETAIL_LIFT, false, FACE_EPS);
  },
  // Dirt on a wall with nothing making it. `dripStain` is the whole drawer: this part exists so a
  // face can be stained without a grille being invented to stain it — see the schema entry.
  //
  // ⚠ IT GOES IN THE MESH, unlike `tag` two entries up, and the difference is the bake. A tag
  // allocates a canvas and hands over a texture, which is why it refuses under a sink; a stain is
  // two translucent quads, which is exactly what `emitFlat` carries. So it is captured once per
  // model like the vent stains already are, and costs a GLASS 2 frame nothing at any range.
  grime: (c, d) => {
    const half = c.V(d.w), z = c.V(d.z);
    if (!(half > 0)) return;
    // ⚠ `faceY`, NOT `c.ly`. A stain is ON the wall, and a quad authored dead in its plane
    // z-fights into a stipple on a depth buffer — the same hair every other wall-mounted part
    // in this table takes, and the reason FACE_EPS exists.
    // ⚠ AND `drip` DEFAULTS TO 1 HERE RATHER THAN BEING REQUIRED. On a grille the field is the
    // opt-IN — absent means no stain, which is what keeps a roof unit from smearing mid-air — and
    // on this part the stain IS the part, so an absent `drip` that drew nothing would be a kind
    // whose only required fields are satisfied and which silently does not exist.
    dripStain(c, { drip: d.drip == null ? 1 : d.drip }, c.lx, faceY(c.ly), z, half);
  },
  // A painted sign board bolted to a wall — not neonBlade, which is a lit blade on its own mast.
  //
  // ⚠ THE BOARD AND THE LETTERING ARE TWO COLOURS, AND THEY USED TO BE ONE FIELD. `color` filled
  // the board AND was handed to bakeSignText as the ink, so a labelled board painted its own words
  // in its own colour and the label was invisible — cyan on cyan. `solid` lettering is deliberately
  // flat with no white core and no halo (see bakeSignText), so there was nothing left to read it
  // by. Voltage's rooftop VOLTAGE board shipped as a blank cyan rectangle for exactly this reason.
  //
  // `ink` is the lettering, and it DEFAULTS to legible rather than to `color`: dark ink on a light
  // board, bone ink on a dark one, picked off the board's own luminance. That keeps the one arm
  // that already authors a board (D_CIVIC, deliberately blank) pixel-identical, and means no
  // author has to state two colours to get a sign they can read.
  signBoard: (c, d) => {
    // ⚠ A SIGN WITH NOTHING TO SAY IS NOT DRAWN. `$name` resolves per TILE, so a model shared by a
    // named building and an unnamed one would otherwise hang a blank board on the unnamed one — and
    // a blank board is worse than no board, because it reads as a sign whose paint has come off.
    // ⚠ AND `$trade` FAILS THE SAME WAY. A model whose trade is in neither table resolves to an
    // empty string, and a blank board is worse than no board — it reads as a sign whose paint has
    // come off, which is the sentence above about `$name` word for word.
    const say = signLabel(d, c);
    if ((d.label === '$name' || d.label === '$trade') && !say) return;
    let half = c.V(d.half);
    const hh = c.V(d.hh), z = c.V(d.z), y = faceY(c.ly);
    // -- ⚠ `bare`: THE NAME WITH NO BOARD UNDER IT, PAINTED STRAIGHT ONTO THE WALL --------------
    //
    // A works does not hang a plate over its door. It has its name painted across the brickwork in
    // letters a storey high, and that is not a smaller version of a sign board -- it is the SAME
    // lettering with the board deleted, which is why it is a flag here rather than a new kind. A
    // `wallName` kind would have needed its own schema row, its own screen floor, its own entry in
    // FACE_PARTS and its own line in five sign gates, to draw the two lines of this function that
    // are already written.
    //
    // ⚠ CLAMPED TO THE WALL IT IS ON, WHICH A BOARD DOES NOT HAVE TO BE. A board is small and
    // centred; painted lettering spans most of a frontage, and `segFit` caps a box half-width at
    // 0.44 while this part's own `half` scales with `fh` -- so on a wide-footprint roll the wall
    // stops and the paint does not. Exactly the fault `tag` records under wallSpanAt, and it is
    // worse here: a tag is decoration and a name is the thing you are reading.
    //
    // ⚠ IT FAILS OPEN WHERE `tag` FAILS CLOSED. A piece on the wrong wall is better not painted;
    // a NAME that will not fit is shrunk, because a building whose name is withheld when the wall
    // is a little narrow is the unsigned city this whole section exists to end.
    const bare = !!d.bare;
    if (bare) {
      const span = wallSpanAt(c.m, c.seed, c.fh, c.h, c.ly, d.face === 'x', z - hh, z + hh, c.lx);
      if (span) {
        half = Math.min(half, Math.max((span.hi - span.lo) * 0.5 - TAG_WALL_MARGIN, 0));
        if (!(half > hh)) return;    // narrower than it is tall is not a name, it is a smear
      }
    }
    // ── ⚠ THE BOARD STANDS WHERE ITS LETTERING DOES ─────────────────────────────────────────
    //
    // The lettering stands `SIGN_BOARD_OUT` off the wall on purpose (kit fins and tubes bolted to
    // that wall have to stay behind the name, and `signfit` says so). The board used to stay at
    // `faceY`, a hair off the brick, so from any oblique seat the words slid clean off their own
    // plate by `out·cot θ`: "READ THE SENTINEL" half on the board and half on the stonework. So the
    // board goes out to meet the text, and short returns close the gap back to the wall, which is
    // what a real board a few inches proud of its facade looks like. Bare paint stays on the wall.
    const out = c.ly < 0 ? -1 : 1, yB = bare ? y : y + out * (SIGN_BOARD_OUT - FACE_EPS);
    const pts = [[c.lx - half, yB, z + hh], [c.lx + half, yB, z + hh], [c.lx + half, yB, z - hh], [c.lx - half, yB, z - hh]];
    const board = d.color || "#141018";
    // `$name` varies per TILE, so the board goes on the canvas in both renderers rather than into a
    // per-model mesh that cannot hold two answers — see the ⚠ on `paint` in emitFlat. A board with a
    // literal label is the same for every tile and meshes normally.
    const perTile = d.label === '$name';
    // ── ⚠ AND A BADGE HAS NO BOARD QUAD UNDER IT, WHICH IS THE WHOLE OF WHAT MAKES IT CURVED ───
    //
    // Every sign in this renderer is a quad and nothing here can draw a rounded one: there is no
    // curved primitive, and a disc approximated as a fan would be its own kind, its own mesh
    // budget and its own entry in five sign gates. But the PLATE does not have to be geometry —
    // `bakeSignText` already paints a canvas that this function maps onto the quad, so a badge
    // paints its own rounded plate INTO that canvas and leaves the corners transparent. The quad
    // stays exactly the quad it was; what you see is a disc.
    //
    // ⚠ SO THE FLAT BOARD MUST BE SKIPPED, or the square plate is drawn behind the round one and
    // the curve is invisible — which looks precisely like the feature not working.
    // ⚠ A PAINTED (`perTile`) BOARD IS A DECAL, AND ITS `lift` IS ALSO A PULL ALONG THE VIEW RAY. It
    // already stands out with the lettering, so it asks for less than the lettering's own FACE_EPS
    // lead or it lands in front of its own words.
    if (!bare && !d.badge) {
      detailQuad(c.ctx, c.cam, c.F, pts, board, c.alpha, { lift: perTile ? FACE_EPS * 0.5 : DETAIL_LIFT, stroke: "rgba(0,0,0,0.5)", lw: 1, paint: perTile });
      if (!perTile) {
        const edge = shadeOf(d.pal || c.pal, 0.5), zt = z + hh, zb = z - hh, L = c.lx - half, R = c.lx + half;
        for (const q of [[[L, y, zt], [R, y, zt], [R, yB, zt], [L, yB, zt]], [[L, y, zb], [R, y, zb], [R, yB, zb], [L, yB, zb]],
                         [[L, y, zt], [L, yB, zt], [L, yB, zb], [L, y, zb]], [[R, y, zt], [R, yB, zt], [R, yB, zb], [R, y, zb]]])
          detailQuad(c.ctx, c.cam, c.F, q, edge, c.alpha, { lift: DETAIL_LIFT });
      }
    }
    // ⚠ A MARK ON ITS OWN IS CONTENT, AND THIS TESTED `d.label` ALONE — the exact bug `signGantry`
    // and `bladePanel` both record in their own guards, in the one drawer that never got the fix.
    // The derived kit pushes a MARK-ONLY plate over the door of any building whose roof has taken
    // its name (see `roofTakesName`), and every one of them drew an empty lit rectangle: `$name`
    // is absent by design there, so `d.label` is undefined and the bake was never reached. A blank
    // board reads as a sign whose paint has come off, which is what this function's own opening ⚠
    // says it must never be.
    if (d.label || d.picto) {
      // Painted INTO the surface, never billboarded — the house rule for all world text.
      // ⚠ CROPPED TO THE INK AND THEN FITTED TO THE BOARD — see fitSignPts. This board's size comes
      // off the WALL and its label comes off the TILE, so the two can never have been sized against
      // each other: the same plate carries a four-letter name and a fourteen-letter one.
      // ⚠ `|| ''` IS LOAD-BEARING NOW THAT A MARK ALONE GETS HERE. An empty label is the whole
      // point of a badge — `bakeSignText` handles `''` by laying out no glyph run and centring the
      // mark — but `undefined` reaches `label.length` and throws inside the detail layer.
      const tex = bakeSignText(say, d.ink || inkFor(bare ? shadeOf(d.pal || c.pal, 1) : board), c.night ? 1 : 0, false, true, true, d);
      const w = pts.map(([lx, ly, z2]) => { const [wx, wy] = c.F(lx, ly); return c.cam.proj(wx, wy, z2); });
      if (w.every((q) => q.f > 0.12)) {
        // `perTile` boards are canvas-painted, so their lettering has to be too — see the ⚠ on
        // `onCanvas` in emitSurfaceText, or the board covers its own words in GLASS 2.
        // ⚠ AND BARE LETTERING CLEARS ONLY ITS OWN BRICKWORK. There is no board to get in front
        // of, so it takes the tie-breaker `tag` takes: at the board's `DETAIL_LIFT * 2.5` pull the
        // paint would stand a finger's width off the wall it is supposed to be ON, which shows as
        // a name sliding across its own building as you drive past it.
        emitSurfaceText(c.ctx, c.cam, w, tex, false, c.alpha * (bare ? 0.92 : 1),
          bare ? DETAIL_LIFT : DETAIL_LIFT * 2, false, bare ? FACE_EPS : FACE_EPS * 2);   // the board is already out at SIGN_BOARD_OUT
      }
    }
  },

  // ── THE STRUCTURAL FOUR ────────────────────────────────────────────────────
  //
  // Everything above this line is stuff BOLTED TO a wall — a pipe, a vent, a board, a cable. That
  // is why a model built entirely out of it still reads as a box: none of it changes the building's
  // silhouette or gives a facade any depth, so a flat wall wearing forty greebles is a flat wall.
  //
  // These four are the parts that make a facade have a FRONT AND A BACK. A window you can see into,
  // a slab that throws a shadow over the storey below, a board standing on legs, a panel hung proud
  // of the wall with a visible edge. They are the difference between the reference diorama and what
  // this format could express before them, and each one is still flat quads through `emitFlat` —
  // adornment, never mass, so collision and the cold-open skyline do not move.
  //
  // ⚠ ALL FOUR RESPECT THE FACE SIGN, WHICH THE OLDER PROJECTING PARTS DO NOT. `balcony` and
  // `fireEscape` compute their outer plane as `ly + out`, so on a face at NEGATIVE y they project
  // backwards into the building. That is latent rather than live — nothing authored today hangs one
  // off a back face — but a canopy is a part somebody will put on all four sides on the first day,
  // so these take `sgn` off the face and push outward from it.

  // A window that has a FRONT AND A BACK: a surround, glazing, a shadowed head and a sill you can
  // see the top of. The single biggest thing missing from the format, because a lit opening is
  // most of what reads as a building after dark and a painted-on rectangle never will.
  //
  // ⚠ IT IS BUILT PROUD OF THE WALL, NEVER RECESSED INTO IT, AND THE FIRST CUT WAS RECESSED. That
  // version put the glazing behind the wall plane with four reveal faces running back to it — the
  // honest way to model a window and the one thing neither of this game's renderers can draw.
  // `emitFlat` sorts on MEAN DEPTH, so a pane a few centimetres behind a wall sorts behind the
  // whole wall quad and the wall paints over it; and because the comparison is against the wall's
  // CENTRE, whether any given window survived depended on which half of the facade it sat on and
  // which way the camera was pointing — six of ten windows vanished, and the four that drew were
  // the four nearest the camera-facing edge. GLASS 2 is worse and quieter: a depth buffer occludes
  // a pane behind a wall CORRECTLY, so on the shipping renderer all ten would be gone, always.
  //
  // Nothing can cut a hole in a wall here — a box face is one quad — so a recess is not available
  // at any price. A surround standing proud reads as the same thing from every angle this game
  // uses, and is true in both renderers: at an oblique view you see the inside of the far jamb,
  // which is exactly the cue a reveal gives. `depth` is therefore how far the frame STANDS OUT.
  // ── A LIT FACADE, AS ONE LIGHT ────────────────────────────────────────────────────────────────
  //
  // Every lit pane in the city was a flat quad with an `rgbOverride` and nothing else: it looked
  // lit and it lit nothing. `pickLights` only ever sees `SPRITE_SINK`, so a window grid contributed
  // exactly zero to the wall wash, and a street of lit shopfronts threw no light on the building
  // opposite or on the road between them.
  //
  // ⚠ ONE PER FACADE, NEVER ONE PER PANE, AND THAT IS THE WHOLE DESIGN OF IT. There are twelve
  // uniform slots against ~120 lights in a dense frame, and `pickLights` ranks on `I * r / f` — so
  // forty window sprites on one block would evict every sign in the city and the picture would get
  // worse in exchange for being more correct. A facade's glow is what the eye reads anyway: the
  // lit panes are a texture, the wash they throw is one soft source.
  //
  // ⚠ AND IT IS SPRITE-SINK ONLY. `glowPool` falls back to a canvas blit when there is no sink,
  // which would put a radial gradient per facade onto the 2-D painter and move `framecost` — in the
  // one phase that looks like it could not touch it. The early return is the whole guard.
  // ⚠ AND IT IS DELIBERATELY NOT IN THIS TABLE, NOR IN `DETAIL_SCHEMA`. `facadeGlow` is a marker in
  // the derived list and nothing else: it emits a LIGHT and no geometry, it is read by
  // `facadeLights` rather than by `detailLayer`, and it is not something anybody should author into
  // a model file. Putting it here as well was redundant and `authoredDetailSmoke` was right to
  // refuse it — that gate runs a part with the mesh sink open and no sprite sink, so a light-only
  // part records nothing and every one of its required fields "changes nothing when removed".
  // A kind `detailLayer` has no drawer for is simply skipped, which is exactly the behaviour wanted.
  windowBay: (c, d) => {
    const half = c.V(d.half), hh = c.V(d.hh), z = c.V(d.z);
    const dep = d.depth ? c.V(d.depth) : Math.min(half, hh) * 0.35;
    const sgn = c.ly < 0 ? -1 : 1;
    const y = faceY(c.ly), yo = c.ly + sgn * dep;   // wall plane, and the frame's outer plane
    const P = d.pal || c.pal;
    const head = shadeOf(P, 0.34), sill = shadeOf(P, 1.28), jamb = shadeOf(P, 0.66), rim = shadeOf(P, 0.92);
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || {});
    const fr = Math.min(half, hh) * 0.26;           // frame width in the plane of the wall
    const ho = half + fr, vo = hh + fr;
    // 1) The surround, flat on the wall: one plate, so the frame is a shape and not four strips.
    Q([[c.lx - ho, y, z + vo], [c.lx + ho, y, z + vo], [c.lx + ho, y, z - vo], [c.lx - ho, y, z - vo]], rim, c.alpha, { lift: DETAIL_LIFT });
    // 2) The frame's returns — the surfaces that read as the reveal. Their SHADING ORDER is what
    //    sells it: the head faces down and sees no sky, the sill faces up and is the brightest
    //    thing on the facade, the jambs sit between. The depth itself is a few centimetres and
    //    nobody can measure it by eye; the order is what the eye actually reads.
    Q([[c.lx - half, y, z + hh], [c.lx + half, y, z + hh], [c.lx + half, yo, z + hh], [c.lx - half, yo, z + hh]], head, c.alpha, { lift: DETAIL_LIFT * 1.6 });
    Q([[c.lx - half, y, z - hh], [c.lx + half, y, z - hh], [c.lx + half, yo, z - hh], [c.lx - half, yo, z - hh]], sill, c.alpha, { lift: DETAIL_LIFT * 1.6 });
    // ⚠ A REVEAL JAMB FACES INWARD, so exactly one of the pair can ever be seen — the near one is
    // turned away from you by definition. Culling the other is free correctness AND the cheapest
    // saving on this pass: `windowBay` is by far the most-instanced part in the kit, so one quad
    // here is one quad times every window in the city.
    //
    // ⚠ AND THE JAMBS AND MULLIONS ARE MESH-ONLY, which is the same bargain `ADORN_NEAR` itself is
    // struck on. A depth-buffered quad is nearly free and a canvas one is not, so GLASS 2 carries
    // the whole reveal at every distance while the 2-D painter draws the four faces that actually
    // read — surround, head, sill, glass — and skips the two that are edge-on from almost every
    // angle. Putting the full set on the painter measured `framecost` **12.6% over** on the dense
    // cab frame against a 2% tolerance; this is most of the way back, and costs the GPU nothing.
    // The parts are still in the mesh, so nothing is lost on the renderer that ships.
    if (MESH_SINK) {
      for (const sx of [-1, 1]) {
        Q([[c.lx + sx * half, y, z + hh], [c.lx + sx * half, yo, z + hh], [c.lx + sx * half, yo, z - hh], [c.lx + sx * half, y, z - hh]], jamb, c.alpha,
          { lift: DETAIL_LIFT * 1.6, cullN: [-sx * c.E[1], sx * c.E[0]] });
      }
    }
    // 3) The glazing, at the BACK of the reveal — on the wall plane, where a window actually is.
    //    Lit from inside after dark, and a dark sheet by day: never the wall colour, because a
    //    window that matches its wall is a painted rectangle again.
    const yg = y + sgn * FACE_EPS;
    Q([[c.lx - half, yg, z + hh], [c.lx + half, yg, z + hh], [c.lx + half, yg, z - hh], [c.lx - half, yg, z - hh]],
      c.night ? (d.glow || '#cfe6ff') : (d.glass || '#243040'), c.alpha * (c.night ? 0.96 : 0.9), { lift: DETAIL_LIFT * 1.3 });
    // 4) Mullions and a transom, on the glazing. A shopfront is one sheet and a tenement window is
    //    four panes, and these two fields are the whole difference between them.
    const bars = MESH_SINK ? clamp(Math.round(d.bars || 0), 0, 6) : 0;   // mesh-only, see above
    const yb2 = yg + sgn * FACE_EPS;
    for (let i = 1; i <= bars; i++) {
      const bx = c.lx - half + (2 * half) * (i / (bars + 1)), t = Math.max(half * 0.02, 0.004);
      Q([[bx - t, yb2, z + hh], [bx + t, yb2, z + hh], [bx + t, yb2, z - hh], [bx - t, yb2, z - hh]], jamb, c.alpha, { lift: DETAIL_LIFT * 1.45 });
    }
    if (d.transom) {
      const tz = z + hh - 2 * hh * clamp(d.transom, 0.05, 0.95), t = Math.max(hh * 0.035, 0.004);
      Q([[c.lx - half, yb2, tz + t], [c.lx + half, yb2, tz + t], [c.lx + half, yb2, tz - t], [c.lx - half, yb2, tz - t]], jamb, c.alpha, { lift: DETAIL_LIFT * 1.45 });
    }
  },

  // A slab cantilevered out over the storey below, with a soffit you can see. The reference's
  // strongest single read: three of them, stacked, each with a coloured underside catching the
  // neon. `balcony` is not this — that is a small tray with a rail, and its underside is derived
  // from the wall palette, so it can never be the red that makes the reference work.
  //
  // ⚠ THE SOFFIT IS AUTHORED AND THE TOP IS NOT. Looking UP at a canopy is the common case in this
  // game — a truck cab sits at eye height 0 — so the underside is the face that carries the colour,
  // and deriving it from `pal` would put a grey slab where the design wants a lit one.
  canopy: (c, d) => {
    const half = c.V(d.half), out = c.V(d.out), z = c.V(d.z);
    const hh = d.hh ? c.V(d.hh) : Math.max(out * 0.14, 0.01);
    const sgn = c.ly < 0 ? -1 : 1;
    const y0 = c.ly, y1 = c.ly + sgn * out;
    const P = d.pal || c.pal;
    const top = shadeOf(P, 1.06), edge = shadeOf(P, 0.84);
    // ⚠ LIFTED, LIKE EVERY OTHER PART BOLTED TO A WALL. `emitFlat` sorts on the quad's MEAN depth
    // against the wall's, and a wall's mean is its CENTRE — so a slab attached near the far end of
    // a long facade sorts behind the whole facade and disappears, while the identical slab at the
    // near end draws. See the ⚠ on windowBay: this is the same trap, and the reason a projecting
    // part is not automatically safe from it.
    const L = { lift: DETAIL_LIFT * 1.4 };
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || L);
    Q([[c.lx - half, y0, z + hh], [c.lx + half, y0, z + hh], [c.lx + half, y1, z + hh], [c.lx - half, y1, z + hh]], top, c.alpha);          // deck
    Q([[c.lx - half, y1, z + hh], [c.lx + half, y1, z + hh], [c.lx + half, y1, z], [c.lx - half, y1, z]], edge, c.alpha);                    // fascia
    Q([[c.lx - half, y0, z], [c.lx + half, y0, z], [c.lx + half, y1, z], [c.lx - half, y1, z]], d.soffit || shadeOf(P, 0.44), c.alpha);      // soffit
    for (const sx of [-1, 1]) {   // the returns, so the slab has a thickness from the side too
      Q([[c.lx + sx * half, y0, z + hh], [c.lx + sx * half, y1, z + hh], [c.lx + sx * half, y1, z], [c.lx + sx * half, y0, z]], edge, c.alpha,
        { lift: DETAIL_LIFT * 1.4, cullN: [sx * c.E[1], -sx * c.E[0]] });
    }
    // ── AND THE RODS THAT HOLD THE FRONT EDGE UP ───────────────────────────────────────────────
    //
    // ⚠ A CANTILEVERED SLAB IS THE OTHER HALF OF THE FLOATING PROBLEM. The deck meets the wall
    // along its back edge and the leading edge is out in the air by `out`, so what the eye reads is
    // a plank stuck to a building. Every awning in every reference board is on tie rods back to the
    // facade, and they are the detail that says the thing has weight. Mesh-only, as the blade's are.
    //
    // ⚠ THE ROD LEANS BACK AND UP, which is what a tie does — a vertical prop under the front edge
    // would be a column, and a column has to reach the pavement.
    if (nearOrMesh()) {
      const rt = Math.max(out * 0.045, 0.003);
      const rod = bracketCol();
      const rise = out * 0.95;
      for (const sx of [-1, 1]) {
        const bx = c.lx + sx * half * 0.8;
        Q([[bx - rt, y1, z + hh], [bx + rt, y1, z + hh], [bx + rt, y0, z + hh + rise], [bx - rt, y0, z + hh + rise]], rod, c.alpha,
          { lift: DETAIL_LIFT * 1.5 });
      }
    }
    // Strip lighting tucked under the leading edge — the reason a canopy reads at night at all.
    if (d.strip) {
      const t = Math.max(hh * 0.35, 0.005), yl = y1 - sgn * out * 0.12;
      Q([[c.lx - half * 0.94, yl, z + t], [c.lx + half * 0.94, yl, z + t], [c.lx + half * 0.94, yl, z], [c.lx - half * 0.94, yl, z]],
        d.strip, c.alpha * (c.night ? 1 : 0.55), { lift: DETAIL_LIFT * 1.9 });
    }
  },

  // A billboard STANDING ON A ROOF, on legs you can see. This is the part the floating rooftop
  // sign was reaching for and missing: Voltage authored a board at z 1.42 over a roof at 1.2 and
  // propped it with two `pipe` runs that stopped at 1.31, so there was a clear tile of empty air
  // under a hovering slab. A gantry owns its own legs, so the board cannot be anywhere its
  // structure is not.
  // ⚠ A `$name` GANTRY IS PER-TILE AND THEREFORE NEVER IN THE MESH — the same three lines
  // `signBoard` already runs on, which this kind was written without, and the difference was 84
  // models wearing a lit, framed, EMPTY board over the roof.
  //
  // A mesh is captured ONCE PER MODEL and shared by every tile drawing it, while `$name` is a
  // property of the TILE — so a board whose text varies cannot be meshed at all, and its geometry
  // has to stay on the canvas in both renderers. `emitFlat`'s `paint` flag is that, and it is what
  // makes the guard below work: refuse to draw, and nothing is left behind in a mesh to show
  // through. (Refusing WITHOUT `paint` is strictly worse and was measured — the board stays in the
  // mesh, the painter stops running, and the sign vanishes on named tiles too.)
  //
  // ⚠ AND THE LETTERING FOLLOWS ITS BOARD ONTO THE CANVAS. The GL canvas is composited BEFORE the
  // 2-D pass, so a decal under a canvas-painted board is covered by its own board — which reads
  // exactly like text that failed to render. `onCanvas` is that, and it is why `perTile` is passed
  // twice rather than computed twice.
  signGantry: (c, d) => {
    const perTile = d.label === '$name';
    // A sign with nothing to say is not drawn: a blank board reads as one whose paint has come off.
    const say = signLabel(d, c);
    if ((perTile || d.label === '$trade') && !say) return;
    const half = c.V(d.half), hh = c.V(d.hh), z = c.V(d.z), rise = d.rise ? c.V(d.rise) : hh * 0.9;
    const P = d.pal || c.pal;
    const leg = shadeOf(P, 0.52), frame = shadeOf(P, 0.78);
    const board = d.color || '#141018';
    const y = faceY(c.ly), zb = z + rise, zt = zb + 2 * hh;
    // ⚠ THE WHOLE FITTING TAKES `paint`, NOT ONLY THE BOARD. Legs and trim in the mesh with the
    // board on the canvas is a gantry that half-disappears on an unnamed tile — two legs and a lit
    // frame round nothing, which is a worse object than the blank board this guard exists to stop.
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, { ...(o || {}), paint: perTile, tag: 'gantry' });
    // ── THE HOARDING IS A SLAB ON POSTS (`RENDER_TUNE.gantry3d`, 0 puts the single plane back) ──────
    //
    // The schema calls this "a billboard standing on a roof, on its own legs" and it was drawn as
    // one quad at a fixed y with two more for the legs — a plane and two stripes. It is the one
    // adornment in the city whose whole job is to stand UP off a roofline against the sky, which is
    // exactly the silhouette a plane cannot hold: from anywhere off its own axis it thins to a line
    // and the legs go with it.
    //
    // ⚠ IT IS MESH, NOT A DECAL, so the extra faces are real depth-tested geometry rather than more
    // canvas work — `detailQuad` goes through `emitFlat`. That is also why they can be CULLED
    // properly: a box has six sides and you see at most three, so the back, the far edge and the
    // soffit carry a `cullN` and cost nothing when they are turned away.
    //
    // ⚠ THE LEGS TAKE THE `pipe` IDIOM — two strips at right angles rather than a four-sided post.
    // Its own note in this file makes the argument: that "reads as a round pipe from any angle a
    // wall is seen from and costs two quads instead of a drum", and a sign leg is the same problem.
    const dp = RENDER_TUNE.gantry3d !== 0 ? Math.max(hh * 0.11, 0.006) : 0;
    const out = y < 0 ? -1 : 1;                       // which way the board FACES — the side it was authored on
    const yF = y + out * dp, yB = y - out * dp;
    const nF = [out * c.E[0], out * c.E[1]];
    for (const sx of [-1, 1]) {   // two legs, splayed in a little from the board's own width
      const lx = c.lx + sx * half * 0.62, t = Math.max(half * 0.045, 0.005);
      Q([[lx - t, yF, zb + hh * 0.2], [lx + t, yF, zb + hh * 0.2], [lx + t, yF, z], [lx - t, yF, z]], leg, c.alpha, { lift: DETAIL_LIFT });
      if (dp) Q([[lx, yF + t, zb + hh * 0.2], [lx, yF - t, zb + hh * 0.2], [lx, yF - t, z], [lx, yF + t, z]], shadeOf(P, 0.40), c.alpha, { lift: DETAIL_LIFT });
    }
    const pts = [[c.lx - half, yF, zt], [c.lx + half, yF, zt], [c.lx + half, yF, zb], [c.lx - half, yF, zb]];
    // A painted (`perTile`) board is a decal pulled by its lift, so it asks for less than the lettering's own lead.
    Q(pts, board, c.alpha, { lift: perTile ? FACE_EPS * 0.5 : DETAIL_LIFT, stroke: 'rgba(0,0,0,0.5)', lw: 1 });
    if (dp) {
      // The back of a hoarding is bare board and dimmer than its painted face.
      Q([[c.lx + half, yB, zt], [c.lx - half, yB, zt], [c.lx - half, yB, zb], [c.lx + half, yB, zb]], shadeOf(P, 0.44), c.alpha,
        { lift: DETAIL_LIFT, cullN: [-nF[0], -nF[1]] });
      for (const sx of [-1, 1]) {   // the two edge returns, which are what give it a thickness you can see
        Q([[c.lx + sx * half, yF, zt], [c.lx + sx * half, yB, zt], [c.lx + sx * half, yB, zb], [c.lx + sx * half, yF, zb]], frame, c.alpha,
          { lift: DETAIL_LIFT, cullN: [sx * c.E[1], -sx * c.E[0]] });
      }
      Q([[c.lx - half, yF, zt], [c.lx + half, yF, zt], [c.lx + half, yB, zt], [c.lx - half, yB, zt]], frame, c.alpha, { lift: DETAIL_LIFT });
      Q([[c.lx - half, yB, zb], [c.lx + half, yB, zb], [c.lx + half, yF, zb], [c.lx - half, yF, zb]], shadeOf(P, 0.32), c.alpha, { lift: DETAIL_LIFT });
    }
    // A lit frame round the board — the neon tube that makes the reference's sign a sign and not
    // a rectangle. Drawn proud of the board so it survives a depth buffer.
    // ⚠ PROUD OF THE BOARD'S FACE, NOT OF THE BOARD'S CENTRE — see RENDER_TUNE.glBoardDepth. This
    // measured FACE_EPS off `y`, which is the slab's middle, and was right until `gantry3d` gave the
    // slab a thickness: the painted face then moved forward to `yF` and the trim did not, so the
    // frame sat INSIDE the board it is bolted to. A painter's queue drew it anyway (the trim is a
    // later entry at the same lift, so it simply painted over), and the moment the board writes its
    // own depth the frame is behind an opaque slab and disappears — measured on 371 quad pairs, and
    // visible as the gold rim vanishing off every hoarding in the city.
    const yFace = yF + out * FACE_EPS;
    if (d.trim) {
      // ── ⚠ A FRAME IS A TUBE IN A CHANNEL, AND THIS WAS FOUR BARS PAINTED THE ACCENT COLOUR ────
      //
      // The four quads below are still here and they are still the right object — a sign has a
      // steel surround and the tube is mounted in it — but they were being FILLED with `d.trim`,
      // the building's own burning accent, so the whole frame was a flat bright rectangle. That is
      // a picture frame: it has the colour of neon and none of the behaviour — no core, no halo,
      // the same value at noon as at midnight — and it is most of why the reference boards read as
      // a lit city and this read as a gold border round a plate.
      //
      // `neonRun` already owns this exactly: the channel in the palette's own shadow, the tube in
      // the accent, ONE polyline so the corners mitre rather than butt. So the surround goes back
      // to being metal and the light is allowed to be a light.
      //
      // ⚠ AND THE HALO IS HANDED OVER ONLY WHEN THERE IS A SINK TO TAKE IT — `neonRun`'s own note
      // in full: on the GPU a glow is one more additive quad and on the 2-D painter it is
      // `shadowBlur`, the single most expensive call canvas2d has, against a committed budget.
      // Without a sink this is a plain bright line, which is the part that carries the idea.
      const t = Math.max(hh * 0.06, 0.004), yf = yFace;
      const richTrim = MESH_SINK || (STROKE_SINK && TUNE.glDeco);
      const chanCol = shadeOf(P, 0.36);
      for (const [z0, z1] of [[zt - t, zt], [zb, zb + t]]) Q([[c.lx - half, yf, z1], [c.lx + half, yf, z1], [c.lx + half, yf, z0], [c.lx - half, yf, z0]], chanCol, c.alpha, {});
      for (const sx of [-1, 1]) Q([[c.lx + sx * half - t, yf, zt], [c.lx + sx * half + t, yf, zt], [c.lx + sx * half + t, yf, zb], [c.lx + sx * half - t, yf, zb]], chanCol, c.alpha, {});
      // ⚠ THE TUBE RUNS INSIDE THE CHANNEL AND PROUD OF IT. Left coplanar with the surround it is a
      // depth-buffer tie against the very bar it is bolted into, which is `FACE_EPS`'s whole job.
      const rgbT = hexRgb(d.trim).join(',');
      const yT = yf + out * FACE_EPS, iz = t * 0.9;
      const ring = [[c.lx - half + iz, yT, zb + iz], [c.lx + half - iz, yT, zb + iz],
                    [c.lx + half - iz, yT, zt - iz], [c.lx - half + iz, yT, zt - iz],
                    [c.lx - half + iz, yT, zb + iz]];
      emitLightRunner(c.ctx, c.cam, ring.map(([lx, ly, pz]) => { const [wx, wy] = c.F(lx, ly); return [wx, wy, pz]; }),
        `rgba(${rgbT},${c.night ? 0.95 : 0.45})`, c.alpha, c.night, richTrim ? rgbT : null, DETAIL_LIFT * 2.2, undefined, 'signtube');
    } else {
      for (const sx of [-1, 1]) {   // otherwise a plain steel surround, which most boards have
        const t = Math.max(half * 0.03, 0.004);   // ⚠ on the board's FACE, for the reason above
        Q([[c.lx + sx * half - t, yFace, zt], [c.lx + sx * half + t, yFace, zt], [c.lx + sx * half + t, yFace, zb], [c.lx + sx * half - t, yFace, zb]], frame, c.alpha, { lift: DETAIL_LIFT * 1.2 });
      }
    }
    // ⚠ A MARK ON ITS OWN IS CONTENT, AND THIS USED TO TEST `d.label` ALONE. `bakeSignText` puts the
    // pictogram and the lettering on one canvas, so a board carrying only a mark — the logo hoarding
    // the derived kit hangs on a building that has already lettered itself — baked nothing, drew
    // nothing, and stood on the roof as an empty lit frame. An empty label is the whole point of it,
    // not the absence of one: the bake handles `''` (no glyph run, the mark centred) and `fitSignPts`
    // then takes the square middle of the board.
    if (d.label || d.picto) {
      // Cropped and fitted, exactly as `signBoard` is and for the same reason — a hoarding is sized
      // off the deck it stands on and lettered with whatever the tile is called.
      const tex = bakeSignText(say, d.ink || inkFor(board), c.night ? 1 : 0, false, !d.neon, true, d);
      const w = pts.map(([lx, ly, z2]) => { const [wx, wy] = c.F(lx, ly); return c.cam.proj(wx, wy, z2); });
      if (w.every((q) => q.f > 0.12)) {
        // ⚠ THE PULL IS MEASURED FROM `yF`, THE BOARD'S OWN FACE, so it only has to win a tie with
        // the board and clear the surround channel at `yFace`. It was `DETAIL_LIFT * 2.5` — 0.05 of a
        // tile, a fifth of a typical hoarding's height — which stood the tube lettering visibly off
        // the front of its board from any oblique seat ("neon too far off sign"). 0.03 still did it
        // on a small roof board seen low and oblique ("PAWNBROKER" hanging off its hoarding), so it
        // is `FACE_EPS * 2` now: past the surround at `yFace` and no further. Chrome Clinic's
        // fitting then crosses its name from one heading; that is on `signfit`'s KNOWN list.
        emitSurfaceText(c.ctx, c.cam, w, tex, false, c.alpha, DETAIL_LIFT * 2, false, FACE_EPS * 2);
      }
    }
  },

  // A sign panel hung PROUD of a wall, with a visible edge return — the orange slab down the
  // corner of the reference. Not `neonBlade`, and the difference is the whole complaint: that
  // helper's half-width is in SCREEN PIXELS (clamped 2..9), so it is a billboard that keeps a
  // constant thickness however you move, never foreshortens, and reads as a sticker floating in
  // front of the building. This is world geometry — it has a front, two edges and a real depth, so
  // it turns with the building, and at a grazing angle you see the side of it like you should.
  bladePanel: (c, d) => {
    // ⚠ A PANEL WITH NOTHING TO SAY IS NOT PUT UP — the rule `signBoard` opens with, the rule
    // `signGantry` enforces with its own `perTile` return, and the rule the roof hoarding states
    // as "NO MARK MEANS NO HOARDING, rather than a blank board". This drawer was the one that
    // never got it, and it is the biggest sign fitting in the kit. Measured over 227 models at
    // eight seeds: 27 corner blades and 68 gable-end ad panels a city carried NEITHER a label nor
    // a mark — a lit, framed, empty plate, which reads as a sign whose paint has come off rather
    // than as a building without one.
    // ⚠ AND `$name` RESOLVES PER TILE, so a model shared by a named building and an unnamed one
    // has to be asked here rather than where the list was built. A mark is still content: a panel
    // that has one stands even when the tile is nameless.
    if (!d.picto && !signLabel(d, c)) return;
    const half = c.V(d.half), z0 = c.V(d.z0), z1 = c.V(d.z1);
    const out = d.out ? c.V(d.out) : half * 0.5;
    const sgn = c.ly < 0 ? -1 : 1;
    const y0 = c.ly, y1 = c.ly + sgn * out;
    const face = d.color || c.neon || '#5cd6ff';
    const side = shadeOf(d.pal || c.pal, 0.5);
    const L = { lift: DETAIL_LIFT * 1.5 };   // see the ⚠ on canopy: mean-depth sorting, same trap
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || L);
    // The two edge returns and the caps: the parts that give it thickness, drawn first so the lit
    // face lands on top of their joint.
    for (const sx of [-1, 1]) {
      Q([[c.lx + sx * half, y0, z1], [c.lx + sx * half, y1, z1], [c.lx + sx * half, y1, z0], [c.lx + sx * half, y0, z0]], side, c.alpha,
        { lift: DETAIL_LIFT * 1.5, cullN: [sx * c.E[1], -sx * c.E[0]] });
    }
    for (const z of [z0, z1]) Q([[c.lx - half, y0, z], [c.lx + half, y0, z], [c.lx + half, y1, z], [c.lx - half, y1, z]], side, c.alpha);
    // ── AND THE THING HOLDING IT UP ────────────────────────────────────────────────────────────
    //
    // ⚠ A BLADE TOUCHES ITS BUILDING ALONG ONE EDGE AND HANGS OFF NOTHING. It projects `out` from
    // the wall, so from anywhere off square you are looking at a lit board standing in mid-air
    // beside a building — which is the single loudest "that is not attached to anything" read in
    // the city, on 140 instances of it. A spine up the wall and two arms out to the panel is what
    // actually carries a hanging sign, and it is the difference between a sticker and a fixture.
    //
    // ⚠ MESH-ONLY, the bargain `bars` already makes one painter up. The 2-D painter is held to its
    // committed `framecost` and a depth buffer draws these for nothing, so GLASS 2 — the default —
    // gets the structure and the canvas renderer is a provable no-op.
    if (nearOrMesh()) {
      const mt = Math.max(half * 0.07, 0.004);                 // the spine's half-thickness
      const steel = bracketCol();
      const span = z1 - z0;
      Q([[c.lx - mt, y0, z1], [c.lx + mt, y0, z1], [c.lx + mt, y0, z0], [c.lx - mt, y0, z0]], steel, c.alpha, { lift: DETAIL_LIFT });
      for (const az of [z0 + span * 0.14, z1 - span * 0.14]) {
        // Seen edge-on from the front and as a real bracket from the side, which is the angle the
        // gap was visible from in the first place. Two-sided: a strut has no back.
        Q([[c.lx, y0, az], [c.lx, y1, az], [c.lx, y1, az - mt * 1.8], [c.lx, y0, az - mt * 1.8]], steel, c.alpha, { lift: DETAIL_LIFT * 1.2 });
      }
    }
    const pts = [[c.lx - half, y1, z1], [c.lx + half, y1, z1], [c.lx + half, y1, z0], [c.lx - half, y1, z0]];
    // ── ⚠ A NEON BOX IS A DARK PANEL WITH LIGHT ON IT, WHICH `marqueeBand` ALREADY LEARNED ──────
    //
    // That helper's own note states it in full and this kind never got it: "the face is dark — a
    // neon box is a black panel with light ON it; flooding the whole face with the hue leaves the
    // lettering nothing to be brighter than, which is the single biggest reason the old one looked
    // flat". This was flooding the whole blade with `c.neon` and then lettering it, so a corner
    // blade was a solid coloured slab with slightly brighter shapes on it — the same flat read the
    // frame two functions up had, on the one fitting that is meant to be seen from down the street.
    //
    // ⚠ THE HUE IS NOT THROWN AWAY, IT MOVES TO THE TUBE. The panel keeps a wash of its own colour
    // near the edge (a box lit from its perimeter is brighter at the perimeter) and the saturated
    // accent goes into a run of glass round the inside of it, on the same `emitLightRunner` the
    // frame and `neonRun` use — so the blade's colour still identifies the trade at range, as a
    // light rather than as a fill.
    const dRGB = mix(hexRgb(face), [11, 9, 16], c.night ? 0.82 : 0.66);
    const dark = `rgb(${dRGB[0] | 0},${dRGB[1] | 0},${dRGB[2] | 0})`;
    Q(pts, dark, c.alpha * (c.night ? 1 : 0.92), { lift: DETAIL_LIFT * 2 });
    {
      const richBlade = MESH_SINK || (STROKE_SINK && TUNE.glDeco);
      const rgbB = hexRgb(face).join(',');
      const iw = half * 0.22, ih = Math.min((z1 - z0) * 0.06, half * 0.5);
      const yB = y1 + sgn * FACE_EPS;
      const ringB = [[c.lx - half + iw, yB, z0 + ih], [c.lx + half - iw, yB, z0 + ih],
                     [c.lx + half - iw, yB, z1 - ih], [c.lx - half + iw, yB, z1 - ih],
                     [c.lx - half + iw, yB, z0 + ih]];
      emitLightRunner(c.ctx, c.cam, ringB.map(([lx, ly, pz]) => { const [wx, wy] = c.F(lx, ly); return [wx, wy, pz]; }),
        `rgba(${rgbB},${c.night ? 0.95 : 0.45})`, c.alpha, c.night, richBlade ? rgbB : null, DETAIL_LIFT * 2.4, undefined, 'signtube');
    }
    // ⚠ A PICTOGRAM ON ITS OWN IS ENOUGH, and the gate read `d.label` alone. A blade carrying a
    // mark and no lettering drew a blank panel — which is exactly what the derived kit needs to
    // hang on a bar, because that list is cached per MODEL and cannot know how long the name on
    // any one building will turn out to be.
    if (d.label || d.picto) {
      // ⚠ FITTED, AND ON A BLADE THE LIMITING AXIS IS ALMOST ALWAYS THE WIDTH. A vertical bake is a
      // CELL per character stacked down a column, so its aspect is 1:n — a four-letter name is 1:4
      // and a ten-letter one is 1:10 on the same panel. Unfitted, the first is drawn at two and a
      // half times the letter width of the second on identical hardware.
      const txt = signLabel(d, c);
      // ── ⚠ THE BAKE FOLLOWS THE PANEL'S SHAPE, AND IT USED TO BE VERTICAL FOR EVERYTHING ────────
      //
      // This kind draws two panels that are not the same object. A corner blade is a tall slab read
      // top-to-bottom, and a vertical bake — one square CELL per character down a column — is
      // exactly right for it. A gable-end ad panel is a WIDE letterbox, about 2.4:1, and a column of
      // letters laid on it is fitted to the shorter axis and comes out a narrow strip stranded in
      // the middle of a billboard. So the part says which it is and this reads it.
      // ⚠ `tight` GOES WITH IT. It crops the canvas to the ink, which is what lets `fitSignPts`
      // size a quad to the texture rather than stretching the texture onto the quad — the bargain
      // `signBoard` and `signGantry` already take, and the reason a fourteen-letter name and a
      // four-letter one both come out at true proportions on the same panel. It is inert under a
      // vertical bake, so the blade is unchanged by construction.
      const vert = !d.horiz;
      const tex = bakeSignText(txt, d.ink || inkFor(face), c.night ? 1 : 0, vert, true, !vert, d);
      const w = pts.map(([lx, ly, z2]) => { const [wx, wy] = c.F(lx, ly); return c.cam.proj(wx, wy, z2); });
      if (w.every((q) => q.f > 0.12)) {
        // `vertical` down the panel, which is what a hung blade is for. Painted ink rather than
        // neon: the panel itself is the lit surface, so a glowing letter on a glowing board is the
        // same soup `signBoard` used to make.
        // ⚠ SEVEN ARGUMENTS, AND THIS CALL PASSED SIX. `bakeSignText` is (label, color, dn,
        // vertical, solid, TIGHT, opts) and `d` was landing on `tight` with `opts` left undefined —
        // so a blade's `font` and `picto` were read off nothing and silently fell back to mono and
        // no mark, on every blade that has ever drawn. The schema promises both keys on all three
        // sign kinds; two of the three delivered. `tight` is inert under `vertical` either way,
        // which is why nothing looked wrong enough to chase.
        emitSurfaceText(c.ctx, c.cam, w, tex, vert, c.alpha, DETAIL_LIFT * 2);
      }
    }
  },

  // ── THE INDUSTRIAL FOUR ────────────────────────────────────────────────────
  //
  // A working building is mostly the machinery bolted to the outside of it: ducting the size of a
  // corridor, an extract stack, banks of louvres, a water tank up on a frame. `pipe` and `vent` are
  // the domestic-scale versions of two of those and there was nothing at all for the other two.

  // BIG external ducting: a trunk up a face, an elbow, and an arm running off along the wall. The
  // single most recognisable thing on an industrial building, and the reason `pipe` is not enough —
  // a downpipe is a line, and a duct is a volume with ribs that reads at fifty metres.
  //
  // Drawn as crossed strips like `pipe`, for the same reason: two quads read as a cylinder from any
  // angle a wall is seen from, and cost a fraction of a drum. The RIBS are what separate it from a
  // fat pipe — a smooth tube of this diameter reads as a silo.
  ductRun: (c, d) => {
    const r = c.V(d.r), z0 = c.V(d.z0), z1 = c.V(d.z1);
    const run = d.run ? c.V(d.run) : 0;
    const sgn = c.ly < 0 ? -1 : 1;
    const y = c.ly + sgn * r;                       // the trunk stands off the wall by its own radius
    const P = d.pal || c.pal;
    const col = shadeOf(P, 0.8), lit = shadeOf(P, 1.05), rib = shadeOf(P, 0.58);
    const L = { lift: DETAIL_LIFT * 1.6 };
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || L);
    Q([[c.lx - r, y, z1], [c.lx + r, y, z1], [c.lx + r, y, z0], [c.lx - r, y, z0]], col, c.alpha);
    Q([[c.lx, y - r, z1], [c.lx, y + r, z1], [c.lx, y + r, z0], [c.lx, y - r, z0]], lit, c.alpha, { lift: DETAIL_LIFT * 1.9 });
    const ribs = clamp(Math.round((z1 - z0) / Math.max(r * 1.8, 0.02)), 0, 14);
    for (let i = 1; i <= ribs; i++) {
      const zz = z0 + (z1 - z0) * (i / (ribs + 1)), t = r * 0.16;
      Q([[c.lx - r * 1.18, y, zz + t], [c.lx + r * 1.18, y, zz + t], [c.lx + r * 1.18, y, zz - t], [c.lx - r * 1.18, y, zz - t]], rib, c.alpha, { lift: DETAIL_LIFT * 2.2 });
    }
    if (!run) return;
    // The elbow and the arm. `run` is signed, so a duct can turn either way along the wall.
    const ex = c.lx + run, zz = z1;
    Q([[c.lx - r, y, zz + r], [ex, y, zz + r], [ex, y, zz - r], [c.lx - r, y, zz - r]], col, c.alpha);
    Q([[c.lx - r, y - r, zz], [ex, y - r, zz], [ex, y + r, zz], [c.lx - r, y + r, zz]], lit, c.alpha, { lift: DETAIL_LIFT * 1.9 });
    const n2 = clamp(Math.round(Math.abs(run) / Math.max(r * 1.8, 0.02)), 0, 14);
    for (let i = 1; i <= n2; i++) {
      const xx = c.lx + run * (i / (n2 + 1)), t = r * 0.16;
      Q([[xx - t, y, zz + r * 1.18], [xx + t, y, zz + r * 1.18], [xx + t, y, zz - r * 1.18], [xx - t, y, zz - r * 1.18]], rib, c.alpha, { lift: DETAIL_LIFT * 2.2 });
    }
  },

  // An extract stack with a cowl. Roof-mounted, and the one part on this list whose whole job is to
  // break a flat roofline — from the air a roof is the biggest surface a building has.
  stack: (c, d) => {
    const r = c.V(d.r), z = c.V(d.z), hh = c.V(d.hh);
    const P = d.pal || c.pal;
    const body = shadeOf(P, 0.74), lit = shadeOf(P, 1.02), band = shadeOf(P, 0.5);
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || {});
    const zt = z + hh;
    Q([[c.lx - r, c.ly, zt], [c.lx + r, c.ly, zt], [c.lx + r, c.ly, z], [c.lx - r, c.ly, z]], body, c.alpha);
    Q([[c.lx, c.ly - r, zt], [c.lx, c.ly + r, zt], [c.lx, c.ly + r, z], [c.lx, c.ly - r, z]], lit, c.alpha);
    for (const t of [0.34, 0.68]) {   // strapping bands
      const zz = z + hh * t, th = r * 0.14;
      Q([[c.lx - r * 1.2, c.ly, zz + th], [c.lx + r * 1.2, c.ly, zz + th], [c.lx + r * 1.2, c.ly, zz - th], [c.lx - r * 1.2, c.ly, zz - th]], band, c.alpha);
    }
    // The cowl: a wider cap with a lip, which is the silhouette that says extract rather than mast.
    const cr = r * 1.7, ct = hh * 0.1;
    Q([[c.lx - cr, c.ly - cr, zt + ct], [c.lx + cr, c.ly - cr, zt + ct], [c.lx + cr, c.ly + cr, zt + ct], [c.lx - cr, c.ly + cr, zt + ct]], shadeOf(P, 1.12), c.alpha);
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ax = sx ? c.lx + sx * cr : c.lx - cr, ay = sy ? c.ly + sy * cr : c.ly - cr;
      const bx = sx ? c.lx + sx * cr : c.lx + cr, by = sy ? c.ly + sy * cr : c.ly + cr;
      Q([[ax, ay, zt + ct], [bx, by, zt + ct], [bx, by, zt], [ax, ay, zt]], band, c.alpha, { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
    }
  },

  // A bank of louvres — the big sibling of `vent`. A plant room, a substation and a server hall are
  // all mostly this, and at these sizes the SLAT COUNT is what says which: a few deep blades read as
  // industrial intake, a dense stack reads as an air-handling wall.
  louvreBank: (c, d) => {
    const half = c.V(d.half), hh = c.V(d.hh), y = faceY(c.ly);
    const z = c.V(d.z), P = d.pal || c.pal;
    dripStain(c, d, c.lx, y, z - hh, half);
    const back = shadeOf(P, 0.3), blade = shadeOf(P, 0.72), edge = shadeOf(P, 0.95);
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || {});
    Q([[c.lx - half, y, z + hh], [c.lx + half, y, z + hh], [c.lx + half, y, z - hh], [c.lx - half, y, z - hh]], back, c.alpha, { lift: DETAIL_LIFT });
    const n = clamp(Math.round(d.n || 6), 2, 16);
    const sgn = c.ly < 0 ? -1 : 1, yb = y + sgn * FACE_EPS;
    const step = (2 * hh) / n;
    for (let i = 0; i < n; i++) {
      const zt = z + hh - step * i, t = step * 0.42;
      Q([[c.lx - half * 0.97, yb, zt], [c.lx + half * 0.97, yb, zt], [c.lx + half * 0.97, yb, zt - t], [c.lx - half * 0.97, yb, zt - t]], blade, c.alpha, { lift: DETAIL_LIFT * 1.5 });
    }
    for (const sx of [-1, 1]) {   // the frame, so the bank has an edge rather than fraying out
      const t = Math.max(half * 0.05, 0.004);
      Q([[c.lx + sx * half - t, yb, z + hh], [c.lx + sx * half + t, yb, z + hh], [c.lx + sx * half + t, yb, z - hh], [c.lx + sx * half - t, yb, z - hh]], edge, c.alpha, { lift: DETAIL_LIFT * 1.8 });
    }
  },

  // A tank up on an open braced frame. `roofTank` is the domestic version — a drum on four stubs;
  // this is the one that stands a storey above the roof on a lattice and is visible from streets
  // away. The BRACING is the whole silhouette: four legs alone read as a table.
  tankFrame: (c, d) => {
    const r = c.V(d.r), hh = c.V(d.hh), z = c.V(d.z), rise = c.V(d.rise);
    const P = d.pal || c.pal;
    const leg = shadeOf(P, 0.42), body = shadeOf(P, 0.86), lid = shadeOf(P, 1.16), band = shadeOf(P, 0.62);
    const Q = (pts, fill, a, o) => detailQuad(c.ctx, c.cam, c.F, pts, fill, a, o || {});
    const t = Math.max(r * 0.08, 0.005);
    // Four legs, and an X across each of the two faces that read: a brace on the near pair is what
    // makes the gap under the tank look structural instead of empty.
    for (const [ax, ay] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) {
      const lx = c.lx + ax * r * 0.82, ly = c.ly + ay * r * 0.82;
      Q([[lx - t, ly, z + rise], [lx + t, ly, z + rise], [lx + t, ly, z], [lx - t, ly, z]], leg, c.alpha);
    }
    for (const sy of [-1, 1]) {
      const ly = c.ly + sy * r * 0.82, x0 = c.lx - r * 0.82, x1 = c.lx + r * 0.82;
      for (const dir of [1, -1]) {
        const a0 = dir > 0 ? x0 : x1, a1 = dir > 0 ? x1 : x0;
        Q([[a0, ly, z], [a1, ly, z + rise], [a1, ly, z + rise - t * 2.4], [a0, ly, z - t * 2.4]], leg, c.alpha * 0.9);
      }
    }
    const zb = z + rise, zt = zb + hh;
    Q([[c.lx - r, c.ly - r, zt], [c.lx + r, c.ly - r, zt], [c.lx + r, c.ly + r, zt], [c.lx - r, c.ly + r, zt]], lid, c.alpha);
    for (const [sx, sy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const ax = sx ? c.lx + sx * r : c.lx - r, ay = sy ? c.ly + sy * r : c.ly - r;
      const bx = sx ? c.lx + sx * r : c.lx + r, by = sy ? c.ly + sy * r : c.ly + r;
      Q([[ax, ay, zt], [bx, by, zt], [bx, by, zb], [ax, ay, zb]], body, c.alpha, { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]] });
      for (const f of [0.32, 0.7]) {   // hoop bands round the shell
        const zz = zb + hh * f, th = hh * 0.05;
        Q([[ax, ay, zz + th], [bx, by, zz + th], [bx, by, zz - th], [ax, ay, zz - th]], band, c.alpha,
          { cullN: [sx * c.E[1] + sy * c.E[0], sy * c.E[1] - sx * c.E[0]], lift: DETAIL_LIFT });
      }
    }
  },
};
export const AUTHORED_DETAIL_KINDS = Object.keys(AUTHORED_DETAIL);
// ── DETAIL KINDS THAT ONLY EVER LAY FLATS ────────────────────────────────────────────────────────
// On the GL path every flat a detail lays is already in the building's mesh and emitFlat drops it,
// so a kind made of nothing else draws nothing there and only allocates (collar, parapet, pipe…: a
// top share of the frame's garbage). Read off each kind's own source: it qualifies only if every
// call in it is one of these and it never asks for `paint` (paint is not in the mesh). `Q` and `rgba`
// are locals each kind defines in its own body, which is scanned with it; dripStain only lays flats
// and the rest are pure. Anything
// else, a sign, a lamp, a helper this list does not name, keeps running.
const FLAT_ONLY_CALLS = new Set(['detailQuad', 'shadeOf', 'dripStain', 'faceY', 'nearOrMesh', 'bracketCol', 'dRand', 'Q', 'rgba', 'V', 'F', 'cos', 'sin', 'max', 'min', 'abs', 'hypot', 'sqrt', 'atan2', 'floor', 'ceil', 'round', 'pow', 'sign', 'clamp', 'frac', 'mix', 'push', 'map', 'forEach', 'slice', 'concat', 'fill', 'from', 'isArray', 'for', 'if', 'while', 'return', 'Number', 'isFinite']);
export const FLAT_ONLY_KINDS = new Set(Object.keys(AUTHORED_DETAIL).filter((k) => {
  const src = String(AUTHORED_DETAIL[k]);
  if (/\bpaint\b/.test(src)) return false;
  for (const m of src.matchAll(/\b([A-Za-z_$][\w$]*)\s*\(/g)) if (!FLAT_ONLY_CALLS.has(m[1]) && m[1] !== k) return false;
  return true;
}));
// ⚠ WRITTEN OUT TWICE ON PURPOSE, and checked by value. windshield.js cannot import the schema
// module from scripts/, so the per-kind screen floors live here and in DETAIL_SCHEMA, and
// shapes:smoke compares them — a kind whose floor is only in one of them either never draws or
// draws at every distance, and both are silent.
// ⚠ DERIVED FROM THE SCHEMA, NOT RESTATED BESIDE IT. These were a second copy of the `px` each
// kind already declares, which is a kind added in one place and silently gated at the default 6
// in the other. One list now, and the schema is the one that also generates the editor form.
export const DETAIL_PX = Object.fromEntries(Object.entries(DETAIL_SCHEMA).map(([k, v]) => [k, v.px || 6]));

// A palette key to a shaded CSS colour. One place, so a detail part and the wall behind it cannot
// disagree about what the building is made of.
export function shadeOf(pal, k) {
  const c = WALL_COL[pal] || [110, 116, 124];
  return `rgb(${Math.min(255, c[0] * k) | 0},${Math.min(255, c[1] * k) | 0},${Math.min(255, c[2] * k) | 0})`;
}
// Lettering that can be READ against a given board, for the callers that paint text onto a panel
// they were also given the colour of. Two answers, not a gradient: a sign painter picks the dark
// or the light and the whole point is contrast. The threshold is on perceived luminance rather
// than on the mean, because a saturated cyan board and a saturated blue one have the same mean
// and want opposite ink.
function inkFor(css) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(css).trim());
  let r = 20, g = 20, b = 24;
  if (m) { const v = parseInt(m[1], 16); r = v >> 16 & 255; g = v >> 8 & 255; b = v & 255; }
  else { const p = /rgba?\(([^)]+)\)/i.exec(String(css)); if (p) { const n = p[1].split(',').map(Number); r = n[0] | 0; g = n[1] | 0; b = n[2] | 0; } }
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) > 140 ? '#14110f' : '#e8dcc8';
}
