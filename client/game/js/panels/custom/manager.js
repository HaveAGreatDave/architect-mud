// Orchestrates custom sidebar panels: builds their DOM sections, mounts them into
// the existing sidebar layout engine, keeps per-instance data caches, and batches
// the server data each panel needs (snapshots + camera subscriptions).
import { state } from '../../state.js';
import { sendRaw } from '../../net.js';
import { mountSection, unmountSection, collapseSection, isSectionCollapsed } from '../sidebar-order.js';
import { loadPanels, addPanel, updatePanel, removePanel, sectionId } from './store.js';
import { PANEL_TYPES } from './registry.js';
import { esc } from './catalogs.js';

let instances = [];
const snapshotData = {}; // snapshot field key -> value (skills, factions, inv_count, …)
const feeds = {};        // camera id -> { status, frame, label }
let cameras = [];        // catalog of cams the player may pin (for the builder)
let skillsCatalog = [];  // catalog of skills (for the Skills panel's sub-picker)

function buildSection(instance) {
  const type = PANEL_TYPES[instance.type];
  const el = document.createElement('div');
  el.className = 'sidebar-section cpanel-section' + (instance.accordion ? ' cpanel-accordion' : '');
  el.id = sectionId(instance.instanceId);
  // Accordion panels toggle by header click (any time), so they use a static
  // caret instead of the edit-mode-only collapse button.
  const caret = instance.accordion ? '<span class="cpanel-caret">▸</span>' : '';
  const collapseBtn = instance.accordion ? '' : '<button class="sidebar-collapse-btn" title="Collapse panel">▾</button>';
  el.innerHTML =
    `<div class="sidebar-label sidebar-label-collapsible">` +
      `<span class="cpanel-head">${caret}<span class="cpanel-title">${type?.icon || '▪'} ${esc(instance.title)}</span></span>` +
      `<span class="cpanel-controls">` +
        `<button class="cpanel-gear" title="Configure panel">⚙</button>` +
        `<button class="cpanel-remove" title="Remove panel">✕</button>` +
        collapseBtn +
      `</span>` +
    `</div>` +
    `<div class="cpanel-body"></div>`;
  el.querySelector('.cpanel-remove').addEventListener('click', e => { e.stopPropagation(); removeOne(instance.instanceId); });
  el.querySelector('.cpanel-gear').addEventListener('click', e => {
    e.stopPropagation();
    import('./builder.js').then(m => m.openPanelConfig(instance.instanceId));
  });
  if (instance.accordion) {
    el.querySelector('.sidebar-label').addEventListener('click', e => {
      if (e.target.closest('.cpanel-gear, .cpanel-remove')) return;
      toggleAccordion(el);
    });
  }
  return el;
}

// Accordion expand: collapse every other currently-open section (remembering
// which ones), then open this. Collapse: close this and re-open exactly the
// sections this panel pushed aside.
function toggleAccordion(el) {
  if (isSectionCollapsed(el)) {
    const pushed = [];
    document.querySelectorAll('#sidebar .sidebar-section').forEach(sec => {
      if (sec !== el && !isSectionCollapsed(sec)) { pushed.push(sec.id); collapseSection(sec, true); }
    });
    el._accordionPushed = pushed;
    collapseSection(el, false);
  } else {
    collapseSection(el, true);
    for (const id of el._accordionPushed || []) {
      const s = document.getElementById(id);
      if (s) collapseSection(s, false);
    }
    el._accordionPushed = null;
  }
}

function renderOne(instance) {
  const el = document.getElementById(sectionId(instance.instanceId));
  if (!el) return;
  const body = el.querySelector('.cpanel-body');
  const type = PANEL_TYPES[instance.type];
  if (!type) { body.innerHTML = '<div class="cpanel-empty">Unknown panel type.</div>'; return; }
  try {
    type.render(body, { config: instance.config || {}, player: state.player || {}, data: snapshotData, feeds, instanceId: instance.instanceId });
  } catch {
    body.innerHTML = '<div class="cpanel-empty">Render error.</div>';
  }
}

// Union of every panel's data requirements, deduped, sent in one shot.
function requestData() {
  const snap = new Set(), watch = new Set();
  for (const inst of instances) {
    const type = PANEL_TYPES[inst.type];
    if (!type) continue;
    const n = type.needs(inst.config || {});
    (n.snapshot || []).forEach(k => snap.add(k));
    (n.watch || []).forEach(k => watch.add(k));
  }
  if (snap.size) sendRaw({ type: 'panel_data', fields: [...snap] });
  sendRaw({ type: 'panel_watch', feeds: [...watch] }); // empty list = watch nothing
}

// Build + inject every saved panel. Called once at boot, BEFORE initSidebarOrder,
// so applyLayout can restore each section's saved position.
export function mountCustomPanels() {
  instances = loadPanels();
  for (const inst of instances) {
    mountSection(buildSection(inst), false);
    renderOne(inst);
    initAccordionState(inst);
  }
}

// Add a brand-new panel at runtime (from the builder).
export function mountOne(instance) {
  instances.push(instance);
  addPanel(instance);
  mountSection(buildSection(instance));
  renderOne(instance);
  initAccordionState(instance);
  requestData();
}

// Accordion panels start collapsed ("open on a click").
function initAccordionState(inst) {
  if (!inst.accordion) return;
  const el = document.getElementById(sectionId(inst.instanceId));
  if (el) collapseSection(el, true);
}

export function removeOne(instanceId) {
  instances = instances.filter(x => x.instanceId !== instanceId);
  removePanel(instanceId);
  unmountSection(sectionId(instanceId));
  requestData();
}

// Apply a config/title edit from the builder. Rebuilds the section in place —
// title, accordion mode, and structure may all have changed — while keeping its
// position, size, and drag wiring via mountSection (which no-ops the re-insert).
export function updateOne(instanceId, patch) {
  const inst = instances.find(x => x.instanceId === instanceId);
  if (!inst) return;
  Object.assign(inst, patch);
  updatePanel(instanceId, patch);
  const oldEl = document.getElementById(sectionId(instanceId));
  if (oldEl) {
    const fresh = buildSection(inst);
    oldEl.replaceWith(fresh);
    mountSection(fresh); // re-wires collapse/resize/drag; id already in DOM so no re-insert
    initAccordionState(inst);
    renderOne(inst);
  }
  requestData();
}

export function getInstance(instanceId) {
  return instances.find(x => x.instanceId === instanceId);
}

// Re-render everything (cheap; reads live state.player). Hooked into updateVitals
// so player-bound derived panels track the built-in vitals bars.
export function refreshCustomPanels() {
  for (const inst of instances) renderOne(inst);
}

// --- server pushes ---

export function onPanelData(msg) {
  Object.assign(snapshotData, msg.values || {});
  refreshCustomPanels();
}

export function onPanelFeed(msg) {
  if (!msg.feed) return;
  feeds[msg.feed] = { status: msg.status, frame: msg.frame, label: msg.label };
  for (const inst of instances) if (inst.type === 'stickycam') renderOne(inst);
}

export function onPanelCatalog(msg) {
  // Skills and cameras arrive as separate panel_catalog pushes; merge, don't clobber.
  if (msg.cameras) cameras = msg.cameras;
  if (msg.skills) skillsCatalog = msg.skills;
}

export function getCameras() { return cameras; }
export function getSkillsCatalog() { return skillsCatalog; }

// Called after auth: request the data the mounted panels need + the cam catalog.
export function syncPanels() {
  requestData();
  sendRaw({ type: 'panel_catalog' });
}
