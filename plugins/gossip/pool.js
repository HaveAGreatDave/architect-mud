// plugins/gossip/pool.js
//
// The global gossip pool. In-memory and ephemeral — rebuilt on restart, exactly
// like surveillance's crimeLog / wantedRuntime. There is NO NPC-to-NPC travel:
// every NPC in the world recalls from this one shared pool, and locality is
// modelled purely as a recall-time weighting (recency + zone proximity), never
// as literal spreading between NPCs.
//
// Heat decays lazily at recall — no timer walks the pool ageing each item. The
// tick's gc() only prunes items that have gone globally cold and enforces CAP.

const CAP           = 200;                 // hard ceiling; evict globally-coldest over this
const HALF_LIFE_MS  = 30 * 60 * 1000;      // a rumour loses half its heat every 30 min
const MIN_KEEP      = 0.02;                 // below this an item is dead (gc drops it)
const PROX_FLOOR    = 0.15;                 // weight floor for a distant-but-in-reach item

// Per-group caps: at most N live items may share a capGroup; adding past the cap
// evicts the weakest member. Weather is chatty and low-value, so hold it to a few.
const GROUP_CAPS    = { weather: 5 };

let seq = 0;
const items = new Map();                    // id -> item

const rand4 = () => Math.floor(Math.random() * 0x10000).toString(16).padStart(4, '0');

// Static (viewer-independent) weight — recency × credibility. Used by gc/eviction
// so an item is never pruned just because the current viewer happens to be far.
function baseWeight(item, now) {
  const age  = 0.5 ** ((now - item.ts) / HALF_LIFE_MS);
  const cred = item.planted ? item.truth : 1;
  return item.heat * age * cred;
}

// 1.0 in the origin zone; linear falloff to PROX_FLOOR across `reach` hops; below
// the floor once past reach. A 'global' reach (kills, blackouts) is heard anywhere.
function proximity(item, viewerZoneId, distanceFn) {
  if (item.reach === 'global' || !item.zoneId || !viewerZoneId) return 1;
  if (item.zoneId === viewerZoneId) return 1;
  const maxHops = typeof item.reach === 'number' ? item.reach : 3;
  const hops = distanceFn ? distanceFn(viewerZoneId, item.zoneId, maxHops) : 1;
  if (hops == null || hops === Infinity) return PROX_FLOOR * 0.5;
  const t = Math.min(1, hops / Math.max(1, maxHops));
  return 1 - (1 - PROX_FLOOR) * t;
}

export function weight(item, viewerZoneId, distanceFn, now = Date.now()) {
  return baseWeight(item, now) * proximity(item, viewerZoneId, distanceFn);
}

export function addItem(partial) {
  // Coalesce repeated real events (a storm that keeps thundering, an ongoing
  // crime spree) into one item that stays warm — refresh its timestamp/heat
  // instead of piling near-duplicate rows. Planted rumours never coalesce; each
  // is its own claim. The key defaults to template+zone+subject, but callers can
  // override it (weather keys by building/area so it collapses across rooms).
  if (!partial.planted) {
    const key = partial.coalesceKey || `${partial.templateKey}|${partial.zoneId}|${partial.subjectName || ''}`;
    for (const it of items.values()) {
      if (it._ck === key) {
        it.ts = partial.ts ?? Date.now();
        it.heat = Math.max(it.heat, partial.heat ?? it.heat);
        if (partial.vars) it.vars = partial.vars;
        if (partial.lead) it.lead = partial.lead;
        return it;
      }
    }
    partial = { ...partial, _ck: key };
  }
  const id = partial.id || `gsp_${Date.now()}_${rand4()}_${seq++}`;
  const item = {
    id,
    ts:          partial.ts ?? Date.now(),
    category:    partial.category || 'world',
    subjectName: partial.subjectName || '',
    subjectId:   partial.subjectId || null,
    zoneId:      partial.zoneId || null,
    templateKey: partial.templateKey || null,
    vars:        partial.vars || {},
    heat:        partial.heat ?? 0.7,
    reach:       partial.reach ?? 3,
    planted:     !!partial.planted,
    truth:       partial.truth ?? 1,
    lead:        partial.lead || null,
    capGroup:    partial.capGroup || null,
    askOnly:     !!partial.askOnly,   // hidden from ambient; surfaces only when a player asks
    _ck:         partial._ck || null,
  };
  items.set(id, item);
  enforceGroupCap(item.capGroup);
  if (items.size > CAP) evictWeakest();
  return item;
}

// Keep at most GROUP_CAPS[group] live items in a capped group, evicting the
// weakest (coldest) members when a fresh one pushes the count over.
function enforceGroupCap(group) {
  const cap = GROUP_CAPS[group];
  if (!cap) return;
  const now = Date.now();
  let members = [...items.values()].filter(i => i.capGroup === group);
  while (members.length > cap) {
    let weakest = members[0];
    for (const it of members) if (baseWeight(it, now) < baseWeight(weakest, now)) weakest = it;
    items.delete(weakest.id);
    members = members.filter(i => i.id !== weakest.id);
  }
}

// A player seeds a rumour. Believability (truth) is set by the caller from a
// deception check; low-truth rumours weigh less at recall and get hedged in the telling.
export function plant({ text, zoneId, truth = 0.5, subjectName = '', lead = null }) {
  return addItem({
    category: 'rumor', templateKey: 'rumor', vars: { text },
    zoneId, subjectName, heat: 0.75, reach: 2, planted: true, truth, lead,
  });
}

// Return up to n items most worth repeating in viewerZoneId. Weighted-random among
// the strongest handful so different NPCs (and repeat asks) surface variety, not
// always the single hottest item.
export function recall(viewerZoneId, { n = 1, category = null, distanceFn = null, filter = null } = {}) {
  const now = Date.now();
  const scored = [];
  for (const item of items.values()) {
    if (category && item.category !== category) continue;
    if (filter && !filter(item)) continue;
    const w = weight(item, viewerZoneId, distanceFn, now);
    if (w <= MIN_KEEP) continue;
    scored.push({ item, w });
  }
  if (!scored.length) return [];
  scored.sort((a, b) => b.w - a.w);
  const pool = scored.slice(0, Math.max(n, Math.min(5, scored.length)));
  const picks = [];
  while (picks.length < n && pool.length) {
    const total = pool.reduce((s, x) => s + x.w, 0);
    let r = Math.random() * total, i = 0;
    while (i < pool.length - 1 && (r -= pool[i].w) > 0) i++;
    picks.push(pool[i].item);
    pool.splice(i, 1);
  }
  return picks;
}

function evictWeakest() {
  const now = Date.now();
  let weakestId = null, weakest = Infinity;
  for (const item of items.values()) {
    const w = baseWeight(item, now);
    if (w < weakest) { weakest = w; weakestId = item.id; }
  }
  if (weakestId) items.delete(weakestId);
}

// Prune globally-cold items and enforce CAP. Called from the plugin tick.
export function gc(now = Date.now()) {
  for (const [id, item] of items) {
    if (baseWeight(item, now) <= MIN_KEEP) items.delete(id);
  }
  while (items.size > CAP) evictWeakest();
}

export function remove(id) { return items.delete(id); }   // dev-panel delete
export function size()  { return items.size; }
export function all()   { return [...items.values()]; }
export function clear() { items.clear(); }        // test hook / dev-panel clear-all
