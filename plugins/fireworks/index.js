// Fireworks — an admin-triggered, server-choreographed pyrotechnic show over the
// Coldwater Clone Facility. One command fans a ~30s show out across four synchronized
// channels, all timed by the server (the authority for *when*):
//   • text     — staggered burst descriptions, propagated to the launch zone AND nearby
//                rooms, dropping words / gaining a "In the distance," prefix with distance
//   • sound    — a boom SFX propagated the same way (gain falls off per room)
//   • on-foot  — a coloured full-screen sky-flash for players standing in reach
//   • airborne — a real 3D burst in the flight-sim windshield, anchored to the world tile
//   • sky glow — a soft weather-FX colour wash over the pane for the show's duration
//
// Everything rides existing seams: sounds.js propagation (distance attenuation for free),
// messaging.js zone sends, and the flight plugin's liveAircraft occupant registry.

import { world, getAllZones, getZone } from '../../server/engine/world.js';
import { sendToPlayer, sendToZone, getBroadcast } from '../../server/engine/messaging.js';
import { propagateSound, propagateAudio, getSoundReach } from '../../server/engine/sounds.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { liveAircraft } from '../flight/state.js';

// The default launch point (used when the caster's own zone can't be resolved): the Clone
// Facility's exterior tile on map_world (grid 918,903).
const DEFAULT_LAUNCH_ZONE = 'zone_district_918_903';
const LOUD = 12;                 // fireworks are LOUD — the boom/glow carry several rooms out
const DEFAULT_SECONDS = 30;
const ROLES = ['admin', 'dev', 'builder', 'designer'];
const LAUNCH_LEAD_MS = 950;      // the shell's climb time — the client streaks the trail up over
                                 // exactly this long, and the whistle is tuned to peak at its end.

// Burst catalogue: a colour (used by every channel) + a description. Kept small and
// evocative; the show cycles through them with a little shuffle.
const SHELLS = [
  { rgb: [255, 70, 70],   text: 'A shell screams up and detonates into a vast crimson chrysanthemum, sparks raining down in slow arcs.' },
  { rgb: [90, 170, 255],  text: 'A blue peony blooms overhead, its petals of light drifting apart and winking out one by one.' },
  { rgb: [120, 255, 140], text: 'A green starburst cracks across the sky, throwing a hundred emerald tendrils in every direction.' },
  { rgb: [255, 200, 80],  text: 'A gold willow bursts and cascades, molten threads sagging halfway to the rooftops before they die.' },
  { rgb: [255, 120, 230], text: 'A magenta comet corkscrews up and shatters into a ring of pink fire.' },
  { rgb: [255, 255, 255], text: 'A brilliant white strobe-burst stutters like lightning, printing hard shadows on every wall.' },
  { rgb: [255, 140, 40],  text: 'An orange palm-shell splays into fat glowing fronds that curl and smoke as they fall.' },
];

// Inline synth SFX (built by the client audio engine — no DB entry). A deep mortar boom
// with a crackling tail; propagateAudio scales its gain per room.
const SFX_BOOM = {
  id: 'sfx_firework_boom', name: 'sfx_firework_boom', category: 'sfx', priority: 6,
  config: {
    duration: 1.1,
    layers: [
      // the concussion — a low sine thump
      { waveform: 'sine', freq: 62, pitchBend: { to: 34, time: 0.4 }, adsr: { a: 0.002, d: 0.28, s: 0, r: 0.5 }, gain: 1.0 },
      // the crack — a bright noise transient
      { noiseMix: 1, filter: { type: 'bandpass', freq: 1600, q: 0.7 }, adsr: { a: 0.001, d: 0.12, s: 0, r: 0.1 }, gain: 0.55 },
      // the crackle tail — filtered noise decaying slowly
      { noiseMix: 1, filter: { type: 'highpass', freq: 2400 }, adsr: { a: 0.02, d: 0.5, s: 0.15, r: 0.6 }, gain: 0.3 },
    ],
  },
};

