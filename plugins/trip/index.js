/**
 * Trip plugin — hallucination lifecycle + trippy client FX.
 *
 * Fires off the engine's `drug.used` hook (any drug whose effects carry a
 * `hallucination` block) and `drug.overdose`. FOUR modes, chosen per-drug — and
 * the split is about what the drug does to your relationship with reality, not
 * about how strong it is:
 *
 *   overlay   — the player does NOT move. Scripted timed descriptive events
 *               flood their client while their body stays in the real zone,
 *               still visible and attackable.
 *   dreamzone — DISSOCIATIVES (khole, deadair, threshold). You have left. An
 *               INSTANCED set of transient rooms is built per trip from
 *               `dream_templates`; the mind goes there and the real body stays in
 *               the real room, lootable and killable, exactly as a sleeper's does.
 *               There is no phantom body — see enterDreamzone.
 *   transform — PSYCHEDELICS (blotter, mescaline, psilocybin). You have NOT left.
 *               The room stays and misbehaves: furniture around you becomes
 *               something else and talks, for you only. See enterTransform.
 *   phantom   — DELIRIANTS (glasshollow, wraithdust). NO screen FX and NO "you
 *               are tripping" cue: fake people and animals walk into the player's
 *               real room and answer to look/examine/talk/attack as if real —
 *               until an interaction (a whiffed punch) reveals there was nothing.
 *
 * `transform` and `phantom` are two halves of one engine law (engine/phantoms.js):
 * a phantom ADDS what is not there, a transform RE-READS what is. Both are live
 * world, both are per-viewer, neither removes the player from play.
 *
 * All trip state is in-memory (activeTrips; phantoms and transforms in
 * engine/phantoms.js). Timers are stored so every exit path (expiry, overdose,
 * death, logout) can cancel them and tear down cleanly. A server restart loses
 * trips; `persistableZone` (world.js) stops a transient instance id ever reaching
 * the players row, and the login rescue in server/index.js catches the rest.
 *
 * See docs/systems-dreams.md.
 */
import { query } from '../../server/models/db.js';
import { getZone, world, getZoneNpcs, getZonePlayers, getZoneFurniture, addPlayerToZone, removePlayerFromZone } from '../../server/engine/world.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { on } from '../../server/engine/events.js';
import { addPhantom, removePhantom, clearPhantoms, getPhantomsInZone, matchPhantom, addTransform, addNpcTransform, addPlayerTransform, getNpcTransforms, clearTransforms, clearTransformsForRedress, beginTransformFade, getTransforms, setRoomTransform, setWeatherWarp } from '../../server/engine/phantoms.js';
import { buildDreamscape, dissolveDreamscape, isDreamZone } from '../../server/engine/dreamscape.js';
import { getRelation, relationTier } from '../../server/engine/relations.js';

// playerId -> { drugId, name, mode, endsAt, realZone, transformZone, timers[], intervals[], broadcast }
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

  const MODES = ['dreamzone', 'phantom', 'transform'];
  let mode = MODES.includes(hallu.mode) ? hallu.mode : 'overlay';
  // Resolve a missing pool HERE, before the mode is announced — the degrade paths
  // below run after trip_start has already gone out, so the client would get
  // dreamzone treatment for what is actually an overlay trip.
  if (mode === 'dreamzone' && !(await hasDreamTemplates(drug.id))) mode = 'overlay';
  if (mode === 'transform' && !(await hasTransforms(drug.id))) mode = 'overlay';
  const durationSec = hallu.duration_seconds || 120;
  const intensity = Math.max(0.1, Math.min(1, (hallu.intensity ?? 0.6) * (0.5 + 0.5 * (potency ?? 1))));
  const palette = hallu.palette || 'green';
  // Visual FX profile the flight sim reads to warp the out-the-window view
  // (authorable per drug; hallucinations default to the psychedelic treatment).
  const profile = hallu.fx_profile || 'psychedelic';
  const realZone = player.current_zone;

  const state = { drugId: drug.id, name: drug.name, mode, endsAt: Date.now() + durationSec * 1000, realZone, transformZone: null, timers: [], intervals: [], broadcast };
  activeTrips.set(player.id, state);

  // Phantom mode is deliberately silent: no screen-warp FX, no rainbow [trip]
  // text, no warped audio bed. The illusion is that there IS no drug — the fake
  // people and animals just walk in and act, dressed as real room life. So the
  // client-side "you are tripping" treatment is reserved for overlay/dreamzone.
  if (mode !== 'phantom') {
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
  }

  if (mode === 'dreamzone') await enterDreamzone(player, hallu, state);
  else if (mode === 'phantom') enterPhantom(player, hallu, state);
  else if (mode === 'transform') await enterTransform(player, state);

  // Auto-end.
  state.timers.push(setTimeout(() => endTrip(player.id, { reason: 'expire' }), durationSec * 1000));
}

async function enterDreamzone(player, hallu, state) {
  // INSTANCED, and the body stays put. Two changes from the old authored-zone
  // model, both deliberate:
  //
  //  1. Rooms are built per trip from `dream_templates` (see the fallback chain in
  //     dreamscape.js), so two players on the same drug no longer stand in the same
  //     room. A shared hallucination was never intended.
  //  2. There is NO phantom body any more. The player's real body stays in the real
  //     room's occupant set exactly as a sleeper's does — it is looted, attacked and
  //     killed directly, so the HP-mirroring and death-transfer that kept a fake
  //     body in sync are gone along with the fake body.
  const entry = await buildDreamscape(player.id, {
    size: 3 + Math.floor(Math.random() * 2),
    tether: { zone: getZone(state.realZone)?.name },
    cause: 'drug',
    drugId: state.drugId,
    broadcast: state.broadcast,
    player,   // lets the rooms borrow from this player's actual life
  });
  if (!entry) { state.mode = 'overlay'; return; }

  // Where the body really is — read by persistableZone, and by anything hunting a
  // slumped body. Mirrors `player.sleeping.bodyZone` on the sleep path.
  player._bodyZone = state.realZone;
  addPlayerToZone(player.id, state.realZone);   // idempotent; the body never left
  player.current_zone = entry;
  addPlayerToZone(player.id, entry);

  state.broadcast?.(state.realZone, { type: 'zone_event', message: `${player.handle}'s body slumps where they stand, eyes gone glassy and far away.`, refresh: true }, player.id);
  sendToPlayer(player.id, { type: 'force_look' });
}

