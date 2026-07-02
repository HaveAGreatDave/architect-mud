// Orchestrates custom sidebar panels: builds their DOM sections, mounts them into
// the existing sidebar layout engine, keeps per-instance data caches, and batches
// the server data each panel needs (snapshots + camera subscriptions).
import { state } from '../../state.js';
import { sendRaw } from '../../net.js';
import { mountSection, unmountSection } from '../sidebar-order.js';
import { loadPanels, addPanel, updatePanel, removePanel, sectionId } from './store.js';
import { PANEL_TYPES } from './registry.js';
import { esc } from './catalogs.js';

let instances = [];
const snapshotData = {}; // snapshot field key -> value (skills, factions, inv_count, …)
const feeds = {};        // camera id -> { status, frame, label }
let cameras = [];        // catalog of cams the player may pin (for the builder)

function buildSection(instance) {
  const type = PANEL_TYPES[instance.type];
  const el = document.createElement('div');
  el.className = 'sidebar-section cpanel-section';
  el.id = sectionId(instance.instanceId);
  el.innerHTML =
    `<div class="sidebar-label sidebar-label-collapsible">` +
      `<span class="cpanel-title">${type?.icon || '▪'} ${esc(instance.title)}</span>` +
      `<span class="cpanel-controls">` +
        (type && type.configSchema.length ? `<button class="cpanel-gear" title="Configure panel">⚙</button>` : '') +
        `<button class="cpanel-remove" title="Remove panel">✕</button>` +
        `<button class="sidebar-collapse-btn" title="Collapse panel">▾</button>` +
      `</span>` +
    `</div>` +
    `<div class="cpanel-body"></div>`;
  el.querySelector('.cpanel-remove').addEventListener('click', e => { e.stopPropagation(); removeOne(instance.instanceId); });
  el.querySelector('.cpanel-gear')?.addEventListener('click', e => {
    e.stopPropagation();
    import('./builder.js').then(m => m.openPanelConfig(instance.instanceId));
  });
  return el;
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
  }
}

// Add a brand-new panel at runtime (from the builder).
export function mountOne(instance) {
  instances.push(instance);
  addPanel(instance);
  mountSection(buildSection(instance));
  renderOne(instance);
  requestData();
}

export function removeOne(instanceId) {
  instances = instances.filter(x => x.instanceId !== instanceId);
  removePanel(instanceId);
  unmountSection(sectionId(instanceId));
  requestData();
}

// Apply a config/title edit from the builder.
export function updateOne(instanceId, patch) {
  const inst = instances.find(x => x.instanceId === instanceId);
  if (!inst) return;
  Object.assign(inst, patch);
  updatePanel(instanceId, patch);
  const el = document.getElementById(sectionId(instanceId));
  const titleEl = el?.querySelector('.cpanel-title');
  if (titleEl) titleEl.innerHTML = `${PANEL_TYPES[inst.type]?.icon || '▪'} ${esc(inst.title)}`;
  renderOne(inst);
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
  cameras = msg.cameras || [];
}

export function getCameras() { return cameras; }

// Called after auth: request the data the mounted panels need + the cam catalog.
export function syncPanels() {
  requestData();
  sendRaw({ type: 'panel_catalog' });
}