// The launch — a shell climbing to its burst point: a clean rising whistle, its pitch swept up
// through a resonant band so it reads as a pure tone. The sweep time is tied to the shell's climb
// (LAUNCH_LEAD_MS), so the whistle peaks just as the trail reaches its apex and cracks into the
// burst. A faint propellant hiss sits well below it so the whistle dominates.
const LAUNCH_LEAD_S = LAUNCH_LEAD_MS / 1000;
const SFX_LAUNCH = {
  id: 'sfx_firework_launch', name: 'sfx_firework_launch', category: 'sfx', priority: 5,
  config: {
    duration: LAUNCH_LEAD_S,
    layers: [
      // the whistle — a clean triangle tone swept up through a tight bandpass, peaking at the apex
      { waveform: 'triangle', freq: 640, pitchBend: { to: 3000, time: LAUNCH_LEAD_S }, filter: { type: 'bandpass', freq: 2000, q: 7 }, adsr: { a: 0.03, d: 0, s: 0.85, r: 0.08 }, gain: 0.22 },
      // the propellant — a faint filtered-noise hiss riding under the tone
      { noiseMix: 1, filter: { type: 'highpass', freq: 2600 }, adsr: { a: 0.05, d: 0.25, s: 0.2, r: 0.2 }, gain: 0.06 },
    ],
  },
};

let showRunning = false;
let timers = [];
let launchZone = DEFAULT_LAUNCH_ZONE;   // set per-show to wherever the caster is standing

// ── Broadcast one burst across every channel ──────────────────────────────────
// A shell first *climbs* — a rising launch whistle propagated out now — then *detonates* a
// beat later, when the boom, burst description and all the visuals land together. `silent`
// suppresses the per-shell text description (sound/flash/3D burst still fire) — used during
// the finale, where the barrage is narrated once as a whole rather than shell by shell.
function fireBurst(shell, silent = false) {
  const bc = getBroadcast();
  if (!bc) return;
  propagateAudio(launchZone, SFX_LAUNCH, LOUD, bc);
  // On-foot shell trail: tell nearby rooms a shell is climbing so the client can streak a trail
  // up over the same `lead` window and detonate at its apex — synced to the whistle.
  for (const [zoneId, dist] of getSoundReach(launchZone, LOUD)) {
    sendToZone(zoneId, { type: 'fireworks_launch', rgb: shell.rgb, dist, lead: LAUNCH_LEAD_MS });
  }
  timers.push(setTimeout(() => detonate(shell, silent), LAUNCH_LEAD_MS));
}

function detonate(shell, silent) {
  const bc = getBroadcast();
  if (!bc) return;

  // Text + boom: origin zone plus every room in earshot, fainter with distance.
  if (!silent) propagateSound(launchZone, shell.text, LOUD, bc);
  propagateAudio(launchZone, SFX_BOOM, LOUD, bc);

  // On-foot sky-flash: one per reached zone, intensity falling off with distance so
  // nearby rooms get a dim glow on the horizon rather than a full-face flash.
  const reach = getSoundReach(launchZone, LOUD);
  for (const [zoneId, dist] of reach) {
    const intensity = Math.max(0.1, 1 / (dist * 0.7 + 1));
    // `dist` (rooms from the launch tile) rides along so the client can render a real
    // particle explosion for players standing one tile away, not just a colour flash.
    sendToZone(zoneId, { type: 'fireworks_flash', rgb: shell.rgb, intensity, dist });
  }

  // Airborne pilots + passengers: a real 3D burst at the launch tile. The flight client
  // anchors it to the world and culls by distance, so a pilot across the basin sees
  // (and hears) only a faint far-off pop.
  const z = world.zones.get(launchZone);
  const bx = z.grid_x, by = z.grid_y;
  for (const live of liveAircraft.values()) {
    if (!live.row.airborne) continue;
    for (const pid of live.occupants) {
      sendToPlayer(pid, { type: 'fireworks_sim', x: bx, y: by, rgb: shell.rgb, sfx: SFX_BOOM });
    }
  }
}

