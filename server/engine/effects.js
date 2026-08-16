// server/engine/effects.js
//
// Unified timed status effect system. Replaces the ad hoc tickStatuses()
// that lived inside combat.js. Effects live in a registry: the engine
// registers its core set below, and plugins add their own via
// registerStatusEffect without touching this file.
//
// Usage:
//   registerStatusEffect({ name: 'poisoned', label: 'Poisoned', onTick(player) { ... } });
//   applyEffect(player, 'bleeding', 10);   // 10 ticks of bleeding
//   const messages = tickEffects(player);  // call once per second tick

// name -> { label, onTick(player) → message | undefined }
const registry = new Map();

// `acuity` is optional: `{ smell: 2, hearing: -1 }`. It's the cheap path for a
// drug, mutation or injury to sharpen or blunt a sense without any plumbing of
// its own — senses.js reads it straight off whatever the player is carrying.
// `stats` is optional: `{ stat_brains: 1 }`. Status effects are where BONUSES
// live — condition.js only ever subtracts, by design — so anything that raises a
// stat registers here and is netted in `effectiveStat`.
// `mob` is optional and is what makes an effect land on an ENEMY as well as a
// player. It is a SEPARATE function from `onTick`, deliberately, for two reasons.
//
// First, most `onTick` bodies write player-shaped fields — stamina, radiation,
// `_foodPoisonHp`, an episode handler that puts vomit on your clothes — and a mob
// has none of those. Duck-typing `onTick` onto an enemy instance would half-work,
// silently, which is worse than not working.
//
// Second, an effect must never write `enemy.hp` itself (see applyStrikeToEnemy in
// combat.js: doing it by hand skips the part roll, the typed soak, the damage
// observers injury hangs off, and the loot/removal path on death). So `mob` does
// not APPLY anything — it returns an INTENT, `{ min, max, damageType, message }`,
// and the caller routes it through the one function allowed to hurt a mob. That
// also keeps this file free of any import from combat.js.
//
// No `mob` means the effect simply does not exist for enemies. That's the same
// call `applyStun` already made for NPCs: better absent than pretend.
export function registerStatusEffect({ name, label, onTick, acuity = null, stats = null, mob = null }) {
  if (!name || typeof onTick !== 'function') throw new Error('registerStatusEffect: name and onTick required');
  if (mob != null && typeof mob !== 'function') throw new Error(`registerStatusEffect(${name}): mob must be a function`);
  registry.set(name, { label, onTick, acuity, stats, mob });
}

// Can this effect be carried by an enemy instance? The gate `rollWeaponStatus`
// checks before applying a weapon's authored `status_chance` to a mob.
export function mobSupportsEffect(name) { return typeof registry.get(name)?.mob === 'function'; }

// Summed stat bonus for one stat across every status a player currently has.
export function effectStatBonus(player, stat) {
  let total = 0;
  for (const s of player?.statuses || []) {
    const b = registry.get(s.name)?.stats;
    if (b && b[stat]) total += Number(b[stat]) || 0;
  }
  return total;
}

// WELL RESTED — the reward for actually sleeping it off, and deliberately worth
// more than the fatigue penalty it replaces. Sleeping is optional; this is what
// makes it worth the five minutes.
registerStatusEffect({
  name: 'rested',
  label: 'Well Rested',
  stats: { stat_brains: 1, stat_cool: 1 },
  onTick: () => undefined,
});

// Summed acuity for one sense across every status a player currently has.
// Lives here rather than in senses.js because the registry is private to this
// module, and a getter is cheaper than exporting the whole map.
export function effectAcuity(player, sense) {
  let total = 0;
  for (const s of player?.statuses || []) {
    const a = registry.get(s.name)?.acuity;
    if (a && a[sense]) total += Number(a[sense]) || 0;
  }
  return total;
}

export function getRegisteredStatusEffects() { return [...registry.keys()]; }

// ── Core effects ─────────────────────────────────────────────────────────────

