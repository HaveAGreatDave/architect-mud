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

export function registerStatusEffect({ name, label, onTick }) {
  if (!name || typeof onTick !== 'function') throw new Error('registerStatusEffect: name and onTick required');
  registry.set(name, { label, onTick });
}

export function getRegisteredStatusEffects() { return [...registry.keys()]; }

// ── Core effects ─────────────────────────────────────────────────────────────

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

// Apply (or refresh) a timed status effect on a player.
export function applyEffect(player, name, duration) {
  if (!player.statuses) player.statuses = [];
  const existing = player.statuses.find(s => s.name === name);
  if (existing) {
    existing.duration = Math.max(existing.duration, duration);
  } else {
    player.statuses.push({ name, duration });
  }
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
