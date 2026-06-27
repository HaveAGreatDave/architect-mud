// server/engine/effects.js
//
// Unified timed status effect system. Replaces the ad hoc tickStatuses()
// that lived inside combat.js. Each effect definition lives as data here
// rather than being hardcoded in a loop, so adding a new effect is a
// one-liner rather than an edit to combat logic.
//
// Usage:
//   applyEffect(player, 'bleeding', 10);   // 10 ticks of bleeding
//   const messages = tickEffects(player);  // call once per second tick

const EFFECT_DEFS = {
  bleeding: {
    onTick(player) {
      player.hp = Math.max(0, player.hp - 2);
      return 'You are bleeding. (-2 HP)';
    },
  },
  burning: {
    onTick(player) {
      player.hp = Math.max(0, player.hp - 5);
      return 'You are on fire. (-5 HP)';
    },
  },
  irradiated: {
    onTick(player) {
      player.radiation = Math.min(100, (player.radiation || 0) + 2);
      return 'Radiation courses through you. (+2 RAD)';
    },
  },
  // Cosmetic only — flavor from a botched butchering. No mechanical effect.
  covered_in_blood: {
    label: 'Covered in blood',
    onTick() { return null; },
  },
};

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
  return (player.statuses || []).map(s => EFFECT_DEFS[s.name]?.label).filter(Boolean);
}

// Tick all active effects. Returns an array of message strings for broadcast.
// Called once per second from the game loop.
export function tickEffects(player) {
  const messages = [];
  if (!player.statuses) return messages;

  player.statuses = player.statuses.filter(s => {
    const def = EFFECT_DEFS[s.name];
    if (def) {
      const msg = def.onTick(player);
      if (msg) messages.push(msg);
    }
    s.duration--;
    return s.duration > 0;
  });

  return messages;
}
