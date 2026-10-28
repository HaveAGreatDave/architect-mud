// FOOD LAB: every food as the Kitchen Stage draws it, with its `tags.matter` under sliders.
//
// It runs the game's own renderer and meshes (client/game/js/panels/gl/kitchen.js, kitchen-mesh.js)
// by dynamic import, so what you see here is what the kitchen draws: the same cel light, ink and
// shapes. Pick a food, look at it in the pan, on the counter, cut, or across its five cook beats,
// and change its form, colours and look. Save writes `tags.matter` back to the item row through
// the Items API, holding only what differs from the food's class default
// (client/shared/kitchen-matter.js), so a class change still reaches every food that didn't
// override it. The row reaches content/ by the usual export.
//
// Left-drag orbits, the wheel zooms.

let FL = null;
const FL_VIEWS = [['pan', 'In the pan'], ['counter', 'On the counter'], ['cut', 'Cut'], ['beats', 'Raw to burnt']];
const FL_LOOK_COLOURS = ['skin', 'flesh', 'spots', 'stripes', 'stem', 'fins', 'label'];
const FL_FORM = [['w', 'length', 0.5, 45, 0.1], ['d', 'width', 0.5, 30, 0.1], ['h', 'height', 0.2, 20, 0.1], ['round', 'roundness', 0, 1, 0.05]];

async function flModules() {
  const [KM, M, KS, K, R] = await Promise.all([
    import('/shared/kitchen-matter.js'),
    import('/js/panels/gl/arena-mesh.js'),
    import('/js/panels/gl/kitchen-mesh.js'),
    import('/shared/knife.js'),
    import('/js/panels/gl/kitchen.js'),
  ]);
  return { KM, M, KS, K, R };
}

async function renderFoodLabPanel(items) {
  const panel = document.getElementById('list-panel');
  flStop();
  const foods = (items || []).filter((i) => i.tags?.food_profile).sort((a, b) => a.name.localeCompare(b.name));
  panel.innerHTML = `<div class="fl-root">
    <div class="fl-list">
      <input class="fl-search" type="search" placeholder="Find a food…">
      <div class="fl-foods"></div>
    </div>
    <div class="fl-stage">
      <canvas class="fl-gl"></canvas>
      <div class="fl-views"></div>
      <div class="fl-note"></div>
    </div>
    <div class="fl-edit"></div>
  </div>`;
  let mods;
  try { mods = await flModules(); } catch (e) { panel.innerHTML = `<div class="fl-error">Couldn't load the kitchen renderer: ${esc(e.message)}</div>`; return; }
  const canvas = panel.querySelector('.fl-gl');
  const renderer = mods.R.createKitchenRenderer(canvas);
  if (!renderer) { panel.querySelector('.fl-note').textContent = 'No WebGL2 here, so nothing to draw.'; }
  FL = { ...mods, panel, canvas, renderer, foods, item: null, matter: null, view: 'pan', yaw: -1.2, pitch: 0.55, dist: 55, raf: 0, dirty: false, filter: '' };
  if (renderer) {
    const set = mods.M.createBatch(1 << 14);
    mods.KS.buildSet(set, { hob: 'domestic' });
    renderer.setStatic(set);
  }
  FL.dyn = mods.M.createBatch(1 << 15);
  panel.querySelector('.fl-search').addEventListener('input', (e) => { FL.filter = e.target.value.toLowerCase(); flList(); });
  panel.addEventListener('click', flClick);
  panel.addEventListener('input', flInput);
  flOrbit(canvas);
  flList();
  flViews();
  if (foods[0]) flPick(foods[0].id);
  FL.raf = requestAnimationFrame(flFrame);
}

function flStop() {
  if (!FL) return;
  cancelAnimationFrame(FL.raf);
  FL.renderer?.dispose();
  FL = null;
}

function flList() {
  const box = FL.panel.querySelector('.fl-foods');
  const groups = new Map();
  for (const f of FL.foods) {
    if (FL.filter && !f.name.toLowerCase().includes(FL.filter) && !f.id.includes(FL.filter)) continue;
    const p = f.tags.food_profile;
    if (!groups.has(p)) groups.set(p, []);
    groups.get(p).push(f);
  }
  box.innerHTML = [...groups].sort(([a], [b]) => a.localeCompare(b)).map(([p, list]) => `<div class="fl-group">${esc(p.replace(/_/g, ' '))}</div>`
    + list.map((f) => `<button class="fl-food${FL.item?.id === f.id ? ' on' : ''}" data-food="${esc(f.id)}">${esc(f.name)}${f.tags.matter ? '' : ' <span class="fl-dim">(class)</span>'}</button>`).join('')).join('');
}

function flViews() {
  FL.panel.querySelector('.fl-views').innerHTML = FL_VIEWS.map(([k, l]) => `<button class="fl-view${FL.view === k ? ' on' : ''}" data-view="${k}">${l}</button>`).join('');
}

