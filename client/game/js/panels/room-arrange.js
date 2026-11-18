// THE ARRANGE MODE: the owner moving their own furniture by hand, the room seen from above at a slant with
// its walls down, a dolls' house you reach into (plugins/roomstage `arrange layout`; room-stage.js hosts it).
//
// Click a piece to pick it, drag it across the floor, R (or right-click, or the wheel while you hold it) turns
// it a quarter. It goes green where it fits and red where it doesn't, and snaps its back to a wall when it
// comes near one (any side near a wall turns it to stand along it; Alt drags it free). Shift or Ctrl click picks
// several, and a drag moves them together. Drag the floor to swing round the room, the wheel to come in or stand off, Q and E for a
// quarter turn of the view, WASD to slide it. Undo, Put back and Reset all work on the draft.
//
// ⚠ NOTHING IS SAVED UNTIL SAVE. Every drag changes a draft held here, and the room is drawn from it
// (room-stage.js rebuild asks apply()). Save sends one `arrange layout` with every piece that moved; the server
// checks them all by the same rule the preview uses (room-layout.js spotFits) and writes them in one UPDATE, or
// none, and answers `room_arranged`. Cancel drops the draft, and nothing was sent.
// ⚠ IT DECIDES NOTHING. Green and red are spotFits, and the server asks it again.
// ⚠ THE WALLS COME DOWN ON THE CPU (cutaway): the room's mesh with its ceiling dropped and its walls, glass and
// trim cut to a stub, the furniture (each batch's 'kit' runs, gl/room-mesh.js) kept whole, and anything past
// the walls dropped. No shader knows about it, so the ink and the light follow without a change.
// ⚠ THE PIECE IN YOUR HAND IS A PROP. Picking it up builds the room once without it and the piece once on its
// own (heldBatch), and every frame of the drag only moves those vertices; putting it down builds the room once
// more with it where it landed. A drag is two builds, never one a frame.

import { STRIDE } from './gl/ballpark-mesh.js';
import { buildRoom } from './gl/room-mesh.js';
import { roomLayout, resolveSpot, spotFits, pieceHangs, cleanSpot, dimsOf, placeSpot, balconyDecks } from '../../../shared/room-layout.js';
import { loadCss, escapeHtml as esc } from '../../../shared/dom.js';
import { sheetRuns, snapRun, gridAlong, laidIn, WALL_GRID_M } from './room-sheets.js';

const CSS = await loadCss(new URL('./room-arrange.css', import.meta.url));
function ensureStyles() {
  if (document.getElementById('ra-css')) return;
  const s = document.createElement('style'); s.id = 'ra-css'; s.textContent = CSS; document.head.appendChild(s);
}

const CUT = 0.22;     // how high the walls stand with the room cut away, metres
const BAND = 0.1;     // how far into the room from a wall the cut reaches: skirting, sills, pictures, curtains
const PAST = 0.45;    // past the walls: the wall's own thickness and its trim; beyond that is dropped
const SNAP = 0.45;    // a piece whose back comes this near a wall goes against it
const SIDE = 0.3;     // a piece whose side or front comes this near a wall turns its back to it and goes against it
const CORNER = 0.25;  // a piece against a wall this near the end of it goes into the corner
const PIECE_SNAP = 0.2; // an edge this near another piece's edge goes flush against it, or lines up with it
const KISS = 0.06;      // flush is this far apart: spotFits keeps 0.05 m between two pieces
const GRID = 0.05;   // a dragged piece moves in steps this long
const LIFT = 0.05;    // a piece in your hand is held this far off the floor
const FOV = 30;
const PITCH = [-1.38, -0.42];
const ZOOM = [0.35, 1.7];
const NONE = { data: new Float32Array(0), n: 0 };
const BACK_OF = { 0: 'back', 90: 'left', 180: 'front', 270: 'right' };
const quarter = (t) => (((Math.round((Number(t) || 0) / 90) * 90) % 360) + 360) % 360;
const clamp = (x, lo, hi) => (lo > hi ? (lo + hi) / 2 : Math.max(lo, Math.min(hi, x)));
const snap = (x) => Math.round(x / GRID) * GRID;
const LAID_UP = 0.012, LAID_IN = 0.06; // a hung piece laid on the floor at its wall's foot (as room-sheets.js lays a run)
const sameSpot = (a, b) => JSON.stringify(a || null) === JSON.stringify(b || null);
const spotText = (s) => (s.wall ? `${s.wall}:${s.along}` : `${s.at[0]},${s.at[1]},${s.turn}`);

