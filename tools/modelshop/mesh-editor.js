// THE MESH EDITOR — the Modelshop's rail for a vehicle drawn from a mesh file.
//
// A mesh file (content/vehicle_models/mesh_*.json) is a list of PARTS, and client/shared/vehicle-mesh.js
// compiles it into the faces the game draws. This panel edits the parts. Three rules carry it.
//
//   1. THE DISK IS THE SOURCE. The page reads every mesh file from the server when it opens, rather
//      than trusting the baked module it imported, so a file edited by hand or by Claude shows up
//      here without a bake. A second poll picks up the next edit the same way while nothing is
//      unsaved.
//   2. EVERY EDIT BUILDS A NEW DOCUMENT. The renderer memoises a mesh on the identity of the params
//      object it was built from (and aircraftFaces memoises on class), so an edit made in place
//      would draw the old shape — which reads exactly like the edit not working. `setMeshOverride`
//      is handed a fresh object every time and flushes the face cache.
//   3. UNDO STORES THE STATE BEFORE THE EDIT. A field mutates and then reports, so a snapshot taken
//      at the report would capture the very change it is meant to undo.
//
// ⚠ Quoting rule, from CLAUDE.md: inside a template literal, quote identifiers with 'single quotes',
// never backticks. Everything here is built through the DOM, and there are no template literals.
import {
  meshIdFor, meshParams, setMeshOverride, aircraftFaces, legacyMeshFaces, setLegacyMeshes, legacyMeshesOn,
} from '/client/game/js/panels/aircraft3d.js';
import {
  PART_KINDS, KNOWN_ROLES, validateMesh, compileMesh, meshStats, meshSource, formatMesh, canon, meshChannels,
} from '/client/shared/vehicle-mesh.js';
import { renderVehiclePreview, vehicleBounds, previewFit, paintWindshield, RENDER_TUNE } from '/client/game/js/panels/windshield.js';
import { installGL } from '/client/game/js/panels/gl/install.js';
import { shellProfileFor } from '/client/shared/interior-shell.js';

const $ = (id) => document.getElementById(id);
const clone = (v) => JSON.parse(JSON.stringify(v));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

// ── State ────────────────────────────────────────────────────────────────────
const S = {
  disk: new Map(),       // id → { params, file, stamp } as last read from the server
  work: new Map(),       // id → params being edited (always a fresh object after an edit)
  undo: new Map(), redo: new Map(),
  dirty: new Set(),
  sel: null,             // part path, e.g. 'parts[5].parts[1]'
  hidden: new Set(),     // part paths hidden in the preview (never saved)
  solo: null,
  pick: [],              // the last paint's { pts, nf, src } records
  pickCycle: { x: -1, y: -1, i: 0 },
  msg: '', msgErr: false,
  livery: null,          // null = the file's own paint; else { base, trim, pattern }
  anim: {},              // channel values for moving parts and folding rotors, e.g. { wings: 1 }
  gear: 1,               // 1 = gear down, 0 = retracted
  showModel: false,
};
let APP = null;          // { state, draw, subjectKeyFor(id), entry() }

// ── Paths into a document ────────────────────────────────────────────────────
// A part path is the compiler's own source-map string ('parts[3].parts[1]'), so a face the renderer
// drew and a part in the tree are named the same way. A mirrored copy carries '~L'.
const pathSteps = (p) => [...String(p).replace(/~L$/, '').matchAll(/parts\[(\d+)\]/g)].map((m) => +m[1]);
function partAt(params, path) {
  let node = params;
  for (const i of pathSteps(path)) { node = node?.parts?.[i]; if (!node) return null; }
  return node === params ? null : node;
}
function parentOf(params, path) {
  const st = pathSteps(path);
  let node = params;
  for (const i of st.slice(0, -1)) node = node.parts[i];
  return { list: node.parts, index: st[st.length - 1], parentPath: st.length > 1 ? 'parts[' + st.slice(0, -1).join('].parts[') + ']' : '' };
}
const joinPath = (parent, i) => (parent ? parent + '.' : '') + 'parts[' + i + ']';
// A dotted/bracketed value path inside a document: 'parts[0].stations[2].rg'.
function getPath(obj, path) {
  if (!path) return obj;
  let o = obj;
  for (const k of path.match(/[^.[\]]+/g)) { if (o == null) return undefined; o = o[/^\d+$/.test(k) ? +k : k]; }
  return o;
}
function setPath(obj, path, value) {
  const ks = path.match(/[^.[\]]+/g).map((k) => (/^\d+$/.test(k) ? +k : k));
  let o = obj;
  for (const k of ks.slice(0, -1)) o = o[k];
  const last = ks[ks.length - 1];
  if (value === undefined) { if (Array.isArray(o)) o.splice(last, 1); else delete o[last]; }
  else o[last] = value;
}

// ── The mesh on screen ───────────────────────────────────────────────────────
// Which mesh file the current subject draws from, or null for a vehicle that is not a mesh.
export function meshIdOfSubject(v) { return v ? meshIdFor(v.cls, !!v.armed) || (legacyMeshesOn() && legacyIdFor(v)) || null : null; }
const legacyIdFor = (v) => (v.cls === 'heli' ? (v.armed ? 'heli_armed' : 'heli') : ['ultralight', 'grasshopper', 'wreck'].includes(v.cls) ? v.cls : null);
function curId() { const e = APP?.entry(); return e?.vehicle ? meshIdOfSubject(e.vehicle) : null; }
function workOf(id) {
  if (!S.work.has(id)) {
    const base = S.disk.get(id)?.params || meshParams(id);
    if (!base) return null;
    S.work.set(id, clone(base));
  }
  return S.work.get(id);
}

// What the preview is handed: the working document with hidden parts emptied out. Emptied rather
// than removed, so every other part keeps its path and picking still names the right one.
function viewParams(params) {
  if (!S.hidden.size && !S.solo) return params;
  const p = clone(params);
  const walk = (list, parent) => list.forEach((part, i) => {
    const path = joinPath(parent, i);
    const inSolo = !S.solo || path === S.solo || S.solo.startsWith(path + '.') || path.startsWith(S.solo + '.');
    if (S.hidden.has(path) || !inSolo) { list[i] = { kind: 'group', name: part.name, parts: [] }; return; }
    if (part.parts) walk(part.parts, path);
  });
  walk(p.parts, '');
  return p;
}