// The full matter for the item being edited: the class default with its override laid over it.
function flPick(id) {
  if (FL.dirty && !confirm('Drop the unsaved changes to this food?')) return;
  const item = FL.foods.find((f) => f.id === id);
  if (!item) return;
  FL.item = item;
  const m = FL.KM.matterFor(item.tags.food_profile, item.tags.matter);
  FL.matter = { form: { ...m.form }, ramp: { ...m.ramp }, look: { ...(m.look || {}) } };
  FL.dirty = false;
  flList();
  flEdit();
}

const flHex = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v : '#888888');

function flEdit() {
  const m = FL.matter, it = FL.item, look = m.look;
  const slider = (group, [k, label, lo, hi, step]) => `<label class="fl-row"><span>${label}</span>
    <input type="range" min="${lo}" max="${hi}" step="${step}" value="${m[group][k] ?? lo}" data-g="${group}" data-k="${k}">
    <output>${m[group][k] ?? ''}</output></label>`;
  const colour = (group, k, optional) => `<label class="fl-row"><span>${k}</span>
    ${optional ? `<input type="checkbox" data-on="${k}"${look[k] ? ' checked' : ''} title="Use it">` : ''}
    <input type="color" value="${flHex(m[group][k])}" data-g="${group}" data-k="${k}"${optional && !look[k] ? ' disabled' : ''}></label>`;
  FL.panel.querySelector('.fl-edit').innerHTML = `
    <div class="fl-head"><b>${esc(it.name)}</b><span class="fl-dim">${esc(it.id)} · ${esc(it.tags.food_profile)}</span></div>
    <div class="fl-sec">Shape</div>
    <label class="fl-row"><span>kind</span><select data-g="form" data-k="kind">${FL.KM.FORMS.map((k) => `<option${m.form.kind === k ? ' selected' : ''}>${k}</option>`).join('')}</select></label>
    ${FL_FORM.map((s) => slider('form', s)).join('')}
    <div class="fl-sec">Colour by beat</div>
    ${FL.KM.BEATS.map((b) => colour('ramp', b, false)).join('')}
    <div class="fl-sec">Look</div>
    ${FL_LOOK_COLOURS.map((k) => colour('look', k, true)).join('')}
    <label class="fl-row"><span>pack</span><select data-g="look" data-k="pack"><option value="">none</option>${FL.KM.PACKS.map((p) => `<option${look.pack === p ? ' selected' : ''}>${p}</option>`).join('')}</select></label>
    ${slider('look', ['size', 'pack size', 0.3, 2, 0.05])}
    <div class="fl-actions">
      <button class="btn" data-act="save">Save</button>
      <button class="btn btn-secondary" data-act="revert">Revert</button>
      <button class="btn btn-secondary" data-act="class">Use class default</button>
      <button class="btn btn-secondary" data-act="copy">Copy JSON</button>
    </div>
    <pre class="fl-json"></pre>`;
  flJson();
}

// What's saved: only the keys that differ from the class, so the class still speaks for the rest.
function flOverride() {
  const base = FL.KM.MATTER[FL.item.tags.food_profile] || FL.KM.PLAIN, m = FL.matter, out = {};
  const form = {};
  for (const k of ['kind', 'w', 'd', 'h', 'round']) if (m.form[k] !== undefined && m.form[k] !== base.form[k]) form[k] = m.form[k];
  if (Object.keys(form).length) out.form = form;
  const ramp = {};
  for (const b of FL.KM.BEATS) if (m.ramp[b] && m.ramp[b].toLowerCase() !== base.ramp[b].toLowerCase()) ramp[b] = m.ramp[b];
  if (Object.keys(ramp).length) out.ramp = ramp;
  const look = {};
  for (const [k, v] of Object.entries(m.look)) if (v !== undefined && v !== '' && v !== null) look[k] = v;
  if (!look.pack) delete look.size;
  if (Object.keys(look).length) out.look = look;
  return Object.keys(out).length ? out : null;
}
function flJson() {
  const pre = FL.panel.querySelector('.fl-json');
  if (pre) pre.textContent = JSON.stringify(flOverride(), null, 1) || 'null (the class default)';
}

function flInput(e) {
  const t = e.target;
  if (!FL || !t.closest('.fl-edit')) return;
  const m = FL.matter;
  if (t.dataset.on) {
    const k = t.dataset.on, picker = FL.panel.querySelector(`input[type=color][data-k="${k}"][data-g="look"]`);
    picker.disabled = !t.checked;
    if (t.checked) m.look[k] = picker.value; else delete m.look[k];
  } else if (t.dataset.g) {
    const g = t.dataset.g, k = t.dataset.k;
    let v = t.value;
    if (t.type === 'range') { v = Number(v); const o = t.parentElement.querySelector('output'); if (o) o.textContent = v; }
    if (g === 'look' && k === 'pack' && !v) delete m.look.pack;
    else m[g][k] = v;
  } else return;
  FL.dirty = true;
  flJson();
}

