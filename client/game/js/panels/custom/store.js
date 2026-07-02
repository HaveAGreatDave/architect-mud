// Persistence for player-defined sidebar panels. localStorage only — the layout
// (position / hidden / collapsed / size) is owned by sidebar-order.js keyed on the
// section id; here we store just the *identity* of each panel: type + config.
//
// Shape: [{ instanceId, type, title, config }, ...]

const PANELS_KEY = 'architect_custom_panels';

export function loadPanels() {
  try { return JSON.parse(localStorage.getItem(PANELS_KEY)) || []; } catch { return []; }
}

function savePanels(list) {
  localStorage.setItem(PANELS_KEY, JSON.stringify(list));
}

export function genId() {
  return 'p' + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
}

// The DOM id of a panel's sidebar section — the bridge to sidebar-order.js.
export function sectionId(instanceId) {
  return 'custom-panel-' + instanceId;
}

export function addPanel(instance) {
  const list = loadPanels();
  list.push(instance);
  savePanels(list);
  return instance;
}

export function updatePanel(instanceId, patch) {
  const list = loadPanels();
  const p = list.find(x => x.instanceId === instanceId);
  if (!p) return null;
  Object.assign(p, patch);
  savePanels(list);
  return p;
}

export function removePanel(instanceId) {
  savePanels(loadPanels().filter(x => x.instanceId !== instanceId));
}
