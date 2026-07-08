// Tablet OS app registry — split into its own module with no other imports so
// ESM's import-hoisting can't create a temporal-dead-zone bug: index.js imports
// the app modules (quests-app.js etc.) for their registration side effects, and
// those modules import registerTabletApp from here. If `apps`/`registerTabletApp`
// lived in index.js itself, the hoisted app imports would run before index.js's
// own top-level `const apps = []` initialized, throwing "Cannot access 'apps'
// before initialization".
const apps = [];

export function registerTabletApp(appDef) {
  if (!appDef?.id || typeof appDef.buildScreen !== 'function') {
    throw new Error('registerTabletApp requires { id, buildScreen }');
  }
  if (apps.some(a => a.id === appDef.id)) return; // idempotent re-registration guard
  apps.push(appDef);
}

export function getTabletApps() { return apps; }
export function findTabletApp(id) { return apps.find(a => a.id === id); }

// The command tokenizer (server/engine/commands/index.js) lowercases the whole
// input and splits on whitespace before a screenId ever reaches buildScreen —
// so a player-typed/client-sent `tabletnav quests job_board` arrives as the
// literal string 'job_board', never 'Job Board'. Apps compare screenId against
// this normalized form (lowercase, underscores → spaces) instead of an exact
// literal, so multi-word/mixed-case screen names stay reachable from real input.
export function normScreen(s) { return String(s || '').toLowerCase().replace(/_/g, ' ').trim(); }