// What a sharpened sense costs when it walks into something overwhelming. The
// acuity is NEGATIVE and steep: a saturated nose is worse than an ordinary one,
// which is the trade for being better than one the rest of the time. Registered
// here rather than in senses.js so the registry stays the single place statuses
// are declared, and so senses.js keeps no state of its own.
registerStatusEffect({
  name: 'sense_overload',
  label: 'Senses Blown',
  acuity: { smell: -3, hearing: -3, sight: -3, touch: -3 },
  onTick: () => undefined,   // no HP cost — the blindness IS the cost
});

registerStatusEffect({
  name: 'bleeding',
  label: 'Bleeding',
  onTick(player) {
    player.hp = Math.max(0, player.hp - 2);
    return 'You are bleeding. (-2 HP)';
  },
  // Kinetic, so a mob's armour soaks it the way armour soaks anything else — a
  // plated thing bleeds less because there was less of it to open.
  mob: (e) => ({ min: 1, max: 3, damageType: 'kinetic', message: `${e.name} is bleeding badly.` }),
});

registerStatusEffect({
  name: 'burning',
  label: 'Burning',
  onTick(player) {
    player.hp = Math.max(0, player.hp - 5);
    return 'You are on fire. (-5 HP)';
  },
  // `fire` typed, which is the whole point of routing this through the strike
  // path: a thing with fire soak on a part shrugs some of it off, and a thing
  // without one does not.
  //
  // Deliberately SMALL, and much smaller than the player figure above. A weapon
  // that applies this does so on a per-swing roll, and `applyEffect` refreshes
  // rather than stacks — so against anything you are actually fighting the burn
  // is effectively permanent for the length of the fight. At 3-6 a tick that was
  // roughly five times a pistol's sustained damage for free. At 1-3 the flame is
  // what a flame should be: it does not win the fight for you, it means the thing
  // you already hit keeps losing while you deal with something else.
  mob: (e) => ({ min: 1, max: 3, damageType: 'fire', message: `${e.name} is burning.` }),
});

registerStatusEffect({
  name: 'irradiated',
  label: 'Irradiated',
  onTick(player) {
    player.radiation = Math.min(100, (player.radiation || 0) + 2);
    return 'Radiation courses through you. (+2 RAD)';
  },
});

// Suffocation from breathing ash without a sealed mask: drains stamina fast,
// then bites HP once you're winded. Applied by the ashfall hazard in
// gameLoop's resourceTick; lapses shortly after you mask up or get indoors.
registerStatusEffect({
  name: 'choking',
  label: 'Choking',
  onTick(player) {
    const cur = player.stamina ?? (player.stamina_max ?? 100);
    if (cur > 0) {
      player.stamina = Math.max(0, cur - 4);
      return 'You choke on the ash-thick air, gasping for breath. (-4 STA)';
    }
    player.hp = Math.max(0, player.hp - 2);
    return "You can't breathe — the ash is suffocating you. (-2 HP)";
  },
});

// Acid rain on bare skin. Same shape as `choking` — stamina first, HP once
// you're spent — but scaled by how much of you is actually uncovered, so a
// partial rainsuit is worth wearing and a full one is immunity. Applied by the
// acid-rain hazard in gameLoop's resourceTick; it deliberately OUTLASTS shelter
// (you're still coated) until you wash it off. See systems-weather-extreme.md.
registerStatusEffect({
  name: 'corroding',
  label: 'Corroding',
  onTick(player) {
    const exposure = Math.max(0.25, 1 - (player.acidCover || 0));
    const cur = player.stamina ?? (player.stamina_max ?? 100);
    if (cur > 0) {
      const drain = Math.max(1, Math.round(3 * exposure));
      player.stamina = Math.max(0, cur - drain);
      return `The acid eats at your skin and you flinch through it. (-${drain} STA)`;
    }
    const dmg = Math.max(1, Math.round(2 * exposure));
    player.hp = Math.max(0, player.hp - dmg);
    return `The acid is burning through you and you have nothing left to flinch with. (-${dmg} HP)`;
  },
});

