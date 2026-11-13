// THE BROADCAST STUDIO. One page for a show's script and its 3-D sequences: the BSM Studio on the
// Script tab, and on the others the entries, sequences and sets of client/shared/sequence.js, with a
// live preview through the player the TV uses. The forms come off sequence.js's tables and
// SET_PIECES, so a new graphic or piece needs nothing here. See tools/broadcast-studio/README.md.

import { GFX, FRAMES, MOVES, CUTS, ACTS, OPS, SEQ_FORMAT, timeline, timelineLength, checkSequence, checkShow, tokenPaths, listPaths, peoplePaths, passes, sequenceFromBsm, shotCamera, SHOW_KINDS, kindOf, showSkeleton, castToken, fill, resolveSet, partsOf } from '/client/shared/sequence.js';
import { SET_PIECES } from '/client/game/js/panels/gl/set-mesh.js';
import { createSequencePlayer } from '/client/game/js/panels/sequence-player.js';

globalThis.__houseComic = true;

const $ = (id) => document.getElementById(id);
const S = { docs: new Map(), dirty: new Set(), tab: 'show', show: null, slot: null, seq: null, set: null, beat: 0, pick: null, sample: '', npcs: [], broadcasts: [], scripts: [], lastField: null, seed: 1, sim: null };

const h = (tag, props = {}, ...kids) => {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (v !== undefined && v !== null && v !== false) el[k] = v;
  }
  el.append(...kids.flat().filter((x) => x !== null && x !== undefined && x !== false));
  return el;
};
const docsOf = (kind) => [...S.docs.values()].filter((d) => d.kind === kind).sort((a, b) => String(a.name).localeCompare(String(b.name)));
const seqNow = () => S.docs.get(S.seq);
// The set as stored, and as drawn: a skin laid over its template. Everything that only reads takes
// setNow(); an edit goes through editable() so a skin's change lands in the skin, never the template.
const rawSet = () => S.docs.get(S.set) || S.docs.get(seqNow()?.set);
const viewSet = (set) => resolveSet(set, (id) => S.docs.get(id));
const setNow = () => viewSet(rawSet());
// What the inspector and the plan write to: the piece, mark or camera itself on a set of its own; on a
// skin, an override of it. A template's piece with no part name is fixed, so it's null.
function editable(kind, id) {
  const raw = rawSet(), view = setNow();
  if (!raw) return null;
  if (!raw.base) return kind === 'piece' ? raw.pieces?.[id] : kind === 'mark' ? raw.marks?.[id] : raw.cameras?.[id];
  if (kind === 'piece') {
    const own = raw.pieces || [], nBase = view.pieces.length - own.length;
    if (id >= nBase) return own[id - nBase];
    const vp = view.pieces[id];
    return vp?.part ? overlay(vp, () => ((raw.parts ||= {})[vp.part] ||= {})) : null;
  }
  const coll = kind === 'mark' ? 'marks' : 'cameras', vo = view[coll]?.[id];
  return vo ? overlay(vo, () => ((raw[coll] ||= {})[id] ||= {})) : null;
}
// Reads the drawn value, writes the override (made on the first write).
const overlay = (shown, ov) => new Proxy({}, {
  get: (t, k) => { const o = ov(); return k in o ? o[k] : shown[k]; },
  set: (t, k, v) => { ov()[k] = v; return true; },
  deleteProperty: (t, k) => { delete ov()[k]; return true; },
  has: (t, k) => k in shown || k in ov(),
});
const showNow = () => S.docs.get(S.show);
const touch = (doc) => { S.dirty.add(doc.id); status(); };
function status(text, cls = '') {
  const el = $('status');
  el.textContent = text ?? (S.dirty.size ? `${S.dirty.size} unsaved` : 'Saved');
  el.className = cls || (text ? '' : S.dirty.size ? 'dirty' : '');
}
const uid = (seq) => { let n = seq.beats.length + 1; while (seq.beats.some((b) => b.id === `b${n}`)) n++; return `b${n}`; };

// ── Form fields ────────────────────────────────────────────────────────────────────────────────
const field = (label, input) => h('label', { class: 'field' }, h('span', {}, label), input);
const remember = (el) => { el.addEventListener('focus', () => { S.lastField = el; }); return el; };
function textInput(obj, key, after, doc) {
  return remember(h('input', { type: 'text', value: obj[key] ?? '', oninput: (e) => { obj[key] = e.target.value; touch(doc); after?.(); } }));
}
function numberInput(obj, key, after, doc, step = 0.1) {
  return h('input', { type: 'number', step, value: obj[key] ?? '', oninput: (e) => { const v = e.target.value; if (v === '') delete obj[key]; else obj[key] = +v; touch(doc); after?.(); } });
}
function selectInput(obj, key, options, after, doc) {
  const el = h('select', { onchange: (e) => { obj[key] = e.target.value; touch(doc); after?.(); } });
  for (const [v, label] of options) el.add(new Option(label, v, false, String(obj[key] ?? '') === String(v)));
  return el;
}
function linesInput(obj, key, after, doc, rows = 3) {
  return remember(h('textarea', { rows, value: (obj[key] || []).join('\n'), oninput: (e) => { obj[key] = e.target.value.split('\n').filter((s) => s.trim()); touch(doc); after?.(); } }));
}
// The picker for what a box shows: the programme, the wall, or one of the set's cameras.
const sourceOptions = (set) => [['feed', 'The live programme'], ['wall', 'The set\'s screen'], ...Object.entries(set?.cameras || {}).map(([k, c]) => [`cam:${k}`, `Camera: ${c.label || k}`])];

// Conditions: a beat, a graphic or a slot plays only when these all pass. The facts come off the data.
function condEditor(owner, after, doc) {
  const box = h('div', {});
  const draw = () => {
    box.replaceChildren();
    (owner.if || []).forEach((c, i) => {
      const noValue = c.op === 'has' || c.op === 'missing';
      box.append(h('div', { class: 'cond' },
        h('input', { type: 'text', value: c.fact || '', placeholder: 'fact', title: 'A fact from the data', oninput: (e) => { c.fact = e.target.value; touch(doc); after?.(); } }),
        selectInput(c, 'op', Object.entries(OPS), () => { draw(); after?.(); }, doc),
        noValue ? h('span', {}) : h('input', { type: 'text', value: c.value ?? '', title: 'A number, true, false or a word', oninput: (e) => { c.value = e.target.value; touch(doc); after?.(); } }),
        h('button', { title: 'Remove', onclick: () => { owner.if.splice(i, 1); if (!owner.if.length) delete owner.if; touch(doc); draw(); after?.(); } }, '✕')));
      box.lastChild.firstChild.setAttribute('list', 'fact-list');
    });
    box.append(h('button', { onclick: () => { (owner.if = owner.if || []).push({ fact: '', op: '>=', value: '' }); touch(doc); draw(); } }, '+ Only if…'));
  };
  draw();
  return box;
}

function gfxField(f, g, set, after, doc) {
  if (f.type === 'list') return field(f.label, selectInput(g, f.k, [['', '(fixed rows below)'], ...listPaths(dataNow()).map((k) => [k, k])], after, doc));
  if (f.type === 'person') return field(f.label, selectInput(g, f.k, [['', '(spelled out below)'], ...peoplePaths(dataNow()).map((k) => [k, k])], after, doc));
  if (f.type === 'number') return field(f.label, numberInput(g, f.k, after, doc));
  if (f.type === 'select') return field(f.label, selectInput(g, f.k, f.opts.map((o) => [o, o]), after, doc));
  if (f.type === 'source') return field(f.label, selectInput(g, f.k, sourceOptions(set), after, doc));
  if (f.type === 'rows') return field(f.label, linesInput(g, f.k, after, doc));
  return field(f.label, textInput(g, f.k, after, doc));
}