// Push the working document to the renderer — if it is valid. An invalid document keeps the last
// good one on screen and says why, because a mesh that does not compile would take the viewport
// with it.
let lastErrors = [];
function publish(id) {
  const params = workOf(id);
  const v = validateMesh(params, 'mesh_' + id + '.json');
  lastErrors = v.errors;
  if (v.errors.length) return false;
  setMeshOverride(id, viewParams(params));
  return true;
}

// ── Editing ──────────────────────────────────────────────────────────────────
function snapshot(id) { return JSON.stringify(workOf(id)); }
// Apply `fn` to a fresh copy of the working document. `label` coalesces a run of edits to one field
// into one undo step, so dragging a number through twenty values is one Ctrl+Z.
let lastLabel = '', lastAt = 0;
function edit(fn, label = '') {
  const id = curId();
  if (!id) return;
  const now = performance.now();
  const coalesce = label && label === lastLabel && now - lastAt < 1200;
  if (!coalesce) {
    const u = S.undo.get(id) || [];
    u.push(snapshot(id));
    if (u.length > 200) u.shift();
    S.undo.set(id, u);
    S.redo.set(id, []);
  }
  lastLabel = label; lastAt = now;
  const next = clone(workOf(id));
  fn(next);
  S.work.set(id, next);
  S.dirty.add(id);
  S.msg = '';
  publish(id);
  APP.draw();
}
export function meshUndo() {
  const id = curId(); const u = S.undo.get(id);
  if (!id || !u?.length) return false;
  (S.redo.get(id) || S.redo.set(id, []).get(id)).push(snapshot(id));
  S.work.set(id, JSON.parse(u.pop()));
  S.dirty.add(id); lastLabel = '';
  publish(id); return true;
}
export function meshRedo() {
  const id = curId(); const r = S.redo.get(id);
  if (!id || !r?.length) return false;
  (S.undo.get(id) || S.undo.set(id, []).get(id)).push(snapshot(id));
  S.work.set(id, JSON.parse(r.pop()));
  S.dirty.add(id); lastLabel = '';
  publish(id); return true;
}

// A new part of a kind, the same size wherever it is added from. Small enough to see, placed on
// the centreline, and built so it compiles as it stands.
export function defaultPart(kind) {
  const T = {
    loft: { sides: 12, section: 'super', exp: [0.82, 0.9, 0.8], shade: { base: 0.62, amp: 0.36 },
      stations: [{ f: 0.3, rg: 0.06, rvT: 0.06, rvB: 0.06, cz: 0 }, { f: 0, rg: 0.1, rvT: 0.1, rvB: 0.1, cz: 0 }, { f: -0.3, rg: 0.05, rvT: 0.05, rvB: 0.05, cz: 0 }],
      capFore: { kind: 'apex', at: [0.4, 0, 0] }, capAft: { kind: 'apex', at: [-0.4, 0, 0] } },
    tube: { pts: [[0, 0, 0], [0, 0, 0.2]], r: 0.02, sides: 6, role: 'nacelle', sh: 0.7 },
    strut: { at: [0, 0.1], top: 0, bot: -0.2, r: 0.015 },
    wheel: { at: [0, 0.15, -0.25], r: 0.05, hw: 0.02, n: 12 },
    spat: { at: [0, 0.15, -0.25], s: 1 },
    faired: { pts: [[0, 0.05, -0.05], [0, 0.2, -0.2]], chord: 0.03, th: 0.009, role: 'strut' },
    panel: { c: [[0.1, 0.05, 0], [0.05, 0.4, 0], [-0.05, 0.4, 0], [-0.1, 0.05, 0]], th: 0.014, role: 'wing', sh: 0.8 },
    ctrl: { role: 'flap', side: 1, sh: 0.8, le: [[0, 0.1, 0], [-0.01, 0.4, 0]], te: [[-0.1, 0.1, 0], [-0.1, 0.4, 0]], cf: 0.3 },
    missile: { f: [-0.1, 0.1], g: 0.3, z: -0.05 },
    drum: { f: 0, r: 0.05, z: [0.2, 0.25], n: 8, role: 'nacelle', sh: { base: 0.7, alt: 0.1 }, top: { sh: 0.9 } },
    ngon: { f: 0, h: 0.3, r: 0.5, n: 8, role: 'rotor', sh: 0.65 },
    cone: { f: 0.4, h: 0, r: 0.05, n: 10, apex: [0.5, 0, 0], role: 'nacelle' },
    blade: { outline: [[-0.6, 0.05], [-0.7, 0.3], [-0.8, 0.32], [-0.8, 0.05]], t: 0.012, role: 'fin', sh: [0.9, 0.7], edges: [{ a: 1, b: 2, sh: 0.8 }] },
    wing: { foil: 'naca2412', span: 0.8, taper0: 0.5, wh: 0.05, dih: 0.03, leR: 0.2, teR: -0.08, leT: 0.15, teT: -0.03, ribs: [-0.8, 0, 0.8], nx: 7, lower: 0.46 },
    poly: { faces: [{ role: 'body', p: [[0, 0, 0], [0.1, 0, 0], [0.1, 0.1, 0]] }] },
    mirror: { parts: [] },
    group: { parts: [] },
  };
  return { kind, name: 'new ' + (PART_KINDS[kind]?.label || kind).toLowerCase(), ...clone(T[kind] || {}) };
}

function selectPath(path) { S.sel = path ? path.replace(/~L$/, '') : null; APP.draw(); }
function addPart(kind) {
  let newPath = null;
  edit((p) => {
    if (S.sel && partAt(p, S.sel)) {
      const target = partAt(p, S.sel);
      if ((target.kind === 'mirror' || target.kind === 'group') && kind !== 'mirror') {
        target.parts.push(defaultPart(kind)); newPath = S.sel + '.parts[' + (target.parts.length - 1) + ']'; return;
      }
      const { list, index, parentPath } = parentOf(p, S.sel);
      list.splice(index + 1, 0, defaultPart(kind)); newPath = joinPath(parentPath, index + 1);
    } else { p.parts.push(defaultPart(kind)); newPath = joinPath('', p.parts.length - 1); }
  }, 'add');
  S.sel = newPath; APP.draw();
}
function treeOp(op) {
  if (!S.sel) return;
  let next = S.sel;
  edit((p) => {
    const { list, index, parentPath } = parentOf(p, S.sel);
    const part = list[index];
    if (op === 'dup') { list.splice(index + 1, 0, clone(part)); next = joinPath(parentPath, index + 1); }
    if (op === 'del') { list.splice(index, 1); next = null; }
    if (op === 'up' && index > 0) { [list[index - 1], list[index]] = [list[index], list[index - 1]]; next = joinPath(parentPath, index - 1); }
    if (op === 'down' && index < list.length - 1) { [list[index + 1], list[index]] = [list[index], list[index + 1]]; next = joinPath(parentPath, index + 1); }
    if (op === 'mirror') list[index] = { kind: 'mirror', name: (part.name || part.kind) + ' (both sides)', parts: [part] };
    if (op === 'unwrap' && part.parts) { list.splice(index, 1, ...part.parts); }
  }, op);
  S.sel = next; APP.draw();
}

