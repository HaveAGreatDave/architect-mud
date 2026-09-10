// MODELSHOP — the editor. Phase 4: the write path.
//
// Editing an authored model, with the preview updating as you type.
//
// THE ONE MECHANIC WORTH UNDERSTANDING. The file holds plain numbers in tile units; the
// renderer wants affine [a·fh + b·h + c] triples. Between them is compileModel(), and this
// module calls the SAME one the bake calls (client/shared/building-model-schema.js) — so
// what you are looking at is the building `npm run models:bake` would produce, not an
// approximation of it. A second compile in the tool is how an editor starts drawing things
// the build will not.
//
// ⚠ A COMPILE MAKES A NEW OBJECT, AND THAT IS LOAD-BEARING. shapeForModel caches captured
// geometry in a WeakMap keyed on the model object's IDENTITY. Mutating a record in place
// would leave every consumer — the cage, the bake preview, the roof readout, the scale
// strip — showing the shape it had before your edit, which looks exactly like the edit not
// working. Each edit therefore replaces the record rather than patching it.
//
// ⚠ Quoting rule, from CLAUDE.md: inside a template literal, quote identifiers with 'single
// quotes', never backticks. This file builds a lot of form markup.
import {
  SEG_SCHEMA, ADORN_SCHEMA, DEFAULT_BASIS, compileModel, validateModel,
} from '/client/shared/building-model-schema.js';
import { wallPaletteKeys, wallPaletteInfo } from '/client/game/js/panels/windshield.js';
import { toolboxSection, setToolboxOpen } from './toolbox.js';
import { shapeForModel } from '/client/game/js/panels/windshield.js';
import { portModel } from '/client/shared/model-port.js';

const $ = (id) => document.getElementById(id);
const el = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
};

// file name → authored doc, as loaded from the server and then edited in place.
const docs = new Map();
// registry key → the file that binds it, so selecting a model in the list finds its source.
const keyToFile = new Map();
let state = null;      // borrowed from app.js: { key, ... }
let onChange = null;   // re-render the preview
let dirty = new Set();

// The gizmo writes straight into the doc, so it needs to say so — otherwise a dragged
// segment is unsaved and the Save button does not look like it has anything to do.
export function markDirty() { const f = keyToFile.get(currentKey); if (f) dirty.add(f); }
let currentKey = null;
export function editorDocFor(key) {
  currentKey = key;
  const f = keyToFile.get(key);
  return f ? docs.get(f) : null;
}

// The compiled record for a key being edited, or null if this model is not authored.
// app.js prefers this over the baked registry entry, which is what makes the preview live.
export function editorRecordFor(key) {
  const doc = editorDocFor(key);
  if (!doc) return null;
  const { rec } = compileModel(doc, keyToFile.get(key));
  return rec;
}

export async function initEditor(opts) {
  state = opts.state; onChange = opts.onChange;
  await Promise.all([reload(), loadBindables()]);
}

async function reload() {
  docs.clear(); keyToFile.clear();
  const r = await fetch('/api/models').then((x) => x.json());
  for (const { file, doc } of r.models || []) {
    docs.set(file, doc);
    baseline.set(file, JSON.stringify(doc));
    for (const b of doc.bind || []) {
      const key = b.by === 'name'
        ? 'named:' + String(b.key).toLowerCase().replace(/[^a-z0-9]+/g, '')
        : 'type:' + b.key;
      keyToFile.set(key, file);
    }
  }
}

// ── THE TEXTURE PICKER ──────────────────────────────────────────────────────
// In GLASS the palette key IS the surface: draw3DBoxAt takes one surface argument and
// wallTexMixed derives BOTH the colour and the material generator from it. So picking a
// texture is picking a palette key — and until now that was a text field, which meant
// choosing one required knowing 283 names and what each looked like.
//
// The grid groups by MATERIAL, which is the thing an author is actually choosing between
// (brick, glass, corrugated metal, art-deco limestone). Both the grouping and the swatch
// come from wallPaletteInfo(), so there is no second copy of the sets here.
let palTarget = null;   // { get, set } for whichever field opened it

export function openPalettePicker(target) {
  palTarget = target;
  renderPalette(document.getElementById('palsearch').value);
  document.getElementById('paldlg').showModal();
}