// FOOD POISONING.
//
// This was being applied by four separate paths — raw food, spoiled food, meat
// eaten rare, a botched cook — and was never REGISTERED, so for its whole life
// it sat in `player.statuses` counting down and doing nothing at all. Every
// food-safety rule in the cooking system resolved to a no-op.
//
// What it does now is deliberately not "damage". It barely touches your HP,
// capped at FOOD_POISON_HP_CAP of your maximum across the whole illness — it
// will make you wish you were dead, it won't kill you. What it takes is
// STAMINA, continuously and hard, so you can't run, can't fight, and can't get
// anywhere. And every so often it takes your dignity: you are sick, or you don't
// make it to a toilet, and it goes on your clothes and on the floor of whatever
// room you happened to be standing in. Publicly.
const FOOD_POISON_HP_CAP = 0.30;      // total HP it can ever take, as a fraction of max
const FOOD_POISON_HP_TICK = 1;
const FOOD_POISON_STAMINA_TICK = 12;  // the real cost: you are going nowhere
const EPISODE_EVERY = 8;              // ticks between one indignity and the next

const VOMIT_LINES = [
  'It comes up without warning. You get most of it on yourself.',
  'You double over and bring up everything you have eaten today.',
  'Your stomach turns itself inside out. There is nothing dignified about it.',
];
const VOID_LINES = [
  "You don't make it anywhere near a toilet.",
  'Your guts give out entirely. It is very obvious what has happened.',
  'There is no holding it. None at all.',
];

registerStatusEffect({
  name: 'food_poisoning',
  label: 'Food poisoning',
  onTick(player) {
    // Stamina first, and hard — this is what actually stops you doing anything.
    const staMax = player.stamina_max ?? 100;
    player.stamina = Math.max(0, (player.stamina ?? staMax) - FOOD_POISON_STAMINA_TICK);

    // HP, barely, and only up to a hard cap for the whole illness.
    const cap = Math.floor((player.hp_max || 100) * FOOD_POISON_HP_CAP);
    player._foodPoisonHp = player._foodPoisonHp || 0;
    if (player._foodPoisonHp < cap) {
      const bite = Math.min(FOOD_POISON_HP_TICK, cap - player._foodPoisonHp);
      player.hp = Math.max(1, player.hp - bite);   // never the thing that kills you
      player._foodPoisonHp += bite;
    }

    // ...and every so often, an episode. Half of them come up, half go down.
    player._foodPoisonTick = (player._foodPoisonTick || 0) + 1;
    if (player._foodPoisonTick % EPISODE_EVERY !== 0) {
      return 'Your guts churn. You can barely stand. (-STA)';
    }
    const up = player._foodPoisonTick % (EPISODE_EVERY * 2) === 0;
    const lines = up ? VOMIT_LINES : VOID_LINES;
    const line = lines[Math.floor(Math.random() * lines.length)];
    // The room and your clothes both remember it.
    onEpisode?.(player, up ? 'vomit' : 'feces');
    return line;
  },
});

// ── Stunned ──────────────────────────────────────────────────────────────────
//
// The effect two weapons have been authored against since before it existed: the
// ComplyMate taser and the resonant stylus both declare a `status_chance` of
// `stunned`, and there was no such effect, so neither ever did anything.
//
// It carries NO onTick behaviour on purpose. Being stunned means you cannot
// swing, and combat already has a proven way to say that: `dodge` locks the
// attack cooldown, and `cmdAttack` plus all four auto-attack loops then refuse on
// their own with no new guard anywhere in the tick. So the lock is applied once
// at the moment of the stun (see `applyStun` in combat.js) and this registration
// exists to give it a NAME — a label on your status line, and something the
// senses/impairment layers can see. Enforcement and description, kept apart.
registerStatusEffect({
  name: 'stunned',
  label: 'Stunned',
  onTick() { return null; },
});