// ── Transform mode ──────────────────────────────────────────────────────────
//
// A psychedelic does NOT remove you. The room stays and misbehaves: the furniture
// in front of you becomes something else, and talks to you. This is the other half
// of the phantom law (engine/phantoms.js) — a phantom adds what is not there, a
// transform re-reads what is.
//
// Live world on purpose. The uncanny needs a baseline to violate and your own room
// is a baseline; a dreamscape has already announced that the rules are off, so
// nothing in it can be uncanny. You also stay attackable, stay able to act, and
// keep playing while high.
async function enterTransform(player, state) {
  await applyTransformsHere(player, state);
  // Re-dress each new room as the player walks — the trip follows them.
  const iv = setInterval(() => {
    const p = world.players.get(player.id);
    // SELF-CANCEL. endTrip clears this on every known exit path, but "every known
    // path" is the assumption that has been wrong more than once here. A vanished
    // player means nothing left to dress, so stop rather than tick forever.
    if (!p) { clearInterval(iv); return; }
    if (p.current_zone !== state.transformZone) applyTransformsHere(p, state).catch(() => {});
    else {
      speakTransform(p, state).catch(() => {});
      // ...and occasionally somebody in the room notices you, not just on the way
      // in. A quarter of REACT_CHANCE keeps standing still quieter than arriving.
      npcNotices(p, p.current_zone, state, REACT_CHANCE / 4).catch(() => {});
    }
  }, 9000);
  state.intervals.push(iv);
}

const arr = (v) => (Array.isArray(v) ? v : []);
const one = (a) => a[Math.floor(Math.random() * a.length)];

/**
 * This trip's transform pool, fetched once. Fallback chain unchanged: this drug's
 * transforms, then the default set, then nothing (and the trip degraded at start).
 */
async function loadTransformPool(state) {
  if (state._transforms) return state._transforms;
  const { rows } = await query('SELECT * FROM drug_transforms WHERE drug_id=$1', [state.drugId]);
  const pool = rows.length ? rows
    : (await query('SELECT * FROM drug_transforms WHERE drug_id IS NULL')).rows;
  state._transforms = pool;
  return pool;
}

/**
 * Re-dress the room the player is standing in. Three layers, and the first one
 * ALWAYS fires — a psychedelic on a bare street corner must still be a
 * psychedelic, which the furniture-only version was not.
 *
 *   1. the ROOM itself gets a warp line appended to its description
 *   2. two or three pieces of furniture become something else, if there are any
 *   3. if the room is too bare to work with, objects are CONJURED that were
 *      never there — the phantom half of the same engine law
 */
async function applyTransformsHere(player, state) {
  // Re-dressing, not coming down: the old shapes are replaced by new ones a beat
  // later, so any pending comedown fade must go with them or a piece animates
  // back to its real name in the middle of the trip.
  clearTransformsForRedress(player.id);
  clearPhantoms(player.id);
  state.transformZone = player.current_zone;

  // Fetched ONCE per trip, not per room. This runs every time a tripping player
  // changes room, which the 9-second follow timer turns into a query every 9
  // seconds for anyone walking while high — a repeating DB cost driven by a
  // player holding a direction key. The transform pool for a given drug cannot
  // change mid-trip in any way that matters, so one fetch covers the whole trip.
  // Held on trip state, not module-level: it dies with the trip, so a dev-panel
  // edit is live for the next one and there is nothing to invalidate.
  const pool = await loadTransformPool(state);
  if (!pool.length) return;

  const scoped = (s) => pool.filter(t => (t.scope || 'object') === s);

  // ── 0. The weather, if there is any ────────────────────────────────────────
  // Appended to the REAL weather line rather than replacing it, so the actual
  // conditions stay legible — you are still in the rain, the rain has simply
  // stopped behaving. Indoors this is set and simply never rendered.
  const weatherPool = scoped('weather');
  if (weatherPool.length) {
    const wt = one(weatherPool);
    setWeatherWarp(player.id, player.current_zone, arr(wt.looks).length ? one(arr(wt.looks)) : wt.description);
  }

  // ── 1. The room itself ─────────────────────────────────────────────────────
  const roomPool = scoped('room');
  if (roomPool.length) {
    const r = one(roomPool);
    const line = arr(r.looks).length ? one(arr(r.looks)) : r.description;
    // The room's NAME goes with it. A room warp that leaves the header reading
    // "Ration Nine — Cold Store" is the trip telling you, in the one place you
    // look first, that the room is still the room.
    setRoomTransform(player.id, player.current_zone, line, r.name || null);
  }

  // ── 2. Real furniture ──────────────────────────────────────────────────────
  const objectPool = scoped('object');
  const furniture = getZoneFurniture(player.current_zone) || [];
  let dressed = 0;
  if (objectPool.length && furniture.length) {
    // Two or three pieces, never the whole room — the things that stay ordinary
    // are what make the changed ones land.
    const targets = [...furniture].sort(() => Math.random() - 0.5).slice(0, 2 + (Math.random() < 0.5 ? 1 : 0));
    for (const f of targets) {
      // A transform may narrow itself to a kind of thing by name; otherwise
      // anything in the room will do.
      const fits = objectPool.filter(t => !t.matches || (f.name || '').toLowerCase().includes(t.matches.toLowerCase()));
      const t = one(fits.length ? fits : objectPool);
      addTransform(player.id, f.id, {
        name: t.name, description: t.description, looks: arr(t.looks), says: arr(t.says),
        emotes: arr(t.emotes), asks: arr(t.asks),
      });
      dressed++;
    }
  }

  // ── 2b. The people in it ───────────────────────────────────────────────────
  // The room changing while the people in it stay ordinary is the version of
  // this that never quite lands: a bar full of normal drinkers around one
  // impossible chair reads as a bug in the chair. ONE person, at most two — the
  // ones who stay themselves are what make the changed one land, exactly as with
  // the furniture. Talking to them, and hitting them, still reaches the real
  // person (see commands/social.js and plugins/weapon).
  // A PERSON is a person. Other players are drawn from the same pool and the
  // same roll as the NPCs, because the drug does not know the difference and
  // neither should the authoring: a bar where the staff can turn into herons and
  // the customers never can is a rule the player will work out and then use.
  // They go in one shuffled list so the two or three that change are picked
  // across everybody in the room rather than one from each kind.
  const personPool = scoped('person');
  const npcsHere = (getZoneNpcs(player.current_zone) || []).map(n => ({ kind: 'npc', row: n }));
  const playersHere = (getZonePlayers(player.current_zone) || [])
    .filter(p => p.id !== player.id)
    .map(p => ({ kind: 'player', row: p }));
  const peopleHere = [...npcsHere, ...playersHere];
  if (personPool.length && peopleHere.length) {
    const targets = [...peopleHere].sort(() => Math.random() - 0.5).slice(0, 1 + (Math.random() < 0.35 ? 1 : 0));
    for (const { kind, row } of targets) {
      // `matches` narrows a transform to a kind of person by npc_type. A player
      // has no npc_type, so only unnarrowed entries fit one — which is correct:
      // a transform written for bartenders should not fire on a stranger.
      const against = kind === 'npc' ? (row.npc_type || '') : '';
      const fits = personPool.filter(t => !t.matches || against.toLowerCase().includes(t.matches.toLowerCase()));
      const t = one(fits.length ? fits : personPool.filter(x => !x.matches));
      if (!t) continue;
      const spec = {
        name: t.name, description: t.description, looks: arr(t.looks), says: arr(t.says),
        emotes: arr(t.emotes), asks: arr(t.asks),
      };
      if (kind === 'npc') addNpcTransform(player.id, row.id, spec);
      else addPlayerTransform(player.id, row.id, spec);
    }
  }

  // ── 3. Conjure, when there was too little to work with ─────────────────────
  // A street corner, a bare corridor, an empty lot. Without this the trip is
  // invisible in exactly the places a player is most likely to be standing.
  const spawnPool = scoped('spawn');
  if (spawnPool.length && dressed < 2) {
    const want = 2 - dressed;
    const picks = [...spawnPool].sort(() => Math.random() - 0.5).slice(0, want);
    picks.forEach((t, i) => {
      const id = `trip_obj_${player.id}_${i}`;
      addPhantom(player.id, {
        id, name: t.name, kind: 'object',
        description: t.description,
        looks: arr(t.looks), says: arr(t.says),
        emotes: arr(t.emotes), asks: arr(t.asks),
        zone: player.current_zone,
        hp: 1, hp_max: 1,
      });
    });
  }

  sendToPlayer(player.id, { type: 'force_look' });
}


