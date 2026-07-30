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
import { world, getLivePlayer } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { addPhantom, removePhantom, setRoomTransform } from '../../server/engine/phantoms.js';
import { speakVoice } from './voices.js';
import { beginDissociation, endDissociation, isDissociating } from '../../server/engine/dreamscape.js';
import { getBroadcast } from '../../server/engine/messaging.js';

// playerId -> { band, phantomIds:Set<string>, timers:Timeout[], audioOn:bool }
const sanityState = new Map();

// Band thresholds are on the RAW sanity value (the player asked for "below 25")
// — not a fraction of sanity_max, which buffs can inflate.
const CREEP_AT = 50;   // dread begins creeping in
const HALLUC_AT = 25;  // hallucinations begin
const INSANE_CLEAR = 10; // insane flag lifts once sanity climbs back to here

// ── The ladder ───────────────────────────────────────────────────────────────
// Bands say how bad it is; these say what it DOES, and they are deliberately staggered
// inside the bands rather than aligned to them. A player who learns "below 25 I see people"
// has a diagnostic. A player who finds symptoms arriving at odd, unannounced points does not
// — which is the whole design brief, because a mind coming apart does not publish a schedule.
//
// The order is chosen so that each rung is harder to verify than the last:
//   VOICES_AT      a person who IS there says something they didn't. Checkable — ask them.
//   PHANTOMS       a person who isn't there at all. Checkable — swing at them.
//   DISEMBODIED_AT a name with nobody attached, from somewhere else entirely. Not checkable
//                  in the moment, which is why it is far down.
//   WARP_AT        the ROOM is wrong. Nothing left to cross-reference against.
const VOICES_AT = 42;        // misattributed speech, indistinguishable from the real thing
const DISEMBODIED_AT = 18;   // …spoken by somebody who is not in the room
const WARP_AT = 12;          // the room itself stops holding still
const DISSOCIATE_AT = 7;     // …and then the room stops being anywhere at all

// The bottom of the ladder. Rare and self-limiting on purpose: an episode you cannot act
// through is powerful exactly once per stretch of play, and a system that fires it every few
// minutes is a system players learn to log out of rather than to fear.
const DISSOCIATE_CHANCE = 0.06;              // per minute, once past the threshold
const DISSOCIATE_COOLDOWN_MS = 12 * 60_000;  // …and not again for a while afterwards
const DISSOCIATE_MIN_MS = 60_000;            // an episode runs 1–2½ minutes of real time
const DISSOCIATE_MAX_MS = 150_000;

// ── Test seam: pin the dissociation roll ─────────────────────────────────────
//
// Dissociation is the only thing in this tick that outlives the tick. It is async
// (buildDreamscape) and deliberately fire-and-forget, and once it lands it re-gates
// EVERY command for the rest of the process. In the regression harness that turned a
// 6%-per-tick dice roll into a cross-suite flake: this suite drives ticks at sanity
// 0 and 5 (both under DISSOCIATE_AT), and the episode would set `_dissociating`
// after our own cleanup had already run — so the harness's leak guard named whichever
// suite happened to be running when the build resolved (slots, scavenging, senses…)
// rather than the one that rolled it. Tests pin the roll off and await any in-flight
// build; nothing in production touches either of these.
let dissociationEnabled = true;
let pendingDissociation = null;
export const _test = {
  setDissociation(on) { dissociationEnabled = on !== false; },
  settled: () => pendingDissociation || Promise.resolve(),
};

// How often a voice lands, and how far gone it sounds. Keyed by the rung, not the band, and
// rising steeply — at the bottom the voices are most of what you hear.
const VOICE_CHANCE = { 1: 0.18, 2: 0.35, 3: 0.6 };

// The room, seen from inside a mind that has stopped rendering it faithfully. Applied
// through the SAME per-viewer `setRoomTransform` seam the drug-trip plugin uses, so a
// warped description costs no new machinery and never touches the shared world cache.
const ROOM_WARPS = [
  'The proportions are wrong. The far wall is further than the room is deep, and you can see both facts at once.',
  'Everything here is very slightly too clean, as though it was assembled recently and quickly, for you.',
  'You have the strong sense the room is only rendered where you are looking, and is not bothering elsewhere.',
  'The room is the right room. It is simply not where it was, and it is being patient about that.',
  'Every surface has the faint give of something breathing very slowly.',
  'You have been here before. You have been here for some time. You may not have left.',
];

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