export function renderPalette(filter) {
  const q = (filter || '').trim().toLowerCase();
  const rows = wallPaletteInfo().filter((p) => !q || p.key.toLowerCase().includes(q) || p.material.includes(q));
  document.getElementById('palcount').textContent = rows.length + ' of ' + wallPaletteInfo().length;
  const groups = new Map();
  for (const p of rows) {
    if (!groups.has(p.material)) groups.set(p.material, []);
    groups.get(p.material).push(p);
  }
  const host = document.getElementById('palgrid');
  host.textContent = '';
  const cur = palTarget ? palTarget.get() : null;
  for (const [mat, list] of [...groups.entries()].sort((a, b) => b[1].length - a[1].length)) {
    const h = el('div', 'grp', mat + '  (' + list.length + ')');
    host.append(h);
    const wrap = el('div', 'wrapg');
    for (const p of list) {
      const b = el('div', 'pk' + (p.key === cur ? ' on' : ''));
      const sw = el('i');
      sw.style.background = 'rgb(' + p.rgb[0] + ',' + p.rgb[1] + ',' + p.rgb[2] + ')';
      const nm = el('span', null, p.key);
      b.append(sw, nm);
      b.onclick = () => { if (palTarget) palTarget.set(p.key); document.getElementById('paldlg').close(); };
      wrap.append(b);
    }
    host.append(wrap);
  }
}

// ── WHERE THE MODEL APPEARS ─────────────────────────────────────────────────
// `bind` is the field that decides whether a model is ever seen, and it was the one thing
// you still had to hand-edit. It is also the easiest thing in the format to get wrong:
// modelFor prefers a building's NAME over its TYPE, and 408 of the 416 building tiles in
// Coldwater carry a name — so a type bind draws on almost nothing. The worked example
// shipped bound to a type whose three tiles are all named: invisible in the game, and
// healthy in every other gate.
//
// So this is a picker over the REAL targets with their REAL tile counts, and it says out
// loud when a bind reaches nothing. Counted from content/zones by the server.
let BINDABLES = { types: [], names: [], buildingTiles: 0, namedTiles: 0 };
export async function loadBindables() {
  try { BINDABLES = await fetch('/api/bindables').then((r) => r.json()); }
  catch { /* degrade to free text — the tool still works without the world */ }
}

// How many tiles this bind would actually draw on. A type bind only reaches tiles with no
// name of their own, OR whose name no model claims; the client knows the registry, so it
// answers that half here rather than the server guessing.
function reachOf(b) {
  if (!b || !b.key) return null;
  if (b.by === 'name') {
    const row = BINDABLES.names.find((n) => n.key === b.key);
    if (!row) return { tiles: 0, why: 'no building in the world carries this name' };
    const slug = 'named:' + b.key.toLowerCase().replace(/[^a-z0-9]+/g, '');
    const m = window.__msModel(slug);
    if (m && m.type !== 'authored') return { tiles: 0, why: 'a hand-written ' + m.type + ' arm already claims this name' };
    return { tiles: row.tiles };
  }
  const row = BINDABLES.types.find((t) => t.key === b.key);
  if (!row) return { tiles: 0, why: 'no building in the world carries this type' };
  const m = window.__msModel('type:' + b.key);
  if (m && m.type !== 'authored') return { tiles: 0, why: 'a hand-written ' + m.type + ' arm already claims this type' };
  if (!row.unnamed) return { tiles: 0, why: 'all ' + row.tiles + ' of its tiles are named, and a name beats a type' };
  return { tiles: row.unnamed };
}

function bindRow(doc, i, onEdit) {
  const b = doc.bind[i];
  const row = el('div', 'bindrow');

  const by = el('select');
  for (const v of ['name', 'type']) { const o = el('option', null, v); o.value = v; by.append(o); }
  by.value = b.by || 'type';
  by.onchange = () => { b.by = by.value; b.key = ''; onEdit('bind'); };

  const key = el('input'); key.type = 'text'; key.value = b.key || '';
  key.setAttribute('list', b.by === 'name' ? 'bindnames' : 'bindtypes');
  key.oninput = () => { b.key = key.value; onEdit('bind'); };

  const rm = el('button', 'mini', '✕');
  rm.title = 'remove this binding';
  rm.onclick = () => { doc.bind.splice(i, 1); onEdit('bind'); };

  row.append(by, key, rm);
  const r = reachOf(b);
  const note = el('div', r && r.tiles ? 'dim' : 'warn');
  note.textContent = !b.key ? 'pick a building'
    : r.tiles ? r.tiles + ' tile' + (r.tiles === 1 ? '' : 's') + ' would draw this model'
      : 'reaches nothing — ' + r.why;
  const wrap = el('div');
  wrap.append(row, note);
  return wrap;
}