// ── Saving and reading the disk ──────────────────────────────────────────────
async function loadDisk() {
  const r = await fetch('/api/vehicles');
  const j = await r.json();
  const st = await (await fetch('/api/vehicles/stamp')).json();
  for (const { file, doc } of j.rows || []) {
    if (doc?.kind !== 'mesh') continue;
    S.disk.set(doc.id, { params: doc.params, file, stamp: st.stamps?.[file] || 0 });
  }
}
export async function meshSave() {
  const id = curId();
  if (!id) return null;
  const params = workOf(id);
  S.msg = 'saving…'; S.msgErr = false; APP.draw();
  try {
    const r = await fetch('/api/vehicles', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc: { id, kind: 'mesh', params } }) });
    const j = await r.json();
    if (!r.ok) { S.msg = (j.errors || [r.statusText]).join('\n'); S.msgErr = true; APP.draw(); return j; }
    const st = await (await fetch('/api/vehicles/stamp')).json();
    S.disk.set(id, { params: clone(params), file: j.file, stamp: st.stamps?.[j.file] || 0 });
    S.dirty.delete(id);
    S.msg = 'saved content/vehicle_models/' + j.file + ' and re-baked'; APP.draw();
    return j;
  } catch (e) { S.msg = 'save failed: ' + e.message; S.msgErr = true; APP.draw(); return null; }
}
function revert(id) {
  const d = S.disk.get(id);
  if (!d) return;
  S.work.set(id, clone(d.params)); S.dirty.delete(id); S.undo.set(id, []); S.redo.set(id, []);
  publish(id); APP.draw();
}
// A file changed on disk. Taken up at once when nothing is unsaved; otherwise the rail says so and
// Revert is the way to take it.
let pollTimer = 0;
async function poll() {
  const id = curId();
  if (!id || document.hidden) return;
  try {
    const st = (await (await fetch('/api/vehicles/stamp')).json()).stamps || {};
    const d = S.disk.get(id), file = 'mesh_' + id + '.json';
    if (st[file] && (!d || st[file] !== d.stamp)) {
      const j = await (await fetch('/api/vehicles')).json();
      const row = (j.rows || []).find((x) => x.file === file);
      if (!row) return;
      S.disk.set(id, { params: row.doc.params, file, stamp: st[file] });
      if (S.dirty.has(id)) { S.msg = file + ' changed on disk while you have unsaved edits — Revert takes the disk version.'; S.msgErr = true; }
      else { S.work.set(id, clone(row.doc.params)); S.msg = 'reloaded ' + file + ' from disk'; S.msgErr = false; publish(id); }
      APP.draw();
    }
  } catch { /* the server is gone; the rail says nothing until it is back */ }
}

// ── Picking ──────────────────────────────────────────────────────────────────
// The preview fills this with the polygon every visible face was drawn as, and the face it came
// from. A face maps back to a part through the compiler's source map, so a click names a part
// without a second projection that could disagree with the picture.
export function meshPickList() { S.pick = []; return S.pick; }
const _faceIndex = new WeakMap();
function pathOfFace(face) {
  const e = APP.entry(); if (!e?.vehicle) return null;
  const v = e.vehicle;
  for (const detail of [1, 0]) {
    const faces = aircraftFaces(v.cls, detail, !!v.armed, v.variant || '');
    let idx = _faceIndex.get(faces);
    if (!idx) { idx = new Map(faces.map((f, i) => [f, i])); _faceIndex.set(faces, idx); }
    const i = idx.get(face);
    if (i != null) return meshSource(faces)?.[i] || null;
  }
  return null;
}
const inPoly = (x, y, pts) => {
  let c = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i], b = pts[j];
    if ((a.sy > y) !== (b.sy > y) && x < (b.sx - a.sx) * (y - a.sy) / ((b.sy - a.sy) || 1e-9) + a.sx) c = !c;
  }
  return c;
};
// The nearest face under the point; Alt+click at the same spot steps one face deeper each time.
export function meshPickAt(x, y, deeper = false) {
  const hits = S.pick.filter((r) => r.pts?.length >= 3 && inPoly(x, y, r.pts)).sort((a, b) => a.nf - b.nf);
  const paths = [];
  for (const h of hits) { const p = pathOfFace(h.src); if (p && !paths.includes(p.replace(/~L$/, ''))) paths.push(p.replace(/~L$/, '')); }
  if (!paths.length) return null;
  const same = Math.hypot(x - S.pickCycle.x, y - S.pickCycle.y) < 4;
  S.pickCycle = { x, y, i: deeper && same ? (S.pickCycle.i + 1) % paths.length : 0 };
  S.sel = paths[S.pickCycle.i];
  return S.sel;
}
// The selection, drawn over the picture from the same polygons the click was tested against.
export function meshPaintOverlay(ctx) {
  if (!S.sel || !S.pick.length) return;
  ctx.save();
  ctx.lineWidth = 1.5; ctx.strokeStyle = 'rgba(111,211,255,0.95)'; ctx.fillStyle = 'rgba(111,211,255,0.16)';
  for (const r of S.pick) {
    const p = pathOfFace(r.src);
    if (!p) continue;
    const q = p.replace(/~L$/, '');
    if (q !== S.sel && !q.startsWith(S.sel + '.')) continue;
    ctx.beginPath(); ctx.moveTo(r.pts[0].sx, r.pts[0].sy);
    for (let i = 1; i < r.pts.length; i++) ctx.lineTo(r.pts[i].sx, r.pts[i].sy);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  }
  ctx.restore();
}
export function meshAnim() { return S.anim; }
export function meshGearAnim() { return S.gear; }
export function meshLivery() {
  if (!S.livery) return null;
  return { base: S.livery.base, trim: S.livery.trim, pattern: S.livery.pattern || 'bare', finish: 'gloss' };
}