async function flClick(e) {
  const t = e.target.closest('button');
  if (!t || !FL) return;
  if (t.dataset.food) return flPick(t.dataset.food);
  if (t.dataset.view) { FL.view = t.dataset.view; flViews(); return; }
  const act = t.dataset.act;
  if (act === 'revert') { FL.dirty = false; return flPick(FL.item.id); }
  if (act === 'class') {
    const base = FL.KM.MATTER[FL.item.tags.food_profile] || FL.KM.PLAIN;
    FL.matter = { form: { ...base.form }, ramp: { ...base.ramp }, look: {} };
    FL.dirty = true;
    return flEdit();
  }
  if (act === 'copy') { try { await navigator.clipboard.writeText(JSON.stringify(flOverride(), null, 2)); toast?.('Copied'); } catch { /* no clipboard */ } return; }
  if (act === 'save') {
    const over = flOverride(), problems = over ? FL.KM.matterProblems(over) : [];
    if (problems.length) return alert(problems.join('\n'));
    const it = FL.item, tags = { ...it.tags };
    if (over) tags.matter = over; else delete tags.matter;
    const r = await API(`/items/${it.id}`, 'PUT', { name: it.name, type: it.type, weight: it.weight, value: it.value, tags });
    if (r?.error) return alert(r.error);
    it.tags = tags;
    FL.dirty = false;
    flList();
    if (typeof toast === 'function') toast(`Saved ${it.name}. Export content to write the file.`);
  }
}

function flOrbit(canvas) {
  let drag = null;
  canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY }; canvas.setPointerCapture(e.pointerId); });
  canvas.addEventListener('pointermove', (e) => {
    if (!drag || !FL) return;
    FL.yaw -= (e.clientX - drag.x) * 0.008;
    FL.pitch = Math.max(0.05, Math.min(1.5, FL.pitch + (e.clientY - drag.y) * 0.006));
    drag = { x: e.clientX, y: e.clientY };
  });
  canvas.addEventListener('pointerup', () => { drag = null; });
  canvas.addEventListener('wheel', (e) => { if (!FL) return; e.preventDefault(); FL.dist = Math.max(40, Math.min(260, FL.dist * (e.deltaY > 0 ? 1.1 : 0.9))); }, { passive: false });
}

// Where the food sits: on the board, the one flat open place on the set.
const FL_AT = [-55, 0, 2.5];

function flFrame() {
  if (!FL) return;
  if (!document.body.contains(FL.canvas)) { flStop(); return; }
  FL.raf = requestAnimationFrame(flFrame);
  if (!FL.renderer || !FL.item) return;
  const { KM, M, KS, K } = FL;
  const m = KM.matterFor(FL.item.tags.food_profile, { form: FL.matter.form, ramp: FL.matter.ramp, look: FL.matter.look });
  m.look = { ...FL.matter.look };
  const whole = K.footprint(m.form), b = M.reset(FL.dyn);
  const at = (dx) => [FL_AT[0] + dx, FL_AT[1], FL_AT[2]];
  let span = Math.max(m.form.w, m.form.d, m.form.h);
  if (FL.view === 'pan') KS.foodPiece(b, m, whole, whole, 'raw', KS.pose(at(0), 0.3), 3);
  else if (FL.view === 'counter') { KS.shelfPiece(b, m, whole, whole, 'raw', KS.pose(at(0), 0.3), 3); span = Math.max(span, m.look.pack ? 24 * (m.look.size || 1) : 0); }
  else if (FL.view === 'cut') {
    if (m.cut.styles.length) {
      const pieces = K.cutPieces(whole, K.balancedGuides(whole, 3).map((g) => ({ at: g, tilt: 0 })));
      pieces.forEach((p, i) => KS.foodPiece(b, m, p, whole, 'raw', KS.pose(at((i - 1) * 1.2), 0), i + 1));
    } else KS.foodPiece(b, m, whole, whole, 'raw', KS.pose(at(0), 0.3), 3);
  } else {
    const gap = Math.max(m.form.w, m.form.d) * 1.25 + 1;
    KM.BEATS.forEach((beat, i) => KS.foodPiece(b, m, whole, whole, beat, KS.pose(at((i - 2) * gap), 0.3), i + 1));
    span = gap * 5;
  }
  const d = Math.max(FL.dist, span * 2.2), aim = [FL_AT[0], FL_AT[1], FL_AT[2] + m.form.h * 0.4];
  const eye = [aim[0] + Math.cos(FL.yaw) * Math.cos(FL.pitch) * d, aim[1] + Math.sin(FL.yaw) * Math.cos(FL.pitch) * d, aim[2] + Math.sin(FL.pitch) * d];
  FL.renderer.render({ eye, at: aim, fov: 0.6, roll: 0 }, b, { shake: [0, 0], flash: 0 });
  FL.panel.querySelector('.fl-note').textContent = `${m.form.w} × ${m.form.d} × ${m.form.h} cm · drag to turn, wheel to zoom`;
}
