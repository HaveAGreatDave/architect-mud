// THE NEON KIT: a sign drawn as bent glass tube, for GLASS.
//
// A lettered board (bakeSignText in windshield.js) is a name in one hand. A neon sign proper is more
// than that: an animal outlined in tube, a ring, a star, two lines of lettering in different faces,
// a colour that runs along a tube from one end to the other, all bolted to a painted board. This file
// paints one of those into a canvas from a recipe, and windshield.js lays the canvas on a wall as a
// decal (`bakeNeonArt`), the way every sign is laid.
//
// It's pure: no imports, no DOM beyond the canvas it's handed, so the Lite bake and the gates can run
// it headless. Each sign's artwork is registered by id (`registerNeonArt`) from the region file that
// owns the building, so a second game's signs never live here.
//
// A tube is drawn the way windshield.js draws a lit letter, so a badge and a name board beside it
// look like the same glass: walls in the gas colour, a paler bore, a near-white core, a faint
// specular, and the halo laid behind the glass. Unlit (by day, or with the power off) it's pale glass
// with the colour only faintly in it, and the shadow it throws on the board, which is how a neon sign
// looks at noon.
//
// docs/proposals/reach-rebuild.md is the plan this was built for.

const ART = new Map();      // id → { draw(pen), w, h }
const CACHE = new Map();    // 'id|lit|dead' → canvas

// Register a sign's artwork. `draw(pen)` works in unit coordinates: x and y run 0..1 across the
// canvas, whatever its pixel size, with y down. `w`/`h` are the canvas size; the aspect is the sign's.
export function registerNeonArt(id, draw, { w = 512, h = 512 } = {}) {
  ART.set(id, { draw, w, h });
  for (const k of [...CACHE.keys()]) if (k.startsWith(id + '|')) CACHE.delete(k);
}
export function hasNeonArt(id) { return ART.has(id); }
export function neonArtIds() { return [...ART.keys()]; }
// Faces load after the first frame (windshield.js `loadNeonFaces`), and a sign painted before then is
// set in the fallback. Called when they land.
export function clearNeonCache() { CACHE.clear(); }

// The canvas for one sign in one state, cached. `lit` is 0 or 1. `dead` names one tube that's dark
// this bake (a string a tube or letter run was given as `id`), or ''. `mk(w, h)` makes a canvas.
export function neonArtCanvas(id, lit, dead, mk) {
  const art = ART.get(id);
  if (!art || !mk) return null;
  const key = id + '|' + (lit ? 1 : 0) + '|' + (dead || '');
  let c = CACHE.get(key);
  if (c) return c;
  c = mk(art.w, art.h);
  const g = c.getContext && c.getContext('2d');
  if (!g) return null;
  const pen = makePen(g, art.w, art.h, !!lit, dead || '', mk);
  art.draw(pen);
  pen.finish();
  c._lit = lit ? 1 : 0;
  CACHE.set(key, c);
  return c;
}