export function bindEditor(doc, onEdit) {
  const host = el('div');
  host.append(el('h3', null, 'Appears on'));
  doc.bind = doc.bind || [];

  // Datalists for both kinds, built once, labelled with the tile counts so the choice is
  // informed rather than a guess at a spelling.
  for (const [id, rows, label] of [['bindtypes', BINDABLES.types, (t) => t.key], ['bindnames', BINDABLES.names, (n) => n.key]]) {
    if (document.getElementById(id)) continue;
    const dl = el('datalist'); dl.id = id;
    for (const r of rows) {
      const o = el('option');
      o.value = label(r);
      o.label = r.tiles + ' tiles';
      dl.append(o);
    }
    document.body.append(dl);
  }

  doc.bind.forEach((_, i) => host.append(bindRow(doc, i, onEdit)));
  const add = el('button', '', 'add binding');
  add.onclick = () => { doc.bind.push({ by: 'name', key: '' }); onEdit('bind'); };
  const addrow = el('div', 'addrow');
  addrow.append(add);
  host.append(addrow);
  return host;
}

// ── UNDO ────────────────────────────────────────────────────────────────────
// A drag writes numbers into the doc on every mousemove, so an editor without undo means
// one careless gesture and the only way back is retyping the model. The stack holds whole
// documents rather than a diff: a model is a few kilobytes, the operations are varied
// (move, add, reorder, palette, delete), and a per-operation inverse for each of them is a
// lot of code that can be subtly wrong. Snapshots cannot be.
//
// ⚠ A DRAG IS ONE UNDO STEP, NOT SIXTY. push() coalesces by tag+file inside a short window,
// so dragging a piece across the viewport is a single entry and Ctrl+Z puts it back where
// it started rather than a pixel to the left.
// ⚠ THE SNAPSHOT PUSHED IS THE STATE BEFORE THE EDIT, AND THAT IS THE WHOLE TRICK.
// A form field mutates the doc and THEN calls back, so snapshotting `doc` at that moment
// captures the change you are trying to undo — Ctrl+Z restores what you already have and
// looks broken. So a BASELINE per file holds the state as of the last undo entry: a push
// stores the baseline and then advances it to the current doc. The first baseline is taken
// when the documents load.
const UNDO_LIMIT = 60;
const COALESCE_MS = 700;
const undoStack = [];
const redoStack = [];
const baseline = new Map();   // file -> JSON as of the last undo entry
let lastPush = { tag: null, file: null, at: 0 };

export function pushUndo(file, doc, tag = 'edit') {
  if (!file || !doc) return;
  const now = Date.now();
  // Coalesce a run of the same kind of edit — a drag, or typing into one field — into one
  // step. The baseline deliberately does NOT advance while coalescing, so the whole run
  // undoes back to where it started.
  if (tag === lastPush.tag && file === lastPush.file && now - lastPush.at < COALESCE_MS) {
    lastPush.at = now;
    return;
  }
  lastPush = { tag, file, at: now };
  const before = baseline.get(file);
  if (before !== undefined) {
    undoStack.push({ file, snap: before });
    if (undoStack.length > UNDO_LIMIT) undoStack.shift();
    redoStack.length = 0;   // a new edit forks the future
  }
  baseline.set(file, JSON.stringify(doc));
}

function restore(from, to) {
  const e = from.pop();
  if (!e) return null;
  const doc = docs.get(e.file);
  if (!doc) return null;
  to.push({ file: e.file, snap: JSON.stringify(doc) });
  baseline.set(e.file, e.snap);
  // Replace the CONTENTS, not the reference — app.js and the form both hold this object.
  for (const k of Object.keys(doc)) delete doc[k];
  Object.assign(doc, JSON.parse(e.snap));
  dirty.add(e.file);
  lastPush = { tag: null, file: null, at: 0 };
  return e.file;
}

