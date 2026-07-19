/**
 * Sanity plugin — the slow slide into madness.
 *
 * Reacts to the engine's live `player.sanity` (0–100). Nothing here DRAINS
 * sanity — drugs, sleep and existing sources own that. This plugin owns only
 * the CONSEQUENCE: a gradual, scarier-than-a-drug-trip dread that escalates as
 * sanity falls, in three bands over one continuous intensity curve:
 *
 *   creep   (25–49) — unease. A cold vignette that deepens as sanity drops,
 *                     a low dread drone, and occasional misperception whispers.
 *                     Nothing is actually there yet.
 *   halluc  (1–24)  — you start seeing things. Fake people/animals (the shared
 *                     per-player phantom registry) walk into your real room and
 *                     read as ordinary presences; whispers turn specific and
 *                     close. The trip plugin's phantom look/attack/talk
 *                     intercepts answer them for free (matchPhantom is global).
 *   insane  (≤0)    — full breakdown. `player.insane` is set, and the engine's
 *                     substrate gate collapses ~half of deliberate actions into
 *                     nonsense (sleep/rest are always allowed — the only way
 *                     out). Recovers with hysteresis: the flag lifts only once
 *                     sanity climbs back to 10, so 0→up doesn't flicker.
 *
 * All state is in-memory (mirrors trips). The FX pipeline mirrors the trip
 * plugin: a `sanity_fx` client message drives a #sanity-overlay + body classes;
 * whispers are plain `.msg-dread` output lines; phantoms come from
 * engine/phantoms.js. Client FX is deliberately its own channel so it composes
 * with an active drug trip rather than fighting the #trip-overlay.
 */
import { world } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { addPhantom, removePhantom } from '../../server/engine/phantoms.js';

// playerId -> { band, phantomIds:Set<string>, timers:Timeout[], audioOn:bool }
const sanityState = new Map();

// Band thresholds are on the RAW sanity value (the player asked for "below 25")
// — not a fraction of sanity_max, which buffs can inflate.
const CREEP_AT = 50;   // dread begins creeping in
const HALLUC_AT = 25;  // hallucinations begin
const INSANE_CLEAR = 10; // insane flag lifts once sanity climbs back to here

// ── Dread audio bed — a low detuned sub with a slow uneasy tremolo and a
// dissonant high shimmer. Sent once on entering an affected band, stopped
// client-side on the 'clear' FX message. (No DB row; inline like the trip bed.)
const DREAD_BED = {
  id: 'amb_dread_bed', name: 'amb_dread_bed', category: 'ambient', priority: 4,
  config: {
    loop: 1, duration: 5.0,
    layers: [
      { waveform: 'sine', freq: 47, pitchBend: { to: 44, time: 5.0 }, tremolo: { rate: 0.35, depth: 0.5 }, adsr: { a: 2.0, d: 0.5, s: 0.9, r: 2.5 }, gain: 0.24 },
      { waveform: 'triangle', freq: 92.5, tremolo: { rate: 0.18, depth: 0.7 }, filter: { type: 'lowpass', freq: 600, q: 1.2 }, adsr: { a: 2.5, d: 0.6, s: 0.7, r: 2.5 }, gain: 0.10 },
      { noiseMix: 0.4, filter: { type: 'bandpass', freq: 5200, q: 0.5 }, tremolo: { rate: 0.09, depth: 0.95 }, adsr: { a: 3.0, d: 0.5, s: 0.4, r: 3.0 }, gain: 0.03 },
    ],
  },
};

// ── Whisper pools — private misperceptions, escalating with the band. ────────
const CREEP_WHISPERS = [
  'Something moves at the edge of your vision. When you turn, the room is empty.',
  'You could swear someone just said your name. Nobody did.',
  'The shadows in the corner sit wrong, as if something is folded into them.',
  'For a heartbeat the walls seem to breathe, slow and wet.',
  'A cold certainty settles over you: you are being watched.',
  'The light flickers in a way the light should not flicker.',
  'You hear footsteps behind you, matched exactly to your own.',
];
const HALLUC_WHISPERS = [
  'It is standing right behind you. You feel its breath on your neck.',
  'The faces in the room turn to look at you all at once, then look away.',
  'Something whispers, close and clear: "Almost. Almost time."',
  'Your own hands look like they belong to someone else.',
  'The floor is much further down than it was a moment ago.',
  'A child is crying somewhere in the walls. There are no children here.',
  'Every reflection is a half-second late, and smiling.',
];
const INSANE_WHISPERS = [
  'THEY ARE ALL HERE THEY HAVE ALWAYS BEEN HERE they are laughing they are —',
  'The room turns inside out. You are outside your own skin, watching.',
  'A thousand voices agree, in perfect unison, that you should not exist.',
  'You cannot remember your name. Something else is wearing it now.',
  'The screaming is coming from your own mouth and you cannot make it stop.',
];