// Something in the room says something to you, unprompted.
// A transform's OWN says[] wins when an author wrote one — that is where a
// specific thing's specific voice lives. Everything else draws from the shared
// pool, so a chair is not stuck with the three lines somebody typed for chairs,
// and so the mundane register reaches every object without being re-authored on
// every row.
const OWN_VOICE_SHARE = 0.4;

// ── Nothing announces itself ────────────────────────────────────────────────
//
// THE WHOLE TRICK IS THAT IT IS NOT A TRICK. A line reading "the bed says,
// without a mouth" tells the player two things it must never tell them: that
// there is still a bed, and that what is happening is a special case. There is
// no bed. There is a lion, and the lion talks the way anything in this game
// talks — same `speech-line` wrapper, same "X says, ..." attribution, same
// painted quotes the client gives an NPC. Read the log back afterwards and you
// cannot tell which of the speakers was real, which is the point.
//
// Three registers, because a thing that only ever TALKS is a talking chair, and
// a talking chair is a joke. Something that does things while you watch, and
// asks you questions about itself, is a presence.
const cap0 = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
// "a sleeping lion" -> "The sleeping lion". Subject form for an emote, matching
// how the engine writes any other third-person room action.
const theOf = (name) => {
  const n = String(name || 'thing').trim();
  const m = n.match(/^(?:a|an|the|some)\s+(.*)$/i);
  return `The ${m ? m[1] : n}`;
};
// Speech attribution EXACTLY as ai-behaviour.js and voices.js write it, so the
// forgery is byte-identical to the real thing (regress asserts this).
const speechLine = (name, verb, text) =>
  `<span class="speech-line">${cap0(name)} ${verb}, "${text}"</span>`;

async function speakTransform(player, state) {
  // Conjured objects speak too — they are transforms that happen not to be
  // attached to a real piece of furniture. No says[] filter any more: the shared
  // pool can speak for anything.
  const conjured = getPhantomsInZone(player.id, player.current_zone).filter(p => p.kind === 'object');
  // Transformed PEOPLE act and speak from the same pools. They are cleared and
  // re-rolled on every room change with the rest, so everything held here is in
  // the room the player is standing in.
  const all = [...getTransforms(player.id), ...getNpcTransforms(player.id), ...conjured];
  if (!all.length || Math.random() > 0.6) return;
  const t = all[Math.floor(Math.random() * all.length)];

  // Weighted toward ACTION. Something moving in the corner of a room you are
  // still standing in does more work than another sentence, and it is also what
  // keeps the talking rare enough to land.
  const roll = Math.random();
  const register = roll < 0.4 ? 'emote' : roll < 0.7 ? 'ask' : 'say';

  if (register === 'emote') {
    const line = own1(t.emotes) || (await drawReaction('object_emote', state))?.self_line || null;
    if (!line) return speakTransform_fallbackSay(player, state, t);
    // A per-player zone_event: the same channel real room life arrives on.
    sendToPlayer(player.id, { type: 'zone_event', message: fillTokens(line, { it: theOf(t.name), player: player.handle }) });
    return;
  }

  if (register === 'ask') {
    const line = own1(t.asks) || (await drawReaction('object_ask', state))?.self_line || null;
    if (!line) return speakTransform_fallbackSay(player, state, t);
    sendToPlayer(player.id, { type: 'output', message: speechLine(t.name, 'asks', fillTokens(line, { it: theOf(t.name), player: player.handle })) });
    return;
  }
  return speakTransform_fallbackSay(player, state, t);
}