// The viewport edits by KEY and has no idea which file backs it, so it snapshots through
// this rather than app.js learning the file map.
export function pushUndoFor(key, tag = 'edit') {
  const file = keyToFile.get(key);
  const doc = file && docs.get(file);
  if (doc) pushUndo(file, doc, tag);
}

export const undo = () => restore(undoStack, redoStack);
export const redo = () => restore(redoStack, undoStack);
export const undoDepth = () => undoStack.length;

// ── THE TOOL PICKER ─────────────────────────────────────────────────────────
// Three transform modes, four mass primitives and nine adornments is sixteen things you
// can reach for, and until now they lived in two dropdowns at the bottom of a scrolling
// rail with nothing to say what any of them was. This is one dialog that names all of them
// and what each is FOR — the descriptions are the point, not the layout.
//
// Every entry does what the existing control does; nothing here is a second implementation.
const TOOL_MODES = [
  ['move', 'Move', 'Drag a piece across the ground. Shift+drag lifts it, keeping its height.'],
  ['scale', 'Scale', 'Drag right to widen, left to narrow. Shift+drag changes height, growing from the base.'],
  ['rotate', 'Rotate', 'Spin a piece about its own axis. A drum has no yaw — it is a solid of revolution.'],
];
const SEG_HELP = {
  box: 'A rectangular block. The workhorse: walls, podiums, setbacks, awnings. Takes a yaw.',
  drum: 'A faceted cylinder, optionally tapered. Tanks, silos, chimneys, round shafts.',
  barrel: 'A half-cylinder roof over a shed. Its rise scales with its SPAN, not with storeys.',
  sawtooth: 'A north-light monitor roof: sloped panels each with a vertical glazed face.',
};
const ADORN_HELP = {
  mast: 'A guyed antenna mast with an aviation light. Recorded as a spar, so it never becomes collision.',
  dish: 'A rooftop satellite dish.',
  blinkLight: 'A small blinking beacon. The cheapest adornment there is.',
  glowPool: 'A soft pool of light on the ground or a roof. Furnace mouths, doorways, ruin glow.',
  helideck: 'A landing deck with paint and edge glow.',
  latticeTower: 'An open lattice mast, tapering.',
  neonBlade: 'A vertical neon sign board. Paints the building name unless you give it a label.',
  marqueeBand: 'A lit band across the entrance face.',
  awning: 'A shopfront awning — wide across the front, shallow into the street.',
};

// Opening the palette is now showing a panel that is probably already open, so this doubles as
// the redraw: a tool that is on, or a model that just became editable, is reflected at once.
export function openToolPicker() { setToolboxOpen(true); renderTools(); }
export function refreshToolbox() { renderTools(); }

function renderTools() {
  const host = document.getElementById('tbbody');
  if (!host) return;
  host.textContent = '';
  const doc = editorDocFor(currentKey);
  // ⚠ Guarded, because the palette is rendered during boot and these hooks are assigned at the
  // BOTTOM of app.js. Unguarded, the first render throws, the panel stays empty, and nothing in
  // the page says why — which is exactly how it behaved the first time.
  const mode = window.__msMode ? window.__msMode() : null;

  toolboxSection(host, 'Transform', TOOL_MODES.map(([id, title, help]) => ({
    title, help, icon: id, on: mode === id, onPick: () => { window.__msSetMode(id); renderTools(); },
  })));

  // ⚠ The two lists come from the SCHEMA, never from a list of names written here. A kind added
  // to SEG_SCHEMA or ADORN_SCHEMA gets a button on the next reload with nothing else edited,
  // which is what stopped the picker drifting from the format when barrel and sawtooth landed.
  toolboxSection(host, 'Add mass', Object.keys(SEG_SCHEMA).map((kind) => ({
    title: kind, help: SEG_HELP[kind] || '', enabled: !!doc,
    onPick: () => addPart(doc, 'segs', SEG_SCHEMA, kind),
  })));

  toolboxSection(host, 'Add adornment', Object.keys(ADORN_SCHEMA).map((kind) => ({
    title: kind, help: ADORN_HELP[kind] || '', enabled: !!doc,
    onPick: () => addPart(doc, 'adorn', ADORN_SCHEMA, kind),
  })));
}

