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
import { wallPaletteKeys } from '/client/game/js/panels/windshield.js';

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
  await reload();
}

async function reload() {
  docs.clear(); keyToFile.clear();
  const r = await fetch('/api/models').then((x) => x.json());
  for (const { file, doc } of r.models || []) {
    docs.set(file, doc);
    for (const b of doc.bind || []) {
      const key = b.by === 'name'
        ? 'named:' + String(b.key).toLowerCase().replace(/[^a-z0-9]+/g, '')
        : 'type:' + b.key;
      keyToFile.set(key, file);
    }
  }
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

function plainField(part, name, type, onEdit) {
  const wrap = el('div', 'fld');
  wrap.append(el('label', null, name));
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
    const kind = sel.value;
    const part = { kind };
    // Sensible starting numbers, so a new part is visible immediately rather than a
    // zero-sized nothing an author has to guess their way out of.
    for (const f of schema[kind].required) part[f] = f === 'z1' ? 0.8 : f === 'z0' ? 0 : f === 'z' ? 0.5 : 0.2;
    list.push(part); onEdit();
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
      ? 'This is a hand-written arm in windshield.js — not editable here. Create a new authored model, or port it (see the README).'
      : 'No authored source for this model.';
    host.append(note);
    host.append(newModelRow(redraw));
    return;
  }

  const onEdit = () => { dirty.add(file); redraw(); };

  const top = el('div', 'etop');
  top.append(el('span', 'dim', file + (dirty.has(file) ? ' •' : '')));
  const save = el('button', dirty.has(file) ? 'on' : '', 'Save');
  save.onclick = () => doSave(file, doc, redraw);
  const del = el('button', '', 'Delete');
  del.onclick = () => { if (confirm('Delete ' + file + '?')) doDelete(file, redraw); };
  top.append(save, del);
  host.append(top);

  // The palette list comes from WALL_COL itself, never a second copy of ~300 key names. A free
  // text field was the first cut and it is the wrong shape: a mistyped palette does not fail, it
  // silently falls back to grey, which looks like a rendering bug rather than a typo.
  const idf = el('div', 'fld');
  idf.append(el('label', null, 'palette'));
  const pal = el('input'); pal.type = 'text'; pal.value = doc.pal || ''; pal.setAttribute('list', 'palkeys');
  let dl = document.getElementById('palkeys');
  if (!dl) {
    dl = el('datalist'); dl.id = 'palkeys';
    for (const k of wallPaletteKeys()) { const o = el('option'); o.value = k; dl.append(o); }
    document.body.append(dl);
  }
  const known = new Set(wallPaletteKeys());
  const markPal = () => pal.classList.toggle('warn', !!pal.value && !known.has(pal.value));
  markPal();
  pal.oninput = () => { if (pal.value) doc.pal = pal.value; else delete doc.pal; markPal(); onEdit(); };
  idf.append(pal);
  host.append(idf);

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