// ── The reference underlay ───────────────────────────────────────────────────
// Concept art over the viewport at an opacity: the fastest way to hold a silhouette against the
// picture it is meant to be. Per browser and per mesh (localStorage), never content.
const UKEY = (id) => 'ms-underlay:' + id;
function underlayOf(id) { try { return JSON.parse(localStorage.getItem(UKEY(id)) || 'null'); } catch { return null; } }
function setUnderlay(id, u) { try { if (u) localStorage.setItem(UKEY(id), JSON.stringify(u)); else localStorage.removeItem(UKEY(id)); } catch (e) { S.msg = 'underlay not stored: ' + e.message; S.msgErr = true; } placeUnderlay(); }
function placeUnderlay() {
  let img = $('ms-underlay');
  const id = curId(), u = id ? underlayOf(id) : null;
  if (!u || !u.src || !u.on) { if (img) img.hidden = true; return; }
  if (!img) {
    img = el('img'); img.id = 'ms-underlay';
    img.style.cssText = 'position:absolute;left:0;top:0;pointer-events:none;z-index:5;transform-origin:0 0;';
    $('stage').append(img);
  }
  img.hidden = false;
  if (img.src !== u.src) img.src = u.src;
  const view = $('view');
  img.style.opacity = String(u.opacity ?? 0.4);
  img.style.width = (view.clientWidth * (u.scale ?? 1)) + 'px';
  img.style.left = ((u.x ?? 0) * view.clientWidth) + 'px';
  img.style.top = ((u.y ?? 0) * view.clientHeight) + 'px';
}

// ── The rail ─────────────────────────────────────────────────────────────────
function fieldRow(host, label, input, title) {
  const d = el('div', 'fld'); const l = el('label', null, label); l.style.flex = '0 0 64px'; if (title) l.title = title;
  d.append(l, input); host.append(d); return d;
}
function numInput(value, onSet, step = 0.001) {
  const i = el('input'); i.type = 'number'; i.step = String(step); i.value = value == null ? '' : String(value);
  i.onchange = () => { if (i.value === '') return onSet(undefined); const v = Number(i.value); if (Number.isFinite(v)) onSet(v); };
  return i;
}
function vecInputs(vec, n, onSet) {
  const w = el('span'); w.style.cssText = 'display:flex;gap:2px;flex:1;min-width:0';
  for (let k = 0; k < n; k++) {
    const i = numInput(vec?.[k], (v) => { const nv = [...(vec || new Array(n).fill(0))]; nv[k] = v ?? 0; onSet(nv); });
    i.style.width = '0'; i.style.flex = '1'; w.append(i);
  }
  return w;
}
function jsonBox(value, onSet, rows = 3) {
  const t = el('textarea'); t.rows = rows; t.spellcheck = false;
  t.style.cssText = 'flex:1;min-width:0;background:#10141a;color:var(--ms-ink);border:1px solid var(--ms-line);font:inherit;font-size:10px;';
  t.value = value === undefined ? '' : JSON.stringify(value);
  t.onchange = () => {
    if (t.value.trim() === '') return onSet(undefined);
    try { onSet(JSON.parse(t.value)); t.style.borderColor = ''; } catch (e) { t.style.borderColor = '#ff7b72'; t.title = e.message; }
  };
  return t;
}
function selectInput(opts, value, onSet, blank = '(default)') {
  const s = el('select'); s.style.margin = '0'; s.style.flex = '1';
  s.append(new Option(blank, ''));
  for (const o of opts) s.append(new Option(o, o));
  s.value = value ?? '';
  s.onchange = () => onSet(s.value === '' ? undefined : s.value);
  return s;
}

// A list of points (or [a, b] pairs), one row each, with add and remove. Adding after a row puts the
// new point halfway to the next one, which is what adding a station usually means.
function pointList(host, list, n, onSet) {
  const L = list || [];
  L.forEach((pt, i) => {
    const r = el('div', 'fld');
    r.append(el('label', 'dim', String(i)));
    r.append(vecInputs(pt, n, (v) => { const nl = clone(L); nl[i] = v; onSet(nl); }));
    const add = el('button', 'mini', '+'); add.title = 'insert a point after this one';
    add.onclick = () => { const nl = clone(L); const nx = L[i + 1] || L[i]; nl.splice(i + 1, 0, pt.map((x, k) => (x + nx[k]) / 2)); onSet(nl); };
    const del = el('button', 'mini', '−'); del.title = 'remove this point';
    del.onclick = () => { const nl = clone(L); nl.splice(i, 1); onSet(nl); };
    r.append(add, del); host.append(r);
  });
}

// The station table: the one control a loft really needs. Columns follow the section, and adding a
// station interpolates it from its neighbours so the hull does not jump.
function stationTable(host, part, set) {
  const sts = part.stations || [];
  const cols = (part.section || 'ellipse') === 'ellipse' ? ['f', 'rg', 'rv', 'cz'] : ['f', 'rg', 'rvT', 'rvB', 'cz', 'keel', 'boxy', 'u'];
  const tbl = el('table'); tbl.style.cssText = 'width:100%;border-collapse:collapse;font-size:10px;';
  const hr = el('tr'); for (const c of cols) { const th = el('th', 'dim', c); th.style.fontWeight = 'normal'; hr.append(th); } hr.append(el('th')); tbl.append(hr);
  sts.forEach((s, i) => {
    const tr = el('tr');
    for (const c of cols) {
      const td = el('td');
      const inp = numInput(s[c], (v) => set('stations[' + i + '].' + c, v));
      inp.style.cssText = 'width:100%;background:#10141a;color:var(--ms-ink);border:1px solid var(--ms-line);font:inherit;font-size:10px;padding:0 2px;';
      td.append(inp); tr.append(td);
    }
    const td = el('td'); td.style.whiteSpace = 'nowrap';
    const add = el('button', 'mini', '+'); add.title = 'add a station halfway to the next';
    add.onclick = () => set('stations', (() => { const L = clone(sts); const a = sts[i], b = sts[i + 1] || sts[i];
      const mid = {}; for (const k of Object.keys(a)) mid[k] = typeof a[k] === 'number' && typeof b[k] === 'number' ? (a[k] + b[k]) / 2 : a[k]; L.splice(i + 1, 0, mid); return L; })());
    const del = el('button', 'mini', '−'); del.title = 'remove this station';
    del.onclick = () => set('stations', (() => { const L = clone(sts); L.splice(i, 1); return L; })());
    td.append(add, del); tr.append(td); tbl.append(tr);
  });
  host.append(tbl);
}