async function speakTransform_fallbackSay(player, state, t) {
  const line = own1(t.says) || (await drawReaction('object', state))?.self_line || null;
  if (!line) return;
  sendToPlayer(player.id, { type: 'output', message: speechLine(t.name, 'says', fillTokens(line, { it: theOf(t.name), player: player.handle })) });
}
const own1 = (list) => (list?.length && Math.random() < OWN_VOICE_SHARE
  ? list[Math.floor(Math.random() * list.length)] : null);

async function killTripPlayer(player) {
  const { handlePlayerDeath } = await import('../../server/engine/gameLoop.js');
  await handlePlayerDeath(player, null, { type: 'drug', label: 'Died in a hallucination' });
}


// ── Degrade checks ──────────────────────────────────────────────────────────
//
// Run BEFORE the mode is announced to the client. Both modes now depend on
// authored content, and a drug with none must degrade to a working overlay trip
// rather than half-entering something that isn't there. Each is one cheap
// EXISTS against a small cold table, once per trip.
async function hasDreamTemplates(drugId) {
  const { rows } = await query(
    `SELECT 1 FROM dream_templates WHERE cause='drug' AND (drug_id=$1 OR drug_id IS NULL) LIMIT 1`, [drugId]);
  return rows.length > 0;
}

async function hasTransforms(drugId) {
  const { rows } = await query(
    `SELECT 1 FROM drug_transforms WHERE drug_id=$1 OR drug_id IS NULL LIMIT 1`, [drugId]);
  return rows.length > 0;
}

// ── Phantom mode ────────────────────────────────────────────────────────────
//
// A deliriant fills the CURRENT room with fake people and animals that read as
// ordinary room life. Each phantom arrives, lingers while emitting occasional
// "actions" (per-player zone_event emotes, styled exactly like NPC ambience),
// then leaves. The illusion follows the player: every timed beat refreshes the
// phantom's zone to wherever the player now is, so it is always "here". The
// phantom itself lives in the engine's per-player phantom registry, where the
// room look and target resolution pick it up.

// Fallback roster when a drug authors no `phantoms` array of its own.
const DEFAULT_PHANTOMS = [
  {
    name: 'a gaunt man in a hospital gown', kind: 'person', hp: 10,
    arrive: 'A gaunt man in a hospital gown shuffles in from the edge of the room and stops against the wall, watching you.',
    barks: [
      "The gaunt man's lips move, but no sound comes out.",
      'The gaunt man takes one slow step closer, still watching.',
      'The gaunt man tilts his head, studying you like a puzzle.',
    ],
    talk: "The gaunt man doesn't answer. He only watches, and smiles a little.",
    look: "He stands too still, gown stained grey at the hem. When you meet his eyes he doesn't blink, and his smile doesn't reach them.",
    depart: 'You glance away for a second, and when you look back the gaunt man is simply gone.',
    stay_frac: 0.7,
  },
  {
    name: 'a low black dog', kind: 'beast', hp: 14,
    arrive: 'A low black dog pads out from behind you, hackles up, and fixes on you with wet yellow eyes.',
    barks: [
      'The black dog growls, a sound you feel in your teeth.',
      'The black dog circles, never taking its eyes off you.',
    ],
    look: 'Its ribs show through matted fur and its jaw hangs slightly wrong. It watches you the way a thing watches food.',
    depart: "The black dog slinks into a shadow that's too shallow to hold it, and is gone.",
    stay_frac: 0.5,
  },
];

let _phantomSeq = 0;

// Per-player emote that renders identically to real NPC/ambient room activity.
function roomEmote(playerId, message) {
  sendToPlayer(playerId, { type: 'zone_event', message });
}

function enterPhantom(player, hallu, state) {
  const roster = Array.isArray(hallu.phantoms) && hallu.phantoms.length ? hallu.phantoms : DEFAULT_PHANTOMS;
  const totalMs = Math.max(10000, state.endsAt - Date.now());
  const pid = player.id;

  roster.forEach((tpl, i) => {
    const id = `ph_${pid}_${++_phantomSeq}`;
    // Stagger arrivals across the first ~40% of the trip.
    const spread = roster.length === 1 ? 0 : i / (roster.length - 1);
    const arriveAt = Math.floor(totalMs * (0.05 + 0.35 * spread));
    const stayMs = Math.floor((totalMs - arriveAt) * (tpl.stay_frac ?? 0.6));

    const spec = {
      id,
      name: tpl.name,
      kind: tpl.kind === 'person' ? 'person' : 'beast',
      hp: tpl.hp ?? 8,
      hp_max: tpl.hp_max ?? tpl.hp ?? 8,
      look: tpl.look || "It doesn't look quite right, though you couldn't say how.",
      talk: tpl.talk,
      depart: tpl.depart,
      zone: state.realZone,
    };

    // Arrival — conjure it into whatever room the player is standing in now.
    state.timers.push(setTimeout(() => {
      const p = world.players.get(pid);
      if (!p) return;
      spec.zone = p.current_zone;
      addPhantom(pid, spec);
      if (tpl.arrive) roomEmote(pid, tpl.arrive);
    }, arriveAt));

    // Barks spread across the stay; each refreshes the zone so it follows along.
    const barks = Array.isArray(tpl.barks) ? tpl.barks : [];
    if (barks.length && stayMs > 0) {
      const every = Math.max(12000, Math.floor(stayMs / (barks.length + 1)));
      for (let b = 0; b < barks.length; b++) {
        const at = arriveAt + every * (b + 1);
        if (at >= arriveAt + stayMs) break;
        state.timers.push(setTimeout(() => {
          const p = world.players.get(pid);
          if (!p) return;
          spec.zone = p.current_zone;
          roomEmote(pid, barks[b]);
        }, at));
      }
    }

    // Departure — it evaporates without ceremony.
    state.timers.push(setTimeout(() => {
      removePhantom(pid, id);
      if (tpl.depart && world.players.get(pid)) roomEmote(pid, tpl.depart);
    }, arriveAt + stayMs));
  });
}