// The same defaults the rail's add-rows use, so a piece added from either place arrives
// the same size — visible immediately rather than a zero-sized nothing to guess out of.
export function defaultPart(schema, kind) {
  const part = { kind };
  for (const f of schema[kind].required) {
    part[f] = f === 'z1' ? 0.8 : f === 'z0' ? 0 : f === 'z' ? 0.5
      : f === 'archH' || f === 'rh' ? 0.15 : 0.2;
  }
  if (kind === 'sawtooth') { part.teeth = 4; part.roofc = '#4b5158'; part.glassc = '#7d9ab0'; part.edge = '#2b2f34'; }
  if (kind === 'barrel') { part.nf = 10; part.base = [120, 112, 100]; }
  return part;
}

function addPart(doc, list, schema, kind) {
  if (!doc) return;
  pushUndoFor(currentKey, 'add');
  doc[list] = doc[list] || [];
  doc[list].push(defaultPart(schema, kind));
  dirty.add(keyToFile.get(currentKey));
  window.__msRedraw();
}

// ── the form ────────────────────────────────────────────────────────────────
// Generated from the schema, never hand-written per field. A field added to SEG_SCHEMA is
// editable here immediately, and one that is not in the schema cannot be typed in by
// accident — the same property the Studio gets from the tag catalog.
function numField(part, name, defTag, onEdit) {
  const wrap = el('div', 'fld');
  wrap.append(el('label', null, name));
  const inp = el('input');
  inp.type = 'number'; inp.step = '0.01';
  inp.value = part[name] ?? '';
  inp.oninput = () => {
    const v = inp.value === '' ? null : Number(inp.value);
    if (v === null) delete part[name]; else part[name] = v;
    onEdit();
  };
  wrap.append(inp);

  // The scale tag. An author types tile units at a fixed basis and says what the number
  // follows; the affine triple is derived. `abs` is styled as a warning because a constant
  // that does not scale is occasionally right and much more often a slip.
  const sel = el('select', 'tag');
  for (const t of ['fh', 'h', 'abs']) {
    const o = el('option', null, t); o.value = t;
    sel.append(o);
  }
  sel.value = (part.scale && part.scale[name]) || defTag;
  const paint = () => sel.classList.toggle('warn', sel.value === 'abs');
  paint();
  sel.onchange = () => {
    part.scale = part.scale || {};
    if (sel.value === defTag) { delete part.scale[name]; if (!Object.keys(part.scale).length) delete part.scale; }
    else part.scale[name] = sel.value;
    paint(); onEdit();
  };
  wrap.append(sel);
  return wrap;
}

// One palette control, used by the model-level field and every segment's. A swatch you can
// click to open the grid, the key itself, and the derived MATERIAL — which is the half an
// author could not see before, because the material generator is chosen off the same key.
function paletteField(get, set, onEdit) {
  const wrap = el('div', 'fld');
  wrap.append(el('label', null, 'pal'));
  const sw = el('i', 'sw');
  const inp = el('input'); inp.type = 'text'; inp.value = get() || '';
  inp.setAttribute('list', 'palkeys');
  const known = new Map(wallPaletteInfo().map((x) => [x.key, x]));
  const paint = () => {
    const info = known.get(inp.value);
    inp.classList.toggle('warn', !!inp.value && !info);
    sw.style.background = info ? 'rgb(' + info.rgb.join(',') + ')' : 'transparent';
    sw.title = info ? inp.value + ' — ' + info.material : 'unknown palette key';
  };
  paint();
  sw.onclick = () => openPalettePicker({ get: () => inp.value, set: (k) => { inp.value = k; set(k); paint(); onEdit(); } });
  inp.oninput = () => { set(inp.value || null); paint(); onEdit(); };
  wrap.append(sw, inp);
  return wrap;
}

function plainField(part, name, type, onEdit) {
  const wrap = el('div', 'fld');
  wrap.append(el('label', null, name));
  // 'pal' is the TEXTURE: wallTex() derives the material family (metal, glass, deco, brick)
  // from the palette key, so choosing one is how a piece changes surface. Backed by the real
  // WALL_COL list, and a key that is not in it turns amber rather than silently going grey.
  if (name === 'pal') {
    return paletteField(() => part.pal, (v) => { if (v) part.pal = v; else delete part.pal; }, onEdit);
  }
  if (type === 'boolean') {
    const inp = el('input'); inp.type = 'checkbox';
    inp.checked = part[name] !== false;
    inp.onchange = () => { part[name] = inp.checked; onEdit(); };
    wrap.append(inp);
  } else {
    const inp = el('input');
    inp.type = type === 'string' ? 'text' : 'number';
    if (type === 'int') inp.step = '1';
    inp.value = part[name] ?? '';
    inp.oninput = () => {
      const raw = inp.value;
      if (raw === '') delete part[name];
      else part[name] = type === 'string' ? raw : Number(raw);
      onEdit();
    };
    wrap.append(inp);
  }
  return wrap;
}

