// The client's setup, following the account.
//
// Macros got this first (`player_macros`, smartbar-macros.js) and everything else
// the client stores had exactly the same problem: set up your triggers, log in on
// a laptop, and every one of them is gone. This is the general version — one
// place that owns the arrival rule, with each store registering itself.
//
// ⚠ THE CONFLICT RULE LIVES HERE ONCE. Six stores each implementing
// last-writer-wins is six chances to get the empty-list case wrong, and getting
// it wrong means silently resurrecting things the player deleted. Nothing outside
// this file compares a stamp.
//
// Deliberately NOT synced: the smartbar's drag order (a layout preference for one
// screen, covering buttons that are not macros) and everything in
// `client/shared/settings.js` (volume, theme, display density — per-device by
// nature; a phone and a desktop should not agree about volume).
// ⚠ No import of net.js. The transport is injected (`setConfigTransport`, called
// from main.js), which keeps this module free of the socket — and therefore
// loadable in Node, which is what lets the smoke test the arrival rule directly.
// net.js imports `/shared/ws.js`, a browser-absolute path Node cannot resolve, so
// importing it here would have taken every module that touches config offline.
let _send = () => {};
export function setConfigTransport(fn) { _send = typeof fn === 'function' ? fn : () => {}; }

const STAMP_PREFIX = 'architect_cfg_at_';
const PUSH_DEBOUNCE_MS = 800;

// key → { load, replace, onArrive }
const _providers = new Map();
const _timers = new Map();

/**
 * Register a store. `key` must be on the server's allowlist (server/index.js
 * CLIENT_CONFIG_KEYS) or its pushes are refused and it will never sync — the
 * refusal is silent by design, so a key added here and not there fails quietly.
 *
 * @param {string} key
 * @param {{load: () => any, replace: (payload:any) => void, onArrive?: () => void}} provider
 */
export function registerConfig(key, provider) {
  _providers.set(key, provider);
}

function localStamp(key) {
  return Number(localStorage.getItem(STAMP_PREFIX + key) || 0);
}

function setLocalStamp(key, stamp) {
  try { localStorage.setItem(STAMP_PREFIX + key, String(stamp)); } catch { /* quota */ }
}

// Called by a store after it writes locally. Debounced: an editor that saves on
// every field commit should not be a write per keystroke.
export function markConfigDirty(key) {
  if (!_providers.has(key)) return;
  setLocalStamp(key, Math.floor(Date.now() / 1000));
  clearTimeout(_timers.get(key));
  _timers.set(key, setTimeout(() => {
    const provider = _providers.get(key);
    if (provider) _send({ type: 'config_push', key, payload: provider.load() });
  }, PUSH_DEBOUNCE_MS));
}

export function pullConfig() { _send({ type: 'config_pull' }); }

/**
 * The server's answer. Three arrival states per key, and the third is the one
 * that has to be got right — it is the same rule macros use, and the reason it is
 * written once here rather than six times:
 *
 *   • never synced (no row)        → push what is local. The MIGRATION case:
 *     everybody already using triggers has them in a browser only.
 *   • local stamp is newer         → push. An edit made offline is not garbage.
 *   • otherwise                    → adopt, INCLUDING an empty list.
 *
 * ⚠ The test is the STAMP, never the payload's length. An empty list from a
 * server that HAS a row is a deletion — somebody cleared their triggers on
 * another device — and reading it as "nothing up there yet" pushes the local copy
 * back and resurrects every one of them, on every login, forever.
 */
export function receiveConfig(config) {
  const incoming = (config && typeof config === 'object') ? config : {};
  for (const [key, provider] of _providers) {
    const row = incoming[key];
    const stamp = Number(row?.updatedAt) || 0;
    if (!stamp) {
      const local = provider.load();
      if (hasContent(local)) markConfigDirty(key);
      continue;
    }
    if (localStamp(key) > stamp) { markConfigDirty(key); continue; }
    // Adopt. Stamped with the SERVER's time, not `now` — stamping an adoption
    // with the current clock makes every login look like a local edit and lets a
    // stale device win the next comparison.
    try { provider.replace(row.payload); } catch { continue; }
    setLocalStamp(key, stamp);
    provider.onArrive?.();
  }
}

// An empty array and an empty object both mean "nothing to migrate". A store that
// has never been touched must not push, or it would claim the key and stamp it,
// and a device that DOES have rules would then be told to adopt emptiness.
function hasContent(v) {
  if (Array.isArray(v)) return v.length > 0;
  if (v && typeof v === 'object') return Object.keys(v).length > 0;
  return false;
}