// ── Phantom interactions (specialized-action intercepts) ─────────────────────
//
// Registered as SPECIALIZED ACTIONS (not commands) for verbs that would
// otherwise resolve a real target. Specialized actions compose — they fire in a
// list, each returning undefined to fall through — so we intercept WITHOUT
// clobbering the other plugins that own these verbs. Dispatch order matters and
// works out for free (commands index.js): plugin commands fire first (so
// flight's in-cockpit `examine`/`look` win while airborne), then these
// specialized actions, then the engine builtins. For `attack`/`kill`/`k` the
// weapon plugin is also a specialized action; the loader's alphabetical base
// order puts `trip` ahead of `weapon`, so a phantom-only target whiffs here
// before weapon can error on it — and matchPhantom already defers to any real
// enemy/npc/player, so a real attack is never stolen.
//
// Each helper returns a result ONLY when the target is one of the caller's
// phantoms; otherwise undefined, and the real handler downstream takes over.

const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

function phantomExamine(player, target) {
  const ph = target && matchPhantom(player, target);
  if (!ph) return undefined;
  // A conjured OBJECT carries looks[]/description like a transform rather than
  // the single `look` a person or beast gets — without this branch, examining a
  // thing the drug put in the room answered with an empty message.
  const look = arr(ph.looks).length ? one(arr(ph.looks)) : null;
  return { type: 'examine', message: `<span class="zone-name">${cap(ph.name)}</span>\n${look || ph.look || ph.description || "It doesn't look quite right, though you couldn't say how."}` };
}

async function phantomTalk(player, target) {
  // A TRANSFORMED thing answers first. These carry `says` and have been
  // volunteering lines at the player unprompted — being unable to talk back to
  // the chair that just spoke to you was the most obvious hole in the mode.
  const spoken = await talkToTransformed(player, target);
  if (spoken) return spoken;

  const ph = target && matchPhantom(player, target);
  if (!ph) return undefined;
  if (ph.talk) return { type: 'output', message: ph.talk };
  const line = ph.kind === 'person'
    ? `${cap(ph.name)} doesn't answer. It just watches you.`
    : `${cap(ph.name)} doesn't react to you at all.`;
  return { type: 'output', message: line };
}

/**
 * Talk to a transformed piece of furniture, or to a conjured object.
 *
 * Answers from the same `says` pool the ambient beat draws on, so the thing has
 * one voice whether it speaks first or you do. Returns undefined when nothing
 * matches, so the normal talk handler still gets its turn.
 */
async function talkToTransformed(player, target) {
  const t = (target || '').toLowerCase().trim();
  if (!t) return undefined;
  const candidates = hallucinationsHere(player)
    .filter(c => (c.name || '').toLowerCase().includes(t));
  if (!candidates.length) return undefined;
  const c = candidates[0];
  // A CONVERSATION, not a line. Opens the ordinary dialogue panel against the
  // shape in front of you — a transformed PERSON included, which is the one case
  // where the two readings of `talk` diverge on purpose: their real name reaches
  // the person and their dialogue tree, the shape's name reaches the shape.
  return openConversation(player, c);
  // Same rule as the unprompted beat: its own authored voice sometimes, the
  // shared pool otherwise — so a thing answers in the same register whether it
  // spoke first or you did, and nothing is ever mute for want of a says[].
  const state = activeTrips.get(player.id);
  // It may well answer a question with a question — the same three registers the
  // unprompted beat uses, and rendered identically to an NPC replying to you.
  const asking = Math.random() < 0.35;
  let line = own1(asking ? c.asks : c.says);
  if (!line) line = (await drawReaction(asking ? 'object_ask' : 'object', state || null))?.self_line || null;
  if (!line) line = (await drawReaction('object', state || null))?.self_line || null;
  if (!line) return undefined;
  const tokens = { it: theOf(c.name), player: player.handle };
  return { type: 'output', message: speechLine(c.name, asking ? 'asks' : 'says', fillTokens(line, tokens)) };
}

// ── Conversations with things that are not there ────────────────────────────
//
// One line back was never a conversation — you spoke to a lion and it said one
// sentence at you. This runs the real dialogue panel, so talking to the shape in
// front of you looks EXACTLY like talking to a person: same panel, same speaker
// name, same option list. There is no `npcs` row, so it rides the engine's
// `dialogue.synthetic` seam (server/index.js) under an id the plugin owns.
//
// The branches are the point. Every one of them is something you can only say to
// a hallucination, and the thing has an answer for each — including the one that
// matters, which is telling it that it is not real.
const CONV_PREFIX = 'trip:';
// playerId -> { key, name, kind, spec, turns }
const conversations = new Map();

// What a reply DRAWS ON. Each maps to a `drug_reactions` source, so the writing
// lives in content and the branch structure lives here.
const BRANCHES = [
  { key: 'answer',   label: 'Answer it.',                        source: 'object_reply_answer' },
  { key: 'identity', label: 'Ask what it was before this.',      source: 'object_reply_identity' },
  { key: 'denial',   label: "Tell it you know it isn't real.",   source: 'object_reply_denial' },
  { key: 'listen',   label: 'Say nothing and let it talk.',      source: 'object' },
];
const MAX_TURNS = 5;   // it winds down rather than looping forever

const convKeyOf = (c) => CONV_PREFIX + (c.furnitureId || c.npcId || c.id);

// Everything in the room this viewer could be talking to — real furniture
// wearing another shape, a person wearing another shape, or something conjured.
function hallucinationsHere(player) {
  return [
    ...getTransforms(player.id),
    ...getNpcTransforms(player.id),
    ...getPhantomsInZone(player.id, player.current_zone).filter(p => p.kind === 'object'),
  ];
}

// The frame the dialogue panel renders. `text` is already the thing's speech —
// the panel prints it as the speaker's line, exactly as it does for an NPC.
function convFrame(conv, text, { closing } = {}) {
  const options = closing ? [] : [
    ...BRANCHES.map(b => ({ label: b.label, next: b.key })),
    { label: 'Leave it alone.', next: '__end__' },
  ];
  return {
    type: 'dialogue',
    npcId: conv.key,
    npcName: cap(conv.name),
    node: closing ? '__end__' : 'root',
    text,
    options,
    stage: '',
    mood: null,
  };
}