// Set by the engine at boot (see bodily wiring in index/gameLoop): effects.js
// stays free of world/DB imports, so the messy part is injected rather than
// imported. Absent in a bare unit-test context, which is why it's optional.
let onEpisode = null;
export function setEpisodeHandler(fn) { onEpisode = fn; }

// Apply (or refresh) a timed status effect on a player — or on an enemy instance,
// which carries the same `statuses` array and has since it was first spawned.
//
// `source` is the player id to credit if this effect is what finally kills the
// thing. It is stored, not resolved: the player may log out, walk away or die
// before the fire finishes, and the tick looks them up fresh each time. Refreshing
// an existing effect RE-STAMPS the source — the last person to set you alight owns
// the kill, which is the reading everyone at the table will expect.
export function applyEffect(player, name, duration, { source = null } = {}) {
  if (!player.statuses) player.statuses = [];
  const existing = player.statuses.find(s => s.name === name);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
    if (source) existing.source = source;
  } else {
    // A fresh bout starts its own budget — the HP cap is per illness, not per
    // lifetime, and the episode clock restarts so the first one isn't instant.
    if (name === 'food_poisoning') { player._foodPoisonHp = 0; player._foodPoisonTick = 0; }
    player.statuses.push({ name, duration, source, elapsed: 0 });
  }
}

// Clear a timed status effect outright. Returns whether it was actually on.
// For effects with a deliberate cure — washing acid residue off — rather than
// waiting out a duration.
export function clearEffect(player, name) {
  const before = player.statuses?.length || 0;
  if (!before) return false;
  player.statuses = player.statuses.filter(s => s.name !== name);
  return player.statuses.length !== before;
}

// Display labels for a player's active effects (for the `stats` status line).
export function statusLabels(player) {
  return (player.statuses || []).map(s => registry.get(s.name)?.label).filter(Boolean);
}

// The same, for an enemy instance — but only the effects that MEAN something on a
// mob. An enemy that somehow acquired a player-only status must not advertise it
// on the Hostiles line, because nothing would ever come of it.
export function mobStatusLabels(entity) {
  return (entity?.statuses || [])
    .map(s => registry.get(s.name))
    .filter(def => def && typeof def.mob === 'function')
    .map(def => def.label)
    .filter(Boolean);
}

// Tick an enemy instance's effects. Returns INTENTS — `{ effect, min, max,
// damageType, message, source, speak }` — and applies nothing itself; the caller
// routes each through applyStrikeToEnemy, the one function allowed to move a mob's
// HP. See the note on `mob` in registerStatusEffect for why the split exists.
//
// `speak` is the anti-spam rule, and it lives here rather than in each effect so
// there is one cadence for all of them. Twenty seconds of "The rust hound burns."
// once a second is twenty lines nobody reads; the first tick and every fourth
// after it reads as a thing that is on fire and stays on fire. The Hostiles line
// carries the label continuously, so the state is never only in the scrollback.
const MOB_SPEAK_EVERY = 4;

export function tickMobEffects(entity) {
  const intents = [];
  if (!entity?.statuses?.length) return intents;

  entity.statuses = entity.statuses.filter(s => {
    const def = registry.get(s.name);
    if (def && typeof def.mob === 'function') {
      const intent = def.mob(entity);
      if (intent) {
        s.elapsed = (s.elapsed || 0) + 1;
        intents.push({
          effect: s.name,
          source: s.source || null,
          speak: s.elapsed === 1 || s.elapsed % MOB_SPEAK_EVERY === 0,
          ...intent,
        });
      }
    }
    s.duration--;
    return s.duration > 0;
  });

  return intents;
}

// Tick all active effects. Returns an array of message strings for broadcast.
// Called once per second from the game loop.
export function tickEffects(player) {
  const messages = [];
  if (!player.statuses) return messages;

  player.statuses = player.statuses.filter(s => {
    const def = registry.get(s.name);
    if (def) {
      const msg = def.onTick(player);
      if (msg) messages.push(msg);
    }
    s.duration--;
    return s.duration > 0;
  });

  return messages;
}
