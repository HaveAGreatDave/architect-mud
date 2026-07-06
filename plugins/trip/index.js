/**
 * Trip plugin — hallucination lifecycle + trippy client FX.
 *
 * Fires off the engine's `drug.used` hook (any drug whose effects carry a
 * `hallucination` block) and `drug.overdose`. Two modes, chosen per-drug:
 *
 *   overlay   — the player does NOT move. Scripted timed descriptive events
 *               flood their client while their body stays in the real zone,
 *               still visible and attackable.
 *   dreamzone — the player is teleported into an authored isolated zone
 *               (off-map map_id, flags.is_dreamzone) while a PHANTOM BODY is
 *               spawned in the real zone mirroring their HP. Damage to the
 *               phantom transfers to the player; the phantom's death kills them.
 *
 * All trip state is in-memory (activeTrips). Timers are stored so every exit
 * path (normal expiry, overdose, death, logout) can cancel them and despawn the
 * phantom cleanly. Server restart loses trips; the login rescue in
 * server/index.js bounces any dreamzone occupant back to their anchor.
 */
import { query } from '../../server/models/db.js';
import { getZone, world, spawnEnemySync } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { dispatchAction } from '../../server/engine/actions.js';
import { on } from '../../server/engine/events.js';

// playerId -> { drugId, name, mode, endsAt, realZone, phantomId, phantomPrevHp, timers[], intervals[], broadcast }
const activeTrips = new Map();

// ── Inline trip audio (no DB row needed) ────────────────────────────────────

// Warped looping bed — a detuned sub drone with a slow tremolo shimmer.
const TRIP_BED = {
  id: 'amb_trip_bed', name: 'amb_trip_bed', category: 'ambient', priority: 4,
  config: {
    loop: 1, duration: 4.0,
    layers: [
      { waveform: 'sine', freq: 58, pitchBend: { to: 61, time: 4.0 }, tremolo: { rate: 0.5, depth: 0.4 }, adsr: { a: 1.2, d: 0.5, s: 0.8, r: 1.5 }, gain: 0.22 },
      { waveform: 'triangle', freq: 174.61, tremolo: { rate: 3.2, depth: 0.6 }, filter: { type: 'lowpass', freq: 900, q: 1.4 }, adsr: { a: 1.5, d: 0.6, s: 0.6, r: 1.8 }, gain: 0.12 },
      { noiseMix: 0.5, filter: { type: 'bandpass', freq: 2200, q: 0.6 }, tremolo: { rate: 0.2, depth: 0.9 }, adsr: { a: 2.0, d: 0.5, s: 0.5, r: 2.0 }, gain: 0.05 },
    ],
  },
};

// Come-up "rush" — a rising sweep that blooms and dissolves.
const TRIP_RUSH = {
  id: 'sfx_trip_rush', name: 'sfx_trip_rush', category: 'sfx', priority: 7,
  config: {
    duration: 2.4,
    layers: [
      { waveform: 'sawtooth', freq: 40, pitchBend: { to: 320, time: 2.2 }, filter: { type: 'lowpass', freq: 1600, q: 2.0 }, adsr: { a: 0.8, d: 0.4, s: 0.6, r: 0.9 }, gain: 0.3 },
      { waveform: 'sine', freq: 220, pitchBend: { to: 660, time: 2.0 }, tremolo: { rate: 8, depth: 0.7 }, adsr: { a: 0.6, d: 0.3, s: 0.5, r: 1.0 }, gain: 0.18 },
      { noiseMix: 0.7, filter: { type: 'highpass', freq: 3000, q: 1.2 }, adsr: { a: 1.0, d: 0.5, s: 0.3, r: 1.2 }, gain: 0.1 },
    ],
  },
};

// ── Event scheduling ────────────────────────────────────────────────────────