// The form for one part, generated from the schema: a field added to PART_KINDS gets a widget here
// with nothing else edited.
function partForm(host, path, part) {
  const K = PART_KINDS[part.kind];
  const set = (sub, v) => edit((p) => setPath(partAt(p, path), sub, v), path + '/' + sub);
  host.append(el('div', 'dim', K ? K.blurb : 'unknown kind'));
  const name = el('input'); name.value = part.name || ''; name.onchange = () => set('name', name.value || undefined);
  fieldRow(host, 'name', name);
  if (!K) return;
  for (const [k, d] of Object.entries(K.fields)) {
    if (k === 'parts') continue;   // edited through the tree
    const v = part[k], title = d.hint || '';
    if (d.t === 'num' || d.t === 'int') fieldRow(host, k, numInput(v, (x) => set(k, x), d.t === 'int' ? 1 : 0.001), title);
    else if (d.t === 'str') { const i = el('input'); i.value = v ?? ''; i.onchange = () => set(k, i.value || undefined); fieldRow(host, k, i, title); }
    else if (d.t === 'role') fieldRow(host, k, selectInput(KNOWN_ROLES, v, (x) => set(k, x)), title);
    else if (d.t === 'enum') fieldRow(host, k, selectInput(d.of, v, (x) => set(k, x)), title);
    else if (d.t === 'vec2' || d.t === 'vec3') fieldRow(host, k, vecInputs(v, d.t === 'vec2' ? 2 : 3, (x) => set(k, x)), title);
    else if (d.t === 'pts' || d.t === 'vec2list') {
      host.append(el('div', 'dim', k + (title ? ' — ' + title : '')));
      pointList(host, v, d.t === 'pts' ? 3 : 2, (x) => set(k, x));
    } else if (d.t === 'stations') { host.append(el('div', 'dim', 'stations (nose to tail)')); stationTable(host, part, set); }
    else fieldRow(host, k, jsonBox(v, (x) => set(k, x), k === 'faces' ? 8 : 3), title);
  }
  for (const k of ['paint', 'minDetail', 'maxDetail']) {
    if (k === 'paint') { const i = el('input'); i.value = part.paint ?? ''; i.placeholder = 'slot in params.paints'; i.onchange = () => set('paint', i.value || undefined); fieldRow(host, 'paint', i); }
    else fieldRow(host, k, numInput(part[k], (x) => set(k, x), 1));
  }
  const note = el('input'); note.value = part.note || ''; note.onchange = () => set('note', note.value || undefined);
  fieldRow(host, 'note', note, 'what this part is, for the next person to open the file');
  for (const k of ['lod0', 'left']) fieldRow(host, k, jsonBox(part[k], (x) => set(k, x), 2), COMMON_HINT[k]);
}
const COMMON_HINT = { lod0: 'fields swapped in at the far detail, e.g. {"n": 8}', left: 'inside a mirror: what differs on the left, e.g. {"sh": 0.66}' };

function modelForm(host, id, params) {
  const set = (k, v) => edit((p) => { if (v === undefined) delete p[k]; else p[k] = v; }, 'model/' + k);
  const name = el('input'); name.value = params.name || ''; name.onchange = () => set('name', name.value || undefined);
  fieldRow(host, 'name', name);
  for (const k of ['scale', 'groundPitch']) fieldRow(host, k, numInput(params[k], (v) => set(k, v)));
  const hull = el('input'); hull.value = params.hull || ''; hull.placeholder = 'the loft the nose art wraps'; hull.onchange = () => set('hull', hull.value || undefined);
  fieldRow(host, 'hull', hull);
  for (const k of ['rotors', 'paints', 'classFacts', 'navLamps']) fieldRow(host, k, jsonBox(params[k], (v) => set(k, v), k === 'rotors' || k === 'paints' ? 4 : 2));
}

function treeView(host, params, counts) {
  const walk = (list, parent, depth) => list.forEach((part, i) => {
    const path = joinPath(parent, i);
    const r = el('div', 'phead'); r.style.paddingLeft = (4 + depth * 12) + 'px';
    if (S.sel === path) { r.style.background = '#16222b'; r.style.outline = '1px solid var(--ms-accent)'; }
    const glyph = { loft: '◖', tube: '|', strut: '╽', wheel: '◎', spat: '◒', faired: '/', panel: '▭', ctrl: '▱', missile: '➤', drum: '▣', ngon: '⬡', cone: '▲', blade: '◢', wing: '✈', poly: '◇', mirror: '⇆', group: '▤' }[part.kind] || '?';
    const b = el('b', null, glyph + ' ' + (part.name || part.kind));
    if (S.hidden.has(path)) b.style.opacity = '0.4';
    const n = el('span', 'dim', String(counts.get(path) || 0)); n.style.fontSize = '10px'; n.title = 'faces at full detail';
    const eye = el('button', 'mini', S.hidden.has(path) ? '◌' : '●'); eye.title = 'hide in the preview (never saved)';
    eye.onclick = (ev) => { ev.stopPropagation(); if (S.hidden.has(path)) S.hidden.delete(path); else S.hidden.add(path); publish(curId()); APP.draw(); };
    const solo = el('button', 'mini' + (S.solo === path ? ' on' : ''), '◎'); solo.title = 'show only this part';
    solo.onclick = (ev) => { ev.stopPropagation(); S.solo = S.solo === path ? null : path; publish(curId()); APP.draw(); };
    r.append(b, n, eye, solo);
    r.onclick = () => selectPath(path);
    host.append(r);
    if (part.parts) walk(part.parts, path, depth + 1);
  });
  walk(params.parts || [], '', 0);
}

