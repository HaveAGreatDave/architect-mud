let token = null;
let currentPanel = 'dashboard';
let _panelClockInterval = null;
let _panelClockTimeout  = null;
let currentRecord = null;
let allRecords = [];
let devRole = null;
let devHandle = null;
let devPlayerId = null;
let stagingEnabled = true;

// Client mirror of server/engine/exits.js — a zone's exit value for a direction
// is a zone-id string for a single exit, or an array of zone-ids when a direction
// holds several (disambiguated at runtime by destination name / SIFT). Every
// dev-panel reader of exits routes through these so the string|array split lives
// in one place. Keep in step with the server helpers.
function exitTargets(exits, dir) {
  const v = (exits || {})[dir];
  if (v == null) return [];
  return Array.isArray(v) ? v.filter(Boolean) : [v];
}
function allExits(exits) {
  const out = [];
  for (const dir of Object.keys(exits || {})) {
    for (const target of exitTargets(exits, dir)) out.push({ dir, target });
  }
  return out;
}
function flatNeighbors(exits) {
  return allExits(exits).map(e => e.target);
}
function addExitTo(exits, dir, target) {
  const cur = exitTargets(exits, dir);
  if (cur.includes(target)) return;
  const next = [...cur, target];
  exits[dir] = next.length === 1 ? next[0] : next;
}
function removeExitFrom(exits, dir, target) {
  const next = exitTargets(exits, dir).filter(t => t !== target);
  if (next.length === 0) delete exits[dir];
  else exits[dir] = next.length === 1 ? next[0] : next;
}

// Entity paths eligible for staging — maps path prefix to entity type label.
