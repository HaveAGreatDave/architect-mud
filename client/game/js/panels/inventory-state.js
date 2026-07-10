// Client-side inventory cache — the non-UI half of what used to live in
// equipment.js (the desktop Inventory/Gear popups, now retired in favour of the
// tablet Gear app). The tablet renders inventory/gear from its own `tabletnav gear`
// fetch; this module only keeps a lightweight mirror of the last `inventory`/`gear`
// server payload so smartbar macros can answer `has`/`lacks` and command markup can
// name the equipped weapon — neither of which should force the tablet open.
import { sendCmdSilent } from '../net.js';

let lastItems = [];
let lastWeight = null;
let lastCapacity = null;
let _invWaiters = [];   // resolvers awaiting the next inventory payload
let _silentPending = 0; // count of in-flight silent refreshes (responses shouldn't open the tablet)

// Fold a fresh inventory/gear payload into the cache and wake anyone awaiting one
// (refreshInventory). Called by the dispatch handlers for `inventory` and `gear`.
export function updateInventoryCache(items, weight, capacity) {
  lastItems = items || [];
  if (weight !== undefined) lastWeight = weight;
  if (capacity !== undefined) lastCapacity = capacity;
  if (_invWaiters.length) { const ws = _invWaiters; _invWaiters = []; for (const r of ws) r(lastItems); }
}

// Read-only snapshot of the last inventory payload (id/name/tags/actions per item).
export function getEquipInventory() { return lastItems; }

export function getEquippedWeaponName() {
  const w = lastItems.find(item => item.is_equipped && item.slot === 'weapon_hand');
  return w?.name || null;
}

// The next inventory response is a silent refresh iff a token is pending — the
// dispatch handler calls this to decide whether to auto-open the tablet Gear app.
export function consumeSilentInventory() {
  if (_silentPending > 0) { _silentPending--; return true; }
  return false;
}

// Silently ask the server for a fresh inventory and resolve once it arrives (or
// after a short timeout, so callers never hang). Used by smartbar macros to make
// `has`/`lacks` reliable without the player having opened any panel — and without
// the response popping the tablet open.
export function refreshInventory() {
  return new Promise((resolve) => {
    _invWaiters.push(resolve);
    _silentPending++;
    sendCmdSilent('inventory');
    setTimeout(() => {
      const i = _invWaiters.indexOf(resolve);
      if (i >= 0) { _invWaiters.splice(i, 1); if (_silentPending > 0) _silentPending--; resolve(lastItems); }
    }, 1500);
  });
}