export function drawMeshRail(host, meta) {
  const id = curId();
  const params = workOf(id);
  if (!params) { host.append(el('div', 'err', 'no mesh file for this subject')); return; }
  const faces = compileMesh(viewParams(params), { detail: 1 }).faces;
  const src = meshSource(faces) || [];
  const counts = new Map();
  for (const p of src) { const q = p.replace(/~L$/, ''); const st = pathSteps(q); for (let k = 1; k <= st.length; k++) { const pre = 'parts[' + st.slice(0, k).join('].parts[') + ']'; counts.set(pre, (counts.get(pre) || 0) + 1); } }

  // Head: what this is, and the three things you do to a file.
  const top = el('div', 'etop');
  top.append(el('b', null, 'mesh_' + id + '.json' + (S.dirty.has(id) ? ' •' : '')));
  const bs = el('span'); bs.style.cssText = 'display:flex;gap:3px;flex-wrap:wrap';
  const btn = (t, f, title, on) => { const b = el('button', 'mini' + (on ? ' on' : ''), t); b.title = title; b.onclick = f; bs.append(b); return b; };
  btn('Save', () => meshSave(), 'validate, write the file, re-bake; a refusal is rolled back').disabled = !S.dirty.has(id) || lastErrors.length > 0;
  btn('Revert', () => revert(id), 'throw the edits away and take the file on disk').disabled = !S.dirty.has(id);
  btn('↶', () => { if (meshUndo()) APP.draw(); }, 'undo (Ctrl+Z)').disabled = !(S.undo.get(id) || []).length;
  btn('↷', () => { if (meshRedo()) APP.draw(); }, 'redo (Ctrl+Shift+Z)').disabled = !(S.redo.get(id) || []).length;
  if (params.portedFrom) btn('A/B', () => { setLegacyMeshes(!legacyMeshesOn()); APP.draw(); }, 'draw the code builder this file replaced (' + params.portedFrom + ') instead', legacyMeshesOn());
  top.append(bs);
  host.append(top);
  if (legacyMeshesOn()) host.append(el('div', 'warn', 'showing ' + params.portedFrom + ', the old builder — A/B again to return to the file'));
  if (S.msg) host.append(el('div', S.msgErr ? 'err' : 'dim', S.msg));
  for (const e of lastErrors.slice(0, 6)) host.append(el('div', 'err', e));

  // The parts.
  host.append(el('h3', null, 'Parts'));
  const tree = el('div'); tree.style.cssText = 'max-height:240px;overflow:auto;border:1px solid var(--ms-line);border-radius:3px';
  treeView(tree, params, counts);
  host.append(tree);
  const ops = el('div', 'addrow');
  const kind = selectInput(Object.keys(PART_KINDS), 'tube', () => {}, '');
  kind.value = 'tube';
  const add = el('button', 'mini', 'Add'); add.title = 'add after the selected part (inside it, if it is a mirror or group)';
  add.onclick = () => addPart(kind.value || 'tube');
  ops.append(kind, add);
  for (const [op, t, title] of [['dup', 'Dup', 'duplicate (D)'], ['del', 'Del', 'delete (Del)'], ['up', '↑', 'move up'], ['down', '↓', 'move down'], ['mirror', '⇆', 'put it in a mirror, so the other side is drawn too'], ['unwrap', '⤴', 'take the parts out of a mirror or group']]) {
    const b = el('button', 'mini', t); b.title = title; b.disabled = !S.sel; b.onclick = () => treeOp(op); ops.append(b);
  }
  host.append(ops);

  // The selected part.
  const part = S.sel ? partAt(params, S.sel) : null;
  if (part) {
    host.append(el('h3', null, (PART_KINDS[part.kind]?.label || part.kind) + ' · ' + S.sel));
    const f = el('div'); partForm(f, S.sel, part); host.append(f);
  } else host.append(el('div', 'dim', 'Click a part in the picture or the list. Alt+click steps to the part behind.'));

  // The file's own fields.
  const mh = el('h3', null, (S.showModel ? '▾' : '▸') + ' Model fields'); mh.style.cursor = 'pointer';
  mh.onclick = () => { S.showModel = !S.showModel; APP.draw(); };
  host.append(mh);
  if (S.showModel) { const f = el('div'); modelForm(f, id, params); host.append(f); }

  // How it is painted in the preview, and the reference picture.
  host.append(el('h3', null, 'Preview'));
  const lv = el('div', 'fld');
  const lsel = selectInput(['custom'], S.livery ? 'custom' : '', (v) => { S.livery = v ? { base: '#5a6470', trim: '#c89040', pattern: 'bare' } : null; APP.draw(); }, 'factory paint');
  lv.append(el('label', null, 'livery'), lsel);
  if (S.livery) {
    for (const k of ['base', 'trim']) { const c = el('input'); c.type = 'color'; c.value = S.livery[k]; c.oninput = () => { S.livery = { ...S.livery, [k]: c.value }; APP.draw(); }; c.style.flex = '0 0 34px'; lv.append(c); }
  }
  host.append(lv);
  const chans = { gear: 1, ...meshChannels(params) };
  for (const [ch, def] of Object.entries(chans)) {
    const r = el('input'); r.type = 'range'; r.min = '0'; r.max = '1'; r.step = '0.01';
    r.value = String(ch === 'gear' ? S.gear : (S.anim[ch] ?? def));
    r.oninput = () => { if (ch === 'gear') S.gear = Number(r.value); else S.anim = { ...S.anim, [ch]: Number(r.value) }; APP.draw(); };
    fieldRow(host, ch, r, ch === 'gear' ? '1 down, 0 retracted' : 'a moving part or a folding rotor, 0 to 1');
  }
  const u = underlayOf(id) || { on: false, opacity: 0.4, scale: 1, x: 0, y: 0 };
  const uf = el('div', 'fld');
  const file = el('input'); file.type = 'file'; file.accept = 'image/*'; file.style.flex = '1';
  file.onchange = () => { const fr = new FileReader(); fr.onload = () => setUnderlay(id, { ...u, src: fr.result, on: true }); if (file.files[0]) fr.readAsDataURL(file.files[0]); };
  const on = el('button', 'mini' + (u.on ? ' on' : ''), 'show'); on.onclick = () => { setUnderlay(id, { ...u, on: !u.on }); APP.draw(); }; on.disabled = !u.src;
  uf.append(el('label', null, 'reference'), file, on);
  host.append(uf);
  if (u.src) for (const [k, lo, hi, st] of [['opacity', 0, 1, 0.05], ['scale', 0.2, 3, 0.01], ['x', -1, 1, 0.005], ['y', -1, 1, 0.005]]) {
    const r = el('input'); r.type = 'range'; r.min = String(lo); r.max = String(hi); r.step = String(st); r.value = String(u[k] ?? (k === 'scale' ? 1 : 0));
    r.oninput = () => setUnderlay(id, { ...(underlayOf(id) || u), [k]: Number(r.value) });
    fieldRow(host, k, r);
  }
  placeUnderlay();

  // What it is made of.
  const st = meshStats(faces);
  meta.textContent = '';
  const row = (l, v, cls) => { const d = el('div', 'row'); d.append(el('b', null, l), el('span', cls, v)); meta.append(d); };
  row('file', 'content/vehicle_models/mesh_' + id + '.json');
  if (params.portedFrom) row('replaces', params.portedFrom);
  row('faces', st.faces + ' (' + compileMesh(viewParams(params), { detail: 0 }).faces.length + ' at far detail)');
  row('vertices', st.verts + ' · ' + st.unique + ' unique');
  row('extent', 'f ' + st.bounds.lo[0].toFixed(2) + '…' + st.bounds.hi[0].toFixed(2) + ' · g ±' + Math.max(-st.bounds.lo[1], st.bounds.hi[1]).toFixed(2) + ' · h ' + st.bounds.lo[2].toFixed(2) + '…' + st.bounds.hi[2].toFixed(2));
  row('symmetry', (st.symmetry * 100).toFixed(1) + '%', st.symmetry < 0.97 ? 'warn' : '');
  row('5+-gons', String(st.ngons), st.ngons ? 'warn' : '');
  row('roles', Object.entries(st.roles).map(([k, n]) => k + ' ' + n).join(', '));
  if (Object.keys(st.paints).length) row('paints', Object.entries(st.paints).map(([k, n]) => k + ' ' + n).join(', '));
}

