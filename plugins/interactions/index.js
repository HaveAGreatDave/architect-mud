import { getEnvironmentState, getZoneVisibility } from '../../server/engine/environment.js';
import { getZone, getZonePlayers, getZoneNpcs, setLivePlayer } from '../../server/engine/world.js';
import { query } from '../../server/models/db.js';

// ---------------------------------------------------------------------------
// Context helpers
// ---------------------------------------------------------------------------

function getCtx(player) {
  let env, vis;
  try { env = getEnvironmentState(); } catch { env = {}; }
  try { vis = getZoneVisibility(player.current_zone); } catch { vis = { category: 'clear', visibility: 1 }; }
  const zone = getZone(player.current_zone);
  return { env, vis, zone };
}

function posture(player) { return player.posture || 'standing'; }

// Returns a short environmental modifier string appended to descriptions.
function envMod(env, vis) {
  const parts = [];
  if (vis.category === 'pitch_dark') parts.push('in complete darkness');
  else if (vis.category === 'dark') parts.push('in the dim light');
  if (env.currentPrecip === 'rain') parts.push('as rain falls around you');
  else if (env.currentPrecip === 'snow') parts.push('as snow drifts down');
  if (['storm','thunderstorm'].includes(env.weatherType)) parts.push('amid crashing thunder');
  else if (env.weatherType === 'blizzard') parts.push('against the howling blizzard');
  return parts.length ? ` — ${parts.join(', ')}` : '';
}

// Broadcast zone_event and return emote for the player.
function doEmote(selfMsg, zoneMsg, player, broadcast) {
  broadcast(player.current_zone, { type: 'zone_event', message: zoneMsg }, player.id);
  return { type: 'emote', message: selfMsg };
}

// ---------------------------------------------------------------------------
// Posture commands
// ---------------------------------------------------------------------------