// ── The player ─────────────────────────────────────────────────────────────────────────────────
let player = null;
const speak = (it, trace) => {
  if (!$('voice').checked || !window.AudioEngine?.speak) return null;
  return window.AudioEngine.speak(it.text, { channel: 'npc', seed: it.data.speaker?.name || it.role || 'studio', trace });
};
function ensurePlayer() {
  if (player) return player;
  player = createSequencePlayer($('monitor'), {
    mode: 'clock', speak,
    onBeat: (it) => { paintNow(it.i); },
    onEnd: () => { $('play').textContent = '▶'; },
  });
  if (!player) { status('WebGL2 is needed for the preview', 'bad'); return null; }
  player.start();
  return player;
}
const lookOf = (id, role) => {
  if (castToken(id)) { const name = fill(id, dataNow()).trim(); return { id: `viewer:${name}`, name: name && name !== id ? name : role }; }
  return S.npcs.find((n) => n.id === id) || { id: id || `studio-${role}`, name: role };
};
function castFor(seq) {
  const show = showNow() || docsOf('show').find((s) => (s.slots || []).some((x) => x.sequence === seq.id));
  const out = {};
  for (const r of Object.keys(seq.roles || {})) out[r] = lookOf(show?.cast?.[r] || seq.roles[r].npc, seq.roles[r].label || r);
  return out;
}
function dataNow() {
  const show = showNow(), samples = show?.samples || {};
  const d = S.sim || samples[S.sample] || Object.values(samples)[0] || {};
  return { show: show?.name || '', ...d };
}
// A sports show previews a real simulated game: the moment its slot plays at, or the sample picked.
// Every other kind fills its tokens from the samples on its entry. The moments come off its kind.
const momentsNow = () => kindOf(showNow()).moments;
async function simulate() {
  const show = showNow();
  S.sim = null;
  if (!show?.broadcast || !kindOf(show).simulated) { fillFacts(); return; }
  const pick = /^sim:(\d)$/.exec(S.sample), { when, n = 0 } = momentsNow()[pick ? +pick[1] : 0] || {};
  const r = await fetch(`/api/sample?broadcast=${encodeURIComponent(show.broadcast)}&when=${when}&n=${n}&seed=${S.seed}`).catch(() => null);
  if (r?.ok) S.sim = await r.json();
  fillFacts();
}
const fillFacts = () => $('fact-list').replaceChildren(...tokenPaths(dataNow()).map((p) => h('option', { value: p })));
// Open a sequence on the moment its slot plays at.
function momentFor(seq) {
  const when = showNow()?.slots?.find((s) => s.sequence === seq?.id)?.when;
  return `sim:${Math.max(0, momentsNow().findIndex((m) => m.when === when))}`;
}
let reloadTimer = 0;
function refresh({ now = false } = {}) {
  clearTimeout(reloadTimer);
  reloadTimer = setTimeout(load, now ? 0 : 280);
}
function load() {
  const p = ensurePlayer();
  if (!p) return;
  let seq = seqNow(), set = setNow();
  if (S.tab === 'set' && set) seq = previewOfSet(set);
  if (!seq || !set) return;
  p.pause();
  p.load({ seq, set, cast: S.tab === 'set' ? setCast(seq) : castFor(seq), data: dataNow(), seed: 'studio' });
  p.seekBeat(S.tab === 'set' ? 0 : S.beat);
  $('clock').textContent = fmt(p.time) + ' / ' + fmt(p.length);
  if (S.tab === 'sequence') queueThumbs();
}
// The set tab looks through the chosen camera, with somebody on each mark.
function previewOfSet(set) {
  const roles = {};
  for (const k of Object.keys(set.marks || {})) roles[k] = { mark: k, label: k };
  const cam = S.pick?.kind === 'camera' ? S.pick.id : Object.keys(set.cameras || {})[0];
  return { id: 'preview', roles, beats: [{ id: 'b1', hold: 9999, shot: { cam, frame: 'full' } }] };
}
const setCast = (seq) => Object.fromEntries(Object.keys(seq.roles).map((r) => [r, { id: `studio-${r}`, name: r }]));
const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;

let thumbTimer = 0;
function queueThumbs() {
  clearTimeout(thumbTimer);
  const seq = seqNow();
  if (!seq) return;
  const todo = [...document.querySelectorAll('#board canvas')];
  let n = 0;
  const step = () => {
    if (player?.playing || n >= todo.length) { if (!player?.playing) player?.seekBeat(S.beat); return; }
    const c = todo[n++];
    player.thumb(+c.dataset.i, c);
    thumbTimer = setTimeout(step, 30);
  };
  // the figures are built a beat after the room
  thumbTimer = setTimeout(step, 1300);
}

function paintNow(i) {
  document.querySelectorAll('.beat').forEach((b) => b.classList.toggle('now', +b.dataset.i === i));
  if (player?.playing && S.beat !== i) { S.beat = i; document.querySelectorAll('.beat').forEach((b) => b.classList.toggle('on', +b.dataset.i === i)); }
}
setInterval(() => {
  if (!player?.state) return;
  $('clock').textContent = `${fmt(player.time)} / ${fmt(player.length)}`;
  if (document.activeElement !== $('scrub') && player.length) $('scrub').value = String(Math.round(player.time / player.length * 1000));
  if (!player.playing) $('play').textContent = '▶';
}, 200);

// ── The rail ───────────────────────────────────────────────────────────────────────────────────
function renderRail() {
  const rail = $('rail');
  rail.replaceChildren();
  rail.append(h('h3', {}, 'Shows', h('button', { title: 'New show', onclick: newShow }, '+')));
  for (const show of docsOf('show')) {
    rail.append(h('button', { class: `item show${S.tab === 'show' && S.show === show.id ? ' on' : ''}`, onclick: () => openShow(show.id) }, show.name, show.live ? h('span', { class: 'live' }, 'LIVE') : null));
    for (const slot of show.slots || []) {
      const on = S.tab === 'sequence' && S.show === show.id && S.slot === slot.id;
      rail.append(h('button', { class: `item slot${on ? ' on' : ''}`, title: slot.sequence || 'Nothing plays here yet', onclick: () => openSlot(show.id, slot) }, slot.label || slot.id, slot.sequence ? null : h('span', { class: 'none' }, ' (empty)')));
    }
  }
  rail.append(h('h3', {}, 'Sequences', h('button', { title: 'New sequence', onclick: () => newSequence() }, '+')));
  for (const seq of docsOf('sequence')) rail.append(h('button', { class: `item${S.tab === 'sequence' && S.seq === seq.id ? ' on' : ''}`, onclick: () => openSequence(seq.id) }, seq.name));
  const from = h('select', { title: 'Turn a .bsm script into a sequence', onchange: (e) => { if (e.target.value) fromScript(e.target.value); e.target.value = ''; } });
  from.add(new Option('From a script…', ''));
  for (const f of S.scripts) from.add(new Option(f, f));
  rail.append(from);
  rail.append(h('h3', {}, 'Sets', h('button', { title: 'New set', onclick: newSet }, '+')));
  // templates first, then the sets: a skin says what it's built on
  const sets = docsOf('set'), tpls = sets.filter((d) => d.template);
  for (const set of [...tpls, ...sets.filter((d) => !d.template)]) rail.append(h('button', { class: `item${set.template ? ' tpl' : ''}${S.tab === 'set' && S.set === set.id ? ' on' : ''}`, title: set.base ? `A skin on ${set.base}` : set.template ? 'A template' : '', onclick: () => openSet(set.id) }, set.template ? `◇ ${set.name.replace(/^Template:s*/, '')}` : set.name));
  const skin = h('select', { title: 'A new set built on a template', onchange: (e) => { if (e.target.value) newSkin(e.target.value); e.target.value = ''; } });
  skin.add(new Option('New skin of…', ''));
  for (const t of tpls) skin.add(new Option(t.name.replace(/^Template:s*/, ''), t.id));
  rail.append(skin);
}

