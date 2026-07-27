import { getZone, isEnterableFacade, getMapByParentZone } from '../../server/engine/world.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { exitTargets } from '../../server/engine/exits.js';

const DIR_ALIASES = {
  n: 'north', s: 'south', e: 'east', w: 'west', u: 'up', d: 'down',
  north: 'north', south: 'south', east: 'east', west: 'west',
  up: 'up', down: 'down', in: 'in', out: 'out',
  ne: 'northeast', nw: 'northwest', se: 'southeast', sw: 'southwest',
  northeast: 'northeast', northwest: 'northwest', southeast: 'southeast', southwest: 'southwest',
};

// Filler words appearing between "knock" and the direction in any accepted syntax:
// "knock on north", "knock door north", "knock on door to the north".
const FILLERS = new Set(['on', 'door', 'to', 'the', 'at']);

// Three door-raps as a single SFX using per-layer delay.
// Each rap = body thud (bandpass noise) + click transient (highpass noise) + sub-thud (sine).
function rapLayers(offsetSec) {
  return [
    {
      noiseMix: 0.8,
      filter: { type: 'bandpass', freq: 280, q: 3.5 },
      adsr: { a: 0.001, d: 0.06, s: 0, r: 0.18 },
      gain: 0.85,
      delay: offsetSec,
    },
    {
      noiseMix: 1,
      filter: { type: 'highpass', freq: 1800, q: 1.0 },
      adsr: { a: 0.001, d: 0.02, s: 0, r: 0.04 },
      gain: 0.45,
      delay: offsetSec,
    },
    {
      waveform: 'sine',
      freq: 55,
      pitchBend: { to: 30, time: 0.15 },
      adsr: { a: 0.001, d: 0.12, s: 0, r: 0.08 },
      gain: 0.5,
      delay: offsetSec,
    },
  ];
}

const SFX_KNOCK = {
  id: 'sfx_knock',
  name: 'sfx_knock',
  category: 'sfx',
  priority: 7,
  config: {
    duration: 1.0,
    layers: [
      ...rapLayers(0),
      ...rapLayers(0.28),
      ...rapLayers(0.56),
    ],
  },
};

function directionLabel(dir) {
  const cardinal = ['north', 'south', 'east', 'west', 'northeast', 'northwest', 'southeast', 'southwest'];
  return cardinal.includes(dir) ? `to the ${dir}` : dir;
}

async function cmdKnock(args, raw, player, broadcast) {
  const words = (args || []).map(w => w.toLowerCase()).filter(w => !FILLERS.has(w));
  const dirWord = words[words.length - 1];
  const direction = dirWord ? DIR_ALIASES[dirWord] : null;

  if (!direction) {
    return { type: 'error', message: 'Knock which way? (e.g. "knock north" or "knock on door to the north")' };
  }

  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'Your zone is missing.' };

  let targetId = exitTargets(zone, direction)[0];
  if (!targetId) {
    const cardinal = ['north', 'south', 'east', 'west'].includes(direction);
    return { type: 'error', message: cardinal ? `There's no door to the ${direction}.` : `There's no door ${direction}.` };
  }

  let targetZone = getZone(targetId);
  if (!targetZone) return { type: 'error', message: 'That exit leads nowhere.' };

  // Knocking on a building means knocking on the people INSIDE it. A facade is never
  // stood on — stepping toward it forwards you through to the interior entry in one
  // move — so the tile in that direction is the building's outward face, not a room.
  // Without this hop every knock at a shop door answered "open air on the other side"
  // (a facade's ambient_theme is 'outdoors'), and the knock reached nobody. Same root
  // cause as the door verbs: reach through the facade to the seam behind it.
  if (isEnterableFacade(targetZone)) {
    const entryId = getMapByParentZone(targetZone.id)?.entry_zone_id;
    const entry = entryId ? getZone(entryId) : null;
    if (entry) { targetId = entryId; targetZone = entry; }
  }

  // Block outdoor targets.
  if ((targetZone.ambient_theme || 'indoors') !== 'indoors') {
    return { type: 'error', message: `You rap on the wall, but there's open air on the other side.` };
  }

  // Block cross-floor targets.
  if ((zone.grid_z ?? 0) !== (targetZone.grid_z ?? 0)) {
    return { type: 'error', message: `The knock fades into the floor. You'd need to find the stairs.` };
  }

  const label = directionLabel(direction);
  const audioMsg = { type: 'audio_sfx', def: SFX_KNOCK };

  // Audio to the knocker's zone (all players including the knocker).
  sendToZone(player.current_zone, audioMsg);

  // Text to others in the knocker's zone (not the knocker).
  broadcast(
    player.current_zone,
    { type: 'zone_event', message: `${player.handle} knocks on the door ${label}.` },
    player.id,
  );

  // Text + audio to the target room.
  sendToZone(targetId, {
    type: 'ambient',
    message: '<span class="msg-ambient">You hear a knock on the door.</span>',
  });
  sendToZone(targetId, audioMsg);

  return { type: 'output', message: `You knock on the door ${label}.` };
}

export const commands = { knock: cmdKnock };