// ── The page API ─────────────────────────────────────────────────────────────
// Everything a person does in the rail, callable from a console or from Claude driving the Browser
// pane: open a mesh, read and write any field by path, look at it from anywhere, and save.
function frameFor(v, W, H) {
  const b = vehicleBounds(v.cls, !!v.armed, v.variant || '');
  const sm = 1.2 / b.height, PAD = 1.45;
  const f = previewFit({ halfW: b.halfW * sm * PAD, height: 1.2 * PAD, baseH: b.baseH * sm }, W, H, 0.72);
  const zMid = b.baseH * sm + (b.height * sm) / 2;
  return { sm, zMid, radius: Math.hypot(f.dist, f.eyeH - zMid) };
}
function renderAt(canvas, v, heading, elevDeg, night) {
  const F = frameFor(v, canvas.width, canvas.height);
  const el0 = elevDeg * Math.PI / 180;
  const dist = Math.max(0.05, F.radius * Math.cos(el0)), eye = F.zMid + F.radius * Math.sin(el0);
  renderVehiclePreview(canvas, { cls: v.cls, variant: v.variant || '', armed: !!v.armed, livery: meshLivery(), night, heading, dist, eyeH: eye,
    camPitch: Math.atan2(eye - F.zMid, dist), sizeMul: F.sm, anim: S.anim, gearAnim: S.gear });
}
async function postShot(canvas, name) {
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/png'));
  const r = await fetch('/api/shot?name=' + encodeURIComponent(name), { method: 'POST', body: blob });
  return (await r.json()).file || null;
}

function installApi() {
  window.__mesh = {
    list: () => [...new Set([...S.disk.keys()])],
    open: (id) => { const key = APP.subjectKeyFor(id); if (!key) return false; window.__msReselect(key); return true; },
    id: () => curId(),
    get: (path = '') => clone(getPath(workOf(curId()), path) ?? null),
    set: (path, value) => { edit((p) => setPath(p, path, value), 'api/' + path); return lastErrors.length ? lastErrors : true; },
    apply: (params) => { edit((p) => { for (const k of Object.keys(p)) delete p[k]; Object.assign(p, clone(params)); }, 'api/apply'); return lastErrors.length ? lastErrors : true; },
    add: (kind, at = null) => { if (at != null) S.sel = at; addPart(kind); return S.sel; },
    remove: (path) => { S.sel = path; treeOp('del'); return true; },
    select: (path) => { selectPath(path); return S.sel; },
    selected: () => S.sel,
    pick: (x, y, deeper = false) => { const p = meshPickAt(x, y, deeper); APP.draw(); return p; },
    stats: () => meshStats(compileMesh(workOf(curId()), { detail: 1 }).faces),
    errors: () => lastErrors.slice(),
    text: () => formatMesh({ id: curId(), kind: 'mesh', params: workOf(curId()) }),
    view: (o = {}) => { Object.assign(APP.state, o); APP.draw(); return { heading: APP.state.heading, dist: APP.state.dist, eye: APP.state.eye, night: APP.state.night }; },
    livery: (lv) => { S.livery = lv || null; APP.draw(); return S.livery; },
    // Pose the moving parts: pose({ wings: 1, rotorFold: 1, gear: 0 }). `gear` is the gear channel.
    pose: (o = {}) => { const { gear, ...rest } = o; if (gear != null) S.gear = gear; S.anim = { ...S.anim, ...rest }; APP.draw(); return { gear: S.gear, ...S.anim }; },
    channels: () => ({ gear: 1, ...meshChannels(workOf(curId())) }),
    save: () => meshSave(),
    revert: () => revert(curId()),
    reload: async () => { await loadDisk(); revert(curId()); return true; },
    undo: () => { const r = meshUndo(); APP.draw(); return r; },
    redo: () => { const r = meshRedo(); APP.draw(); return r; },
    legacy: (on) => { setLegacyMeshes(on); APP.draw(); return legacyMeshesOn(); },
    // A turntable contact sheet in one PNG: every heading at every elevation, plus a strip at the
    // size a contact is actually seen at (each cell rendered small, then shown ×4 with no
    // smoothing, so what you judge is the pixels a player gets).
    sheet: async ({ headings = [0, 45, 90, 135, 180, 225, 270, 315], elevs = [8, 30, -12], size = [320, 200], night = 0, name = null, tiny = [56, 34] } = {}) => {
      const v = APP.entry()?.vehicle; if (!v) return null;
      const [cw, ch] = size, [tw, th] = tiny;
      const out = document.createElement('canvas');
      out.width = cw * headings.length; out.height = ch * elevs.length + th * 4 + 24;
      const g = out.getContext('2d');
      g.fillStyle = '#0d0f12'; g.fillRect(0, 0, out.width, out.height);
      const cell = document.createElement('canvas'); cell.width = cw; cell.height = ch;
      elevs.forEach((e, r) => headings.forEach((h, c) => {
        renderAt(cell, v, h, e, night);
        g.drawImage(cell, c * cw, r * ch);
        g.fillStyle = '#8b97a5'; g.font = '11px monospace'; g.fillText(h + '° / ' + e + '°', c * cw + 6, r * ch + 14);
      }));
      const t = document.createElement('canvas'); t.width = tw; t.height = th;
      g.imageSmoothingEnabled = false;
      headings.forEach((h, c) => { renderAt(t, v, h, 8, night); g.drawImage(t, c * cw + (cw - tw * 4) / 2, ch * elevs.length + 12, tw * 4, th * 4); });
      g.fillStyle = '#8b97a5'; g.fillText('at contact size (' + tw + '×' + th + ' px, shown ×4)', 6, ch * elevs.length + 10);
      return postShot(out, name || ('mesh-' + curId() + (night ? '-night' : '')));
    },
    // How far the file's picture is from its builder's, in pixels, from where the camera is now.
    ab: () => {
      const view = $('view');
      const a = document.createElement('canvas'), b = document.createElement('canvas');
      a.width = b.width = view.width; a.height = b.height = view.height;
      const v = APP.entry()?.vehicle; if (!v) return null;
      const opts = { cls: v.cls, variant: v.variant || '', armed: !!v.armed, livery: meshLivery(), night: APP.state.night, heading: APP.state.heading,
        dist: APP.state.dist, eyeH: APP.state.eye, camPitch: APP.state.pitch, sizeMul: APP.state.vehSizeMul || 1 };
      const was = legacyMeshesOn();
      try {
        setLegacyMeshes(false); renderVehiclePreview(a, opts);
        setLegacyMeshes(true); renderVehiclePreview(b, opts);
      } finally { setLegacyMeshes(was); }
      const da = a.getContext('2d').getImageData(0, 0, a.width, a.height).data, db = b.getContext('2d').getImageData(0, 0, b.width, b.height).data;
      let diff = 0; for (let i = 0; i < da.length; i += 4) if (da[i] !== db[i] || da[i + 1] !== db[i + 1] || da[i + 2] !== db[i + 2]) diff++;
      return { pixels: diff, of: da.length / 4 };
    },
    shot: async (name) => postShot($('view'), name || ('mesh-' + curId() + '-view')),
    // From the pilot's seat: the class's own cockpit (interior-shell.js), in GLASS 2 over a small
    // test city, with the head turned by yaw/pitch. Saved like any shot. See seatShot below.
    seat: (opts = {}) => seatShot(curId(), opts),
    // For a check that a converted file still draws what its builder did.
    legacyFaces: (detail = 1) => legacyMeshFaces(curId(), detail)?.length ?? null,
  };
}