function partCard(part, i, list, schema, onEdit, sel) {
  const def = schema[part.kind];
  const card = el('div', 'part' + (sel === i ? ' sel' : ''));
  const head = el('div', 'phead');
  head.append(el('b', null, '#' + i + '  ' + part.kind));

  const btn = (t, title, fn) => { const b = el('button', 'mini', t); b.title = title; b.onclick = fn; head.append(b); };
  btn('↑', 'move earlier — segment order is PAINT order', () => { if (i > 0) { list.splice(i - 1, 0, list.splice(i, 1)[0]); onEdit(); } });
  btn('↓', 'move later', () => { if (i < list.length - 1) { list.splice(i + 1, 0, list.splice(i, 1)[0]); onEdit(); } });
  btn('⧉', 'duplicate', () => { list.splice(i + 1, 0, JSON.parse(JSON.stringify(part))); onEdit(); });
  btn('✕', 'remove', () => { list.splice(i, 1); onEdit(); });
  card.append(head);

  if (!def) { card.append(el('div', 'err', 'unknown kind — nothing will draw it')); return card; }
  const body = el('div', 'pbody');
  for (const [f, tag] of Object.entries(def.geom)) body.append(numField(part, f, tag, onEdit));
  for (const [f, t] of Object.entries(def.plain)) body.append(plainField(part, f, t, onEdit));
  card.append(body);
  card.onclick = (e) => { if (e.target.tagName !== 'BUTTON') { window.__msSelect(schema === SEG_SCHEMA ? i : -1); } };
  return card;
}

function addRow(list, schema, onEdit, verb) {
  const row = el('div', 'addrow');
  const sel = el('select');
  for (const k of Object.keys(schema)) { const o = el('option', null, k); o.value = k; sel.append(o); }
  const b = el('button', null, verb);
  b.onclick = () => {
    // One place decides what a new piece starts as, so the rail and the tool picker
    // cannot disagree about it.
    list.push(defaultPart(schema, sel.value)); onEdit('add');
  };
  row.append(sel, b);
  return row;
}