async function cmdSit(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  const mod = envMod(env, vis);

  // Targeted furniture sit
  const target = stripPrep(args, ['on', 'at', 'in']);
  if (target) {
    const { rows } = await query(
      `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
      [player.current_zone, `%${target}%`]
    );
    if (!rows.length) return { type: 'emote', message: `There is no ${target} here to sit on.` };
    if (posture(player) === 'sitting') {
      return { type: 'emote', message: `You are already sitting on the ${rows[0].name}.` };
    }
    setLivePlayer(player.id, { ...player, posture: 'sitting' });
    return doEmote(
      `You settle onto the ${rows[0].name}${mod}.`,
      `${player.handle} settles onto the ${rows[0].name}.`,
      player, broadcast
    );
  }

  if (posture(player) === 'sitting') return { type: 'emote', message: 'You are already sitting.' };

  // Check for any sittable furniture in zone
  const { rows: chairs } = await query(
    `SELECT name FROM furniture WHERE zone_id=$1 AND (object_type='furniture' OR object_type IS NULL) LIMIT 1`,
    [player.current_zone]
  );
  if (chairs.length) {
    setLivePlayer(player.id, { ...player, posture: 'sitting' });
    return doEmote(
      `You sit down on the ${chairs[0].name}${mod}.`,
      `${player.handle} sits down on the ${chairs[0].name}.`,
      player, broadcast
    );
  }

  // Bare floor sit
  setLivePlayer(player.id, { ...player, posture: 'sitting' });
  return doEmote(
    `You sit down on the floor${mod}.`,
    `${player.handle} sits down.`,
    player, broadcast
  );
}

async function cmdLie(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  const mod = envMod(env, vis);
  const target = stripPrep(args, ['on', 'down', 'in']);
  if (target) {
    const { rows } = await query(
      `SELECT * FROM furniture WHERE zone_id=$1 AND name ILIKE $2 LIMIT 1`,
      [player.current_zone, `%${target}%`]
    );
    if (!rows.length) return { type: 'emote', message: `There is no ${target} here to lie on.` };
    if (posture(player) === 'lying') return { type: 'emote', message: `You are already lying on the ${rows[0].name}.` };
    setLivePlayer(player.id, { ...player, posture: 'lying' });
    return doEmote(
      `You lie down on the ${rows[0].name}${mod}.`,
      `${player.handle} lies down on the ${rows[0].name}.`,
      player, broadcast
    );
  }
  if (posture(player) === 'lying') return { type: 'emote', message: 'You are already lying down.' };
  setLivePlayer(player.id, { ...player, posture: 'lying' });
  return doEmote(
    `You lie down on the floor${mod}.`,
    `${player.handle} lies down.`,
    player, broadcast
  );
}

function cmdStand(args, raw, player, broadcast) {
  if (posture(player) === 'standing') return { type: 'emote', message: 'You are already standing.' };
  setLivePlayer(player.id, { ...player, posture: 'standing' });
  return doEmote('You stand up.', `${player.handle} stands up.`, player, broadcast);
}

function cmdKneel(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  const mod = envMod(env, vis);
  if (posture(player) === 'kneeling') return { type: 'emote', message: 'You are already kneeling.' };
  setLivePlayer(player.id, { ...player, posture: 'kneeling' });
  return doEmote(
    `You kneel down${mod}.`,
    `${player.handle} kneels down.`,
    player, broadcast
  );
}

// ---------------------------------------------------------------------------
// Physical actions
// ---------------------------------------------------------------------------

function cmdStretch(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  const mod = envMod(env, vis);
  const postureNote = posture(player) !== 'standing' ? ` from your ${posture(player)} position` : '';
  return doEmote(
    `You stretch out${postureNote}${mod}.`,
    `${player.handle} stretches.`,
    player, broadcast
  );
}

function cmdWave(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  if (vis.category === 'pitch_dark') return { type: 'emote', message: "You wave, though no one can see it in the dark." };
  const target = stripPrep(args, ['at', 'to', 'toward']);
  if (target) {
    const found = findTargetInZone(target, player);
    if (!found) return { type: 'emote', message: `You don't see anyone called "${target}" here.` };
    return doEmote(
      `You wave at ${found}.`,
      `${player.handle} waves at ${found}.`,
      player, broadcast
    );
  }
  return doEmote(
    'You wave.',
    `${player.handle} waves.`,
    player, broadcast
  );
}

function cmdShrug(args, raw, player, broadcast) {
  return doEmote('You shrug.', `${player.handle} shrugs.`, player, broadcast);
}

function cmdPoint(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  if (vis.category === 'pitch_dark') return { type: 'emote', message: "You point at nothing in particular — it's too dark to see anything." };
  const target = stripPrep(args, ['at', 'to', 'toward']);
  if (target) {
    const found = findTargetInZone(target, player);
    if (found) {
      return doEmote(`You point at ${found}.`, `${player.handle} points at ${found}.`, player, broadcast);
    }
    return doEmote(`You point toward ${target}.`, `${player.handle} points toward ${target}.`, player, broadcast);
  }
  return doEmote('You point.', `${player.handle} points.`, player, broadcast);
}

// ---------------------------------------------------------------------------
// Expressive emotes
// ---------------------------------------------------------------------------

function cmdSmile(args, raw, player, broadcast) {
  return doEmote('You smile.', `${player.handle} smiles.`, player, broadcast);
}

function cmdFrown(args, raw, player, broadcast) {
  return doEmote('You frown.', `${player.handle} frowns.`, player, broadcast);
}

function cmdLaugh(args, raw, player, broadcast) {
  const { env } = getCtx(player);
  const loud = ['storm','thunderstorm'].includes(env.weatherType) ? ' — barely audible over the weather' : '';
  return doEmote(`You laugh${loud}.`, `${player.handle} laughs.`, player, broadcast);
}

function cmdCry(args, raw, player, broadcast) {
  return doEmote('You cry.', `${player.handle} begins to cry.`, player, broadcast);
}

function cmdSigh(args, raw, player, broadcast) {
  return doEmote('You sigh.', `${player.handle} sighs.`, player, broadcast);
}

function cmdNod(args, raw, player, broadcast) {
  const target = stripPrep(args, ['at', 'to']);
  if (target) {
    const found = findTargetInZone(target, player);
    if (found) return doEmote(`You nod at ${found}.`, `${player.handle} nods at ${found}.`, player, broadcast);
  }
  return doEmote('You nod.', `${player.handle} nods.`, player, broadcast);
}

function cmdShake(args, raw, player, broadcast) {
  return doEmote('You shake your head.', `${player.handle} shakes their head.`, player, broadcast);
}

const DANCE_VARIANTS = [
  'breaks into an awkward shuffling dance.',
  'sways side to side in a slow, rhythmic motion.',
  'spins in a half-hearted circle.',
];

function cmdDance(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  const variant = DANCE_VARIANTS[Math.floor(Math.random() * DANCE_VARIANTS.length)];
  const precipNote = env.currentPrecip === 'rain' ? ' in the rain' : env.currentPrecip === 'snow' ? ' in the falling snow' : '';
  const darkNote = vis.category === 'pitch_dark' ? ' in the dark' : '';
  return doEmote(
    `You ${variant.replace('breaks', 'break').replace('sways', 'sway').replace('spins', 'spin')}${precipNote}${darkNote}`,
    `${player.handle} ${variant}${precipNote}`,
    player, broadcast
  );
}

const PACE_VARIANTS = [
  'paces back and forth.',
  'walks a slow, restless circle.',
  'moves in a tight, agitated loop.',
];

function cmdPace(args, raw, player, broadcast) {
  const variant = PACE_VARIANTS[Math.floor(Math.random() * PACE_VARIANTS.length)];
  if (posture(player) !== 'standing') {
    setLivePlayer(player.id, { ...player, posture: 'standing' });
  }
  return doEmote(
    `You ${variant.replace('paces', 'pace').replace('walks', 'walk').replace('moves', 'move')}`,
    `${player.handle} ${variant}`,
    player, broadcast
  );
}

// ---------------------------------------------------------------------------
// Social actions
// ---------------------------------------------------------------------------

function cmdGreet(args, raw, player, broadcast) {
  const { vis } = getCtx(player);
  if (vis.category === 'pitch_dark') return { type: 'emote', message: "You call out a greeting into the darkness." };
  const target = args.join(' ').trim();
  if (target) {
    const found = findTargetInZone(target, player);
    if (!found) return { type: 'emote', message: `You don't see anyone called "${target}" here.` };
    return doEmote(
      `You greet ${found} with a nod.`,
      `${player.handle} greets ${found}.`,
      player, broadcast
    );
  }
  return doEmote('You look around and offer a general greeting.', `${player.handle} offers a general greeting.`, player, broadcast);
}

function cmdFollow(args, raw, player, broadcast) {
  const target = args.join(' ').trim();
  if (!target) return { type: 'emote', message: 'Follow whom?' };
  const found = findTargetInZone(target, player);
  if (!found) return { type: 'emote', message: `You don't see anyone called "${target}" here.` };
  return doEmote(
    `You fall into step behind ${found}.`,
    `${player.handle} falls into step behind ${found}.`,
    player, broadcast
  );
}

// ---------------------------------------------------------------------------
// Self-reflection
// ---------------------------------------------------------------------------

function cmdReflect(args, raw, player, broadcast) {
  const { env, vis } = getCtx(player);
  const lines = [];
  lines.push(`You pause and take stock of yourself.`);
  lines.push(`You are ${posture(player)}.`);
  if ((player.wetness || 0) > 50) lines.push('You are soaking wet.');
  else if ((player.wetness || 0) > 20) lines.push('Your clothes are damp.');
  if ((player.radiation || 0) > 70) lines.push('A faint sickly glow emanates from your skin.');
  else if ((player.radiation || 0) > 40) lines.push('You feel an uncomfortable warmth beneath your skin.');
  if ((player.hunger || 100) < 25) lines.push('Your stomach is growling painfully.');
  if ((player.thirst || 100) < 25) lines.push('Your mouth is parched.');
  if (vis.category === 'pitch_dark') lines.push('You can barely see your own hands in front of your face.');
  if (env.currentPrecip === 'rain') lines.push('Rain runs down your face and drips from your chin.');
  return { type: 'emote', message: lines.join(' ') };
}

// ---------------------------------------------------------------------------
// Examine override (intercept 'surroundings' and 'appearance', fall through otherwise)
// ---------------------------------------------------------------------------

async function cmdExamine(args, raw, player, broadcast) {
  const target = args.join(' ').toLowerCase().trim();
  if (target === 'surroundings' || target === 'around' || target === 'area') {
    return cmdExamineSurroundings(player);
  }
  if (target === 'appearance' || target === 'myself' || target === 'self' || target === 'me') {
    // Fall through — world.js cmdExamine handles 'me'/'self'/'myself'
    return undefined;
  }
  // Fall through to world.js examine for all other targets
  return undefined;
}

async function cmdExamineSurroundings(player) {
  const { env, vis, zone } = getCtx(player);
  if (!zone) return { type: 'emote', message: 'You are nowhere.' };

  const parts = [];

  // Lighting
  if (vis.category === 'pitch_dark') parts.push('It is pitch black. You can barely make out your surroundings.');
  else if (vis.category === 'dark') parts.push('The area is poorly lit, shapes barely visible.');
  else if (vis.category === 'dim') parts.push('The light is dim but you can make out your surroundings.');
  else parts.push('You take in the area around you.');

  // Weather
  if (env.currentPrecip === 'rain') {
    const intensity = env.precipRate > 0.6 ? 'heavily' : env.precipRate > 0.3 ? 'steadily' : 'lightly';
    parts.push(`Rain falls ${intensity}.`);
  } else if (env.currentPrecip === 'snow') {
    parts.push('Snow drifts down quietly.');
  }
  if (['storm', 'thunderstorm'].includes(env.weatherType)) parts.push('Thunder rumbles in the distance.');
  if (env.weatherType === 'fog') parts.push('Thick fog limits visibility.');

  // Temperature
  if (env.tempC !== undefined) {
    const t = env.tempC;
    if (t < 0) parts.push('It is freezing cold.');
    else if (t < 10) parts.push('There is a biting chill in the air.');
    else if (t > 35) parts.push('The heat is oppressive.');
    else if (t > 28) parts.push('It is uncomfortably warm.');
  }

  // Exits
  const exits = Object.keys(zone.exits || {});
  if (exits.length) parts.push(`Exits lead: ${exits.join(', ')}.`);

  return { type: 'examine', message: parts.join(' ') };
}

// ---------------------------------------------------------------------------
// Utility: strip a leading preposition from args and return the rest
// ---------------------------------------------------------------------------

function stripPrep(args, preps) {
  if (!args.length) return '';
  const first = args[0].toLowerCase();
  if (preps.includes(first)) return args.slice(1).join(' ').trim();
  return args.join(' ').trim();
}

// ---------------------------------------------------------------------------
// Utility: find a player or NPC in the current zone by partial name
// ---------------------------------------------------------------------------

function findTargetInZone(target, player) {
  const lower = target.toLowerCase();
  const players = getZonePlayers(player.current_zone).filter(p => p.id !== player.id);
  const p = players.find(p => p.handle.toLowerCase().includes(lower));
  if (p) return p.handle;
  const npcs = getZoneNpcs(player.current_zone);
  const n = npcs.find(n => n.name.toLowerCase().includes(lower));
  if (n) return n.name;
  return null;
}

// ---------------------------------------------------------------------------
// Dev panel route
// ---------------------------------------------------------------------------

const WEATHER_TYPES = ['clear','cloudy','overcast','rain','thunderstorm','storm','snow','blizzard','fog','haze','ash'];
const VIS_CATEGORIES = ['clear','dim','dark','pitch_dark'];

export async function routeHandler(path, method, body, auth) {
  if (!auth || !['dev','admin','builder','designer'].includes(auth.role)) return null;

  if (method === 'GET' && path.startsWith('/api/interactions/furniture/')) {
    const zoneId = path.replace('/api/interactions/furniture/', '');
    if (!zoneId) return { status: 400, body: { error: 'Zone ID required' } };
    const { rows } = await query(
      `SELECT id, name, description, object_type, flags FROM furniture WHERE zone_id=$1 ORDER BY name`,
      [zoneId]
    );
    const withInteractions = rows.map(f => ({
      ...f,
      responds_to: inferInteractions(f),
    }));
    return { status: 200, body: withInteractions };
  }

  if (method === 'POST' && path === '/api/interactions/test') {
    const { command, zoneId, weatherOverride, visibilityOverride } = body || {};
    if (!command || !zoneId) return { status: 400, body: { error: 'command and zoneId required' } };

    const zone = getZone(zoneId);
    if (!zone) return { status: 404, body: { error: 'Zone not found' } };

    // Mock player for dry-run
    const mockPlayer = {
      id: '__test__', handle: 'Tester', current_zone: zoneId,
      posture: 'standing', wetness: 0, radiation: 0, hunger: 100, thirst: 100,
    };

    // Capture broadcast output
    let zoneMessage = null;
    const mockBroadcast = (_zoneId, msg) => { zoneMessage = msg.message; };

    // Override context for testing
    const origEnv = { ...(getEnvironmentState() || {}), weatherType: weatherOverride || 'clear', currentPrecip: weatherOverride === 'rain' ? 'rain' : weatherOverride === 'snow' ? 'snow' : 'none', precipRate: 0.5 };
    const origVis = { category: visibilityOverride || 'clear', visibility: visibilityOverride === 'pitch_dark' ? 0 : visibilityOverride === 'dark' ? 0.2 : visibilityOverride === 'dim' ? 0.5 : 1 };

    // Parse command
    const parts = command.trim().split(/\s+/);
    const cmd = parts[0].toLowerCase();
    const args = parts.slice(1);
    const raw = command.trim();

    const handler = commands[cmd];
    if (!handler) return { status: 404, body: { error: `No interaction command: ${cmd}` } };

    let result;
    try {
      result = await handler(args, raw, mockPlayer, mockBroadcast);
    } catch (err) {
      return { status: 500, body: { error: err.message } };
    }

    return { status: 200, body: {
      selfMessage: result?.message || null,
      zoneMessage,
      weatherOverride: origEnv.weatherType,
      visibilityOverride: origVis.category,
    }};
  }

  return null;
}

function inferInteractions(furniture) {
  const type = (furniture.object_type || '').toLowerCase();
  const name = (furniture.name || '').toLowerCase();
  const interactions = [];
  if (/chair|bench|stool|couch|sofa|seat|throne/.test(name) || type === 'furniture') interactions.push('sit');
  if (/bed|cot|mat|mattress|floor/.test(name)) interactions.push('sit', 'lie');
  if (/table|desk|counter/.test(name)) interactions.push('lean', 'rest at');
  if (/wall|pillar|post/.test(name)) interactions.push('lean');
  return [...new Set(interactions)];
}

// ---------------------------------------------------------------------------
// Exports
// ---------------------------------------------------------------------------

export const commands = {
  sit:     cmdSit,
  stand:   cmdStand,
  lie:     cmdLie,
  kneel:   cmdKneel,
  stretch: cmdStretch,
  wave:    cmdWave,
  shrug:   cmdShrug,
  point:   cmdPoint,
  smile:   cmdSmile,
  frown:   cmdFrown,
  laugh:   cmdLaugh,
  cry:     cmdCry,
  sigh:    cmdSigh,
  nod:     cmdNod,
  shake:   cmdShake,
  dance:   cmdDance,
  pace:    cmdPace,
  greet:   cmdGreet,
  follow:  cmdFollow,
  reflect: cmdReflect,
  examine: cmdExamine,
};