// ── From the seat ────────────────────────────────────────────────────────────
//
// There was no way to look at a cockpit without flying the aircraft, and an aircraft whose flight
// model does not exist yet (the Drake) cannot be flown. This paints the real seat view — the same
// `paintWindshield` the game calls, with the class's own interior shell — onto a canvas of its own,
// with GLASS 2 installed for it and taken down again after.
// ⚠ THE SHELL IS DRAWN ONLY BY GLASS 2 (it goes into the own-ship solids sink), so gl, interior and
// cockpit3d are all forced on for the shot and put back afterwards.
let SEAT_MAP = null;
function seatMap() {
  if (SEAT_MAP) return SEAT_MAP;
  const R = 18, N = 37;
  SEAT_MAP = Array.from({ length: N }, (_, y) => Array.from({ length: N }, (_, x) => {
    if (x === R) return { kind: 'land', biome: 'citycore', road: 1, rd: 'ns', flr: 0, pw: 1 };
    if ((x + y * 3) % 7 === 0 && Math.abs(x - R) > 1) return { kind: 'land', biome: 'citycore', bt: 'office', ent: 'east', flr: 4 + ((x * 7 + y) % 9) };
    if (y < 6) return { kind: 'water', biome: 'water', flr: 0 };
    return { kind: 'land', biome: 'citycore', flr: 0 };
  }));
  return SEAT_MAP;
}
export async function seatShot(cls, o = {}) {
  if (!cls || !shellProfileFor(cls, !!o.armed)) return { error: 'no interior for ' + cls };
  const W = o.w || 1100, H = o.h || 620;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:fixed;left:0;top:0;z-index:9999;background:#000;width:' + W + 'px;height:' + H + 'px';
  const cv = document.createElement('canvas');
  cv.id = '__seat_' + Math.random().toString(36).slice(2, 8);
  cv.style.cssText = 'display:block;width:' + W + 'px;height:' + H + 'px';
  holder.append(cv); document.body.append(holder);
  const keep = { gl: RENDER_TUNE.gl, interior: RENDER_TUNE.interior, cockpit3d: RENDER_TUNE.cockpit3d };
  const un = installGL(() => cv);
  try {
    RENDER_TUNE.gl = 1; RENDER_TUNE.interior = 1; RENDER_TUNE.cockpit3d = 1;
    const v = { cls, armed: !!o.armed, phase: 'cruise', height: o.height ?? 0.1, worldBlend: 1, hour: o.hour ?? 13, weather: o.weather || 'clear',
      speed: 0.2, heading: 0, mapOffset: { x: 0.1, y: -0.2 }, pitch: 0, bank: 0, lookYaw: o.yaw || 0, lookPitch: o.pitch || 0,
      dome: !!o.dome, map: seatMap(),
      instr: Object.assign({ ias: 88, alt: 640, hdg: 12, rpm: 0.97, throttle: 0.6, fuel: 0.72, pitch: 3, bank: -8, vsi: 300,
        wings: 0, rotorFold: 0, hour: 10.25 }, o.instr || {}) };
    for (let i = 0; i < 3; i++) paintWindshield(cv.id, v);
    return await postShot(cv, o.name || ('seat-' + cls + '-' + Math.round(o.yaw || 0) + '-' + Math.round(o.pitch || 0)));
  } finally { Object.assign(RENDER_TUNE, keep); if (typeof un === 'function') un(); holder.remove(); }
}

// ── Wiring ───────────────────────────────────────────────────────────────────
export async function initMeshEditor(app) {
  APP = app;
  installApi();
  try { await loadDisk(); } catch (e) { S.msg = 'could not read the mesh files: ' + e.message; S.msgErr = true; }
  // Anything on disk that differs from the bake the page imported is what the editor shows.
  // Compared by value, because the bake sorts keys and the file keeps them in schema order.
  for (const [id, d] of S.disk) if (canon(d.params) !== canon(meshParams(id))) { S.work.set(id, clone(d.params)); publish(id); }
  clearInterval(pollTimer);
  pollTimer = setInterval(poll, 1000);
  addEventListener('resize', placeUnderlay);
}
export function meshEditorOpen() { return !!curId(); }
export function meshKeyDown(ev) {
  const k = ev.key.toLowerCase();
  if ((ev.ctrlKey || ev.metaKey) && k === 'z') { ev.preventDefault(); if (ev.shiftKey ? meshRedo() : meshUndo()) APP.draw(); return true; }
  if ((ev.ctrlKey || ev.metaKey) && k === 'y') { ev.preventDefault(); if (meshRedo()) APP.draw(); return true; }
  if ((ev.ctrlKey || ev.metaKey) && k === 's') { ev.preventDefault(); meshSave(); return true; }
  if (ev.ctrlKey || ev.metaKey) return false;
  if (k === 'escape') { S.sel = null; APP.draw(); return true; }
  if ((k === 'delete' || k === 'backspace') && S.sel) { ev.preventDefault(); treeOp('del'); return true; }
  if (k === 'd' && S.sel) { treeOp('dup'); return true; }
  return false;
}
