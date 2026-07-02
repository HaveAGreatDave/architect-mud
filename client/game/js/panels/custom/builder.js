// Add/configure UI for custom panels: the "＋ panel" catalog and the per-type
// config form. The form is driven by each type's configSchema, so a new panel
// type needs no builder changes unless it introduces a new control kind.
import { PANEL_TYPES, PRESETS } from './registry.js';
import { FIELD_CATALOG, FIELD_BY_KEY, WIDGET_CATALOG, compatibleWidgets, esc } from './catalogs.js';
import { genId } from './store.js';
import { mountOne, updateOne, getInstance, getCameras } from './manager.js';

export function initCustomPanelButton() {
  document.getElementById('sidebar-add-panel')?.addEventListener('click', openPanelCatalog);
}

// --- catalog ("＋ panel") ---

export function openPanelCatalog() {
  const items = [
    ...Object.values(PANEL_TYPES).map(t => ({ kind: 'type', typeId: t.id, icon: t.icon, title: t.title, description: t.description })),
    ...PRESETS.map(p => ({ kind: 'preset', preset: p, icon: p.icon, title: p.title, description: p.description })),
  ];
  const grid = document.createElement('div');
  grid.className = 'cpanel-catalog';
  grid.innerHTML = items.map((it, idx) =>
    `<button type="button" class="cpanel-catalog-item" data-idx="${idx}">` +
      `<span class="cpanel-catalog-icon">${it.icon}</span>` +
      `<span class="cpanel-catalog-title">${esc(it.title)}</span>` +
      `<span class="cpanel-catalog-desc">${esc(it.description)}</span>` +
    `</button>`
  ).join('');
  const ov = openModal('Add a panel', grid, null);
  grid.querySelectorAll('.cpanel-catalog-item').forEach(btn => {
    btn.addEventListener('click', () => {
      const it = items[+btn.dataset.idx];
      closeModal(ov);
      if (it.kind === 'preset') {
        mountOne({ instanceId: genId(), type: it.preset.type, title: it.preset.title, config: { ...it.preset.config } });
      } else {
        const type = PANEL_TYPES[it.typeId];
        if (type.configSchema.length) openConfigForm(it.typeId, null);
        else mountOne({ instanceId: genId(), type: it.typeId, title: type.defaultTitle({}), config: {} });
      }
    });
  });
}

// --- config form (create or edit) ---

export function openPanelConfig(instanceId) {
  const inst = getInstance(instanceId);
  if (inst) openConfigForm(inst.type, inst);
}

function openConfigForm(typeId, existing) {
  const type = PANEL_TYPES[typeId];
  const config = existing ? { ...existing.config } : {};
  const form = document.createElement('div');
  form.className = 'cpanel-form';

  const titleWrap = document.createElement('label');
  titleWrap.className = 'cpanel-field';
  titleWrap.innerHTML = '<span class="cpanel-field-label">Title</span>';
  const titleInput = document.createElement('input');
  titleInput.type = 'text';
  titleInput.className = 'cpanel-input';
  titleInput.value = existing ? existing.title : type.defaultTitle(config);
  titleWrap.appendChild(titleInput);
  form.appendChild(titleWrap);

  const controls = {}; // key -> () => partial config object
  for (const field of type.configSchema) {
    if (field.type === 'fields') buildFieldsControl(form, config, controls);
    else if (field.type === 'widget') buildWidgetControl(form, config, controls);
    else if (field.type === 'cameras') buildCamerasControl(form, config, controls);
  }

  openModal(existing ? 'Configure panel' : `Add ${type.title}`, form, () => {
    const newConfig = {};
    for (const k in controls) Object.assign(newConfig, controls[k]());
    const title = titleInput.value.trim() || type.defaultTitle(newConfig);
    if (existing) updateOne(existing.instanceId, { title, config: newConfig });
    else mountOne({ instanceId: genId(), type: typeId, title, config: newConfig });
  });
}