// ── Phantom roster for the hallucination band. Distinct from the wraithdust
// deliriant roster; these are the shapes low sanity coughs up. Interactions
// (look/attack/talk) are handled by the trip plugin's specialized actions,
// which read the same global phantom registry we add to here.
const DREAD_PHANTOMS = [
  {
    name: 'a figure made of static', kind: 'person', hp: 8,
    arrive: 'A figure of grey static resolves out of the far wall and stands watching you.',
    look: 'It is roughly a person, but it will not hold a shape — features boiling, hands too long. Where its eyes should be there is only more static.',
    talk: 'The static figure does not answer. The hiss just gets louder.',
    depart: 'You blink, and the static figure is gone, leaving a ringing in your ears.',
  },
  {
    name: 'a woman with no face', kind: 'person', hp: 10,
    arrive: 'A woman steps in from a doorway that was not there and stops, very close.',
    look: 'She is dressed for somewhere ordinary. Above her collar there is smooth blank skin where a face should be, and it is tilted toward you as if listening.',
    talk: 'She has no mouth to answer with. She only leans a little closer.',
    depart: 'The faceless woman steps back through the doorway that is no longer there.',
  },
  {
    name: 'something on all fours', kind: 'beast', hp: 14,
    arrive: 'Something the size of a large dog scuttles in low along the wall, joints bending the wrong way.',
    look: 'It is pale and hairless and moves like an insect wearing a dog. It watches you sidelong, and its ribs work like a bellows.',
    depart: 'The thing on all fours pours itself into a gap too thin to hold it and is gone.',
  },
  {
    name: 'a crowd of silent onlookers', kind: 'person', hp: 12,
    arrive: 'The room fills, silently, with people standing shoulder to shoulder, all facing you.',
    look: 'Dozens of them, grey and still, packed impossibly into the space. Not one of them blinks. Not one of them breathes.',
    talk: 'The crowd does not answer. As one, they take a single step closer.',
    depart: 'You look away for an instant, and when you look back the crowd has simply never been there.',
  },
];

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];

// Effective band, honouring the insane hysteresis flag on the player.
// Exported for the regression suite.
export function bandFor(player) {
  if (player.insane) return 'insane';
  const s = player.sanity ?? 100;
  if (s >= CREEP_AT) return 'clear';
  if (s >= HALLUC_AT) return 'creep';
  if (s > 0) return 'halluc';
  return 'insane';
}

// One continuous 0–1 dread curve: subtle at 49, ~0.5 at 25, ~1 at the bottom.
// Exported for the regression suite.
export function intensityFor(player) {
  if (player.insane) return 1;
  const s = player.sanity ?? 100;
  if (s >= CREEP_AT) return 0;
  return Math.max(0.12, Math.min(1, (CREEP_AT - s) / CREEP_AT));
}

function whisperFor(band) {
  if (band === 'insane') return pick(INSANE_WHISPERS);
  if (band === 'halluc') return pick(HALLUC_WHISPERS);
  return pick(CREEP_WHISPERS);
}
// Whisper frequency per tick (minute), escalating with the band.
const WHISPER_CHANCE = { creep: 0.4, halluc: 0.75, insane: 1 };
// How many phantoms may haunt a player at once, per band.
const PHANTOM_CAP = { halluc: 1, insane: 3 };

function stateFor(id) {
  let st = sanityState.get(id);
  if (!st) { st = { band: 'clear', phantomIds: new Set(), timers: [], audioOn: false }; sanityState.set(id, st); }
  return st;
}

function roomEmote(playerId, message) {
  sendToPlayer(playerId, { type: 'zone_event', message });
}