async function openConversation(player, thing) {
  const conv = { key: convKeyOf(thing), name: thing.name, spec: thing, turns: 0 };
  conversations.set(player.id, conv);
  const state = activeTrips.get(player.id) || null;
  // It opens the way it has been opening all trip: with a question about itself.
  const opener = own1(thing.asks)
    || (await drawReaction('object_ask', state))?.self_line
    || own1(thing.says)
    || (await drawReaction('object', state))?.self_line
    || 'Yes?';
  return convFrame(conv, fillTokens(opener, { it: theOf(thing.name), player: player.handle }));
}

/**
 * One exchange. Returns the next dialogue frame, or a `dialogue_end` when the
 * conversation is over — the panel closes and the log says why.
 *
 * RE-VALIDATED EVERY TURN, like every other ongoing loop in the game: the trip
 * can end, the drug can wear off, you can walk out. When the shape is gone, the
 * conversation is over and it says so in the only way that fits — you are
 * talking to a chair.
 */
async function advanceConversation(player, choice) {
  const conv = conversations.get(player.id);
  if (!conv) return null;
  const still = hallucinationsHere(player).find(t => convKeyOf(t) === conv.key);
  if (!still) {
    conversations.delete(player.id);
    return { type: 'dialogue_end', message: '<span class="msg-ambient">You\'re talking to a chair. It\'s a chair.</span>' };
  }
  if (choice === '__end__') {
    conversations.delete(player.id);
    const state = activeTrips.get(player.id) || null;
    const bye = (await drawReaction('object_reply_farewell', state))?.self_line;
    return {
      type: 'dialogue_end',
      message: bye
        ? `<span class="speech-line">${cap(conv.name)} says, "${fillTokens(bye, { it: theOf(conv.name), player: player.handle })}"</span>`
        : `<span class="msg-ambient">You stop talking to ${theOf(conv.name).toLowerCase()}.</span>`,
    };
  }

  const branch = BRANCHES.find(b => b.key === choice) || BRANCHES[0];
  const state = activeTrips.get(player.id) || null;
  const line = (await drawReaction(branch.source, state))?.self_line
    || own1(conv.spec.says)
    || (await drawReaction('object', state))?.self_line
    || '...';
  conv.turns++;

  const tokens = { it: theOf(conv.name), player: player.handle };
  let text = fillTokens(line, tokens);
  // It runs out of conversation rather than looping. The last thing it says is
  // an ACTION, not a line — it goes back to whatever it was doing, and the panel
  // shuts with no options left to press.
  if (conv.turns >= MAX_TURNS) {
    const emote = own1(conv.spec.emotes) || (await drawReaction('object_emote', state))?.self_line;
    conversations.delete(player.id);
    return {
      type: 'dialogue_end',
      message: `<span class="speech-line">${cap(conv.name)} says, "${text}"</span>${emote ? `\n<span class="msg-ambient">${fillTokens(emote, tokens)}</span>` : ''}`,
    };
  }
  return convFrame(conv, text);
}

// Nobody carries a conversation out of a trip.
function endConversation(playerId) { conversations.delete(playerId); }

function pickWitness(player) {
  const npcs = getZoneNpcs(player.current_zone);
  if (npcs.length) return npcs[Math.floor(Math.random() * npcs.length)].name;
  const others = getZonePlayers(player.current_zone).filter((p) => p.id !== player.id);
  if (others.length) return others[Math.floor(Math.random() * others.length)].handle;
  return null;
}

// The reveal: you swing and connect with nothing. The phantom evaporates and a
// real witness (if any) reacts — which is how the illusion breaks, diegetically,
// with no "you are hallucinating" banner.
function phantomWhiff(player, target) {
  const ph = target && matchPhantom(player, target);
  if (!ph) return undefined;
  removePhantom(player.id, ph.id);
  const witness = pickWitness(player);
  const reaction = witness
    ? ` ${cap(witness)} stares. "The hell are you swinging at?"`
    : ' There was never anything there.';
  return {
    type: 'output',
    message: `<span class="msg-combat">You lunge at ${ph.name} — and your fist passes through empty air. ${cap(ph.name)} isn't there. It never was.</span>${reaction}`,
  };
}

const whiffAction = (args, raw, player) => phantomWhiff(player, args.join(' '));
const examineAction = (args, raw, player) => phantomExamine(player, args.join(' '));
const talkAction = (args, raw, player) => phantomTalk(player, args.join(' '));

export const specializedActions = [
  { verb: 'attack', handler: whiffAction },
  { verb: 'kill', handler: whiffAction },
  { verb: 'k', handler: whiffAction },
  { verb: 'examine', handler: examineAction },
  { verb: 'look', handler: examineAction },
  { verb: 'talk', handler: talkAction },
];

