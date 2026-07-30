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
export function registerStatusEffect({ name, label, onTick, acuity = null, stats = null }) {
  if (!name || typeof onTick !== 'function') throw new Error('registerStatusEffect: name and onTick required');
  registry.set(name, { label, onTick, acuity, stats });
}

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
});

registerStatusEffect({
  name: 'burning',
  label: 'Burning',
  onTick(player) {
    player.hp = Math.max(0, player.hp - 5);
    return 'You are on fire. (-5 HP)';
  },
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

// Apply (or refresh) a timed status effect on a player.
export function applyEffect(player, name, duration) {
  if (!player.statuses) player.statuses = [];
  const existing = player.statuses.find(s => s.name === name);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
  } else {
    // A fresh bout starts its own budget — the HP cap is per illness, not per
    // lifetime, and the episode clock restarts so the first one isn't instant.
    if (name === 'food_poisoning') { player._foodPoisonHp = 0; player._foodPoisonTick = 0; }
    player.statuses.push({ name, duration });
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