function goTab(tab) {
  S.tab = tab;
  for (const b of document.querySelectorAll('#tabs button')) b.classList.toggle('on', b.dataset.tab === tab);
  $('stage-pane').hidden = tab === 'show' || tab === 'script';
  $('form-pane').hidden = tab !== 'show';
  $('inspector').hidden = tab === 'script';
  $('script-frame').hidden = tab !== 'script';
  $('body').style.gridTemplateColumns = tab === 'script' ? '230px minmax(0, 1fr)' : tab === 'show' ? '230px minmax(0, 1fr)' : '';
  if (tab === 'show') $('inspector').hidden = true;
  if (tab === 'script' && !$('script-frame').src) $('script-frame').src = '/bsm-studio.html';
  $('board').hidden = tab !== 'sequence';
  $('plan-wrap').hidden = tab !== 'set';
  $('transport').style.visibility = tab === 'sequence' ? '' : 'hidden';
  renderRail();
  if (tab === 'show') renderShow();
  if (tab === 'sequence') { S.sample = kindOf(showNow()).simulated ? momentFor(seqNow()) : S.sample; renderSample(); simulate().then(() => { renderBoard(); renderInspector(); refresh({ now: true }); }); }
  if (tab === 'set') { renderSetInspector(); drawPlan(); refresh({ now: true }); }
}
function openShow(id) { S.show = id; S.slot = null; goTab('show'); }
function openSlot(showId, slot) {
  S.show = showId; S.slot = slot.id;
  if (slot.sequence && S.docs.has(slot.sequence)) { S.seq = slot.sequence; S.beat = 0; goTab('sequence'); return; }
  goTab('show');
  status(`${slot.label || slot.id} has no sequence yet. Pick one in the table.`);
}
function openSequence(id) {
  S.seq = id; S.beat = 0; S.slot = null;
  const show = docsOf('show').find((s) => (s.slots || []).some((x) => x.sequence === id));
  if (show) S.show = show.id;
  goTab('sequence');
}
function openSet(id) { S.set = id; S.pick = null; goTab('set'); }

// ── New documents ──────────────────────────────────────────────────────────────────────────────
function addDoc(doc) { S.docs.set(doc.id, doc); touch(doc); return doc; }
function freshId(prefix, name) {
  const base = `${prefix}_${String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'new'}`;
  let id = base, n = 2;
  while (S.docs.has(id)) id = `${base}_${n++}`;
  return id;
}
function newShow() {
  const name = prompt('The show\'s name?');
  if (!name) return;
  const doc = addDoc(showSkeleton('regular', { id: freshId('show', name), name }));
  openShow(doc.id);
}
function newSequence(from = null) {
  const name = prompt('The sequence\'s name?', from ? `${from.name} copy` : '');
  if (!name) return;
  const set = docsOf('set')[0];
  const roles = Object.fromEntries(Object.keys(set?.marks || {}).slice(0, 2).map((k) => [k, { mark: k, label: set.marks[k].label || k }]));
  const doc = addDoc(from ? { ...structuredClone(from), id: freshId('seq', name), name } : { kind: 'sequence', format: SEQ_FORMAT, id: freshId('seq', name), name, set: set?.id || '', roles, beats: [{ id: 'b1', shot: { cam: Object.keys(set?.cameras || {})[0] || 'cam1', frame: 'wide', on: Object.keys(roles), move: 'none', cut: 'cut' }, hold: 3, gfx: [] }] });
  openSequence(doc.id);
}
function newSet() {
  const name = prompt('The set\'s name?');
  if (!name) return;
  const doc = addDoc({ kind: 'set', format: SEQ_FORMAT, id: freshId('set', name), name, room: { w: 10, d: 8, h: 4 }, focus: [0, 1.1, 5], palette: {}, pieces: [], marks: { a: { at: [-0.8, 5], yaw: 180, pose: 'sit', label: 'Left' }, b: { at: [0.8, 5], yaw: 180, pose: 'sit', label: 'Right' } }, cameras: { cam1: { label: 'Centre', at: [0, 0.6], h: 1.5 } }, lamps: [{ p: [0, 3.4, 3.4], k: 1 }] });
  openSet(doc.id);
}
// A skin: a name and a template, and the template's sign reads the name.
function newSkin(base) {
  const name = prompt("The skin's name (the show or network it's for)?");
  if (!name) return;
  const doc = addDoc({ kind: 'set', format: SEQ_FORMAT, id: freshId('set', name), name, base, brand: { name: name.toUpperCase() }, palette: {} });
  openSet(doc.id);
}
async function fromScript(file) {
  const text = await fetch(`/api/script?name=${encodeURIComponent(file)}`).then((r) => r.text());
  const compiled = window.compileBsm(text), set = docsOf('set')[0];
  const seq = sequenceFromBsm(compiled, { id: freshId('seq', file.replace(/\.bsm$/, '')), set: set?.id || '' });
  if (!seq.beats.length) { status(`${file} isn't a linear script, so it has no shots to read`, 'bad'); return; }
  // each speaker takes the set's next mark, and a shot of a camera the set hasn't got takes its first
  const marks = Object.keys(set?.marks || {}), cams = Object.keys(set?.cameras || {});
  Object.values(seq.roles).forEach((r, i) => { r.mark = marks[i % marks.length]; });
  for (const b of seq.beats) if (!set?.cameras?.[b.shot.cam]) b.shot.cam = cams[0];
  addDoc(seq);
  openSequence(seq.id);
  status(`${seq.beats.length} beats from ${file}`);
}

// Changing a show's kind lays out its slots and sample data afresh, unless it already plays something.
function reKind(show) {
  const fresh = showSkeleton(show.type, show);
  if (!(show.slots || []).some((s) => s.sequence)) show.slots = fresh.slots;
  if (!Object.values(show.samples || {}).some((v) => Object.keys(v || {}).length)) show.samples = fresh.samples;
  touch(show); renderShow(); renderRail(); renderSample();
}

