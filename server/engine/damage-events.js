// Damage-event substrate (docs/proposals/injury-system.md, Phase 1).
//
// Combat already knows three things at the moment of impact that it currently
// throws away: WHICH body part was struck, WHAT damage type landed, and whether
// it was a crit. Every one of those is computed, used for one line of prose or
// one soak lookup, and discarded. This publishes them.
//
// Systems that care about where a player got hit — injuries first, but equally
// a gore/scarring layer, an armour-coverage tutorializer, or a medical-log
// feature — register an observer and never touch combat.js.
//
//   registerDamageObserver((player, hit) => { … }, 'injury')
//   hit = { part, damage, type, critical, source }
//
// SYNCHRONOUS AND QUERY-FREE BY CONTRACT, exactly like `wear()` and
// `hygieneOf()` next door. These fire on the combat hot path — every swing of
// every fight, plus environmental strikes and air-to-ground. An observer that
// awaits anything is a bug, and an observer that queries is a worse one:
// accrue in memory and let a tick flush it.
//
// Observers are notified, not consulted. Nothing they return is read, and they
// cannot alter the damage — combat has already resolved by the time this fires.
// That is deliberate: it keeps the seam one-way, so no plugin can silently
// change how much a hit hurts.

const observers = [];

export function registerDamageObserver(observer, owner = 'plugin') {
  if (typeof observer !== 'function') throw new Error('registerDamageObserver: function required');
  observers.push({ observer, owner });
}

// An observer that throws is logged and skipped — a broken injury plugin must
// never be able to swallow a hit or break a fight in progress.
export function fireDamageToPlayer(player, hit) {
  if (!observers.length || !player) return;
  for (const { observer, owner } of observers) {
    try {
      observer(player, hit);
    } catch (e) {
      console.error(`[damage-events:${owner}] observer error: ${e.message}`);
    }
  }
}

export function getRegisteredDamageObservers() { return observers.map(o => o.owner); }

// ── The enemy side (injury-system.md §8b) ────────────────────────────────────
//
// A separate list, not a flag on the same one, because the two sides are
// genuinely different: a player is a persistent row and an enemy instance is a
// disposable object that stops existing when it dies. Anything listening here
// must keep its state ON the instance and expect to lose it — that is the whole
// reason enemy wounds are affordable.
//
// Same contract as above: SYNC, query-free, notified rather than consulted.
const enemyObservers = [];

export function registerEnemyDamageObserver(observer, owner = 'plugin') {
  if (typeof observer !== 'function') throw new Error('registerEnemyDamageObserver: function required');
  enemyObservers.push({ observer, owner });
}

export function fireDamageToEnemy(enemy, hit) {
  if (!enemyObservers.length || !enemy) return;
  for (const { observer, owner } of enemyObservers) {
    try {
      observer(enemy, hit);
    } catch (e) {
      console.error(`[damage-events:${owner}] enemy observer error: ${e.message}`);
    }
  }
}

export function getRegisteredEnemyDamageObservers() { return enemyObservers.map(o => o.owner); }

// Multi-component attacks (an enemy swinging 1–2 kinetic + 2–3 energy) have no
// single damage type. Pick the one that actually did the work: the component
// contributing the most AFTER its own soak, so a type the player's armour shrugs
// off doesn't get credit for the wound it didn't cause.
//
// Ties resolve to the first component, which is arbitrary and invisible — the
// even-split case is rare and the two types would tell nearly the same story.
export function dominantDamageType(contributions) {
  let best = null;
  let bestAmt = -1;
  for (const c of contributions || []) {
    if (c && c.amount > bestAmt) { bestAmt = c.amount; best = c.type; }
  }
  return best || 'kinetic';
}