// Single teardown for every exit path. Idempotent.
// reasons: 'expire' | 'overdose' | 'death' | 'silent'
function endTrip(playerId, { reason } = {}) {
  const state = activeTrips.get(playerId);
  if (!state) return;
  activeTrips.delete(playerId); // delete first — re-entrancy guard

  state.timers.forEach(clearTimeout);
  state.intervals.forEach(clearInterval);
  clearPhantoms(playerId);
  // Coming down where the player can watch it: snapshot what they are being
  // shown FIRST, so the next render animates the room back to the truth the same
  // way it animated away from it. Skipped on death and on a silent logout
  // teardown — nobody is looking, and a fade left in memory for either would
  // fire on some unrelated later look.
  const fading = (reason !== 'death' && reason !== 'silent') ? beginTransformFade(playerId) : null;
  clearTransforms(playerId);   // the room stops misbehaving
  forgetSaid(playerId);        // nobody carries this trip into the next one
  endConversation(playerId);   // and nothing is still mid-sentence

  const player = world.players.get(playerId);

  // Out of the instance and back into the body. No TELEPORT: the body never left
  // the real room, so this is the same move wakeFromDream makes for a sleeper —
  // put current_zone back and dissolve the rooms. Skipped on death, which has
  // already relocated the player, and on a silent logout teardown (the rooms are
  // still dissolved either way, or they leak for the life of the process).
  if (state.mode === 'dreamzone' && player) {
    if (reason !== 'death' && reason !== 'silent' && isDreamZone(player.current_zone)) {
      removePlayerFromZone(player.id, player.current_zone);
      player.current_zone = getZone(state.realZone) ? state.realZone : (player.anchor_zone || 'zone_start');
      addPlayerToZone(player.id, player.current_zone);
      sendToPlayer(playerId, { type: 'force_look' });
    }
    delete player._bodyZone;
  }
  if (state.mode === 'dreamzone') dissolveDreamscape(playerId);

  if (reason !== 'silent' && player) {
    // Phantom mode never sent trip_start and has no screen treatment, so it
    // needs no trip_end teardown or "colours drain back" line — the figures
    // simply stop coming, and the last ones vanish next time the room is looked
    // at. The unexplained absence is the intended come-down.
    if (state.mode !== 'phantom') {
      sendToPlayer(playerId, { type: 'trip_end' });
      if (reason !== 'death') sendToPlayer(playerId, { type: 'output', message: '<span class="msg-system">The colours drain back to grey. You come down.</span>' });
    }
    // Re-look so the comedown is WATCHED rather than discovered. Without this the
    // room only corrects itself the next time the player happens to look, which
    // for anyone standing still is minutes later and reads as a glitch. The
    // dreamzone branch above has already forced one; a fade with nothing left to
    // animate is what makes a second harmless, but there is no reason to send it.
    if (fading && state.mode !== 'dreamzone') sendToPlayer(playerId, { type: 'force_look' });
  }
}

// ── Event subscriptions ─────────────────────────────────────────────────────

// Logout mid-trip: persist the real zone (so a dreamzone player doesn't log
// back inside the trip) and tear down silently.
on('player.logout', ({ id }) => {
  forgetSaid(id);
  endConversation(id);
  const state = activeTrips.get(id);
  if (!state) return;
  if (state.mode === 'dreamzone') {
    // The hand-rolled "put current_zone back" write is gone: persistableZone in
    // world.js now refuses to persist a transient id for ANY writer, falling back
    // to _bodyZone, so the disconnect checkpoint already stores the real room.
    // endTrip below dissolves the instance so its rooms and timer don't leak.
    const p = world.players.get(id);
    if (p && isDreamZone(p.current_zone)) p.current_zone = state.realZone;
  }
  endTrip(id, { reason: 'silent' });
});

// Death mid-trip (from anything): clear the overlay, despawn the phantom, no re-teleport.
on('player.death', ({ player }) => {
  if (player?.id) endTrip(player.id, { reason: 'death' });
});

// ── Social reactions: people can tell ───────────────────────────────────────
//
// A transform trip leaves you in the world and functional, which is most of why
// it is the right mode for a psychedelic — but it also meant nobody could tell.
// You could stand in a bar talking to a chair and the room had no opinion.
//
// So: walk into a room while visibly gone and somebody says something. Reactions
// are the ROOM's, not the drug's — the tripper is told how they are being seen,
// and everyone else is told what they are seeing, which are different sentences.
/**
 * Draw a line from the shared `drug_reactions` pool.
 *
 * THE NORMAL LINES ARE THE POINT. A pool of nothing but cosmic pronouncements
 * becomes wallpaper within one trip — the player learns the register and stops
 * reading. Mixing in flat, domestic lines ("Did you ever sort out the bins?"),
 * delivered by a chair, is what keeps the surreal ones landing, because you
 * genuinely cannot tell which of them just happened.
 *
 * So `normal` is not a fallback, it is weighted in on purpose, and drawn as its
 * own roll rather than shuffled into one list — otherwise adding surreal content
 * would quietly dilute the mundane out of existence.
 */
const NORMAL_SHARE = 0.4;

/**
 * The reaction pool for one trip, fetched ONCE and held on the trip's state.
 *
 * This used to query per spoken line, which put a round trip on a 9-second
 * repeating timer — the only thing in the whole feature that hit the DB on a
 * clock rather than on an event. A single tripper cost a handful of queries a
 * minute for the length of their trip, and it scaled with concurrent trippers
 * rather than with anything a player did.
 *
 * The pool is ~42 rows and cannot change mid-trip in any way that matters, so one
 * fetch per trip is strictly better. It is NOT a module-level cache: it dies with
 * the trip, so a dev-panel edit is live for the very next trip and there is still
 * nothing to invalidate.
 */
async function loadReactionPool(state) {
  if (state._reactions) return state._reactions;
  const { rows } = await query(
    `SELECT * FROM drug_reactions WHERE drug_id IS NULL OR drug_id=$1`, [state.drugId || null]);
  state._reactions = rows;
  return rows;
}

/**
 * What this NPC has already said to this player during this trip.
 *
 * Without it an NPC asks whether you are all right, you walk out and back in, and
 * it asks again — which reads as a broken robot rather than a person. Keyed per
 * (player, npc) and dropped wholesale when the trip ends, so it needs no eviction
 * and cannot leak across trips.
 */
const saidRecently = new Map();   // `${playerId}:${npcId}` -> { at, used: Set<lineId> }
const NPC_SILENCE_MS = 45000;     // one NPC will not comment twice inside this

function npcMaySpeak(playerId, npcId) {
  const rec = saidRecently.get(`${playerId}:${npcId}`);
  return !rec || Date.now() - rec.at >= NPC_SILENCE_MS;
}
function rememberSaid(playerId, npcId, lineId) {
  const key = `${playerId}:${npcId}`;
  const rec = saidRecently.get(key) || { at: 0, used: new Set() };
  rec.at = Date.now();
  rec.used.add(lineId);
  saidRecently.set(key, rec);
}
function forgetSaid(playerId) {
  for (const k of saidRecently.keys()) if (k.startsWith(`${playerId}:`)) saidRecently.delete(k);
}

/**
 * Narrow a pool to the lines that fit this NPC and this relationship.
 *
 * SPECIFIC WINS, but only if something specific exists. A line scoped to a tier
 * or a trade is a specialisation layered over the general pool — so a medic who
 * happens to be a close friend gets the medic lines, a close friend with no
 * scoped lines still gets the general ones, and no combination can leave an NPC
 * with nothing to say.
 */