// ── The show tab ───────────────────────────────────────────────────────────────────────────────
function renderShow() {
  const pane = $('form-pane'), show = showNow();
  pane.replaceChildren();
  if (!show) { pane.append(h('p', { class: 'hint' }, 'Pick a show on the left, or make a new one. A show is a broadcast\'s entry: who\'s in it, and which sequence plays at each of its slots.')); return; }
  const redraw = () => { renderRail(); };
  const seqOptions = [['', '(nothing)'], ...docsOf('sequence').map((s) => [s.id, s.name])];
  const bOptions = [['', '(no broadcast yet)'], ...S.broadcasts.map((b) => [b.id, b.name])];
  const roles = new Set();
  for (const s of show.slots || []) for (const r of Object.keys(S.docs.get(s.sequence)?.roles || {})) roles.add(r);
  for (const r of Object.keys(show.cast || {})) roles.add(r);
  const npcOptions = [['', '(nobody)'], ...(kindOf(show).castTokens || []).map((t) => [`{${t}}`, `{${t}}: whoever the broadcast names`]), ...S.npcs.map((n) => [n.id, n.name])];
  const problems = checkShow(show, Object.fromEntries(S.docs)), kind = kindOf(show);
  const whenOptions = [...new Map(kind.moments.map((m) => [m.when, m.label])).entries()];

  pane.append(h('h2', {}, show.name));
  pane.append(h('div', { class: 'wide' },
    h('div', { class: 'two' }, field('Name', textInput(show, 'name', redraw, show)), field('Airs as', selectInput(show, 'broadcast', bOptions, null, show))),
    field('Kind of show', selectInput(show, 'type', Object.entries(SHOW_KINDS).map(([k, v]) => [k, v.label]), () => reKind(show), show)),
    h('p', { class: 'hint' }, kind.moments.length ? `A ${kind.label.toLowerCase()} calls its desk at: ${kind.moments.map((m) => m.label.toLowerCase()).join('; ')}.` : `A ${kind.label.toLowerCase()} doesn't call the desk on air yet. It still plays on a set whose Stage for list says ${kind.stage}, behind the TV's 3D button.`),
    h('label', { class: 'field' }, h('input', { type: 'checkbox', checked: !!show.live, onchange: (e) => { show.live = e.target.checked; touch(show); redraw(); } }), ' On air: this entry plays in the live broadcast'),
    h('p', { class: 'hint' }, 'Saving writes to content/. A push to main carries it to the game.')));
  pane.append(h('h3', {}, 'Cast'));
  pane.append(h('table', {}, [...roles].map((r) => h('tr', {}, h('td', {}, r), h('td', {}, selectInput(show.cast = show.cast || {}, r, npcOptions, null, show))))));
  pane.append(h('h3', {}, 'Slots'));
  pane.append(h('p', { class: 'hint' }, 'Where the sequences go. When is the moment the broadcast calls, and the kind of show says which it has. Several slots can share a moment: the first whose conditions pass plays, so put special cases above the usual one.'));
  const slots = h('table', {}, h('tr', {}, h('th', {}, 'Slot'), h('th', {}, 'When'), h('th', {}, 'Sequence'), h('th', {}, '')));
  const shift = (i, d) => { const j = i + d; if (j < 0 || j >= show.slots.length) return; [show.slots[i], show.slots[j]] = [show.slots[j], show.slots[i]]; touch(show); renderShow(); redraw(); };
  (show.slots || []).forEach((s, i) => slots.append(h('tr', {},
    h('td', {}, textInput(s, 'label', redraw, show)), h('td', {}, selectInput(s, 'when', whenOptions.some(([w]) => w === s.when) || !s.when ? [['', '(pick one)'], ...whenOptions] : [[s.when, `${s.when} (never called)`], ...whenOptions], () => renderShow(), show)), h('td', {}, selectInput(s, 'sequence', seqOptions, () => { redraw(); renderShow(); }, show), condEditor(s, null, show)),
    h('td', { class: 'row-actions' }, h('button', { title: 'Try this one earlier', onclick: () => shift(i, -1) }, '▲'), h('button', { title: 'Try this one later', onclick: () => shift(i, 1) }, '▼'), h('button', { onclick: () => { if (s.sequence) { S.slot = s.id; openSlot(show.id, s); } } }, 'Edit'), h('button', { title: 'Remove this slot', onclick: () => { show.slots.splice(i, 1); touch(show); renderShow(); redraw(); } }, '✕')))));
  pane.append(slots, h('button', { onclick: () => { (show.slots = show.slots || []).push({ id: `slot${show.slots.length + 1}`, label: 'New slot', when: whenOptions[0]?.[0] || '', sequence: '' }); touch(show); renderShow(); redraw(); } }, '+ Slot'));
  pane.append(h('h3', {}, 'Sample data'));
  pane.append(h('p', { class: 'hint' }, kind.simulated ? 'A sports show previews a real simulated game, so this is only a fallback.' : 'What the preview fills {tokens} from.'));
  const area = h('textarea', { rows: 14, class: 'wide', style: 'font-family:ui-monospace,Consolas,monospace', value: JSON.stringify(show.samples || {}, null, 2), oninput: (e) => { try { show.samples = JSON.parse(e.target.value); e.target.style.borderColor = ''; touch(show); } catch { e.target.style.borderColor = 'var(--bad)'; } } });
  pane.append(area);
  if (problems.length) pane.append(h('h3', {}, 'Problems'), h('ul', { class: 'problems' }, problems.map((p) => h('li', {}, p))));
}

// ── The storyboard ─────────────────────────────────────────────────────────────────────────────
function renderSample() {
  const sel = $('sample'), show = showNow(), samples = Object.keys(show?.samples || {});
  const sims = kindOf(show).simulated ? momentsNow().map(({ label }, i) => [`sim:${i}`, `${label} (simulated)`]) : [];
  sel.replaceChildren();
  const all = [...sims, ...samples.map((k) => [k, k])];
  if (!all.some(([k]) => k === S.sample)) S.sample = sims.length ? momentFor(seqNow()) : all[0]?.[0] || '';
  for (const [k, label] of all) sel.add(new Option(label, k, false, k === S.sample));
  $('reroll').hidden = !sims.length;
}
function beatCaption(b) {
  return `${FRAMES[b.shot?.frame]?.label || 'Shot'} · ${b.shot?.cam || ''}${b.shot?.move && b.shot.move !== 'none' ? ` · ${MOVES[b.shot.move]?.label || ''}` : ''}`;
}
function renderBoard() {
  const seq = seqNow(), board = $('board');
  board.replaceChildren();
  if (!seq) return;
  seq.beats.forEach((b, i) => {
    const c = h('canvas', { width: 256, height: 144, dataset: { i: String(i) } });
    // a beat whose conditions fail this game is greyed, and a line it can't fill the same
    const live = !!timeline({ beats: [b] }, dataNow(), { cast: castFor(seq), seed: 'studio' }).length;
    board.append(h('div', { class: `beat${i === S.beat ? ' on' : ''}${live ? '' : ' off'}${b.if?.length ? ' if' : ''}`, title: live ? '' : 'Left out of this game', dataset: { i: String(i) }, onclick: () => selectBeat(i) }, c,
      h('div', { class: 'cap' }, `${i + 1}. ${beatCaption(b)}`),
      h('div', { class: 'line', title: (b.say?.lines || []).join('\n') }, b.say?.lines?.[0] ? `${b.say.role ? `${seq.roles?.[b.say.role]?.label || b.say.role}: ` : ''}${b.say.lines[0]}` : `Silent, ${b.hold || 3}s`)));
  });
  board.append(h('button', { class: 'beat add', title: 'Add a beat after the last one', onclick: () => addBeat() }, '+'));
}
function selectBeat(i) {
  S.beat = i;
  document.querySelectorAll('.beat').forEach((b) => b.classList.toggle('on', +b.dataset.i === i));
  player?.pause();
  $('play').textContent = '▶';
  player?.seekBeat(i);
  renderInspector();
}
function addBeat(at = null) {
  const seq = seqNow(), prev = seq.beats[at ?? seq.beats.length - 1];
  const b = { id: uid(seq), shot: { ...(prev?.shot || { cam: Object.keys(setNow()?.cameras || {})[0], frame: 'medium' }), cut: 'cut' }, say: { role: Object.keys(seq.roles || {})[0] || '', lines: [] }, hold: 3, gfx: [] };
  seq.beats.splice((at ?? seq.beats.length - 1) + 1, 0, b);
  touch(seq);
  S.beat = seq.beats.indexOf(b);
  renderBoard(); renderInspector(); refresh();
}