export function renderEditor(host, key, redraw) {
  host.textContent = '';
  const file = keyToFile.get(key);
  const doc = file && docs.get(file);

  if (!doc) {
    const m = window.__msModel(key);
    const note = el('div', 'dim');
    note.textContent = m && m.type !== 'authored'
      ? 'This is a hand-written arm in windshield.js. Fork it to get an editable copy of its mass, or start a new model below.'
      : 'No authored source for this model.';
    host.append(note);
    if (m && m.type !== 'authored') host.append(forkRow(key, m, redraw));
    host.append(newModelRow(redraw));
    return;
  }

  // Tagged so a run of keystrokes in one field is ONE undo step, not one per character.
  const onEdit = (tag) => { pushUndo(file, doc, tag || 'edit'); dirty.add(file); redraw(); };

  const top = el('div', 'etop');
  top.append(el('span', 'dim', file + (dirty.has(file) ? ' •' : '')));
  const save = el('button', dirty.has(file) ? 'on' : '', 'Save');
  save.onclick = () => doSave(file, doc, redraw);
  const del = el('button', '', 'Delete');
  del.onclick = () => { if (confirm('Delete ' + file + '?')) doDelete(file, redraw); };
  const exp = el('button', '', 'Export');
  exp.title = 'Download this model as a .json file';
  exp.onclick = () => {
    const blob = new Blob([JSON.stringify(doc, null, 2) + '\n'], { type: 'application/json' });
    const a = el('a');
    a.href = URL.createObjectURL(blob);
    a.download = file;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  };
  const imp = el('button', '', 'Import');
  imp.title = 'Replace this model from a .json file';
  imp.onclick = () => {
    const inp = el('input'); inp.type = 'file'; inp.accept = '.json,application/json';
    inp.onchange = async () => {
      const f = inp.files && inp.files[0];
      if (!f) return;
      const bar = $('esave');
      try {
        const next = JSON.parse(await f.text());
        // Validated BEFORE it lands, with the same validator the server and the bake run —
        // so a file from somewhere else cannot put the editor into a state the build rejects.
        const v = validateModel(next, f.name);
        if (v.errors.length) {
          bar.className = 'err';
          bar.textContent = 'not imported — ' + v.errors.slice(0, 2).join(' / ');
          return;
        }
        pushUndo(file, doc, 'import');
        for (const k of Object.keys(doc)) delete doc[k];
        Object.assign(doc, next);
        dirty.add(file);
        bar.className = 'ok';
        bar.textContent = 'imported ' + f.name + ' — not saved yet';
        redraw();
      } catch (e) {
        bar.className = 'err';
        bar.textContent = 'not imported — ' + e.message;
      }
    };
    inp.click();
  };
  top.append(save, exp, imp, del);
  host.append(top);

  // The palette list comes from WALL_COL itself, never a second copy of ~300 key names. A free
  // text field was the first cut and it is the wrong shape: a mistyped palette does not fail, it
  // silently falls back to grey, which looks like a rendering bug rather than a typo.
  // The datalist backs every palette input on the page, so it is built once.
  if (!document.getElementById('palkeys')) {
    const dl = el('datalist'); dl.id = 'palkeys';
    for (const k of wallPaletteKeys()) { const o = el('option'); o.value = k; dl.append(o); }
    document.body.append(dl);
  }
  host.append(paletteField(() => doc.pal, (v) => { if (v) doc.pal = v; else delete doc.pal; }, onEdit));

  host.append(bindEditor(doc, onEdit));

  host.append(el('h3', null, 'Segments — paint order'));
  doc.segs = doc.segs || [];
  doc.segs.forEach((s, i) => host.append(partCard(s, i, doc.segs, SEG_SCHEMA, onEdit, window.__msSelected())));
  host.append(addRow(doc.segs, SEG_SCHEMA, onEdit, 'add segment'));

  host.append(el('h3', null, 'Adornments'));
  doc.adorn = doc.adorn || [];
  doc.adorn.forEach((a, i) => host.append(partCard(a, i, doc.adorn, ADORN_SCHEMA, onEdit, -1)));
  host.append(addRow(doc.adorn, ADORN_SCHEMA, onEdit, 'add adornment'));

  // Live validation, from the same validator the server and the bake run. A model that
  // cannot be saved says so while you are typing rather than when you press the button.
  const v = validateModel(doc, file);
  const msgs = el('div', 'msgs');
  for (const e of v.errors) msgs.append(el('div', 'err', '✗ ' + e));
  for (const w of v.warnings) msgs.append(el('div', 'warn', '! ' + w));
  host.append(msgs);
  host.append(newModelRow(redraw));
}