// Drop any room warp we applied. Called from the same teardown paths as the phantoms —
// a player who recovers, dies or logs out must not keep a bent room.
function dropOurWarp(playerId, st) {
  if (st?.warpZone) { setRoomTransform(playerId, st.warpZone, null); st.warpZone = null; }
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
// Wake paths 3 and 4 ride here: death and logout both reset, and both must return the mind
// to the body before the dreamscape is torn down under it.
function dropOurDissociation(player) {
  if (player && isDissociating(player)) endDissociation(player, { broadcast: getBroadcast(), reason: 'silent' });
}

function dropOurPhantoms(playerId, st) {
  for (const id of st.phantomIds) removePhantom(playerId, id);
  st.phantomIds.clear();
  st.timers.forEach(clearTimeout);
  st.timers = [];
  // The warp rides along: it is applied by the same tick and must be forgotten by the same
  // teardown, or recovery leaves the room bent with nothing left to un-bend it.
  dropOurWarp(playerId, st);
}

// Full reset for a player — used on recovery, death and logout.
function resetPlayer(player, { sendClear = true } = {}) {
  const st = sanityState.get(player.id);
  if (st) { dropOurPhantoms(player.id, st); st.audioOn = false; st.band = 'clear'; }
  player.insane = false;
  if (sendClear) sendToPlayer(player.id, { type: 'sanity_fx', band: 'clear', intensity: 0 });
}

// Wake path 1 and 2: the episode's own clock, and sanity climbing back out from under it.
// Checked before anything else in the tick so a recovering player is never narrated at from
// inside a dreamscape they have already left.
function tickDissociation(player, st) {
  if (!isDissociating(player)) return;
  const expired = Date.now() >= (st.dissociateUntil || 0);
  const recovered = (player.sanity ?? 100) >= DISSOCIATE_AT + 5;
  if (expired || recovered) endDissociation(player, { broadcast: getBroadcast() });
}

// One player's slice of the minute tick.
function tickPlayer(player) {
  // Maintain the insane hysteresis flag first, so bandFor sees it.
  if ((player.sanity ?? 100) <= 0) player.insane = true;
  else if ((player.sanity ?? 100) >= INSANE_CLEAR) player.insane = false;

  const band = bandFor(player);
  const st = stateFor(player.id);
  tickDissociation(player, st);

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
    // Whispers. These are the HONEST symptom — `.msg-dread` is visibly its own channel, so
    // you always know a whisper was in your head. Everything below this line is not.
    if (Math.random() < (WHISPER_CHANCE[band] ?? 0)) {
      sendToPlayer(player.id, { type: 'output', message: `<span class="msg-dread">${whisperFor(band)}</span>` });
    }

    // VOICES. The first rung, and the one that lies to the interface — see voices.js. The
    // tier climbs with how far gone you are: mundane and aimed at nobody, then addressing
    // you by name, then not pretending to be a person in a room at all.
    const s = player.sanity ?? 100;
    if (s < VOICES_AT) {
      const tier = s < WARP_AT ? 3 : s < DISEMBODIED_AT ? 2 : 1;
      if (Math.random() < (VOICE_CHANCE[tier] ?? 0)) {
        speakVoice(player, tier, { disembodied: s < DISEMBODIED_AT });
      }
    }

    // Hallucinations (halluc + insane bands only).
    const phantomCap = PHANTOM_CAP[band] ?? 0;
    if (phantomCap && st.phantomIds.size < phantomCap && Math.random() < (band === 'insane' ? 0.9 : 0.6)) {
      conjurePhantom(player, st);
    }

    // DISSOCIATION. The last rung: the voices failed you, then the people, then the room, and
    // this is what is left. Never while asleep (you are already elsewhere) and never in the
    // middle of a fight — an episode you cannot act through would be a death sentence handed
    // out by a dice roll, which is cruelty rather than horror.
    if (dissociationEnabled && s < DISSOCIATE_AT && !isDissociating(player) && !player.in_combat
        && Date.now() - (st.lastDissociate || 0) > DISSOCIATE_COOLDOWN_MS
        && Math.random() < DISSOCIATE_CHANCE) {
      st.lastDissociate = Date.now();
      st.dissociateUntil = Date.now() + DISSOCIATE_MIN_MS + Math.random() * (DISSOCIATE_MAX_MS - DISSOCIATE_MIN_MS);
      // Fire-and-forget: buildDreamscape is async and the tick is not, and a failed build
      // simply means no episode this minute rather than a broken one.
      pendingDissociation = beginDissociation(player, { broadcast: getBroadcast() }).catch(() => {});
    }

    // THE ROOM STOPS HOLDING STILL. Bottom rung: once the voices and the people have both
    // failed you, the last thing left to doubt is the floor. Re-applied per tick (and on
    // every room change, because the transform is keyed to a zone) so it follows you.
    if (s < WARP_AT) {
      if (st.warpZone !== player.current_zone || Math.random() < 0.25) {
        st.warpZone = player.current_zone;
        setRoomTransform(player.id, player.current_zone, pick(ROOM_WARPS));
      }
    } else if (st.warpZone) {
      setRoomTransform(player.id, st.warpZone, null);
      st.warpZone = null;
    }
  }

  st.band = band;
}

// ── Event subscriptions ──────────────────────────────────────────────────────
// Death resets sanity to max (gameLoop) — tear our state down immediately so
// stray phantoms/insane don't survive the respawn. No FX push (the client is
// mid-death handling).
on('player.death', ({ player }) => { if (player?.id) { dropOurDissociation(player); resetPlayer(player, { sendClear: false }); } });

on('player.logout', ({ id }) => {
  // persistableZone already knows to write _bodyZone rather than a dreamscape id, but the
  // zone still has to be torn down or it leaks for the life of the process.
  dropOurDissociation(getLivePlayer(id));
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