// ── The sequence inspector ─────────────────────────────────────────────────────────────────────
function renderInspector() {
  const seq = seqNow(), box = $('inspector');
  box.replaceChildren();
  if (!seq) return;
  const set = setNow(), b = seq.beats[S.beat];
  const after = () => { refresh(); const c = document.querySelector(`.beat[data-i="${S.beat}"]`); if (c) { c.querySelector('.cap').textContent = `${S.beat + 1}. ${beatCaption(b)}`; } };
  const problems = checkSequence(seq, set);
  if (problems.length) box.append(h('div', { class: 'group' }, h('h4', {}, 'Problems'), h('ul', { class: 'problems' }, problems.map((p) => h('li', {}, p)))));
  if (b) {
    b.shot = b.shot || {};
    const on = Array.isArray(b.shot.on) ? b.shot.on : b.shot.on ? [b.shot.on] : [];
    const subjects = [...Object.keys(seq.roles || {}).map((r) => [r, seq.roles[r].label || r]), ...Object.keys(set?.marks || {}).filter((m) => !(seq.roles || {})[m] && !Object.values(seq.roles || {}).some((r) => r.mark === m)).map((m) => [m, `Mark: ${set.marks[m].label || m}`])];
    box.append(h('div', { class: 'group' }, h('h4', {}, `Beat ${S.beat + 1}`, h('span', { class: 'row-actions' },
      h('button', { title: 'Move earlier', onclick: () => moveBeat(-1) }, '◀'), h('button', { title: 'Move later', onclick: () => moveBeat(1) }, '▶'),
      h('button', { title: 'Duplicate', onclick: () => { const c = structuredClone(b); c.id = uid(seq); seq.beats.splice(S.beat + 1, 0, c); S.beat++; touch(seq); renderBoard(); renderInspector(); refresh(); } }, '⧉'),
      h('button', { title: 'Delete this beat', onclick: () => { if (seq.beats.length < 2) return; seq.beats.splice(S.beat, 1); S.beat = Math.max(0, S.beat - 1); touch(seq); renderBoard(); renderInspector(); refresh(); } }, '✕'))),
    h('div', { class: 'two' },
      field('Camera', selectInput(b.shot, 'cam', Object.entries(set?.cameras || {}).map(([k, c]) => [k, c.label || k]), after, seq)),
      field('Framing', selectInput(b.shot, 'frame', Object.entries(FRAMES).map(([k, v]) => [k, v.label]), after, seq)),
      field('Move', selectInput(b.shot, 'move', Object.entries(MOVES).map(([k, v]) => [k, v.label]), after, seq)),
      field('Cut in', selectInput(b.shot, 'cut', Object.entries(CUTS).map(([k, v]) => [k, v.label]), after, seq))),
    field('On', h('div', {}, subjects.map(([k, label]) => h('label', { style: 'margin-right:8px;white-space:nowrap' }, h('input', { type: 'checkbox', checked: on.includes(k), onchange: (e) => { const cur = new Set(Array.isArray(b.shot.on) ? b.shot.on : b.shot.on ? [b.shot.on] : []); if (e.target.checked) cur.add(k); else cur.delete(k); b.shot.on = [...cur]; touch(seq); after(); } }), ` ${label}`))))));

    b.say = b.say || { role: '', lines: [] };
    box.append(h('div', { class: 'group' }, h('h4', {}, 'Line'),
      field('Who speaks', selectInput(b.say, 'role', [['', 'Nobody, or off camera'], ...Object.keys(seq.roles || {}).map((r) => [r, seq.roles[r].label || r])], after, seq)),
      field('What they say. One line each: a broadcast picks one', linesInput(b.say, 'lines', () => { after(); renderBoardLine(b); }, seq, 4)),
      field('Silent beat lasts (s)', numberInput(b, 'hold', after, seq))));

    const conds = () => { after(); renderBoard(); };
    box.append(h('div', { class: 'group' }, h('h4', {}, 'Plays when'), h('p', { class: 'hint' }, 'Leave it empty and this beat always plays.'), condEditor(b, conds, seq)));

    box.append(h('div', { class: 'group' }, h('h4', {}, 'People'),
      Object.keys(seq.roles || {}).map((r) => field(seq.roles[r].label || r, selectInput(b.act = b.act || {}, r, Object.entries(ACTS), after, seq)))));

    box.append(h('div', { class: 'group' }, h('h4', {}, 'Set\'s screen'),
      h('div', { class: 'two' }, field('Shows', selectInput(b, 'wall', [['', 'As before'], ['brand', 'Title'], ['feed', 'The live programme'], ['list', 'A list']], () => { after(); renderInspector(); }, seq)), field('Title', textInput(b, 'wallText', after, seq))),
      b.wall === 'list' ? h('div', { class: 'two' }, field('One row for each', selectInput(b, 'wallList', [['', '(pick one)'], ...listPaths(dataNow()).map((k) => [k, k])], after, seq)), field('Each row', textInput(b, 'wallRow', after, seq))) : null));

    b.gfx = b.gfx || [];
    const gfx = h('div', { class: 'group' }, h('h4', {}, 'Graphics'));
    b.gfx.forEach((g, i) => {
      const row = GFX[g.kind];
      gfx.append(h('div', { class: 'gfx-card' }, h('header', {}, `${row?.icon || ''} ${row?.label || g.kind}`, h('button', { title: 'Remove', onclick: () => { b.gfx.splice(i, 1); touch(seq); renderInspector(); refresh(); } }, '✕')),
        (row?.fields || []).map((f) => gfxField(f, g, set, after, seq)), condEditor(g, after, seq)));
    });
    gfx.append(h('div', { class: 'gfx-add' }, Object.entries(GFX).map(([k, row]) => h('button', { title: `Add a ${row.label.toLowerCase()}`, onclick: () => { b.gfx.push({ kind: k, ...structuredClone(row.make) }); touch(seq); renderInspector(); refresh(); } }, `${row.icon} ${row.label}`))));
    box.append(gfx);

    const paths = [...tokenPaths(dataNow()), ...Object.keys(seq.roles || {}).map((r) => `${r}.name`), 'speaker.name'];
    box.append(h('div', { class: 'group' }, h('h4', {}, 'Tokens'), h('p', { class: 'hint' }, 'Click one to put it in the field you were in.'),
      h('div', { class: 'tokens' }, paths.map((p) => h('button', { onclick: () => insertToken(p) }, `{${p}}`)))));
  }
  box.append(h('div', { class: 'group' }, h('h4', {}, 'Sequence'),
    field('Name', textInput(seq, 'name', renderRail, seq)),
    field('Set', selectInput(seq, 'set', docsOf('set').map((s) => [s.id, s.name]), () => { renderInspector(); refresh({ now: true }); }, seq)),
    h('div', { class: 'row-actions' }, h('button', { onclick: () => newSequence(seq) }, 'Copy'), h('button', { onclick: () => removeDoc(seq) }, 'Delete')),
    field('Roles', h('div', {}, Object.keys(seq.roles || {}).map((r) => h('div', { class: 'two' }, textInput(seq.roles[r], 'label', null, seq), selectInput(seq.roles[r], 'mark', Object.entries(set?.marks || {}).map(([k, m]) => [k, m.label || k]), () => refresh(), seq)))))));
}
function renderBoardLine(b) {
  const seq = seqNow(), el = document.querySelector(`.beat[data-i="${S.beat}"] .line`);
  if (el) el.textContent = b.say?.lines?.[0] ? `${b.say.role ? `${seq.roles?.[b.say.role]?.label || b.say.role}: ` : ''}${b.say.lines[0]}` : `Silent, ${b.hold || 3}s`;
}
function moveBeat(d) {
  const seq = seqNow(), j = S.beat + d;
  if (j < 0 || j >= seq.beats.length) return;
  [seq.beats[S.beat], seq.beats[j]] = [seq.beats[j], seq.beats[S.beat]];
  S.beat = j; touch(seq); renderBoard(); renderInspector(); refresh();
}
function insertToken(p) {
  const el = S.lastField;
  if (!el || !document.body.contains(el)) { status('Click into a text field first'); return; }
  const at = el.selectionStart ?? el.value.length, tok = `{${p}}`;
  el.setRangeText(tok, at, el.selectionEnd ?? at, 'end');
  el.dispatchEvent(new Event('input'));
  el.focus();
}
async function removeDoc(doc) {
  if (!confirm(`Delete ${doc.name}? This removes its file.`)) return;
  S.docs.delete(doc.id); S.dirty.delete(doc.id);
  await fetch(`/api/doc?id=${encodeURIComponent(doc.id)}`, { method: 'DELETE' }).catch(() => {});
  if (S.seq === doc.id) S.seq = null;
  goTab('show');
}