// Conjure a dread phantom into the player's CURRENT room. It arrives, lingers
// a minute or two, then departs — reusing the shared phantom registry so the
// room look renders it and the trip plugin's intercepts answer interactions.
function conjurePhantom(player, st) {
  const tpl = pick(DREAD_PHANTOMS);
  const id = `sane_${player.id}_${Date.now()}_${Math.floor(Math.random() * 1e4)}`;
  const spec = {
    id, name: tpl.name, kind: tpl.kind === 'beast' ? 'beast' : 'person',
    hp: tpl.hp ?? 8, hp_max: tpl.hp ?? 8,
    look: tpl.look || "It does not look quite right, though you couldn't say how.",
    talk: tpl.talk, depart: tpl.depart,
    zone: player.current_zone,
  };
  addPhantom(player.id, spec);
  st.phantomIds.add(id);
  if (tpl.arrive) roomEmote(player.id, tpl.arrive);

  // It leaves on its own after 60–150s; keep the timer so teardown can cancel.
  const h = setTimeout(() => {
    st.phantomIds.delete(id);
    removePhantom(player.id, id);
    if (world.players.get(player.id) && tpl.depart) roomEmote(player.id, tpl.depart);
  }, 60000 + Math.floor(Math.random() * 90000));
  st.timers.push(h);
}

// Remove only the phantoms WE spawned (never clearPhantoms — that would wipe a
// concurrent drug trip's phantoms too).
function dropOurPhantoms(playerId, st) {
  for (const id of st.phantomIds) removePhantom(playerId, id);
  st.phantomIds.clear();
  st.timers.forEach(clearTimeout);
  st.timers = [];
}

// Full reset for a player — used on recovery, death and logout.
function resetPlayer(player, { sendClear = true } = {}) {
  const st = sanityState.get(player.id);
  if (st) { dropOurPhantoms(player.id, st); st.audioOn = false; st.band = 'clear'; }
  player.insane = false;
  if (sendClear) sendToPlayer(player.id, { type: 'sanity_fx', band: 'clear', intensity: 0 });
}

// One player's slice of the minute tick.
function tickPlayer(player) {
  // Maintain the insane hysteresis flag first, so bandFor sees it.
  if ((player.sanity ?? 100) <= 0) player.insane = true;
  else if ((player.sanity ?? 100) >= INSANE_CLEAR) player.insane = false;

  const band = bandFor(player);
  const st = stateFor(player.id);

  if (band === 'clear') {
    if (st.band !== 'clear') resetPlayer(player); // came back from the brink
    return;
  }

  // Sleeping players ride it out with the room shut off — no whispers/phantoms,
  // but keep the flag maintenance above so they can wake sane.
  const sleeping = !!player.sleeping;

  // Push the live FX intensity every affected tick (sanity drifts between ticks).
  sendToPlayer(player.id, { type: 'sanity_fx', band, intensity: intensityFor(player) });

  // Start the dread bed once, on first entering an affected band.
  if (!st.audioOn) { sendToPlayer(player.id, { type: 'audio_ambience', def: DREAD_BED }); st.audioOn = true; }

  if (!sleeping) {
    // Whispers.
    if (Math.random() < (WHISPER_CHANCE[band] ?? 0)) {
      sendToPlayer(player.id, { type: 'output', message: `<span class="msg-dread">${whisperFor(band)}</span>` });
    }
    // Hallucinations (halluc + insane bands only).
    const phantomCap = PHANTOM_CAP[band] ?? 0;
    if (phantomCap && st.phantomIds.size < phantomCap && Math.random() < (band === 'insane' ? 0.9 : 0.6)) {
      conjurePhantom(player, st);
    }
  }

  st.band = band;
}

// ── Event subscriptions ──────────────────────────────────────────────────────
// Death resets sanity to max (gameLoop) — tear our state down immediately so
// stray phantoms/insane don't survive the respawn. No FX push (the client is
// mid-death handling).
on('player.death', ({ player }) => { if (player?.id) resetPlayer(player, { sendClear: false }); });

on('player.logout', ({ id }) => {
  const st = sanityState.get(id);
  if (st) dropOurPhantoms(id, st);
  sanityState.delete(id);
});

export const hooks = {
  'tick.minute': () => {
    for (const [, player] of world.players) {
      try { tickPlayer(player); } catch (e) { console.error('[sanity] tick:', e.message); }
    }
  },
};