// ── COLOUR ───────────────────────────────────────────────────────────────────────────────────────
function rgbOf(css) {
  if (Array.isArray(css)) return css;
  const s = String(css);
  if (/^#[0-9a-f]{6}$/i.test(s)) return [parseInt(s.slice(1, 3), 16), parseInt(s.slice(3, 5), 16), parseInt(s.slice(5, 7), 16)];
  const m = s.match(/\d+(\.\d+)?/g) || [255, 255, 255];
  return m.slice(0, 3).map(Number);
}
const rgba = (c, a) => 'rgba(' + Math.round(c[0]) + ',' + Math.round(c[1]) + ',' + Math.round(c[2]) + ',' + a + ')';
const toward = (c, d, k) => [c[0] + (d[0] - c[0]) * k, c[1] + (d[1] - c[1]) * k, c[2] + (d[2] - c[2]) * k];
const WHITE = [255, 255, 255];
// Unlit glass: clear tube with the phosphor coating showing faintly through. A cool grey, a little of
// the colour, and never dark: a dead sign is pale against its board, not black.
const GLASS = [214, 218, 222];

// ── THE PEN ──────────────────────────────────────────────────────────────────────────────────────
//
// Two layers. The board is painted straight onto the canvas. The tubes are drawn onto a layer of
// their own and laid over it at the end, because the halo goes BEHIND the glass (`destination-over`)
// and on the canvas itself that would put it behind the board too, where nobody sees it.
function makePen(g, W, H, lit, dead, mk) {
  const S = Math.min(W, H);
  const X = (u) => u * W, Y = (v) => v * H;
  const layer = mk(W, H);
  const L = layer.getContext && layer.getContext('2d');
  const halos = [];   // drawn behind the glass once every tube is down
  // How dark the board is painted at night. The decal is emissive when the sign is lit (the shader
  // draws it at full value whatever the light), so a board painted at its daylight colours would
  // glow with the tubes. Painting it down is how it stays a board in the dark.
  const boardK = lit ? 0.34 : 1;

  // Colour of a tube at a point: one colour, or a run from `color` at the bottom of its bounding box
  // to `color2` at the top, as the lettering in the Coyote's sign runs amber into cyan.
  const strokeFor = (ctx, o, box, k, a) => {
    const c1 = rgbOf(o.color), c2 = o.color2 ? rgbOf(o.color2) : null;
    const base = lit ? c1 : toward(GLASS, c1, 0.22);
    if (!c2) return rgba(k ? toward(base, WHITE, k) : base, a);
    const top = lit ? c2 : toward(GLASS, c2, 0.22);
    const gr = ctx.createLinearGradient(0, box[3], 0, box[1]);
    const [r0, r1] = o.run || [0.4, 0.82];   // where, bottom to top, the one colour gives way to the other
    gr.addColorStop(r0, rgba(k ? toward(base, WHITE, k) : base, a));
    gr.addColorStop(r1, rgba(k ? toward(top, WHITE, k) : top, a));
    return gr;
  };

  // The passes of one run of tube. `trace(ctx)` lays the path (or strokes the text) with the stroke
  // style and width already set, so lines and lettering share one recipe.
  const glass = (o, trace, box, T) => {
    const ctx = L || g;
    const off = !lit || (dead && o.id && o.id === dead);
    ctx.save();
    ctx.lineJoin = 'round'; ctx.lineCap = 'round';
    if (off) {
      // Pale glass, and the shadow the tube throws on the board under a high sun. Drawn on the board
      // itself so the shadow lands on paint, not on other glass.
      g.save(); g.lineJoin = 'round'; g.lineCap = 'round';
      g.translate(T * 0.35, T * 0.55);
      g.strokeStyle = 'rgba(0,0,0,0.32)'; g.lineWidth = T; trace(g);
      g.restore();
      ctx.strokeStyle = rgba(toward(GLASS, rgbOf(o.color), 0.12), 0.95); ctx.lineWidth = T; trace(ctx);
      ctx.strokeStyle = strokeFor(ctx, o, box, 0, 0.55); ctx.lineWidth = T * 0.62; trace(ctx);
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = T * 0.16;
      ctx.translate(-T * 0.14, -T * 0.2); trace(ctx);
      ctx.restore();
      return;
    }
    // Lit glass has no dark edge: walls in the gas colour, a paler bore, a near-white core and a
    // faint specular. Same four passes as a lit letter in bakeSignText.
    ctx.strokeStyle = strokeFor(ctx, o, box, 0, 1);    ctx.lineWidth = T;        trace(ctx);
    ctx.strokeStyle = strokeFor(ctx, o, box, 0.3, 1);  ctx.lineWidth = T * 0.7;  trace(ctx);
    ctx.strokeStyle = strokeFor(ctx, o, box, 0.78, 0.95); ctx.lineWidth = T * 0.32; trace(ctx);
    ctx.restore();
    halos.push({ o, trace, box, T });
  };

  // Bounding box of a point list, for the colour run.
  const boxOf = (pts) => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const [x, y] of pts) { x0 = Math.min(x0, X(x)); y0 = Math.min(y0, Y(y)); x1 = Math.max(x1, X(x)); y1 = Math.max(y1, Y(y)); }
    return [x0, y0, x1, y1];
  };
  // A smooth path through the points: straight between them unless `smooth`, in which case each
  // corner is rounded through its neighbours' midpoints, which is how a glass bender takes a curve.
  const pathOf = (pts, closed, smooth) => (ctx) => {
    ctx.beginPath();
    if (!smooth || pts.length < 3) {
      pts.forEach(([x, y], i) => (i ? ctx.lineTo(X(x), Y(y)) : ctx.moveTo(X(x), Y(y))));
      if (closed) ctx.closePath();
    } else {
      const n = pts.length, mid = (a, b) => [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const start = closed ? mid(pts[n - 1], pts[0]) : pts[0];
      ctx.moveTo(X(start[0]), Y(start[1]));
      const last = closed ? n : n - 1;
      for (let i = closed ? 0 : 1; i < last; i++) {
        const p = pts[i], q = mid(p, pts[(i + 1) % n]);
        // A point with a third value is a hard corner (a nose, an ear tip, a paw): the tube goes
        // straight into it and straight out, as a bender makes a sharp bend.
        if (p[2]) { ctx.lineTo(X(p[0]), Y(p[1])); ctx.lineTo(X(q[0]), Y(q[1])); }
        else ctx.quadraticCurveTo(X(p[0]), Y(p[1]), X(q[0]), Y(q[1]));
      }
      if (!closed) ctx.lineTo(X(pts[n - 1][0]), Y(pts[n - 1][1]));
      else ctx.closePath();
    }
    ctx.stroke();
  };

  const pen = {
    W, H, lit,
    // Paint on the board, darkened at night (see `boardK`). `fn(g, X, Y, S, shade)`, where
    // `shade(css)` returns the colour as the board shows it now.
    board(fn) {
      const shade = (css, a = 1) => rgba(rgbOf(css).map((v) => v * boardK), a);
      g.save(); fn(g, X, Y, S, shade); g.restore();
    },
    // A run of tube through points [[x, y], …]. `w` is the tube's gauge as a fraction of the sign.
    // `id` names it, so the arm can kill it for a flicker (see neonArtCanvas's `dead`).
    tube(pts, o = {}) {
      if (!pts || pts.length < 2) return;
      const T = Math.max(1.5, (o.w || 0.012) * S);
      glass(o, pathOf(pts, !!o.closed, !!o.smooth), boxOf(pts), T);
    },
    // The glow a lit outline throws on the board inside it: a soft wash of its colour over the
    // shape, so an animal outlined in tube reads as one bright silhouette and not as a wire. Light,
    // so drawn only when the sign is lit; by day the board inside is just board.
    glow(pts, o = {}) {
      if (!lit || !pts || pts.length < 3) return;
      const c = rgbOf(o.color || '#ffffff');
      g.save();
      g.beginPath();
      pts.forEach(([x, y], i) => (i ? g.lineTo(X(x), Y(y)) : g.moveTo(X(x), Y(y))));
      g.closePath();
      g.clip();
      g.fillStyle = rgba(c, o.a ?? 0.22);
      g.fillRect(0, 0, W, H);
      // Brighter toward the edges, where the tube is, and dimmer in the middle of the shape.
      g.shadowColor = rgba(c, 1); g.shadowBlur = S * (o.blur ?? 0.03);
      g.strokeStyle = rgba(c, (o.a ?? 0.22) * 1.6); g.lineWidth = S * (o.edge ?? 0.03);
      g.stroke();
      g.restore();
    },
    // A ring of tube.
    ring(cx, cy, r, o = {}) {
      const n = Math.max(24, Math.round(r * 160)), pts = [];
      for (let i = 0; i < n; i++) { const a = (i / n) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy + Math.sin(a) * r * (W / H)]); }
      this.tube(pts, { ...o, closed: true });
    },
    // A pad: the small loop a circuit trace ends in.
    pad(x, y, r, o = {}) { this.ring(x, y, r, { w: o.w || 0.008, ...o }); },
    // Lettering bent in tube, along a baseline or round an arc. Each letter is outlined, not filled:
    // a neon letter is two parallel tubes with the board between them, as on every lit name.
    // o: { size, face (a CSS family stack), color, color2, w, track, align, arc: { cx, cy, r } }
    text(str, x, y, o = {}) {
      const ctx = L || g;
      const px = (o.size || 0.1) * H;
      const font = (o.weight ? o.weight + ' ' : '') + Math.round(px) + 'px ' + (o.face || 'sans-serif');
      const T = Math.max(1.5, (o.w || 0.008) * S);
      ctx.save(); ctx.font = font; ctx.textBaseline = 'middle'; ctx.textAlign = 'center';
      const track = (o.track || 0) * px;
      const raw = [...str].map((ch) => ctx.measureText(ch).width);
      ctx.restore();
      // `maxW` squeezes the letters across (never down) until the word fits that fraction of the
      // sign, as a sign-writer condenses a name to its board. `sx` squeezes by a set amount.
      const rawTotal = raw.reduce((s, v) => s + v, 0) + track * (raw.length - 1);
      let sx = o.sx || 1;
      if (o.maxW && rawTotal * sx > o.maxW * W) sx = (o.maxW * W) / rawTotal;
      const ws = raw.map((w) => w * sx);
      const total = rawTotal * sx;
      // Where each letter sits and how it's turned.
      const at = [];
      if (o.arc) {
        // Round an arc whose centre is BELOW the text: the word bows upward, as across the top of a
        // badge. The arc length is the set width, so the letters keep their spacing.
        // `a0` turns the whole word round the centre (radians, negative to the left), so a name can
        // climb as it goes, as a word set on a rising curve does.
        const cx = X(o.arc.cx), cy = Y(o.arc.cy), r = o.arc.r * H, a0 = o.arc.a0 || 0;
        let s = -total / 2;
        ws.forEach((w) => { const a = a0 + (s + w / 2) / r; at.push([cx + Math.sin(a) * r, cy - Math.cos(a) * r, a]); s += w + track; });
      } else {
        const align = o.align || 'center';
        let s = align === 'left' ? X(x) : align === 'right' ? X(x) - total : X(x) - total / 2;
        ws.forEach((w) => { at.push([s + w / 2, Y(y), 0]); s += w + track; });
      }
      const box = [Math.min(...at.map((p) => p[0])) - px / 2, Math.min(...at.map((p) => p[1])) - px / 2,
        Math.max(...at.map((p) => p[0])) + px / 2, Math.max(...at.map((p) => p[1])) + px / 2];
      [...str].forEach((ch, i) => {
        if (ch === ' ') return;
        const [lx, ly, a] = at[i];
        // The squeeze scales the line width with it, so it's undone on the stroke: a condensed
        // letter is bent from the same gauge of tube as a wide one.
        const trace = (c) => { c.save(); c.font = font; c.textBaseline = 'middle'; c.textAlign = 'center'; c.translate(lx, ly); c.rotate(a); c.scale(sx, 1); c.lineWidth /= Math.sqrt(sx); c.strokeText(ch, 0, 0); c.restore(); };
        // A letter id is the run's id and the letter's index, so `dead` can take one letter out.
        glass({ ...o, id: o.id != null ? o.id + ':' + i : '' }, trace, box, T);
      });
    },
    // Lay the glass over the board, with every halo behind it. Called once, by neonArtCanvas.
    finish() {
      if (!L) return;
      if (lit && halos.length) {
        L.save();
        L.globalCompositeOperation = 'destination-over';
        L.lineJoin = 'round'; L.lineCap = 'round';
        for (const h of halos) {
          L.shadowColor = rgba(rgbOf(h.o.color), 1); L.shadowBlur = h.T * 2.6;
          L.strokeStyle = strokeFor(L, h.o, h.box, 0, 0.9); L.lineWidth = h.T * 1.6; h.trace(L);
        }
        L.restore();
      }
      g.drawImage(layer, 0, 0);
    },
  };
  return pen;
}