// ── The set tab ────────────────────────────────────────────────────────────────────────────────
const PIECE_DRAW_SIZE = { desk_curve: (p) => [p.w || 3.6, 0.8], desk_straight: (p) => [p.w || 2.2, p.depth || 0.8], video_wall: (p) => [p.w || 7, 0.2], sofa: (p) => [p.w || 2, 0.9], armchair: () => [0.9, 0.9], flat: (p) => [p.w || 3, 0.14], light_grid: (p) => [p.w || 8, p.depth || 4], riser: (p) => [(p.r || 3) * 2, (p.r || 3) * 2], table: (p) => [(p.r || 0.45) * 2, (p.r || 0.45) * 2], stairs: (p) => [p.w || 1.2, 1.7] };
function planFrame(set) {
  const c = $('plan'), w = set.room?.w || 10, d = set.room?.d || 8, k = Math.min(c.width / (w + 2), c.height / (d + 3.4));
  // +u is the screen's left through a camera, so the plan runs the same way
  return { c, k, x: (u) => c.width / 2 - u * k, y: (v) => c.height - (v + 2.4) * k, u: (x) => (c.width / 2 - x) / k, v: (y) => (c.height - y) / k - 2.4 };
}
function drawPlan() {
  const set = setNow();
  if (!set) return;
  const f = planFrame(set), g = f.c.getContext('2d');
  g.clearRect(0, 0, f.c.width, f.c.height);
  const w = set.room?.w || 10, d = set.room?.d || 8;
  g.strokeStyle = '#3a4050'; g.lineWidth = 2; g.strokeRect(f.x(w / 2), f.y(d), w * f.k, (d + 2) * f.k);
  g.font = '11px system-ui'; g.textAlign = 'center';
  const on = (kind, id) => S.pick?.kind === kind && S.pick.id === id;
  (set.pieces || []).forEach((p, i) => {
    const [pw, pd] = (PIECE_DRAW_SIZE[p.type] || (() => [0.6, 0.6]))(p);
    const fixed = set.base && !p.part && i < set.pieces.length - (rawSet().pieces || []).length;
    g.fillStyle = on('piece', i) ? 'rgba(232,192,112,0.35)' : fixed ? 'rgba(120,140,170,0.08)' : 'rgba(120,140,170,0.22)';
    g.strokeStyle = on('piece', i) ? '#e8c070' : '#5a6478';
    g.fillRect(f.x(p.at[0] + pw / 2), f.y(p.at[1] + pd / 2), pw * f.k, pd * f.k);
    g.strokeRect(f.x(p.at[0] + pw / 2), f.y(p.at[1] + pd / 2), pw * f.k, pd * f.k);
    g.fillStyle = '#8d94a5'; g.fillText(SET_PIECES[p.type]?.label || p.type, f.x(p.at[0]), f.y(p.at[1]) + 4);
  });
  for (const [id, m] of Object.entries(set.marks || {})) {
    g.fillStyle = on('mark', id) ? '#e8c070' : '#7fd18a';
    g.beginPath(); g.arc(f.x(m.at[0]), f.y(m.at[1]), 7, 0, 7); g.fill();
    g.fillStyle = '#0a0c12'; g.fillText(id[0].toUpperCase(), f.x(m.at[0]), f.y(m.at[1]) + 4);
    g.fillStyle = '#7fd18a'; g.fillText(m.label || id, f.x(m.at[0]), f.y(m.at[1]) - 10);
  }
  for (const [id, c] of Object.entries(set.cameras || {})) {
    const cam = shotCamera(set, null, { cam: id, frame: 'full' }, 0.5, 0), a = cam.yaw, r = 42;
    g.fillStyle = on('camera', id) ? 'rgba(232,192,112,0.2)' : 'rgba(57,160,255,0.14)';
    g.beginPath(); g.moveTo(f.x(c.at[0]), f.y(c.at[1]));
    for (const s of [-0.34, 0.34]) g.lineTo(f.x(c.at[0]) - Math.sin(a + s) * r, f.y(c.at[1]) - Math.cos(a + s) * r);
    g.fill();
    g.fillStyle = on('camera', id) ? '#e8c070' : '#39a0ff';
    g.fillRect(f.x(c.at[0]) - 7, f.y(c.at[1]) - 6, 14, 12);
    g.fillText(c.label || id, f.x(c.at[0]), f.y(c.at[1]) + 20);
  }
}
function hitPlan(set, x, y) {
  const f = planFrame(set), near = (u, v, r) => Math.hypot(f.x(u) - x, f.y(v) - y) < r;
  for (const [id, c] of Object.entries(set.cameras || {})) if (near(c.at[0], c.at[1], 12)) return { kind: 'camera', id, ref: editable('camera', id) };
  for (const [id, m] of Object.entries(set.marks || {})) if (near(m.at[0], m.at[1], 11)) return { kind: 'mark', id, ref: editable('mark', id) };
  const list = set.pieces || [];
  for (let i = list.length - 1; i >= 0; i--) {
    const p = list[i], [pw, pd] = (PIECE_DRAW_SIZE[p.type] || (() => [0.6, 0.6]))(p), u = f.u(x), v = f.v(y);
    if (Math.abs(u - p.at[0]) < pw / 2 && Math.abs(v - p.at[1]) < pd / 2) return { kind: 'piece', id: i, ref: editable('piece', i) };
  }
  return null;
}
function planEvents() {
  const c = $('plan');
  let drag = null;
  const point = (e) => { const r = c.getBoundingClientRect(); return [(e.clientX - r.left) * c.width / r.width, (e.clientY - r.top) * c.height / r.height]; };
  c.addEventListener('pointerdown', (e) => {
    const set = setNow();
    if (!set) return;
    const [x, y] = point(e), hit = hitPlan(set, x, y);
    S.pick = hit ? { kind: hit.kind, id: hit.id } : null;
    drag = hit;
    if (!hit?.ref) drag = null;
    if (drag) c.setPointerCapture(e.pointerId);
    drawPlan(); renderSetInspector();
    if (hit?.kind === 'camera') refresh({ now: true });
  });
  c.addEventListener('pointermove', (e) => {
    if (!drag) return;
    const set = setNow(), f = planFrame(set), [x, y] = point(e), snap = (n) => Math.round(n * 20) / 20;
    drag.ref.at = [snap(f.u(x)), snap(f.v(y))];
    touch(rawSet()); drawPlan(); refresh();
  });
  c.addEventListener('pointerup', () => { drag = null; renderSetInspector(); });
}
function renderSetInspector() {
  const set = rawSet(), view = setNow(), box = $('inspector');
  box.replaceChildren();
  if (!set) return;
  const after = () => { drawPlan(); refresh(); };
  const redo = () => { touch(set); renderSetInspector(); after(); };
  const skin = !!set.base, pick = S.pick;
  if (pick) {
    const g = h('div', { class: 'group' }), obj = editable(pick.kind, pick.id);
    if (pick.kind === 'piece') {
      const vp = view.pieces[pick.id], row = SET_PIECES[vp?.type], nBase = view.pieces.length - (set.pieces || []).length, own = !skin || pick.id >= nBase;
      if (vp) {
        // a skin's part: swap it for another piece, take it out, or put the template's back
        const kill = own ? () => { set.pieces.splice(skin ? pick.id - nBase : pick.id, 1); S.pick = null; redo(); } : vp.part ? () => { (set.parts ||= {})[vp.part] = null; S.pick = null; redo(); } : null;
        g.append(h('h4', {}, `${row?.label || vp.type}${vp.part ? ` · ${vp.part}` : ''}`, kill ? h('button', { title: 'Take it out', onclick: kill }, '✕') : null));
        if (!obj) g.append(h('p', { class: 'hint' }, `Fixed by ${set.base}. Change it there, or give it a part name there so a skin can.`));
        else {
          if (skin && vp.part && !own) {
            const swap = h('select', { onchange: (e) => { const k = e.target.value; if (k === vp.type) return; const o = ((set.parts ||= {})[vp.part] ||= {}); o.type = k; for (const [f, v] of Object.entries(SET_PIECES[k].make)) if (f !== 'at' && !(f in o)) o[f] = structuredClone(v); redo(); } });
            for (const [k, r] of Object.entries(SET_PIECES)) swap.add(new Option(r.label, k, false, k === vp.type));
            g.append(field('This part is a', swap), h('div', { class: 'row-actions' }, h('button', { onclick: () => { delete set.parts[vp.part]; if (!Object.keys(set.parts).length) delete set.parts; redo(); } }, 'Back to the template\'s')));
          } else if (set.template) g.append(field('Part name (what a skin calls it; blank keeps it fixed)', textInput(obj, 'part', null, set)));
          for (const f of row?.fields || []) g.append(f.type === 'number' ? field(f.label, numberInput(obj, f.k, after, set)) : field(f.label, textInput(obj, f.k, after, set)));
        }
      }
    } else if (pick.kind === 'mark' && obj) {
      g.append(h('h4', {}, `Mark ${pick.id}`, h('button', { onclick: () => { if (skin) (set.marks ||= {})[pick.id] = null; else delete set.marks[pick.id]; S.pick = null; redo(); } }, '✕')),
        field('Label', textInput(obj, 'label', after, set)), h('div', { class: 'two' }, field('Facing (°)', numberInput(obj, 'yaw', after, set, 5)), field('Pose', selectInput(obj, 'pose', [['sit', 'Sitting'], ['stand', 'Standing']], after, set))),
        // a talk show's host walks here for the monologue and back to his seat after it (sequence-player.js liveBlock)
        h('label', { class: 'field' }, h('input', { type: 'checkbox', checked: !!obj.standup, onchange: (e) => { if (e.target.checked) obj.standup = true; else delete obj.standup; touch(set); after(); } }), ' Stand-up spot: the host does the monologue here, not a seat'));
    } else if (obj) {
      g.append(h('h4', {}, `Camera ${pick.id}`, h('button', { onclick: () => { if (skin) (set.cameras ||= {})[pick.id] = null; else delete set.cameras[pick.id]; S.pick = null; redo(); } }, '✕')),
        field('Label', textInput(obj, 'label', after, set)), field('Height (m)', numberInput(obj, 'h', after, set)));
    }
    box.append(g);
  }
  const add = h('select', { onchange: (e) => { const k = e.target.value; e.target.value = ''; if (!k) return; (set.pieces = set.pieces || []).push({ type: k, ...structuredClone(SET_PIECES[k].make), at: [0, (view.room?.d || 8) / 2] }); S.pick = { kind: 'piece', id: setNow().pieces.length - 1 }; redo(); } });
  add.add(new Option('Add a piece…', ''));
  for (const [k, row] of Object.entries(SET_PIECES)) add.add(new Option(row.label, k));
  const letter = (obj, stem) => { let n = 1; while (obj[`${stem}${n}`]) n++; return `${stem}${n}`; };
  box.append(h('div', { class: 'group' }, h('h4', {}, 'Add'), add, h('div', { class: 'row-actions', style: 'margin-top:6px' },
    h('button', { onclick: () => { const id = letter(view.marks || {}, 'm'); (set.marks ||= {})[id] = { at: [0, (view.room?.d || 8) / 2], yaw: 180, pose: 'stand', label: id }; S.pick = { kind: 'mark', id }; redo(); } }, '+ Mark'),
    h('button', { onclick: () => { const id = letter(view.cameras || {}, 'cam'); (set.cameras ||= {})[id] = { at: [0, 0.6], h: 1.5, label: id }; S.pick = { kind: 'camera', id }; redo(); } }, '+ Camera'))));

  // what it's built on, and the network on it
  const templates = docsOf('set').filter((d) => d.template && d.id !== set.id);
  const base = h('select', { onchange: (e) => {
    if (e.target.value) set.base = e.target.value;
    else { const v = setNow(); Object.assign(set, structuredClone({ room: v.room, focus: v.focus, pieces: v.pieces, marks: v.marks, cameras: v.cameras, lamps: v.lamps, ambient: v.ambient, palette: v.palette, brand: v.brand, ...(v.picture ? { picture: v.picture } : {}) })); delete set.base; delete set.parts; }
    S.pick = null; redo();
  } });
  base.add(new Option(skin ? 'Nothing: make it a room of its own' : 'Nothing: a room of its own', '', false, !skin));
  for (const t of templates) base.add(new Option(t.name, t.id, false, set.base === t.id));
  set.brand ||= {};
  const brandColour = h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(view.brand?.colour || '') ? view.brand.colour : '#39a0ff', oninput: (e) => { set.brand.colour = e.target.value; touch(set); refresh(); } });
  const hidden = Object.entries(set.parts || {}).filter(([, v]) => v === null).map(([k]) => k);
  box.append(h('div', { class: 'group' }, h('h4', {}, set.template ? 'Template' : 'Built on'),
    set.template ? h('p', { class: 'hint' }, `A room other sets are built on, never staged itself. Its parts: ${partsOf(view).join(', ') || 'none yet'}.`) : field('Template (a skin changes only what it says)', base),
    field('Network or show name, for {brand.name}', textInput(set.brand, 'name', after, set)),
    h('label', { class: 'field' }, h('span', {}, 'Its colour'), brandColour),
    hidden.length ? h('div', {}, h('p', { class: 'hint' }, 'Taken out:'), hidden.map((k) => h('button', { onclick: () => { delete set.parts[k]; redo(); } }, `+ ${k}`))) : null));

  const uses = h('input', { type: 'text', value: (set.uses || []).join(', '), placeholder: 'talkshow, news, default', oninput: (e) => { set.uses = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); touch(set); } });
  const bcs = h('input', { type: 'text', value: (set.broadcasts || []).join(', '), placeholder: 'bc_the_calm_eye', oninput: (e) => { set.broadcasts = e.target.value.split(',').map((s) => s.trim()).filter(Boolean); if (!set.broadcasts.length) delete set.broadcasts; touch(set); } });
  const room = h('div', { class: 'group' }, h('h4', {}, 'Room'), field('Name', textInput(set, 'name', renderRail, set)));
  if (!set.template) room.append(field('Made for these broadcasts (ids; beats the room and the kind)', bcs), field('Stage for (a text show of these kinds plays here; default is the rest)', uses), field('The room it is (a zone id)', textInput(set, 'zone', null, set)));
  if (skin) room.append(h('p', { class: 'hint' }, `${view.room?.w} × ${view.room?.d} × ${view.room?.h} m, from ${set.base}.`));
  else { set.room ||= {}; room.append(h('div', { class: 'two' }, field('Width', numberInput(set.room, 'w', after, set)), field('Depth', numberInput(set.room, 'd', after, set)), field('Height', numberInput(set.room, 'h', after, set)))); }
  box.append(room);
  set.palette ||= {};
  const colour = (k, label) => h('label', {}, h('input', { type: 'color', value: /^#[0-9a-f]{6}$/i.test(view.palette?.[k] || '') ? view.palette[k] : '#222222', oninput: (e) => { set.palette[k] = e.target.value; touch(set); refresh(); } }), label);
  box.append(h('div', { class: 'group' }, h('h4', {}, 'Colours'), h('div', { class: 'swatches' }, [['floor', 'Floor'], ['wall', 'Walls'], ['trim', 'Trim'], ['accent', 'Light strips'], ['desk', 'Desk'], ['deskTop', 'Desk top'], ['chair', 'Chairs'], ['sofa', 'Sofa'], ['door', 'Door'], ['outside', 'Outside the window'], ['line', 'Floor line']].map(([k, l]) => colour(k, l))),
    h('label', {}, h('input', { type: 'checkbox', checked: view.picture === 'mono', onchange: (e) => { if (e.target.checked) set.picture = 'mono'; else if (skin && view.picture === 'mono' && set.picture !== 'mono') set.picture = 'colour'; else delete set.picture; touch(set); redo(); } }), ' Shot in black and white')));
  const lamps = h('div', { class: 'group' }, h('h4', {}, 'Lamps'));
  if (skin && !set.lamps) lamps.append(h('p', { class: 'hint' }, `Lit as ${set.base} is.`), h('button', { onclick: () => { set.lamps = structuredClone(view.lamps || []); redo(); } }, 'Light it differently'));
  else lamps.append(h('p', { class: 'hint' }, 'Up to six. Across, up, back, then brightness.'), ...(set.lamps || []).map((l, i) => h('div', { class: 'two', style: 'grid-template-columns:1fr 1fr 1fr 1fr 22px' },
    ...[0, 1, 2].map((n) => numberInput(l.p, n, after, set)), numberInput(l, 'k', after, set), h('button', { onclick: () => { set.lamps.splice(i, 1); redo(); } }, '✕'))),
  h('button', { onclick: () => { (set.lamps = set.lamps || []).push({ p: [0, (view.room?.h || 4) - 0.5, (view.room?.d || 8) / 2], k: 1 }); redo(); } }, '+ Lamp'));
  box.append(lamps);
}

// ── Files ──────────────────────────────────────────────────────────────────────────────────────
async function save() {
  const list = [...S.dirty].map((id) => S.docs.get(id)).filter(Boolean);
  for (const doc of list) {
    const r = await fetch('/api/doc', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(doc) });
    if (!r.ok) { status(`Couldn't save ${doc.id}: ${(await r.json().catch(() => ({}))).error || r.status}`, 'bad'); return; }
    S.dirty.delete(doc.id);
  }
  status();
}
// A show takes its sequences and their sets with it, and a skin its template, so the file stands on its own.
function withBase(docs, set) { for (let s = set, n = 0; s && n < 4; s = S.docs.get(s.base), n++) docs.set(s.id, s); }
function bundle() {
  const docs = new Map(), addSeq = (id) => { const q = S.docs.get(id); if (!q) return; docs.set(q.id, q); withBase(docs, S.docs.get(q.set)); };
  if (S.tab === 'show' && showNow()) { const s = showNow(); docs.set(s.id, s); for (const x of s.slots || []) addSeq(x.sequence); return { name: s.id, docs }; }
  if (S.tab === 'set' && setNow()) { withBase(docs, rawSet()); return { name: rawSet().id, docs }; }
  if (seqNow()) { addSeq(seqNow().id); return { name: seqNow().id, docs }; }
  return null;
}
function exportFile() {
  const b = bundle();
  if (!b) { status('Open a show, a sequence or a set first'); return; }
  const blob = new Blob([JSON.stringify({ format: 'thomas-broadcast-package', version: SEQ_FORMAT, docs: [...b.docs.values()] }, null, 1)], { type: 'application/json' });
  const a = h('a', { href: URL.createObjectURL(blob), download: `${b.name}.broadcast.json` });
  a.click();
  URL.revokeObjectURL(a.href);
}
async function importFile(file) {
  let pack;
  try { pack = JSON.parse(await file.text()); } catch { status(`${file.name} isn't JSON`, 'bad'); return; }
  const docs = pack?.format === 'thomas-broadcast-package' ? pack.docs : pack?.kind ? [pack] : null;
  if (!docs?.length) { status(`${file.name} isn't a Broadcast Studio file`, 'bad'); return; }
  const clash = docs.filter((d) => S.docs.has(d.id)).map((d) => d.id);
  if (clash.length && !confirm(`This replaces ${clash.join(', ')}. Go ahead?`)) return;
  for (const d of docs) addDoc(d);
  renderRail();
  status(`${docs.length} imported. Save to keep them.`);
}

// ── Boot ───────────────────────────────────────────────────────────────────────────────────────
for (const b of document.querySelectorAll('#tabs button')) b.addEventListener('click', () => goTab(b.dataset.tab));
$('save').addEventListener('click', save);
$('export').addEventListener('click', exportFile);
$('import').addEventListener('change', (e) => { if (e.target.files[0]) importFile(e.target.files[0]); e.target.value = ''; });
$('play').addEventListener('click', () => {
  if (!player) return;
  if (player.playing) { player.pause(); window.AudioEngine?.cancelSpeech?.(); $('play').textContent = '▶'; } else { player.play(); $('play').textContent = '⏸'; }
});
$('prev').addEventListener('click', () => { if (S.beat > 0) selectBeat(S.beat - 1); });
$('next').addEventListener('click', () => { const n = seqNow()?.beats.length || 0; if (S.beat < n - 1) selectBeat(S.beat + 1); });
$('scrub').addEventListener('input', (e) => { player?.pause(); player?.seek(+e.target.value / 1000 * (player?.length || 0)); });
const reData = () => simulate().then(() => { player?.setData(dataNow()); renderBoard(); renderInspector(); queueThumbs(); });
$('sample').addEventListener('change', (e) => { S.sample = e.target.value; reData(); });
$('reroll').addEventListener('click', () => { S.seed = (S.seed % 9999) + 1; status(`Game ${S.seed}`); reData(); });
document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 's') { e.preventDefault(); save(); return; }
  if (/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || '') || S.tab !== 'sequence') return;
  if (e.key === ' ') { e.preventDefault(); $('play').click(); }
  if (e.key === 'ArrowLeft') $('prev').click();
  if (e.key === 'ArrowRight') $('next').click();
});
window.addEventListener('beforeunload', (e) => { if (S.dirty.size) { e.preventDefault(); e.returnValue = ''; } });
planEvents();

const [docs, npcs, bcs, scripts] = await Promise.all(['/api/docs', '/api/npcs', '/api/broadcasts', '/api/scripts'].map((u) => fetch(u).then((r) => r.json())));
for (const d of docs.docs) S.docs.set(d.id, d);
S.npcs = npcs.npcs; S.broadcasts = bcs.broadcasts; S.scripts = scripts.scripts;
const first = docsOf('show')[0];
if (first) S.show = first.id;
goTab('show');
status();
window.__studio = { S, get player() { return player; }, timeline, timelineLength };