function scopeToNpc(pool, npc, tier) {
  const byType = npc?.npc_type ? pool.filter(r => r.npc_type === npc.npc_type) : [];
  if (byType.length) return byType;
  const byRelation = tier ? pool.filter(r => r.relation === tier) : [];
  if (byRelation.length) return byRelation;
  return pool.filter(r => !r.npc_type && !r.relation);
}

function drawReactionFrom(pool, source) {
  const tone = Math.random() < NORMAL_SHARE ? 'normal' : 'surreal';
  // Drug-specific lines sit ON TOP of the shared pool rather than replacing it —
  // unlike rooms and transforms, where a scoped set means the drug has its own
  // identity. Here the shared pool IS the register, and the per-drug lines are
  // seasoning; excluding them would leave a drug with three lines on repeat.
  const bySource = pool.filter(r => r.source === source);
  const inTone = bySource.filter(r => r.tone === tone);
  // Nothing in that register — fall back to any line of this source rather than
  // going silent, so a half-authored pool still produces something.
  const from = inTone.length ? inTone : bySource;
  return from.length ? from[Math.floor(Math.random() * from.length)] : null;
}

async function drawReaction(source, drugIdOrState) {
  // Accepts a trip state (pooled) or a bare drug id (one-off callers).
  const state = typeof drugIdOrState === 'object' && drugIdOrState ? drugIdOrState : null;
  if (state) return drawReactionFrom(await loadReactionPool(state), source);
  const { rows } = await query(
    `SELECT * FROM drug_reactions WHERE drug_id IS NULL OR drug_id=$1`, [drugIdOrState || null]);
  return drawReactionFrom(rows, source);
}

// {it} is the transformed thing in subject form ("The sleeping lion") — the one
// token a shared object line needs, and what lets ONE emote pool fit every shape
// a room can take.
const fillTokens = (s, { npc, player, it } = {}) =>
  String(s || '')
    .replace(/\{npc\}/g, npc || 'somebody')
    .replace(/\{player\}/g, player || 'somebody')
    .replace(/\{it\}/g, it || 'It');

// One reaction per room-entry at most, and not every time — a room that comments
// on your state every single move stops being a world and starts being a nag.
const REACT_CHANCE = 0.5;

/**
 * Somebody in the room notices what state you are in.
 *
 * Fires on room ENTRY and, more rarely, while you are simply standing there —
 * entry-only meant a bar full of people commented once at the door and then never
 * again, which made pacing the doorway the only way to see the content.
 *
 * The line is chosen for the specific NPC and your specific history with them
 * (see scopeToNpc), and each NPC then shuts up for a while, so nobody asks you
 * the same question twice in a minute.
 */
async function npcNotices(actor, zone, state, chance) {
  if (!state || state.mode !== 'transform') return;
  if (Math.random() > chance) return;
  const npcs = (getZoneNpcs(zone) || []).filter(n => npcMaySpeak(actor.id, n.id));
  if (!npcs.length) return;
  // ONE npc, not the whole room — a chorus reads as a bug, and the point is that
  // somebody noticed, not that everybody did.
  const npc = npcs[Math.floor(Math.random() * npcs.length)];

  // Relations are in memory (hydrated at login, sync by contract) — no query.
  const tier = relationTier(getRelation(actor, npc.id));
  const pool = scopeToNpc(await loadReactionPool(state), npc, tier)
    .filter(r => r.source === 'npc');
  if (!pool.length) return;
  const fresh = pool.filter(r => !saidRecently.get(`${actor.id}:${npc.id}`)?.used.has(r.id));
  const r = drawReactionFrom(fresh.length ? fresh : pool, 'npc');
  if (!r) return;

  rememberSaid(actor.id, npc.id, r.id);
  const tokens = { npc: npc.name, player: actor.handle };
  sendToPlayer(actor.id, { type: 'output', message: `<span class="msg-ambient">${fillTokens(r.self_line, tokens)}</span>` });
  if (r.room_line) state.broadcast?.(zone, { type: 'zone_event', message: fillTokens(r.room_line, tokens) }, actor.id);
}

// Only `transform`: a dreamzone tripper cannot walk, an overlay trip is internal,
// and a deliriant is deliberately undetectable — its whole premise is that there
// is no drug. (The LAW is handled separately and already works: a hallucinogen
// sets `_visibleDrug`, so surveillance raises `public_intoxication` on entry
// regardless of any of this.)
on('zone.entered', async ({ actor, zone }) => {
  try {
    await npcNotices(actor, zone, actor?.id && activeTrips.get(actor.id), REACT_CHANCE);
  } catch (e) { console.error('[trip] social reaction:', e.message); }
});

// Test seams for the social layer — pure functions over (pool, npc, tier) and a
// per-(player,npc) memory map, so regress can assert the scoping and the silence
// without a live room.
export const _speechLine = speechLine;
export const _fillTokens = fillTokens;
export const _theOf = theOf;
export const _scopeToNpc = scopeToNpc;
export const _npcMaySpeak = npcMaySpeak;
export const _rememberSaid = rememberSaid;
export const _forgetSaid = forgetSaid;

export const hooks = {
  // The engine routes any dialogue whose npcId isn't an NPC row through here.
  // Claim only our own prefix — another plugin may own its own synthetic
  // speaker, and answering for it would steal the conversation.
  'dialogue.synthetic': async ({ player, npcId, choice }) => {
    if (!player || typeof npcId !== 'string' || !npcId.startsWith(CONV_PREFIX)) return undefined;
    const conv = conversations.get(player.id);
    if (!conv || conv.key !== npcId) {
      return { type: 'dialogue_end', message: '<span class="msg-ambient">Whatever you were talking to has stopped being there.</span>' };
    }
    return (await advanceConversation(player, choice)) ?? undefined;
  },
  'drug.used': (payload) => startTrip(payload).catch(e => console.error('[trip] startTrip:', e.message)),
  'drug.overdose': ({ player }) => { if (player?.id) endTrip(player.id, { reason: 'overdose' }); },
};