// ── the walls down ──────────────────────────────────────────────────────────────────────────────
// A batch with what's past the walls dropped, the ceiling dropped, and the walls cut at CUT, the furniture's
// runs ('kit') kept whole. Triangles are classed by their middle in the room's own frame.
function cutBatch(b, L, inner, outer) {
  if (!b?.n) return b;
  const src = b.data, n = b.n, H = L.h;
  const [ax, , az] = L.at, [rx, , rz] = L.r, [fx, , fz] = L.f, fl = L.floor || 0;
  let out = new Float32Array(Math.max(STRIDE * 3, n * STRIDE)), on = 0;
  const kit = [...(b.kit || [])].sort((p, q) => p[0] - q[0]), kitOut = [];
  let ki = 0;
  const grow = (more) => { if ((on + more) * STRIDE <= out.length) return; const d = new Float32Array(Math.max((on + more) * STRIDE, out.length * 2)); d.set(out.subarray(0, on * STRIDE)); out = d; };
  const copy = (o) => { out.set(src.subarray(o, o + STRIDE), on * STRIDE); on++; };
  const lerp = (o1, o2, t) => { const base = on * STRIDE; for (let k = 0; k < STRIDE; k++) out[base + k] = src[o1 + k] + (src[o2 + k] - src[o1 + k]) * t; out[base + 11] = src[o1 + 11]; on++; };
  const inBox = (u, v, B, pad) => B.some((q) => u > q[0] - pad && u < q[1] + pad && v > q[2] - pad && v < q[3] + pad);
  const laid = layPlan(src, kit, L);
  for (let t = 0; t + 2 < n; t += 3) {
    while (ki < kit.length && kit[ki][0] + kit[ki][1] <= t) ki++;
    const isKit = ki < kit.length && t >= kit[ki][0];
    const o0 = t * STRIDE, o1 = o0 + STRIDE, o2 = o1 + STRIDE;
    const cx = (src[o0] + src[o1] + src[o2]) / 3 - ax, cz = (src[o0 + 2] + src[o1 + 2] + src[o2 + 2]) / 3 - az;
    const u = cx * rx + cz * rz, v = -(cx * fx + cz * fz);
    if (!inBox(u, v, outer, 0)) continue;
    grow(6);
    if (isKit) {
      const last = kitOut[kitOut.length - 1];
      if (last && last[0] + last[1] === on) last[1] += 3; else kitOut.push([on, 3]);
      copy(o0); copy(o1); copy(o2);
      if (laid[ki]) layVerts(out, (on - 3) * STRIDE, 3, laid[ki], L);
      continue;
    }
    const ys = [src[o0 + 1] - fl, src[o1 + 1] - fl, src[o2 + 1] - fl];
    if (inBox(u, v, inner, -BAND)) {
      // the ceiling and what hangs off it: a pendant's cord and shade
      if (Math.min(ys[0], ys[1], ys[2]) > H - 0.9) continue;
      copy(o0); copy(o1); copy(o2);
      continue;
    }
    // a wall, its glass or its trim: what's under the cut
    // and what's below the floor past the walls: the building's own face, down to the street
    if (Math.max(ys[0], ys[1], ys[2]) < -0.02) continue;
    const os = [o0, o1, o2], ins = ys.map((y) => y <= CUT);
    const k = ins.filter(Boolean).length;
    if (k === 3) { copy(o0); copy(o1); copy(o2); continue; }
    if (k === 0) continue;
    // Sutherland-Hodgman against y = CUT: walk the edges, keeping the inside points and the crossings
    const poly = [];
    for (let i = 0; i < 3; i++) {
      const a = i, c = (i + 1) % 3;
      if (ins[a]) poly.push([os[a], os[a], 0]);
      if (ins[a] !== ins[c]) poly.push([os[a], os[c], (CUT - ys[a]) / (ys[c] - ys[a])]);
    }
    for (let i = 1; i + 1 < poly.length; i++) for (const q of [poly[0], poly[i], poly[i + 1]]) { if (q[2] === 0) copy(q[0]); else lerp(q[0], q[1], q[2]); }
  }
  const res = { data: out.subarray(0, on * STRIDE), n: on };
  if (kitOut.length) res.kit = kitOut;
  return res;
}
// ── what hangs on a wall, laid down ─────────────────────────────────────────────────────────────
// With the walls cut, a picture or a set at head height floats over them and shows the room its back. So each piece's
// run (one kit run a piece) that is all off the floor and against a wall is folded down onto the floor at that wall's
// foot, face up, its top edge to the wall, the way the posters are (room-sheets.js laid): it reads from inside the
// room and stays under the hand that drags it.
const INWARD = { left: [1, 0], right: [-1, 0], front: [0, 1], back: [0, -1] };
function frameOf3(L) {
  const [ax, , az] = L.at, [rx, , rz] = L.r, [fx, , fz] = L.f, fl = L.floor || 0;
  return {
    local: (x, y, z) => { const cx = x - ax, cz = z - az; return [cx * rx + cz * rz, -(cx * fx + cz * fz), y - fl]; },
    world: (u, v, y) => [ax + u * rx - v * fx, fl + y, az + u * rz - v * fz],
    dirLocal: (x, z) => [x * rx + z * rz, -(x * fx + z * fz)],
    dirWorld: (du, dv) => [du * rx - dv * fx, du * rz - dv * fz],
  };
}
// per kit run: { wall, top } when it's a hung piece, else null
function layPlan(src, kit, L) {
  const F = frameOf3(L), hu = L.w / 2, D = L.d;
  return kit.map(([first, c]) => {
    let u0 = Infinity, u1 = -Infinity, v0 = Infinity, v1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (let i = first; i < first + c; i++) {
      const o = i * STRIDE, [u, v, y] = F.local(src[o], src[o + 1], src[o + 2]);
      u0 = Math.min(u0, u); u1 = Math.max(u1, u); v0 = Math.min(v0, v); v1 = Math.max(v1, v); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
    }
    if (!(y0 > 0.45)) return null;
    const gaps = { left: u0 + hu, right: hu - u1, front: v0, back: D - v1 };
    const wall = Object.keys(gaps).sort((a, b) => gaps[a] - gaps[b])[0];
    if (gaps[wall] > 0.35) return null;
    const depth = wall === 'left' || wall === 'right' ? u1 - u0 : v1 - v0;
    if (depth > 0.6) return null;
    return { wall, top: y1 };
  });
}
// fold `count` vertices from `at` in `d` down to the floor at their wall's foot: height becomes how far out, how far
// out becomes a sliver of height; the normals turn with them
function layVerts(d, at, count, plan, L) {
  const F = frameOf3(L), hu = L.w / 2, D = L.d, [iu, iv] = INWARD[plan.wall];
  const base = plan.wall === 'left' ? -hu : plan.wall === 'right' ? hu : plan.wall === 'front' ? 0 : D;
  for (let i = 0; i < count; i++) {
    const o = at + i * STRIDE, [u, v, y] = F.local(d[o], d[o + 1], d[o + 2]);
    const out = (u - base) * iu + (v - base) * iv, along = iu ? v : u;
    const out2 = LAID_IN + (plan.top - y), y2 = LAID_UP + Math.max(0, out) * 0.2;
    const u2 = iu ? base + iu * out2 : along, v2 = iu ? along : base + iv * out2;
    const w = F.world(u2, v2, y2);
    d[o] = w[0]; d[o + 1] = w[1]; d[o + 2] = w[2];
    // normal: its inward part goes up, its up part goes back toward the wall
    const [nu, nv] = F.dirLocal(d[o + 3], d[o + 5]), nIn = nu * iu + nv * iv, nUp = d[o + 4];
    const nAlongU = iu ? 0 : nu, nAlongV = iu ? nv : 0;
    const nu2 = nAlongU - iu * nUp, nv2 = nAlongV - iv * nUp, nw = F.dirWorld(nu2, nv2);
    d[o + 3] = nw[0]; d[o + 4] = nIn; d[o + 5] = nw[1];
  }
}
// The room's own floor and its en-suite's, in its frame [u0, u1, v0, v1].
function floorsOf(L) {
  const out = [[-L.w / 2, L.w / 2, 0, L.d]];
  if (L.annex && L.spec.annex) out.push([L.annex.u0, L.annex.u1, L.annex.v0, L.annex.v0 + L.spec.annex.d]);
  // the balcony's decks are floor you can put furniture on, so the view keeps them and frames them
  out.push(...balconyDecks(L.spec));
  return out;
}
export function cutaway(m, L) {
  const inner = floorsOf(L), outer = inner.map((q) => [q[0] - PAST, q[1] + PAST, q[2] - PAST, q[3] + PAST]);
  const cut = (b) => cutBatch(b, L, inner, outer);
  return { ...m, solid: cut(m.solid), glass: cut(m.glass), screen: pinch(m.screen, L, outer), view: NONE, textured: new Map([...m.textured].map(([key, b]) => [key, cut(b)])) };
}
// The screens past the walls (a sign in the lobby next door) folded to nothing where they are: the TV's picture is
// found in this batch by vertex offset (mesh.screens), so nothing may be taken out of it, only flattened.
function pinch(b, L, outer) {
  if (!b?.n) return b;
  const d = b.data.slice(0, b.n * STRIDE), [ax, , az] = L.at, [rx, , rz] = L.r, [fx, , fz] = L.f;
  for (let t = 0; t + 2 < b.n; t += 3) {
    const o = t * STRIDE, cx = (d[o] + d[o + STRIDE] + d[o + 2 * STRIDE]) / 3 - ax, cz = (d[o + 2] + d[o + STRIDE + 2] + d[o + 2 * STRIDE + 2]) / 3 - az;
    const u = cx * rx + cz * rz, v = -(cx * fx + cz * fz);
    if (outer.some((q) => u > q[0] && u < q[1] && v > q[2] && v < q[3])) continue;
    for (let k = 1; k < 3; k++) for (let i = 0; i < 3; i++) d[o + k * STRIDE + i] = d[o + i];
  }
  return { ...b, data: d };
}