// Resolve the list of timed descriptive events for a trip. Authors may supply
// an explicit `events` array ({atSec, text}); otherwise an eventPool +
// eventEverySec spreads pool lines across the duration.
function resolveEvents(hallu, durationSec) {
  if (Array.isArray(hallu.events) && hallu.events.length) {
    return hallu.events.filter(e => e && (e.atSec || 0) < durationSec);
  }
  const pool = Array.isArray(hallu.eventPool) ? hallu.eventPool : [];
  if (!pool.length) return [];
  const every = Math.max(3, hallu.eventEverySec || 8);
  const out = [];
  for (let t = every, i = 0; t < durationSec; t += every, i++) {
    out.push({ atSec: t, text: pool[i % pool.length] });
  }
  return out;
}

// ── Trip lifecycle ──────────────────────────────────────────────────────────

async function startTrip({ player, drug, potency, broadcast }) {
  const hallu = drug.effects?.hallucination;
  if (!hallu) return;
  if (activeTrips.has(player.id)) endTrip(player.id, { reason: 'silent' });

  const mode = hallu.mode === 'dreamzone' ? 'dreamzone' : 'overlay';
  const durationSec = hallu.duration_seconds || 120;
  const intensity = Math.max(0.1, Math.min(1, (hallu.intensity ?? 0.6) * (0.5 + 0.5 * (potency ?? 1))));
  const palette = hallu.palette || 'green';
  // Visual FX profile the flight sim reads to warp the out-the-window view
  // (authorable per drug; hallucinations default to the psychedelic treatment).
  const profile = hallu.fx_profile || 'psychedelic';
  const realZone = player.current_zone;

  const state = { drugId: drug.id, name: drug.name, mode, endsAt: Date.now() + durationSec * 1000, realZone, phantomId: null, phantomPrevHp: 0, timers: [], intervals: [], broadcast };
  activeTrips.set(player.id, state);

  sendToPlayer(player.id, { type: 'trip_start', mode, palette, profile, intensity, duration_seconds: durationSec });
  sendToPlayer(player.id, { type: 'audio_sfx', def: TRIP_RUSH, gain: 0.8 });
  sendToPlayer(player.id, { type: 'audio_ambience', def: TRIP_BED });

  // Timed descriptive events.
  for (const ev of resolveEvents(hallu, durationSec)) {
    const h = setTimeout(() => {
      sendToPlayer(player.id, { type: 'trip_event', text: ev.text, palette: ev.palette || palette, intensity: ev.intensity ?? intensity });
    }, (ev.atSec || 0) * 1000);
    state.timers.push(h);
  }

  if (mode === 'dreamzone') await enterDreamzone(player, hallu, state);

  // Auto-end.
  state.timers.push(setTimeout(() => endTrip(player.id, { reason: 'expire' }), durationSec * 1000));
}

async function enterDreamzone(player, hallu, state) {
  const dzId = hallu.dreamzone_id;
  const dz = dzId && getZone(dzId);
  if (!dz) {
    // Misconfigured drug — fall back to an overlay trip rather than stranding the player.
    state.mode = 'overlay';
    return;
  }

  // Teleport the mind into the dream zone (reuses the canonical TELEPORT path).
  await dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: dzId }, context: { broadcast: state.broadcast } });

  // Spawn the phantom body in the real zone, mirroring the player's HP.
  const template = {
    id: `phantom_${player.id}`,
    name: `${player.handle}'s slumped body`,
    description: 'A body slumped where they stand, eyes rolled back, breath shallow. Whatever they are seeing, it is not here.',
    hp_max: player.hp_max, hp: player.hp,
    hit: 0, dodge: 1, weapon: [], body_parts: [], loot_table: [], butcher_table: [], butcher_difficulty: 5,
    behavior: 'passive', faction: 'neutral',
    death_message: 'The body shudders once, then goes still.',
    behaviour_graph: {}, flags: { _phantom: true },
  };
  const inst = spawnEnemySync(template, state.realZone);
  inst.hp = player.hp;
  inst._phantomOf = player.id;
  state.phantomId = inst.instanceId;
  state.phantomPrevHp = player.hp;

  state.broadcast?.(state.realZone, { type: 'zone_event', message: `${player.handle}'s body slumps to the ground, eyes gone glassy and far away.`, refresh: true }, player.id);

  // Mirror phantom damage onto the player each second; the phantom's death is the player's death.
  const iv = setInterval(() => syncPhantom(player.id), 1000);
  state.intervals.push(iv);
}