function buildFieldsControl(form, config, controls) {
  const wrap = document.createElement('div');
  wrap.className = 'cpanel-field';
  wrap.innerHTML = '<span class="cpanel-field-label">Fields</span>';
  const box = document.createElement('div');
  box.className = 'cpanel-fieldpick';
  const selected = new Set(config.fields || []);
  const groups = {};
  for (const f of FIELD_CATALOG) (groups[f.group] ||= []).push(f);
  for (const [group, fs] of Object.entries(groups)) {
    const g = document.createElement('div');
    g.className = 'cpanel-fieldgroup';
    g.innerHTML = `<div class="cpanel-fieldgroup-label">${esc(group)}</div>`;
    for (const f of fs) {
      const chip = document.createElement('button');
      chip.type = 'button';
      chip.className = 'cpanel-chip' + (selected.has(f.key) ? ' on' : '');
      chip.textContent = f.label;
      chip.addEventListener('click', () => {
        selected.has(f.key) ? selected.delete(f.key) : selected.add(f.key);
        chip.classList.toggle('on');
        form.dispatchEvent(new CustomEvent('fieldschange'));
      });
      g.appendChild(chip);
    }
    box.appendChild(g);
  }
  wrap.appendChild(box);
  form.appendChild(wrap);
  form._selectedFields = selected; // read by the widget control
  controls.fields = () => ({ fields: [...selected] });
}

function buildWidgetControl(form, config, controls) {
  const wrap = document.createElement('div');
  wrap.className = 'cpanel-field';
  wrap.innerHTML = '<span class="cpanel-field-label">Display</span>';
  const box = document.createElement('div');
  box.className = 'cpanel-widgetpick';
  wrap.appendChild(box);
  form.appendChild(wrap);
  let chosen = config.widget || null;
  const render = () => {
    const selected = form._selectedFields || new Set();
    const valueTypes = [...selected].map(k => FIELD_BY_KEY[k]?.valueType).filter(Boolean);
    const compatible = valueTypes.length ? compatibleWidgets(valueTypes) : Object.keys(WIDGET_CATALOG);
    if (chosen && !compatible.includes(chosen)) chosen = null;
    if (!chosen && compatible.length) chosen = compatible[0];
    box.innerHTML = compatible.length
      ? compatible.map(id => `<button type="button" class="cpanel-chip${id === chosen ? ' on' : ''}" data-w="${id}">${esc(WIDGET_CATALOG[id].label)}</button>`).join('')
      : '<span class="cpanel-empty">These fields can\'t share one widget.</span>';
    box.querySelectorAll('[data-w]').forEach(b => b.addEventListener('click', () => { chosen = b.dataset.w; render(); }));
  };
  render();
  form.addEventListener('fieldschange', render);
  controls.widget = () => ({ widget: chosen });
}

function buildCamerasControl(form, config, controls) {
  const wrap = document.createElement('div');
  wrap.className = 'cpanel-field';
  wrap.innerHTML = '<span class="cpanel-field-label">Cameras</span>';
  const box = document.createElement('div');
  box.className = 'cpanel-fieldpick';
  const selected = new Set(config.cameras || []);
  const cams = getCameras();
  if (!cams.length) box.innerHTML = '<span class="cpanel-empty">No cameras available to you.</span>';
  for (const cam of cams) {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'cpanel-chip' + (selected.has(cam.id) ? ' on' : '');
    chip.textContent = cam.label || cam.id;
    chip.addEventListener('click', () => {
      selected.has(cam.id) ? selected.delete(cam.id) : selected.add(cam.id);
      chip.classList.toggle('on');
    });
    box.appendChild(chip);
  }
  wrap.appendChild(box);
  form.appendChild(wrap);
  controls.cameras = () => ({ cameras: [...selected] });
}

// --- minimal modal ---

function openModal(title, contentEl, onSave) {
  const ov = document.createElement('div');
  ov.className = 'cpanel-modal-overlay';
  const box = document.createElement('div');
  box.className = 'cpanel-modal';

  const head = document.createElement('div');
  head.className = 'cpanel-modal-head';
  head.innerHTML = `<span>${esc(title)}</span>`;
  const x = document.createElement('button');
  x.className = 'cpanel-modal-x';
  x.textContent = '✕';
  x.addEventListener('click', () => closeModal(ov));
  head.appendChild(x);
  box.appendChild(head);

  const body = document.createElement('div');
  body.className = 'cpanel-modal-body';
  body.appendChild(contentEl);
  box.appendChild(body);

  if (onSave) {
    const foot = document.createElement('div');
    foot.className = 'cpanel-modal-foot';
    const cancel = document.createElement('button');
    cancel.className = 'cpanel-modal-cancel';
    cancel.textContent = 'Cancel';
    cancel.addEventListener('click', () => closeModal(ov));
    const save = document.createElement('button');
    save.className = 'cpanel-modal-save';
    save.textContent = 'Save';
    save.addEventListener('click', () => { onSave(); closeModal(ov); });
    foot.append(cancel, save);
    box.appendChild(foot);
  }

  ov.appendChild(box);
  ov.addEventListener('click', e => { if (e.target === ov) closeModal(ov); });
  document.body.appendChild(ov);
  return ov;
}

function closeModal(ov) { ov.remove(); }