// ── FORKING AN ARM ──────────────────────────────────────────────────────────
// The answer to "can I edit this building?" for the 172 that are code. The arm cannot be edited,
// but its captured MASS can be turned back into an authored document, and then you can add
// shapes to it, move them, retexture them and save.
//
// ⚠ A FORK IS A STARTING POINT, NOT A COPY. Capture is lossy in three ways that all matter here
// (see client/shared/model-port.js): no adornments but masts, no per-box texture seed, and one
// frozen entrance facing — which is the thing that ended the port of the city. So the fork gets
// its OWN id and binds to nothing that exists, and it deliberately does not claim `portedFrom`,
// which is the field that would make it override the arm. The original building is untouched
// until you bind the fork to it yourself.
function forkRow(key, m, redraw) {
  const row = el('div', 'addrow');
  const b = el('button', '', 'Make editable');
  b.title = 'Copy this arm\'s mass into an authored model, bound to the same buildings, and edit it here.'
    + ' What the game draws changes with it. Adornments other than masts, per-box texture seeds and the'
    + ' other three entrance facings are not captured, so it is a starting point rather than a copy.';
  b.onclick = async () => {
    const bar = $('esave');
    // portModel takes the renderer as an argument; in node that is the stubbed windshield, here
    // it is the real one this page already imported.
    const { doc, errors } = portModel({ shapeForModel }, key, m, Number(window.__msSeed?.() ?? 3));
    if (errors) {
      bar.className = 'err';
      bar.textContent = 'cannot be expressed in the authored format — ' + errors[0];
      return;
    }
    // ⚠ IT KEEPS THE ARM'S OWN KEY AND STANDS IN FOR IT. The first cut gave the fork its own id and
    // bound it to a name nothing carried, which was safe and useless: you edited a model no tile
    // resolved to, and the building in the game went on drawing the arm. So the fork claims the key
    // (`replaces`, which the registry merge honours the way it honours a port) and the arm is kept
    // in LEGACY_MODELS — `RENDER_TUNE.legacyArms` puts the whole city back with one flag.
    //
    // `replaces` rather than `portedFrom` because the two make different claims. A port says it
    // draws the SAME building and is re-measured against the arm on every push; a fork says it is
    // deliberately a different one. Writing `portedFrom` here would be claiming something false
    // and the port gate would fail the push, correctly.
    delete doc.portedFrom;
    doc.replaces = m.type;
    doc.note = 'Forked from the hand-written ' + m.type + ' arm in the Modelshop, and drawn instead of it. '
      + 'Mass only: adornments other than masts, per-box texture seeds and the other entrance facings '
      + 'were not captured.';
    const file = doc.id + '.json';
    docs.set(file, doc);
    keyToFile.set(key, file);
    await doSave(file, doc, redraw);
    // Same key, now an authored record: the tool reopens on the thing you were already looking at.
    window.__msReselect(key);
  };
  row.append(b);
  return row;
}

function newModelRow(redraw) {
  const row = el('div', 'addrow');
  const inp = el('input'); inp.type = 'text'; inp.placeholder = 'new model id, e.g. tannery';
  const b = el('button', '', 'New');
  b.onclick = async () => {
    const id = inp.value.trim().toLowerCase().replace(/[^a-z0-9_-]/g, '');
    if (!id) return;
    const doc = {
      id,
      basis: { ...DEFAULT_BASIS },
      segs: [{ kind: 'box', cx: 0, cy: 0, hw: 0.35, fd: 0.3, z0: 0, z1: 0.8, roof: true }],
      adorn: [],
      bind: [{ by: 'type', key: id }],
    };
    docs.set(id + '.json', doc);
    keyToFile.set('type:' + id, id + '.json');
    await doSave(id + '.json', doc, redraw, id);
  };
  row.append(inp, b);
  return row;
}

async function doSave(file, doc, redraw, selectType) {
  const bar = $('esave');
  let r;
  try {
    r = await fetch('/api/models', {
      method: 'PUT', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ file, doc }),
    }).then((x) => x.json());
  } catch (e) {
    // A save that quietly does nothing is worse than one that fails loudly — the model is
    // still on screen, still edited, and the author has no reason to think it did not land.
    bar.className = 'err';
    bar.textContent = 'could not reach the Modelshop server (' + e.message + ') — your edit is still here, unsaved.';
    return;
  }
  if (r.ok) {
    dirty.delete(file);
    bar.className = 'ok';
    // The bake on disk changed, but this page imported the OLD one at load. Saying so is the
    // honest thing: the preview is live because the editor compiles in the browser, and the
    // SIM will not see the change until the game client reloads.
    bar.textContent = 'saved · ' + file + ' · bake rewritten (' + r.bindings + ' bindings) · reload the game client to see it in the sim';
    if (selectType) window.__msReselect('type:' + selectType);
  } else {
    bar.className = 'err';
    bar.textContent = (r.rolledBack ? 'refused and rolled back: ' : 'refused: ') + (r.errors || ['unknown']).join(' / ');
  }
  redraw();
}

async function doDelete(file, redraw) {
  const r = await fetch('/api/models?file=' + encodeURIComponent(file), { method: 'DELETE' }).then((x) => x.json());
  const bar = $('esave');
  bar.className = r.ok ? 'ok' : 'err';
  bar.textContent = r.ok ? 'deleted ' + file : (r.errors || []).join(' / ');
  const gone = [...keyToFile.entries()].filter(([, f]) => f === file).map(([k]) => k);
  await reload();
  if (r.ok) for (const k of gone) window.__msUnregister(k);
  redraw();
}