function syncPhantom(playerId) {
  const state = activeTrips.get(playerId);
  if (!state || !state.phantomId) return;
  const player = world.players.get(playerId);
  if (!player) return; // logout handler cleans up
  const phantom = world.enemies.get(state.phantomId);

  // Body destroyed → the player dies.
  if (!phantom || phantom._dead || phantom.hp <= 0) {
    endTrip(playerId, { reason: 'death' });
    killTripPlayer(player);
    return;
  }

  // Transfer incoming damage from body to player.
  if (phantom.hp < state.phantomPrevHp) {
    const dmg = state.phantomPrevHp - phantom.hp;
    state.phantomPrevHp = phantom.hp;
    player.hp = Math.max(0, player.hp - dmg);
    query('UPDATE players SET hp=$1 WHERE id=$2', [player.hp, playerId]).catch(() => {});
    sendToPlayer(playerId, { type: 'combat_incoming', message: '<span class="msg-combat">Something reaches you through the visions — pain, distant but real.</span>', player_update: { hp: player.hp, hp_max: player.hp_max } });
    if (player.hp <= 0) {
      endTrip(playerId, { reason: 'death' });
      killTripPlayer(player);
    }
  }
}

async function killTripPlayer(player) {
  const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
  await handlePlayerDeath(player, null, { type: 'drug', label: 'Died in a hallucination' });
}

function despawnPhantom(state) {
  if (!state.phantomId) return;
  const phantom = world.enemies.get(state.phantomId);
  world.enemies.delete(state.phantomId);
  const zone = world.zones.get(state.realZone);
  zone?.enemies.delete(state.phantomId);
  state.phantomId = null;
  return phantom;
}

// Single teardown for every exit path. Idempotent.
// reasons: 'expire' | 'overdose' | 'death' | 'silent'
function endTrip(playerId, { reason } = {}) {
  const state = activeTrips.get(playerId);
  if (!state) return;
  activeTrips.delete(playerId); // delete first — re-entrancy guard

  state.timers.forEach(clearTimeout);
  state.intervals.forEach(clearInterval);
  despawnPhantom(state);

  const player = world.players.get(playerId);

  // Teleport the mind back — unless death already relocated the body, or we're
  // silently tearing down on logout.
  if (state.mode === 'dreamzone' && reason !== 'death' && reason !== 'silent' && player && player.current_zone !== state.realZone) {
    const dest = getZone(state.realZone) ? state.realZone : (player.anchor_zone || 'zone_start');
    dispatchAction({ type: 'TELEPORT', actor: player, params: { zone_id: dest }, context: { broadcast: state.broadcast } }).catch(() => {});
  }

  if (reason !== 'silent' && player) {
    sendToPlayer(playerId, { type: 'trip_end' });
    if (reason !== 'death') sendToPlayer(playerId, { type: 'output', message: '<span class="msg-system">The colours drain back to grey. You come down.</span>' });
  }
}

// ── Event subscriptions ─────────────────────────────────────────────────────

// Logout mid-trip: persist the real zone (so a dreamzone player doesn't log
// back inside the trip) and tear down silently.
on('player.logout', ({ id }) => {
  const state = activeTrips.get(id);
  if (!state) return;
  if (state.mode === 'dreamzone') {
    query('UPDATE players SET current_zone=$1 WHERE id=$2', [state.realZone, id]).catch(() => {});
  }
  endTrip(id, { reason: 'silent' });
});

// Death mid-trip (from anything): clear the overlay, despawn the phantom, no re-teleport.
on('player.death', ({ player }) => {
  if (player?.id) endTrip(player.id, { reason: 'death' });
});

export const hooks = {
  'drug.used': (payload) => startTrip(payload).catch(e => console.error('[trip] startTrip:', e.message)),
  'drug.overdose': ({ player }) => { if (player?.id) endTrip(player.id, { reason: 'overdose' }); },
};