// ── Show lifecycle ────────────────────────────────────────────────────────────
function startShow(seconds, zoneId) {
  showRunning = true;
  launchZone = zoneId;
  const durMs = seconds * 1000;
  const bc = getBroadcast();

  // Opening: a lone shell climbing, plus the weather-FX sky glow for every room in reach.
  if (bc) {
    propagateSound(launchZone, 'A mortar thunks and a comet of light claws its way up into the dark.', LOUD, bc);
    propagateAudio(launchZone, SFX_LAUNCH, LOUD, bc);
  }
  const reach = getSoundReach(launchZone, LOUD);
  for (const [zid] of reach) sendToZone(zid, { type: 'fireworks_sky', on: true });

  timers = [];
  // Body: an unhurried, well-spaced burst every ~3.5–5.5s, each narrated in full, right up
  // to the finale window.
  const FINALE_MS = 4200;
  let i = 0, t = 1400;
  const order = [...SHELLS];
  const nextShell = () => order[(i++) % order.length];
  while (t < durMs - FINALE_MS) {
    timers.push(setTimeout(() => fireBurst(nextShell()), t));
    t += 3500 + Math.floor(Math.random() * 2000);
  }
  // Finale: a rapid multi-colour barrage, narrated ONCE as a single intense description
  // rather than shell by shell — the bursts themselves fire silently underneath it.
  const finaleStart = durMs - FINALE_MS;
  timers.push(setTimeout(() => {
    if (bc) propagateSound(launchZone, 'The sky detonates — shell after shell slamming up in a rolling barrage, the booms overlapping into one continuous roar as the whole horizon strobes crimson, gold and white.', LOUD, bc);
  }, finaleStart));
  for (let k = 0; k < 12; k++) {
    timers.push(setTimeout(() => fireBurst(nextShell(), true), finaleStart + 250 + k * 300));
  }
  // Curtain — held back by the launch lead so the last finale shell's detonation lands
  // before the closing line.
  timers.push(setTimeout(endShow, durMs + LAUNCH_LEAD_MS));
}

function endShow() {
  showRunning = false;
  timers = [];
  const bc = getBroadcast();
  const reach = getSoundReach(launchZone, LOUD);
  for (const [zid] of reach) sendToZone(zid, { type: 'fireworks_sky', on: false });
  if (bc) propagateSound(launchZone, 'The last embers drift down and the sky goes dark, a pall of smoke hanging where the colour was.', LOUD, bc);
}

// Resolve where the show launches from. Order: the caster's current tile by default; a
// trailing name (`fireworks [seconds] <name>`) resolves to a zone by SIFT partial match
// (same engine GPS uses), picking the tile nearest the caster when several match.
function resolveLaunchZone(query, player) {
  if (!query) return getZone(player.current_zone) || null;

  const direct = getZone(query) || getZone(query.toLowerCase());
  if (direct) return direct;

  const r = siftResolve(query, getAllZones());
  if (r.type === 'none') return null;
  if (r.type === 'ambiguous') {
    // Admin command — don't bother with a client picker; light the nearest match.
    const here = getZone(player.current_zone);
    const dist = (z) => here ? Math.abs((z.grid_x ?? 0) - (here.grid_x ?? 0)) + Math.abs((z.grid_y ?? 0) - (here.grid_y ?? 0)) : 0;
    return r.candidates.slice().sort((a, b) => dist(a) - dist(b))[0];
  }
  return r.candidate;
}

// ── Command ───────────────────────────────────────────────────────────────────
// `fireworks [seconds] [zone name]` — staff only. Launches the show from the caster's own
// tile, or from a named zone (partial match) if one is given.
function cmdFireworks(args, raw, player) {
  if (!ROLES.includes(player.role)) return { type: 'error', message: 'Only staff can light the sky.' };
  if (showRunning) return { type: 'error', message: 'A show is already lighting up the sky. Let it finish.' };

  // A leading integer is the duration; everything after it (or all of it) names the zone.
  const rest = [...args];
  let secs = DEFAULT_SECONDS;
  if (rest.length && /^\d+$/.test(rest[0])) secs = Math.max(5, Math.min(120, parseInt(rest.shift(), 10)));
  const query = rest.join(' ').trim();

  const zone = resolveLaunchZone(query, player);
  if (!zone) return { type: 'error', message: query ? `No zone matching "${query}".` : `You aren't standing anywhere the sky can be lit.` };
  if (!world.zones.has(zone.id)) return { type: 'error', message: `Launch zone ${zone.id} isn't loaded.` };

  startShow(secs, zone.id);
  return { type: 'emote', message: `🎆 A ${secs}s fireworks show erupts over ${zone.name}.` };
}

export const commands = {
  fireworks: cmdFireworks,
};
