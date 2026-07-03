// Shared helpers for the Dev Log commit history — used by both the API routes
// (which read the synced dev_commits table) and scripts/sync-commits.js (which
// parses git and writes that table). Kept here so the core-seam list and the
// author-key rule can't drift between reader and writer.

// The engine's sensitive substrate — the seams the regression gate cares about.
// A commit touching any of these is flagged "core"; intensity scales with the
// number of lines it changed in these files.
export const CORE_SEAM_FILES = new Set([
  'server/engine/commands/index.js',   // command dispatch pipeline
  'server/engine/plugins.js',          // plugin loader / route+hook registries
  'server/engine/actions.js',          // action registry
  'server/engine/events.js',           // event bus
  'server/engine/specializedActions.js',
  'server/engine/movement-gates.js',   // move gates
  'server/engine/posture.js',          // posture substrate
  'server/engine/exits.js',            // exits accessor
  'server/engine/graph.js',            // script graph runner
  'server/engine/flags.js',            // flag store
  'server/models/schema.js',           // DB schema
]);

export function coreIntensityTier(lines) {
  if (lines <= 0) return 0;
  if (lines <= 40) return 1;   // light
  if (lines <= 200) return 2;  // medium
  return 3;                     // heavy
}

// Stable per-contributor key: lowercased author email, or 'name:<name>' fallback.
export function gitAuthorKey(email, name) {
  const e = (email || '').trim().toLowerCase();
  if (e) return e;
  return 'name:' + (name || '').trim().toLowerCase();
}