// ── the mode ──────────────────────────────────────────────────────────────────────────────────────
// room-stage.js gives it the Stage's own pieces: `S` (spec, pieces, L), the renderer `R`, `rebuild()` to lay the
// room out again, `opts()` the room's build options ({ seed, lampOn }), `send(cmd)`, and `done(saved)` when it
// closes: `saved` is the pieces as saved, or null for a cancel.
// `admin` is the staff mode on a local server (plugins/roomstage adminHere): every piece moves (red refuses it as it
// does a player: nothing overlaps or stands in a way through), the Furniture menu adds any furniture item, and Remove takes one out.
// `sendSilent(cmd)` asks for the menu's catalog without a line in the log.
export function createArrange({ root, host, S, R, rebuild, repaint = () => {}, opts, send, sendSilent = send, admin = false, done }) {
  ensureStyles();
  const draft = new Map(), undo = [];
  // the admin mode's new pieces (a temporary id to the piece, with `itemId`) and the pieces it's taking out
  const added = new Map(), removed = new Set();
  let newN = 0, catalog = null;
  const can = (p) => !!p && (admin || !!p.placed);
  const saved = new Map(S.pieces.map((p) => [p.id, p.spot]));
  // the pieces picked together (Shift or Ctrl click): a drag moves them all, R turns each
  const picked = new Set();
  let sel = null, hover = null, held = null, pend = null, bad = new Set(), saving = false, closed = false, escArmed = 0;
  const cuts = new WeakMap();

  const el = document.createElement('div');
  el.className = 'ra-layer';
  el.innerHTML = `<canvas class="ra-ink"></canvas>
    <div class="ra-top"><b>${admin ? 'Arrange · staff' : 'Arrange'}</b><span class="ra-hint">Drag a piece to move it · it snaps to walls and the furniture beside it (Alt drags free) · Shift or Ctrl click (or drag a box on the floor) picks several · R or right-click turns it · drag the floor or the middle button to look round · WASD slides · wheel to zoom${admin ? ' · saves to content/furniture' : ''}</span></div>
    ${admin ? `<div class="ra-menu" hidden role="dialog" aria-label="Furniture">
      <div class="ra-menu-head"><b>Furniture</b><button type="button" class="ra-menu-x" aria-label="Close the menu">&times;</button></div>
      <input type="search" class="ra-find" placeholder="Find a piece..." aria-label="Find a piece of furniture">
      <div class="ra-cats"></div>
      <div class="ra-list" role="listbox" aria-label="Furniture items"><p class="ra-empty">Loading...</p></div>
    </div>` : ''}
    <div class="ra-menu ra-pmenu" hidden role="dialog" aria-label="Posters">
      <div class="ra-menu-head"><b>Posters you carry</b><button type="button" class="ra-menu-x" aria-label="Close the menu">&times;</button></div>
      <div class="ra-list" role="listbox" aria-label="Posters you carry"><p class="ra-empty">Loading...</p></div>
    </div>
    <div class="ra-tip" hidden></div>
    <div class="ra-flash" hidden></div>
    <div class="ra-bar" role="toolbar" aria-label="Arrange the furniture">
      <span class="ra-group">
        <button type="button" data-a="viewl" title="Turn the view (Q)" aria-label="Turn the view left">&#10226;</button>
        <button type="button" data-a="viewr" title="Turn the view (E)" aria-label="Turn the view right">&#10227;</button>
      </span>
      <span class="ra-group ra-piece">
        <span class="ra-name">Pick a piece</span>
        <button type="button" data-a="turnl" title="Turn it left (Shift+R)" aria-label="Turn it left" disabled>&#8634;</button>
        <button type="button" data-a="turnr" title="Turn it right (R)" aria-label="Turn it right" disabled>&#8635;</button>
        <button type="button" data-a="back" title="Put it back where it was (Backspace)" disabled>Put back</button>
        ${admin ? '<button type="button" data-a="remove" title="Take it out of the room (Delete)" disabled>Remove</button>' : ''}
      </span>
      ${admin ? '<span class="ra-group"><button type="button" class="ra-add" data-a="menu" title="Add a piece of furniture (F)">+ Furniture</button></span>' : ''}
      <span class="ra-group"><button type="button" class="ra-add" data-a="posters" title="Put up a poster you carry (P)">+ Poster</button></span>
      <span class="ra-group">
        <button type="button" data-a="undo" title="Undo (Ctrl+Z)" disabled>Undo</button>
        <button type="button" data-a="reset" title="Put everything back as it was" disabled>Reset</button>
      </span>
      <span class="ra-group">
        <button type="button" data-a="cancel" title="Leave without saving (Esc)">Cancel</button>
        <button type="button" class="ra-save" data-a="save" title="Save the layout (Enter)" disabled>Save layout</button>
      </span>
    </div>`;
  host.appendChild(el);
  const ink = el.querySelector('.ra-ink'), g = ink.getContext('2d');
  const tipEl = el.querySelector('.ra-tip'), flashEl = el.querySelector('.ra-flash'), nameEl = el.querySelector('.ra-name');
  const btn = (a) => el.querySelector(`[data-a="${a}"]`);

  // ── the draft ──
  const spotOf = (id) => (draft.has(id) ? draft.get(id) : saved.get(id));
  // what Save sends: the moved pieces, the new ones and the ones taken out
  const moved = () => [...draft].filter(([id, s]) => !added.has(id) && !removed.has(id) && !sameSpot(s, saved.get(id)));
  const changeCount = () => moved().length + added.size + removed.size + sheetMoves().length + sheetAdds.size;
  const pieceOf = (id) => S.pieces.find((p) => p.id === id) || added.get(id) || null;
  // the pieces as the room is drawn from them: the draft over the saved, the new ones in, the removed ones and the
  // one in your hand out
  const withDraft = (p) => (draft.has(p.id) ? { ...p, spot: draft.get(p.id) } : p);
  function apply(pieces) {
    return [...pieces, ...added.values()].filter((p) => !removed.has(p.id) && (!held || !held.ids.has(p.id))).map(withDraft);
  }
  // everything in the room but `id`, where the draft has it, for spotFits
  const othersOf = (id, skip = null) => [...S.pieces, ...added.values()].filter((p) => p.id !== id && !p.annex && !removed.has(p.id) && !skip?.has(p.id)).map(withDraft);
  const fits = (p, spot) => spotFits(S.spec, othersOf(p.id), p, spot, { byHand: true });
  const dimsOfPiece = (p) => p.dims || dimsOf(p.arche);
  const snapshot = () => ({ draft: new Map(draft), added: new Map(added), removed: new Set(removed), sheetDraft: new Map(sheetDraft), sheetAdds: new Map(sheetAdds) });
  function remember() {
    undo.push(snapshot());
    if (undo.length > 100) undo.shift();
  }
  function commit(id, spot) { commitMany([[id, spot]]); }
  function commitMany(list) {
    remember();
    for (const [id, spot] of list) {
      if (!added.has(id) && sameSpot(spot, saved.get(id))) draft.delete(id); else draft.set(id, spot);
      bad.delete(id);
    }
    rebuild();
    sync();
  }
  // ── the admin mode's menu: a new piece in, a piece out ──
  function addItem(item) {
    const id = `new:${++newN}`, piece = { ...item, id, itemId: item.id, placed: true, acts: [], spot: null };
    const others = othersOf(id), arche = piece.arche;
    // where `place` would put it, else the middle of the floor
    const spot = placeSpot(S.spec, others, arche, dimsOfPiece(piece), { crt: !!piece.crt, form: piece.form || null }) || cleanSpot({ at: [0, S.spec.d / 2], turn: 0 });
    remember();
    added.set(id, piece);
    draft.set(id, pieceHangs(piece) && !spot.wall ? spotFor(piece, 0, S.spec.d - 0.1, 0) : spot);
    sel = id;
    rebuild();
    sync();
    say(`The ${piece.name} is in. Drag it where you want it.`, true);
  }
  function removePiece(id) {
    const p = pieceOf(id);
    if (!p || !admin) return;
    remember();
    if (added.has(id)) added.delete(id); else removed.add(id);
    draft.delete(id);
    picked.delete(id);
    if (sel === id) sel = null;
    rebuild();
    sync();
    say(`The ${p.name} comes out when you save.`, true);
  }

  // ── paper on the walls (room-sheets.js; plugins/roomstage `sheet_spot`) ──
  // A set's run moves as one: dragging its strip along the wall tops moves the whole set, and Save sends every sheet of
  // it to the new spot. The Posters menu adds a roll the player carries; it goes up on Save, with its set's run.
  const sheetDraft = new Map();     // set -> { wall, along }
  const sheetAdds = new Map();      // 'inv:<row>' -> the carried sheet
  let stock = null, sheetHeld = null, paintAsked = false;
  const glassWalls = new Set(Array.isArray(S.spec?.glass) ? S.spec.glass : []);
  const savedSheetSpot = (set) => S.sheets.find((s) => s.set === set && s.spot?.wall)?.spot || null;
  const sheetSpotNow = (set) => (sheetHeld?.set === set ? sheetHeld.spot : sheetDraft.get(set)) || null;
  function sheetsNow(list = S.sheets) {
    return [...list, ...sheetAdds.values()].map((s) => { const sp = sheetSpotNow(s.set); return sp ? { ...s, spot: sp } : s; });
  }
  const sheetMoves = () => [...sheetDraft].filter(([set, sp]) => !sameSpot(sp, savedSheetSpot(set)));
  const runsHere = () => (S.L ? sheetRuns(S.L, sheetsNow()) : []);
  // the decals again, once a frame at most (room-stage.js paintTags, which reads sheets() through runsNow)
  function repaintSheets() {
    if (paintAsked) return;
    paintAsked = true;
    requestAnimationFrame(() => { paintAsked = false; if (!closed) repaint(); });
  }
  // A run lies face up on the floor at its wall's foot (room-sheets.js laid): its four corners there, in the room's
  // frame, `a` along the wall and `o` out from it
  function laidRect(run, half, height) {
    const L = S.L, hu = L.w / 2, i0 = laidIn(L), i1 = i0 + height, a = run.c - half, b = run.c + half;
    const at = (s, o) => (run.wall === 'left' ? [-hu + o, s] : run.wall === 'right' ? [hu - o, s] : run.wall === 'front' ? [s, o] : [s, L.d - o]);
    return [at(a, i0), at(b, i0), at(b, i1), at(a, i1)];
  }
  function sheetPick(x, y) {
    const hit = floorAt(x, y);
    if (!hit) return null;
    for (const r of runsHere()) {
      const q = laidRect(r.run, r.width / 2, r.height), us = q.map((p) => p[0]), vs = q.map((p) => p[1]), pad = 0.04;
      if (hit[0] > Math.min(...us) - pad && hit[0] < Math.max(...us) + pad && hit[1] > Math.min(...vs) - pad && hit[1] < Math.max(...vs) + pad) return r;
    }
    return null;
  }
  // the wall nearest a point on the floor, and where along it the run's middle goes: right against the next run if
  // it's that close, else on the wall grid
  function sheetSpotAt(hit, set, off = 0) {
    const L = S.L, hu = L.w / 2;
    const near = [['left', hit[0] + hu, hit[1]], ['right', hu - hit[0], hit[1]], ['front', hit[1], hit[0]], ['back', L.d - hit[1], hit[0]]]
      .filter(([wall]) => !glassWalls.has(wall)).sort((p, q) => p[1] - q[1])[0];
    if (!near) return null;
    const runs = runsHere(), me = runs.find((r) => r.g.set === set);
    const others = runs.filter((r) => r.g.set !== set).map((r) => ({ wall: r.run.wall, c: r.run.c, half: r.width / 2 }));
    return { wall: near[0], along: Math.round(snapRun(L, near[0], near[2] + off, (me?.width || 0) / 2, others) * 100) / 100 };
  }
  function addSheet(it) {
    if (sheetAdds.has(it.id)) return;
    remember();
    sheetAdds.set(it.id, it);
    repaintSheets();
    sync();
    say(`${it.name} goes up when you save. Drag the posters along the wall tops to move them.`, true);
    drawPosterMenu();
  }

  // ── where a piece goes ──
  // The spot for a piece centred at (u, v) facing `turn`: against the wall its back is near, else out in the
  // room. A hung piece always goes on the wall nearest. Kept in the room either way.
  // `free` (Alt held, or a group) leaves it where it's put, no wall pulling it in.
  function spotFor(p, u, v, turn, free = false) {
    const sp = S.spec, hu = sp.w / 2, D = sp.d, [w, d] = dimsOfPiece(p), q = (turn / 90) % 2;
    const hw = (q ? d : w) / 2, hd = (q ? w : d) / 2;
    // dragged out past the walls onto a balcony: it stands free on the deck nearest, kept inside its rail
    if (!pieceHangs(p) && (v < 0 || v > D || Math.abs(u) > hu)) {
      const deck = balconyDecks(sp).map((r) => ({ r, gap: Math.hypot(Math.max(r[0] - u, 0, u - r[1]), Math.max(r[2] - v, 0, v - r[3])) })).sort((a, b) => a.gap - b.gap)[0];
      if (deck && deck.gap < 0.6) { const r = deck.r; return cleanSpot({ at: [clamp(u, r[0] + hw, r[1] - hw), clamp(v, r[2] + hd, r[3] - hd)], turn }); }
    }
    u = clamp(u, -hu + hw, hu - hw); v = clamp(v, hd, D - hd);
    // along the wall, and into the corner when it's near the end
    const end = (x, lo, hi) => { x = clamp(x, lo, hi); return x - lo < CORNER ? lo : hi - x < CORNER ? hi : x; };
    const onWall = (wall) => cleanSpot({ wall, along: wall === 'left' || wall === 'right' ? end(v, w / 2, D - w / 2) : end(u, -hu + w / 2, hu - w / 2) });
    if (pieceHangs(p)) {
      // the wall nearest, its middle on the wall grid, then right against a hung neighbour if one's that close
      const ds = { left: u + hu, right: hu - u, front: v, back: D - v }, wall = Object.keys(ds).sort((a, b) => ds[a] - ds[b])[0];
      const side = wall === 'left' || wall === 'right', lo = side ? w / 2 : -hu + w / 2, hi = side ? D - w / 2 : hu - w / 2;
      return toPieces(p, cleanSpot({ wall, along: clamp(Math.round((side ? v : u) / WALL_GRID_M) * WALL_GRID_M, lo, hi) }));
    }
    if (free) return cleanSpot({ at: [u, v], turn });
    const gaps = { back: D - (v + hd), left: u - hw + hu, front: v - hd, right: hu - (u + hw) }, back = BACK_OF[turn];
    if (gaps[back] < SNAP) return toPieces(p, onWall(back));
    // another wall near: the piece turns its back to it, the way furniture stands along a wall
    const near = Object.keys(gaps).sort((a, b) => gaps[a] - gaps[b])[0];
    return toPieces(p, gaps[near] < SIDE ? onWall(near) : cleanSpot({ at: [u, v], turn }));
  }
  // The spot pulled the last little way to the furniture round it: an edge near another piece's edge goes flush
  // against it, or lines up with it. Against a wall it only slides along the wall; out in the room it moves both ways.
  function toPieces(p, spot) {
    if (!spot) return spot;
    const me = placeOf(p, spot), hangs = pieceHangs(p);
    const rect = (q) => { const t = quarter(q.turn) % 180 === 90, hw = (t ? q.d : q.w) / 2, hd = (t ? q.w : q.d) / 2; return [q.u - hw, q.u + hw, q.v - hd, q.v + hd]; };
    const m = rect(me);
    let bu = null, bv = null;
    const best = (cur, x) => (Math.abs(x) < PIECE_SNAP && (cur === null || Math.abs(x) < Math.abs(cur)) ? x : cur);
    for (const o of othersOf(p.id)) {
      if (o.spot?.on || pieceHangs(o) !== hangs) continue;
      const r = rect(placeOf(o, o.spot));
      // only a piece beside this one across the other axis: within PIECE_SNAP of overlapping it
      if (m[2] < r[3] + PIECE_SNAP && m[3] > r[2] - PIECE_SNAP) for (const x of [r[1] - m[0] + KISS, r[0] - m[1] - KISS, r[0] - m[0], r[1] - m[1]]) bu = best(bu, x);
      if (m[0] < r[1] + PIECE_SNAP && m[1] > r[0] - PIECE_SNAP) for (const x of [r[3] - m[2] + KISS, r[2] - m[3] - KISS, r[2] - m[2], r[3] - m[3]]) bv = best(bv, x);
    }
    if (spot.wall) {
      const side = spot.wall === 'left' || spot.wall === 'right', d = side ? bv : bu;
      return d === null ? spot : cleanSpot({ wall: spot.wall, along: spot.along + d });
    }
    if (bu === null && bv === null) return spot;
    return cleanSpot({ at: [spot.at[0] + (bu || 0), spot.at[1] + (bv || 0)], turn: spot.turn });
  }
  const placeOf = (p, spot) => resolveSpot(S.spec, spot, dimsOfPiece(p));

  // ── the camera ──
  const box = () => { const fs = floorsOf(S.L); return [Math.min(...fs.map((q) => q[0])), Math.max(...fs.map((q) => q[1])), Math.min(...fs.map((q) => q[2])), Math.max(...fs.map((q) => q[3]))]; };
  const B0 = box(), mid = [(B0[0] + B0[1]) / 2, (B0[2] + B0[3]) / 2];
  // from behind the door wall at a corner, looking toward the window: the way you see it walking in
  const frontYaw = Math.atan2(S.L.f[0], S.L.f[2]);
  const cam = { yaw: frontYaw + Math.PI / 4, pitch: -0.82, zoom: 1, at: S.L.world(mid[0], mid[1], 0.3) };
  const goal = { ...cam, at: [...cam.at] };
  const fwdOf = (y, p) => [Math.sin(y) * Math.cos(p), Math.sin(p), Math.cos(y) * Math.cos(p)];
  let lastT = 0, aspect = 1;
  // the slide keys held down: [forward, right]
  const SLIDE = { w: [1, 0], arrowup: [1, 0], s: [-1, 0], arrowdown: [-1, 0], d: [0, 1], arrowright: [0, 1], a: [0, -1], arrowleft: [0, -1] };
  const slideKeys = new Set();
  let slideFast = false;   // Shift held: the slide goes three times as fast
  function eyeNow() {
    const f = fwdOf(cam.yaw, cam.pitch), R0 = 0.5 * Math.hypot(B0[1] - B0[0], B0[3] - B0[2]) + 0.8;
    const half = (FOV * Math.PI / 180) / 2, hHalf = Math.atan(Math.tan(half) * aspect);
    const dist = (R0 / Math.tan(Math.min(half, hHalf))) * cam.zoom;
    return { eye: cam.at.map((x, i) => x - f[i] * dist), f };
  }
  function camNow(now) {
    const dt = lastT ? Math.min(0.1, (now - lastT) / 1000) : 0.016, k = 1 - Math.exp(-dt * 12);
    lastT = now;
    // WASD held slides the view, about 12 m a second at the opening zoom (4 crawled across a big flat)
    if (slideKeys.size) {
      let f = 0, r = 0;
      for (const k of slideKeys) { const s = SLIDE[k]; f += s[0]; r += s[1]; }
      const st = (slideFast ? 36 : 12) * goal.zoom * dt, fw = [Math.sin(goal.yaw), 0, Math.cos(goal.yaw)], rt = [-Math.cos(goal.yaw), 0, Math.sin(goal.yaw)];
      const c = goal.at.map((x, i) => x + (fw[i] * f + rt[i] * r) * st), q = box(), l = S.L.local(c);
      goal.at = S.L.world(clamp(l[0], q[0] - 1, q[1] + 1), clamp(l[1], q[2] - 1, q[3] + 1), 0.3);
    }
    cam.yaw += (goal.yaw - cam.yaw) * k; cam.pitch += (goal.pitch - cam.pitch) * k; cam.zoom += (goal.zoom - cam.zoom) * k;
    for (let i = 0; i < 3; i++) cam.at[i] += (goal.at[i] - cam.at[i]) * k;
    const { eye } = eyeNow();
    return { eye, yaw: cam.yaw, pitch: cam.pitch, fov: FOV };
  }
  // the ray under a point of the picture, in the room's frame: from [u, v, y] along [du, dv, dy]
  function rayAt(x, y) {
    const w = host.clientWidth || 1, h = host.clientHeight || 1, { eye, f } = eyeNow();
    const t = Math.tan((FOV * Math.PI / 180) / 2), nx = (2 * x / w - 1) * t * (w / h), ny = (1 - 2 * y / h) * t;
    const rl = Math.hypot(f[2], f[0]) || 1, r = [-f[2] / rl, 0, f[0] / rl], up = [r[1] * f[2] - r[2] * f[1], r[2] * f[0] - r[0] * f[2], r[0] * f[1] - r[1] * f[0]];
    const d = [0, 1, 2].map((i) => f[i] + r[i] * nx + up[i] * ny);
    const L = S.L, o = L.local(eye), dl = [d[0] * L.r[0] + d[2] * L.r[2], -(d[0] * L.f[0] + d[2] * L.f[2]), d[1]];
    return { o, d: dl };
  }
  function floorAt(x, y, at = 0) {
    const { o, d } = rayAt(x, y);
    if (d[2] > -1e-4) return null;
    const s = (at - o[2]) / d[2];
    return [o[0] + d[0] * s, o[1] + d[1] * s];
  }
  // a piece's box in the room's frame: [u0, u1, v0, v1, y0, y1]
  function boxOf(p) {
    const q = Math.round(quarter(p.turn) / 90) % 2, hw = (q ? p.d : p.w) / 2, hd = (q ? p.w : p.d) / 2;
    const hung = pieceHangs(p);
    if (hung && p.wall) {
      const hu = S.L.w / 2, D = S.L.d, a0 = LAID_IN, a1 = LAID_IN + Math.max(0.15, p.h);
      if (p.wall === 'left') return [-hu + a0, -hu + a1, p.v - p.w / 2, p.v + p.w / 2, 0, 0.1];
      if (p.wall === 'right') return [hu - a1, hu - a0, p.v - p.w / 2, p.v + p.w / 2, 0, 0.1];
      if (p.wall === 'front') return [p.u - p.w / 2, p.u + p.w / 2, a0, a1, 0, 0.1];
      return [p.u - p.w / 2, p.u + p.w / 2, D - a1, D - a0, 0, 0.1];
    }
    const y0 = hung ? Math.max(0.6, (p.mount ?? 1.5) - p.h / 2) : p.y0 || 0;
    return [p.u - hw, p.u + hw, p.v - hd, p.v + hd, y0, y0 + Math.max(0.15, p.h)];
  }
  function pick(x, y) {
    const { o, d } = rayAt(x, y);
    let best = null, bt = Infinity;
    for (const p of S.L.placed) {
      if (p.annex || p.spot?.on) continue;
      const b = boxOf(p), lo = [b[0], b[2], b[4]], hi = [b[1], b[3], b[5]];
      let t0 = 0, t1 = Infinity;
      for (let i = 0; i < 3; i++) {
        if (Math.abs(d[i]) < 1e-9) { if (o[i] < lo[i] || o[i] > hi[i]) { t0 = Infinity; break; } continue; }
        let a = (lo[i] - o[i]) / d[i], c = (hi[i] - o[i]) / d[i];
        if (a > c) [a, c] = [c, a];
        t0 = Math.max(t0, a); t1 = Math.min(t1, c);
      }
      if (t0 <= t1 && t0 < bt) { bt = t0; best = p; }
    }
    return best ? pieceOf(best.id) || null : null;
  }

  // ── the piece in your hand ──
  // built once on its own (the room's shell less everything but it), then moved as a prop each frame
  function heldBatch(list, leadId) {
    try {
      const sp = S.spec;
      const bare = { w: sp.w, d: sp.d, h: sp.h, unit: 'm', door: sp.door, window: sp.window, windows: [], windowless: true, finish: sp.finish, at: sp.at, face: sp.face, floor: sp.floor };
      const L1 = roomLayout(bare, list.map(([p, spot]) => ({ ...p, spot }))), m = buildRoom(L1, { ...opts(), shell: false });
      const parts = [m.solid, ...m.textured.values()];
      let n = 0;
      for (const b of parts) for (const [, c] of b.kit || []) n += c;
      const rest = new Float32Array(n * STRIDE);
      let at = 0;
      for (const b of parts) for (const [first, c] of b.kit || []) { rest.set(b.data.subarray(first * STRIDE, (first + c) * STRIDE), at); at += c * STRIDE; }
      const q = L1.placed.find((x) => x.id === leadId) || L1.placed[0];
      // a hung piece in hand lies on the floor as the room shows it (and is built again when it changes wall)
      if (q?.wall && list.length === 1 && pieceHangs(list[0][0])) {
        const L2 = { ...L1, at: S.L.at, r: S.L.r, f: S.L.f, floor: S.L.floor, w: S.L.w, d: S.L.d };
        const lay = layPlan(rest, [[0, rest.length / STRIDE]], L2)[0] || { wall: q.wall, top: (q.mount ?? 1.5) + q.h / 2 };
        layVerts(rest, 0, rest.length / STRIDE, { ...lay, wall: q.wall }, L2);
      }
      return { rest, out: new Float32Array(rest.length), base: q ? S.L.world(q.u, q.v, 0) : null };
    } catch (err) {
      console.warn('[arrange] the piece in hand', err);
      return null;
    }
  }
  function pickUp(p, hit) {
    const q = S.L.placed.find((x) => x.id === p.id);
    if (!q) return;
    const turn = quarter(q.turn), spot = spotOf(p.id);
    // the others picked with it ride along, each kept where it stands relative to this one
    const crew = picked.has(p.id) ? [...picked].filter((id) => id !== p.id).map(pieceOf).filter((c) => can(c) && S.L.placed.some((x) => x.id === c.id)) : [];
    const ids = new Set([p.id, ...crew.map((c) => c.id)]);
    held = { id: p.id, ids, p, turn, off: [q.u - hit[0], q.v - hit[1]], spot, ok: true, from: spot, place: placeOf(p, spot), free: false,
      crew: crew.map((c) => { const s = spotOf(c.id), pl = placeOf(c, s); return { p: c, from: s, spot: s, at0: [pl.u, pl.v], turn: quarter(pl.turn), place: pl }; }) };
    held.start = [held.place.u, held.place.v];
    held.mesh = heldBatch([[p, spot], ...held.crew.map((c) => [c.p, c.spot])], p.id); held.meshTurn = quarter(held.place.turn);
    sel = p.id;
    rebuild();
    sync();
  }
  function moveHeld(hit) {
    if (!held || !hit) return;
    const u = snap(hit[0] + held.off[0]), v = snap(hit[1] + held.off[1]);
    // a group moves together, so only a lone piece is pulled to a wall
    held.spot = spotFor(held.p, u, v, held.turn, held.free || held.crew.length > 0);
    held.place = placeOf(held.p, held.spot);
    held.at = [u, v];
    const du = held.place.u - held.start[0], dv = held.place.v - held.start[1];
    for (const c of held.crew) { c.spot = spotFor(c.p, c.at0[0] + du, c.at0[1] + dv, c.turn, true); c.place = placeOf(c.p, c.spot); }
    if (!held.crew.length) held.ok = fits(held.p, held.spot);
    else {
      // each against the room less the group: the group keeps its own shape (chairs tucked under a table overlap
      // it), so only furniture outside it can be in the way
      const all = [[held.p, held.spot], ...held.crew.map((c) => [c.p, c.spot])];
      held.ok = all.every(([p, s]) => spotFits(S.spec, othersOf(p.id, held.ids), p, s, { byHand: true }));
    }
    // a turn (a wall it snapped to, or R) is built again; a move is only the vertices moved
    if (quarter(held.place.turn) !== held.meshTurn) { held.mesh = heldBatch([[held.p, held.spot]], held.p.id); held.meshTurn = quarter(held.place.turn); }
    else if (held.spot.wall && pieceHangs(held.p)) {
      // a laid piece's vertices are its wall's: moved along it, it's only shifted; onto another, built again
      if (held.meshWall !== held.spot.wall) { held.mesh = heldBatch([[held.p, held.spot]], held.p.id); held.meshWall = held.spot.wall; }
    }
  }
  function turnHeld(dir) {
    if (!held) return;
    if (pieceHangs(held.p)) { say('It hangs on a wall: drag it to another wall.'); return; }
    if (held.crew.length) { say('Put them down to turn them.'); return; }
    held.turn = quarter(held.turn + 90 * dir);
    const at = held.at || [held.place.u, held.place.v];
    held.off = [0, 0];
    moveHeld(at);
  }
  function putDown(keep = true) {
    const h = held;
    if (!h) return;
    held = null;
    R.setProps(NONE);
    // red never goes down, staff included: what you see in this mode is what the room lays out, so nothing saved
    // here overlaps another piece or stands in a way through
    const many = h.crew.length > 0;
    if (keep && h.ok && !sameSpot(h.spot, h.from)) {
      commitMany([[h.id, h.spot], ...h.crew.map((c) => [c.p.id, c.spot])]);
      return;
    }
    if (keep && !h.ok) say(many ? "There's no room for them all there." : `There's no room for the ${h.p.name} there.`);
    rebuild();
    sync();
  }
  function drawHeld() {
    const h = held;
    if (!h?.mesh?.base) { R.setProps(NONE); return; }
    const to = S.L.world(h.place.u, h.place.v, 0), dx = to[0] - h.mesh.base[0], dz = to[2] - h.mesh.base[2];
    const { rest, out } = h.mesh;
    out.set(rest);
    const laidShift = h.spot?.wall && pieceHangs(h.p);
    // a laid piece: only its slide along the wall moves it (its mesh was laid at its own wall's foot)
    for (let i = 0; i < out.length; i += STRIDE) { out[i] += dx; out[i + 1] += laidShift ? 0.01 : LIFT; out[i + 2] += dz; }
    R.setProps({ data: out, n: out.length / STRIDE });
  }

  // ── turning a piece where it stands ──
  function turnPiece(id, dir) {
    const p = pieceOf(id), q = S.L.placed.find((x) => x.id === id);
    if (!p || !q) return;
    if (!can(p)) { say(`The ${p.name} is fixed in place.`); return; }
    if (pieceHangs(p)) { say('It hangs on a wall: drag it to another wall.'); return; }
    const spot = spotFor(p, q.u, q.v, quarter(quarter(q.turn) + 90 * dir));
    if (!fits(p, spot)) { say(`There's no room to turn the ${p.name} there.`); return; }
    commit(id, spot);
  }
  function putBack(id) {
    const p = pieceOf(id);
    if (!p || !draft.has(id) || added.has(id)) return;
    if (!fits(p, saved.get(id))) { say(`Something's in the way of where the ${p.name} was.`); return; }
    commit(id, saved.get(id));
  }

  // ── the bar ──
  function sync() {
    const p = sel ? pieceOf(sel) : null, n = changeCount();
    nameEl.textContent = p ? (can(p) ? p.name : `${p.name} (fixed)`) : 'Pick a piece';
    const movable = can(p) && !saving;
    btn('turnl').disabled = btn('turnr').disabled = !movable || pieceHangs(p);
    btn('back').disabled = !movable || !draft.has(sel) || added.has(sel);
    if (admin) btn('remove').disabled = !movable;
    btn('undo').disabled = saving || !undo.length;
    btn('reset').disabled = saving || !(draft.size || added.size || removed.size || sheetDraft.size || sheetAdds.size);
    const save = btn('save');
    save.disabled = saving || !n;
    save.textContent = saving ? 'Saving...' : n ? `Save layout (${n})` : 'Save layout';
    btn('cancel').disabled = saving;
  }
  let flashT = 0;
  function say(text, good = false) {
    flashEl.textContent = text; flashEl.hidden = false; flashEl.classList.toggle('good', good);
    clearTimeout(flashT); flashT = setTimeout(() => { flashEl.hidden = true; }, 2800);
  }
  function save() {
    if (saving || !changeCount()) return;
    const words = [
      ...moved().map(([id, s]) => `${id}@${spotText(s)}`),
      ...[...added.values()].map((p) => `+${p.itemId}@${spotText(draft.get(p.id))}`),
      ...[...removed].map((id) => `-${id}`),
      ...sheetWords(),
    ];
    saving = true; sync();
    send(`arrange layout ${words.join(' ')}`);
    // no answer at all (a dropped socket): the bar comes back so they can try again
    setTimeout(() => { if (saving && !closed) { saving = false; sync(); say('No answer from the server. Try again.'); } }, 8000);
  }
  // a moved run: every hung sheet of its set to the spot; a carried roll to its set's spot, or where its run hangs now
  function sheetWords() {
    const word = (sp) => `${sp.wall}${Number.isFinite(sp.along) ? `:${sp.along.toFixed(2)}` : ''}`;
    const out = [];
    for (const [set, sp] of sheetMoves()) for (const s of S.sheets) if (s.set === set) out.push(`sheet:${s.id}@${word(sp)}`);
    const runs = sheetAdds.size ? runsHere() : [];
    for (const s of sheetAdds.values()) {
      const r = runs.find((x) => x.g.set === s.set)?.run;
      const sp = sheetDraft.get(s.set) || savedSheetSpot(s.set) || (r ? { wall: r.wall, along: r.c } : { wall: 'back' });
      out.push(`sheet+${s.inv}@${word(sp)}`);
    }
    return out;
  }
  function close(saveIt) {
    if (closed) return;
    closed = true;
    held = null;
    R.setProps(NONE);
    document.removeEventListener('keydown', onKey, true); document.removeEventListener('keyup', onKeyUp, true); window.removeEventListener('blur', dropKeys); slideKeys.clear();
    el.remove();
    // the posters as saved, until the server's room_sheets says so; hung back on their walls
    if (saveIt && (sheetDraft.size || sheetAdds.size)) S.sheets = sheetsNow();
    repaint();
    // saved: the room as it now stands, until the server's own room_piece replaces it (the new pieces with their real ids)
    done(saveIt ? apply(S.pieces) : null);
  }
  function cancel() {
    if (changeCount() && Date.now() - escArmed > 2500) { escArmed = Date.now(); say('Leave without saving? Cancel again (or Esc) to drop your changes.'); return; }
    close(false);
  }
  el.querySelector('.ra-bar').addEventListener('click', (e) => {
    const a = e.target.closest('button')?.dataset.a;
    if (!a) return;
    if (a === 'viewl') goal.yaw += Math.PI / 2;
    else if (a === 'viewr') goal.yaw -= Math.PI / 2;
    else if (a === 'turnl' && sel) turnPiece(sel, -1);
    else if (a === 'turnr' && sel) turnPiece(sel, 1);
    else if (a === 'back' && sel) putBack(sel);
    else if (a === 'remove' && sel) removePiece(sel);
    else if (a === 'menu') toggleMenu();
    else if (a === 'undo') doUndo();
    else if (a === 'reset') { if (draft.size || added.size || removed.size || sheetDraft.size || sheetAdds.size) { remember(); draft.clear(); added.clear(); removed.clear(); sheetDraft.clear(); sheetAdds.clear(); bad.clear(); sel = null; rebuild(); repaintSheets(); drawPosterMenu(); sync(); } }
    else if (a === 'posters') togglePosterMenu();
    else if (a === 'cancel') cancel();
    else if (a === 'save') save();
  });
  function doUndo() {
    if (!undo.length || saving) return;
    const was = undo.pop();
    draft.clear(); added.clear(); removed.clear();
    for (const [k, v] of was.draft) draft.set(k, v);
    for (const [k, v] of was.added) added.set(k, v);
    for (const k of was.removed) removed.add(k);
    sheetDraft.clear(); sheetAdds.clear();
    for (const [k, v] of was.sheetDraft) sheetDraft.set(k, v);
    for (const [k, v] of was.sheetAdds) sheetAdds.set(k, v);
    repaintSheets(); drawPosterMenu();
    if (sel && !pieceOf(sel)) sel = null;
    for (const id of [...picked]) if (!pieceOf(id) || removed.has(id)) picked.delete(id);
    rebuild();
    sync();
  }

  // ── the Furniture menu (admin): every furniture item, by what kind of thing it is, and a search ──
  const menu = el.querySelector('.ra-menu:not(.ra-pmenu)'), findEl = el.querySelector('.ra-find'), listEl = el.querySelector('.ra-list'), catsEl = el.querySelector('.ra-cats');
  let shelf = 'all';
  const SHELVES = [['all', 'All'], ['seat', 'Seating', ['sofa', 'seat', 'bench']], ['bed', 'Beds', ['bed']], ['table', 'Tables', ['table', 'surface', 'top']],
    ['store', 'Storage', ['store', 'cabinet', 'wardrobe']], ['kitchen', 'Kitchen', ['cold', 'hob', 'sink']], ['bath', 'Bathroom', ['shower', 'toilet']],
    ['screen', 'Screens', ['screen', 'deck']], ['other', 'Other']];
  const shelfOf = (it) => SHELVES.find(([, , as]) => as?.includes(it.arche))?.[0] || 'other';
  function toggleMenu(open) {
    if (!menu) return;
    const show = open ?? menu.hidden;
    menu.hidden = !show;
    tipEl.hidden = true;
    btn('menu')?.classList.toggle('on', show);
    if (show && !catalog) sendSilent('arrange catalog');
    if (show) { drawMenu(); setTimeout(() => findEl?.focus(), 0); }
  }
  function drawMenu() {
    if (!menu) return;
    if (!catalog) { listEl.innerHTML = '<p class="ra-empty">Loading...</p>'; return; }
    catsEl.innerHTML = SHELVES.filter(([k]) => k === 'all' || catalog.some((it) => shelfOf(it) === k))
      .map(([k, label]) => `<button type="button" data-shelf="${k}" class="${k === shelf ? 'on' : ''}">${label}</button>`).join('');
    const q = (findEl.value || '').trim().toLowerCase();
    const hits = catalog.filter((it) => (shelf === 'all' || shelfOf(it) === shelf) && (!q || it.name.toLowerCase().includes(q) || it.id.toLowerCase().includes(q)));
    listEl.innerHTML = hits.length
      ? hits.map((it) => `<button type="button" class="ra-item" role="option" data-item="${esc(it.id)}" title="${esc(it.id)}"><span>${esc(it.name)}</span><i>${esc(it.form || it.arche)}${Number.isFinite(it.value) ? ` · ${it.value}c` : ''}</i></button>`).join('')
      : '<p class="ra-empty">Nothing by that name.</p>';
  }
  if (menu) {
    menu.querySelector('.ra-menu-x').addEventListener('click', () => toggleMenu(false));
    findEl.addEventListener('input', drawMenu);
    findEl.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { toggleMenu(false); e.stopPropagation(); }
      if (e.key === 'Enter') { const b = listEl.querySelector('.ra-item'); if (b) b.click(); e.preventDefault(); }
    });
    catsEl.addEventListener('click', (e) => { const k = e.target.closest('[data-shelf]')?.dataset.shelf; if (k) { shelf = k; drawMenu(); } });
    listEl.addEventListener('click', (e) => {
      const id = e.target.closest('[data-item]')?.dataset.item, it = id && catalog?.find((x) => x.id === id);
      if (it && !saving) addItem(it);
    });
    for (const ev of ['pointerdown', 'wheel']) menu.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });
  }

  // ── the Posters menu: the rolls this player carries (plugins/roomstage 'arrange sheets') ──
  const pmenu = el.querySelector('.ra-pmenu'), plist = pmenu.querySelector('.ra-list');
  function togglePosterMenu(open) {
    const show = open ?? pmenu.hidden;
    pmenu.hidden = !show;
    tipEl.hidden = true;
    btn('posters')?.classList.toggle('on', show);
    if (show && !stock) sendSilent('arrange sheets');
    if (show) drawPosterMenu();
  }
  function drawPosterMenu() {
    if (pmenu.hidden) return;
    if (!stock) { plist.innerHTML = '<p class="ra-empty">Loading...</p>'; return; }
    const left = stock.filter((it) => !sheetAdds.has(it.id));
    plist.innerHTML = left.length
      ? left.map((it) => `<button type="button" class="ra-item" role="option" data-sheet="${esc(it.id)}"><span>${esc(it.name)}</span><i>put up</i></button>`).join('')
      : `<p class="ra-empty">${stock.length ? 'All of them are going up.' : "You aren't carrying any posters."}</p>`;
  }
  pmenu.querySelector('.ra-menu-x').addEventListener('click', () => togglePosterMenu(false));
  plist.addEventListener('click', (e) => {
    const id = e.target.closest('[data-sheet]')?.dataset.sheet, it = id && stock?.find((x) => x.id === id);
    if (it && !saving) addSheet(it);
  });
  for (const ev of ['pointerdown', 'wheel']) pmenu.addEventListener(ev, (e) => e.stopPropagation(), { passive: true });

  // ── the pointer ──
  const pts = new Map();
  let pinch = null;
  const local = (e) => { const b = host.getBoundingClientRect(); return [e.clientX - b.left, e.clientY - b.top]; };
  const panBy = (a, b) => {
    if (!a || !b) return;
    const L = S.L, du = a[0] - b[0], dv = a[1] - b[1];
    goal.at = goal.at.map((x, i) => x + (i === 1 ? 0 : L.r[i] * du - L.f[i] * dv));
    // the room stays on the screen
    const c = L.local(goal.at), q = box();
    const cu = clamp(c[0], q[0] - 1, q[1] + 1), cv = clamp(c[1], q[2] - 1, q[3] + 1);
    goal.at = L.world(cu, cv, 0.3);
  };
  el.addEventListener('contextmenu', (e) => e.preventDefault());
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.ra-bar, button')) return;
    e.preventDefault(); e.stopPropagation();
    tipEl.hidden = true;
    try { el.setPointerCapture(e.pointerId); } catch { /* not capturable */ }
    const [x, y] = local(e);
    pts.set(e.pointerId, [x, y]);
    if (pts.size === 2) {
      // two fingers: pinch to zoom, move both to slide the view; a piece in hand goes back
      if (held) putDown(false);
      pend = null;
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), zoom: goal.zoom, mid: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] };
      return;
    }
    if (saving) { pend = { kind: 'orbit', x0: x, y0: y, x, y }; return; }
    const sr = e.button === 0 ? sheetPick(x, y) : null;
    if (sr) {
      // held where it was taken: the pointer's distance from the run's middle along the wall is kept
      const hit = floorAt(x, y), at = hit ? (sr.run.wall === 'left' || sr.run.wall === 'right' ? hit[1] : hit[0]) : sr.run.c;
      pend = { kind: 'sheet', set: sr.g.set, off: sr.run.c - at, x0: x, y0: y, x, y };
      return;
    }
    const p = pick(x, y);
    if (e.button === 2) {
      if (p) { sel = p.id; turnPiece(p.id, e.shiftKey ? -1 : 1); sync(); pend = null; return; }
      pend = { kind: 'pan', x0: x, y0: y, x, y };
      return;
    }
    // the middle button swings round the room, wherever it's pressed
    if (e.button === 1) { pend = { kind: 'orbit', x0: x, y0: y, x, y }; return; }
    if (p) {
      // Shift or Ctrl adds it to the pieces picked (or takes it out); a plain click on one of them drags the lot
      const multi = e.shiftKey || e.ctrlKey || e.metaKey;
      if (multi) {
        if (!picked.size && sel && sel !== p.id && can(pieceOf(sel))) picked.add(sel);
        if (picked.has(p.id)) { picked.delete(p.id); sel = picked.size ? [...picked].pop() : null; sync(); pend = { kind: 'orbit', x0: x, y0: y, x, y }; return; }
        if (can(p)) picked.add(p.id);
      } else if (!picked.has(p.id)) picked.clear();
      sel = p.id; sync();
      pend = can(p) ? { kind: 'piece', p, x0: x, y0: y, x, y, multi } : { kind: 'orbit', x0: x, y0: y, x, y, fixed: p };
      if (!can(p)) say(`The ${p.name} is fixed in place.`);
      return;
    }
    // Shift or Ctrl on bare floor draws a box: every movable piece whose middle is in it is picked
    if (e.shiftKey || e.ctrlKey || e.metaKey) { pend = { kind: 'box', x0: x, y0: y, x, y }; return; }
    pend = { kind: 'orbit', x0: x, y0: y, x, y, empty: true };
  });
  function boxPick(b) {
    const w = host.clientWidth, h = host.clientHeight, [x0, x1] = [Math.min(b.x0, b.x), Math.max(b.x0, b.x)], [y0, y1] = [Math.min(b.y0, b.y), Math.max(b.y0, b.y)];
    for (const q of S.L.placed) {
      if (q.annex || q.spot?.on) continue;
      const p = pieceOf(q.id), s = R.project(S.L.world(q.u, q.v, 0.1), w, h);
      if (can(p) && s && s.x >= x0 && s.x <= x1 && s.y >= y0 && s.y <= y1) { picked.add(q.id); sel = q.id; }
    }
    sync();
  }
  el.addEventListener('pointermove', (e) => {
    e.stopPropagation();
    const [x, y] = local(e);
    if (pts.has(e.pointerId)) pts.set(e.pointerId, [x, y]);
    if (pinch && pts.size >= 2) {
      const [a, b] = [...pts.values()], d = Math.hypot(a[0] - b[0], a[1] - b[1]), m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      goal.zoom = clamp(pinch.zoom * (pinch.d / Math.max(20, d)), ZOOM[0], ZOOM[1]);
      panBy(floorAt(pinch.mid[0], pinch.mid[1]), floorAt(m[0], m[1]));
      pinch.mid = m;
      return;
    }
    if (held) { held.free = e.altKey; moveHeld(floorAt(x, y)); return; }
    if (pend) {
      const dx = x - pend.x, dy = y - pend.y, far = Math.hypot(x - pend.x0, y - pend.y0) > 5;
      if (pend.kind === 'sheet') {
        if (far || sheetHeld) { const hit = floorAt(x, y), sp = hit && sheetSpotAt(hit, pend.set, pend.off); if (sp && !sameSpot(sp, sheetHeld?.spot)) { sheetHeld = { set: pend.set, spot: sp }; repaintSheets(); } else if (sp && !sheetHeld) sheetHeld = { set: pend.set, spot: sp }; }
        pend.x = x; pend.y = y;
        return;
      }
      if (pend.kind === 'piece' && far) { const hit = floorAt(pend.x0, pend.y0); if (hit) pickUp(pend.p, hit); pend = null; moveHeld(floorAt(x, y)); return; }
      if (pend.kind === 'orbit' && far) { goal.yaw -= dx * 0.008; goal.pitch = clamp(goal.pitch + dy * 0.006, PITCH[0], PITCH[1]); pend.moved = true; }
      if (pend.kind === 'box') pend.moved ||= far;
      if (pend.kind === 'pan' && far) { panBy(floorAt(pend.x, pend.y), floorAt(x, y)); pend.moved = true; }
      pend.x = x; pend.y = y;
      return;
    }
    // hovering: what's under the pointer and what it'd do
    if (sheetPick(x, y)) { hover = null; el.style.cursor = 'grab'; tipEl.hidden = false; tipEl.textContent = 'Poster: drag it along the walls (it snaps to the grid and to the poster beside it)'; tipEl.style.left = `${x + 16}px`; tipEl.style.top = `${y + 12}px`; return; }
    const p = pick(x, y);
    hover = p?.id || null;
    el.style.cursor = p ? (can(p) ? 'grab' : 'not-allowed') : '';
    tipEl.hidden = !p;
    if (p) { tipEl.textContent = can(p) ? `${p.name}: drag to move, R to turn${admin ? ', Delete to remove' : ''}` : `${p.name}: fixed in place`; tipEl.style.left = `${x + 16}px`; tipEl.style.top = `${y + 12}px`; }
  });
  const up = (e) => {
    e.stopPropagation();
    pts.delete(e.pointerId);
    if (pinch) { if (pts.size < 2) pinch = null; return; }
    if (held) { putDown(true); return; }
    if (pend?.kind === 'sheet') {
      const h2 = sheetHeld;
      pend = null; sheetHeld = null;
      if (h2) {
        remember();
        if (sameSpot(h2.spot, savedSheetSpot(h2.set))) sheetDraft.delete(h2.set); else sheetDraft.set(h2.set, h2.spot);
        repaintSheets(); sync();
      }
      return;
    }
    const p = pend;
    pend = null;
    // a click on bare floor lets go of the piece you'd picked
    if (p?.kind === 'box') { if (p.moved) boxPick(p); }
    else if (p?.empty && !p.moved) { sel = null; picked.clear(); sync(); }
    // a plain click (no drag) on one of a group picks that one alone
    else if (p?.kind === 'piece' && !p.multi && picked.size > 1) { picked.clear(); sync(); }
  };
  el.addEventListener('pointerup', up);
  el.addEventListener('pointercancel', (e) => { pts.delete(e.pointerId); pinch = null; pend = null; if (sheetHeld) { sheetHeld = null; repaintSheets(); } if (held) putDown(false); });
  el.addEventListener('pointerleave', () => { tipEl.hidden = true; hover = null; });
  el.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (held) { turnHeld(e.deltaY > 0 ? 1 : -1); return; }
    goal.zoom = clamp(goal.zoom * Math.exp(e.deltaY * 0.0012), ZOOM[0], ZOOM[1]);
  }, { passive: false });

  // ── the keys ── (on the document, ahead of the Stage's walker, which they'd otherwise move)
  function onKey(e) {
    if (closed) return;
    // the game's command line keeps no keys while you arrange: it takes focus back on its own, and WASD went into it
    const field = e.target.closest?.('input, textarea, select, [contenteditable]');
    if (field && field.id === 'cmd-input') field.blur();
    else if (field || document.getElementById('tablet-os-overlay')) return;
    const k = String(e.key || ''), lk = k.toLowerCase();
    slideFast = e.shiftKey;
    let used = true;
    if (k === 'Escape') { if (held) putDown(false); else if (sel || picked.size) { sel = null; picked.clear(); sync(); } else cancel(); }
    else if ((e.ctrlKey || e.metaKey) && lk === 'z') doUndo();
    else if (k === 'Enter') save();
    else if (lk === 'r' || k === '.' || k === ',') { const dir = e.shiftKey || k === ',' ? -1 : 1; if (held) turnHeld(dir); else if (picked.size > 1) { for (const id of [...picked]) turnPiece(id, dir); } else if (sel) turnPiece(sel, dir); }
    else if (lk === 'q') goal.yaw += Math.PI / 2;
    else if (lk === 'e') goal.yaw -= Math.PI / 2;
    else if (k === 'Delete' && admin) { if (sel) removePiece(sel); }
    else if (k === 'Backspace' || k === 'Delete') { if (sel) putBack(sel); }
    else if (lk === 'f' && admin) toggleMenu();
    else if (lk === 'p') togglePosterMenu();
    else if (k === '+' || k === '=') goal.zoom = clamp(goal.zoom * 0.85, ZOOM[0], ZOOM[1]);
    else if (k === '-' || k === '_') goal.zoom = clamp(goal.zoom / 0.85, ZOOM[0], ZOOM[1]);
    else if (SLIDE[lk]) slideKeys.add(lk);
    else used = false;
    if (used) { e.preventDefault(); e.stopPropagation(); }
  }
  function onKeyUp(e) { slideFast = e.shiftKey; const lk = String(e.key || '').toLowerCase(); if (slideKeys.delete(lk)) { e.preventDefault(); e.stopPropagation(); } }
  const dropKeys = () => { slideKeys.clear(); slideFast = false; };
  document.addEventListener('keydown', onKey, true);
  document.addEventListener('keyup', onKeyUp, true);
  window.addEventListener('blur', dropKeys);

  // ── the overlay: the floor's grid, the footprints ──
  function poly(pts2, fill, stroke, wide = 2) {
    if (pts2.some((q) => !q)) return;
    g.beginPath(); pts2.forEach((q, i) => (i ? g.lineTo(q.x, q.y) : g.moveTo(q.x, q.y))); g.closePath();
    if (fill) { g.fillStyle = fill; g.fill(); }
    if (stroke) { g.strokeStyle = stroke; g.lineWidth = wide; g.stroke(); }
  }
  function overlay() {
    const w = host.clientWidth, h = host.clientHeight, dpr = Math.min(2, window.devicePixelRatio || 1);
    if (ink.width !== Math.round(w * dpr) || ink.height !== Math.round(h * dpr)) { ink.width = Math.round(w * dpr); ink.height = Math.round(h * dpr); }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, h);
    const L = S.L, P = (u, v, y = 0.012) => R.project(L.world(u, v, y), w, h);
    // the grid, half a metre, faint
    const [u0, u1, v0, v1] = [-L.w / 2, L.w / 2, 0, L.d];
    g.strokeStyle = 'rgba(160, 220, 255, 0.13)'; g.lineWidth = 1;
    g.beginPath();
    for (let u = Math.ceil(u0 / 0.5) * 0.5; u <= u1 + 1e-6; u += 0.5) { const a = P(u, v0), b = P(u, v1); if (a && b) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } }
    for (let v = Math.ceil(v0 / 0.5) * 0.5; v <= v1 + 1e-6; v += 0.5) { const a = P(u0, v), b = P(u1, v); if (a && b) { g.moveTo(a.x, a.y); g.lineTo(b.x, b.y); } }
    g.stroke();
    const foot = (q, y) => { const b = boxOf(q); return [P(b[0], b[2], y), P(b[1], b[2], y), P(b[1], b[3], y), P(b[0], b[3], y)]; };
    for (const q of L.placed) {
      if (q.annex || held?.ids.has(q.id)) continue;
      const p = pieceOf(q.id);
      if (bad.has(q.id)) poly(foot(q, 0.012), 'rgba(255, 70, 70, 0.22)', 'rgba(255, 90, 90, 0.95)', 2);
      else if (q.id === sel || picked.has(q.id)) poly(foot(q, 0.012), 'rgba(90, 210, 255, 0.16)', 'rgba(110, 225, 255, 0.95)', 2.5);
      else if (q.id === hover) poly(foot(q, 0.012), null, can(p) ? 'rgba(255, 255, 255, 0.7)' : 'rgba(255, 200, 120, 0.6)', 1.5);
      else if (added.has(q.id)) poly(foot(q, 0.012), null, 'rgba(255, 210, 90, 0.6)', 1.5);
      else if (draft.has(q.id)) poly(foot(q, 0.012), null, 'rgba(110, 225, 255, 0.35)', 1);
    }
    // the posters: an outline round each run where it lies at its wall's foot, and the wall grid along the wall of the
    // one in hand (or a hung piece in hand)
    const runs = runsHere(), gridWall = sheetHeld?.spot?.wall || (held && pieceHangs(held.p) ? held.spot?.wall : null);
    if (gridWall) {
      const L = S.L, hu = L.w / 2, side = gridWall === 'left' || gridWall === 'right';
      const at = (s, o) => (gridWall === 'left' ? [-hu + o, s] : gridWall === 'right' ? [hu - o, s] : gridWall === 'front' ? [s, o] : [s, L.d - o]);
      g.strokeStyle = 'rgba(255, 255, 255, 0.45)'; g.lineWidth = 1;
      for (const s of gridAlong(L, side ? 0 : -hu, side ? L.d : hu)) {
        const p1 = P(...at(s, 0), 0.01), p2 = P(...at(s, laidIn(L) * 0.6 + 0.12), 0.01);
        if (p1 && p2) { g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); }
      }
    }
    for (const r of runs) {
      const q = laidRect(r.run, r.width / 2, r.height).map(([u, v]) => P(u, v, 0.02));
      if (q.some((p) => !p)) continue;
      const busy = sheetHeld?.set === r.g.set, moved = sheetDraft.has(r.g.set) || [...sheetAdds.values()].some((s) => s.set === r.g.set);
      g.beginPath(); q.forEach((p, i) => (i ? g.lineTo(p.x, p.y) : g.moveTo(p.x, p.y))); g.closePath();
      g.strokeStyle = busy ? 'rgba(90, 240, 130, 0.95)' : moved ? 'rgba(255, 210, 90, 0.9)' : 'rgba(240, 200, 255, 0.7)'; g.lineWidth = busy ? 2.5 : 1.5;
      g.stroke();
    }
    if (pend?.kind === 'box' && pend.moved) {
      g.fillStyle = 'rgba(90, 210, 255, 0.1)'; g.strokeStyle = 'rgba(110, 225, 255, 0.9)'; g.lineWidth = 1.5; g.setLineDash([5, 4]);
      const bx = Math.min(pend.x0, pend.x), by = Math.min(pend.y0, pend.y), bw = Math.abs(pend.x - pend.x0), bh = Math.abs(pend.y - pend.y0);
      g.fillRect(bx, by, bw, bh); g.strokeRect(bx, by, bw, bh); g.setLineDash([]);
    }
    if (held) {
      const q = { ...held.place, turn: held.place.turn };
      for (const c of [q, ...held.crew.map((m) => m.place)]) poly(foot(c, 0.012), held.ok ? 'rgba(80, 230, 120, 0.25)' : 'rgba(255, 70, 70, 0.3)', held.ok ? 'rgba(90, 240, 130, 0.95)' : 'rgba(255, 90, 90, 0.95)', 2.5);
      // against a wall: the wall it's on, lit
      if (held.spot.wall) {
        const W = held.spot.wall, a = W === 'left' ? [u0, v0, u0, v1] : W === 'right' ? [u1, v0, u1, v1] : W === 'front' ? [u0, v0, u1, v0] : [u0, v1, u1, v1];
        const p1 = P(a[0], a[1], CUT), p2 = P(a[2], a[3], CUT);
        if (p1 && p2) { g.strokeStyle = held.ok ? 'rgba(90, 240, 130, 0.8)' : 'rgba(255, 90, 90, 0.8)'; g.lineWidth = 3; g.beginPath(); g.moveTo(p1.x, p1.y); g.lineTo(p2.x, p2.y); g.stroke(); }
      }
    }
  }

  sync();
  repaintSheets();
  return {
    get on() { return !closed; },
    apply,
    // the room's mesh with the walls down, kept per mesh so a lamp switched or a door shut doesn't cut it again
    cut(m) { const c = cuts.get(m); if (c && c.L === S.L) return c.m; const out = cutaway(m, S.L); cuts.set(m, { L: S.L, m: out }); return out; },
    frame(now) {
      aspect = (host.clientWidth || 1) / (host.clientHeight || 1);
      const c = camNow(now);
      drawHeld();
      return { cam: c, after: overlay };
    },
    // the server's answer to Save
    result(msg) {
      if (closed) return;
      saving = false;
      if (msg.ok) { close(true); return; }
      bad = new Set(msg.bad || []);
      say(msg.message || "The layout wasn't saved.");
      sync();
    },
    close: () => close(false),
    // the admin menu's items (plugins/roomstage arrangeCatalog)
    catalog(items) { catalog = Array.isArray(items) ? items : []; drawMenu(); },
    // the Posters menu's rolls (plugins/roomstage arrangeSheetStock)
    stock(items) { stock = Array.isArray(items) ? items : []; drawPosterMenu(); },
    // the sheets as the room shows them while arranging: the draft's spots, the rolls going up
    sheets: (list) => sheetsNow(list),
  };
}
