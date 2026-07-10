import { query } from '../../models/db.js';
import { formatBattleCry } from '../combat.js';
import { getZone, getMinimapData, getAllZones, getMap, addPlayerToZone, removePlayerFromZone, getDoorForExit, setDoorCache, getAllLivePlayers, getLivePlayer, getZoneEnemies, getZoneNpcs, tryBattleCry } from '../world.js';
import { getZoneVisibility, getWindowsForZone, getEnvironmentState, getZoneTemperature, getZoneSeverity } from '../environment.js';
import { describeZone, resolveNamedDestination, isInteriorZone } from './describe.js';
import { exitTargets, allExits, primaryExits } from '../exits.js';
import { checkLockAuth, getLockTagPublic } from './doors.js';
import { lockTypePassesWhileLocked } from '../locks.js';
import { emit } from '../events.js';
import { closeShopSession } from '../vendor-session.js';
import { computeCarriedWeight, carryCapacity, formatWeight } from './inventory.js';
import { OPPOSITE } from '../directions.js';
import { forceStand } from '../posture.js';
import { registerMoveGate, runMoveGates } from '../movement-gates.js';
import { doorGuardsOnlyUnownedApartment } from '../apartments.js';
import { createSelectionState, getSelectionState, formatSelectionPage } from '../sift.js';
import { districtFor } from '../districts.js';
import { getFlag, setFlag } from '../flags.js';

const RAW_DIRECTIONS = ['north', 'south', 'east', 'west', 'up', 'down', 'in', 'out', 'exit'];

// Wind/weather attrition (docs/systems-weather-extreme.md, step 4): crossing into
// an exposed outdoor zone during severe weather costs extra stamina. Attrition,
// never a wall — the move always succeeds. getZoneSeverity is 0 for interiors /
// off-map, so heading indoors is free. Cost = BASE + severity×SPAN stamina.
const WIND_MOVE_SEVERITY = 0.4;   // min local severity before a move costs extra
const WIND_MOVE_BASE     = 4;
const WIND_MOVE_SPAN     = 16;    // → ~10 stamina at sev 0.4, ~20 at sev 1.0

// Run mode (the `run` command / minimap Run toggle → player.running, a runtime-only
// live-player flag). Each step taken while running costs stamina; when you're too
// winded to pay the toll the step still happens, but as a free walk — that's the
// "stamina gate". GPS auto-walk sends real moves down this same path, so its
// stamina loss matches a manual run exactly.
const RUN_STEP_STAMINA = 4;

// ── Engine move gates (the law layer) ────────────────────────────────────────
// Registered through the same chain plugins use (registerMoveGate), so engine
// laws and plugin gates run in one ordered, listable pipeline. Gates are pure;
// door open/close side effects happen in cmdMove after every gate passes.

// Locked doors block unless the player's lock auth clears them.
// "in"/"out"/"exit" read badly as "the door to the out" — name the destination
// zone instead (door to <exterior/interior zone name>). Cardinal directions keep
// the natural "the door to the north" phrasing.
const NAMED_LOCK_DIRS = new Set(['in', 'out', 'exit']);
registerMoveGate(async ({ player, direction, door, to }) => {
  if (!door || door.hp <= 0 || door.lock_state !== 'locked') return;
  if (doorGuardsOnlyUnownedApartment(door)) return; // unrented unit — the lock is vestigial
  const lockTag = getLockTagPublic(door);
  if (!lockTag) return; // locked but no lock installed — a data glitch, not a wall; let it pass
  // A manual bolt (privacy latch) never opens while shut, even for the person who
  // set it — they must unlock it to leave, which is why it can't be locked from
  // the far side. Credentialled locks still let their auth-holder walk through.
  const canPass = lockTypePassesWhileLocked(lockTag.type)
    && await checkLockAuth(lockTag, door, player);
  if (!canPass) {
    // up/down read badly as "the door to the up" — say "above"/"below" instead
    if (direction === 'up')   return { block: true, message: `The door above is locked.` };
    if (direction === 'down') return { block: true, message: `The door below is locked.` };
    const label = NAMED_LOCK_DIRS.has(direction) && to?.name ? to.name : `the ${direction}`;
    return { block: true, message: `The door to ${label} is locked.` };
  }
}, 'engine:door-lock');

// Encumbrance blocks the move — the law lives at movement, not acquisition
// (you can hold the weight; you can't walk with it — that gap is what makes
// the corpse-mule pattern possible). opts.bypassEncumbrance is the named
// exemption system moves (shove, .gohome) pass.
registerMoveGate(async ({ player, opts }) => {
  if (opts?.bypassEncumbrance) return;
  const carried = await computeCarriedWeight(player);
  const cap = carryCapacity(player);
  if (carried > cap) {
    return { block: true, message: `You're carrying too much to move (${formatWeight(carried)}/${formatWeight(cap)}). Drop something.` };
  }
}, 'engine:encumbrance');

// Open water is impassable on foot. Entering a water tile (zone flags.water)
// needs a boat — an uncontained inventory item tagged 'boat' (capability tag,
// same shape as the fishing rod / hack deck). Cheap: the DB check only runs when
// the destination is actually water, so dry-land moves never touch it.
registerMoveGate(async ({ player, to }) => {
  if (!to?.flags?.water) return;
  const { rows } = await query(
    `SELECT 1 FROM player_inventory pi JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id=$1 AND pi.container_id IS NULL AND jsonb_exists(i.tags,'boat') LIMIT 1`,
    [player.id]
  );
  if (rows.length) return;
  return { block: true, message: 'Black water laps at the edge — you need a boat to cross open water.' };
}, 'engine:water');

function buildArriveMsg(name, arrivalDir, sourceZoneName) {
  if (arrivalDir === 'out') return `${name} arrives from outside.`;
  if (arrivalDir === 'in')  return `${name} emerges from ${sourceZoneName}.`;
  if (arrivalDir === 'up')  return `${name} descends the stairs.`;
  if (arrivalDir === 'down') return `${name} climbs the stairs.`;
  if (arrivalDir)           return `${name} arrives from the ${arrivalDir}.`;
  return `${name} arrives.`;
}

async function cmdLookThroughWindow(win, player) {
  if (!win.curtain_open && win.glass_state !== 'broken') {
    return { type:'examine', message:`The curtains are drawn. You can't see through ${win.name}.` };
  }
  const vis = getZoneVisibility(player.current_zone);
  if (vis.visibility < 0.1 && !win.zone_exterior) {
    return { type:'examine', message:`It's too dark on your side to make anything out through ${win.name}.` };
  }
  if (!win.zone_exterior) {
    const { getHUDPayload } = await import('../environment.js');
    const env = getHUDPayload();
    const weatherDesc = { clear:'clear skies', cloudy:'overcast skies', overcast:'heavy overcast', rain:'rain falling steadily', thunderstorm:'a thunderstorm raging overhead', storm:'a raging storm', snow:'snow coming down', blizzard:'a blinding blizzard', fog:'thick fog rolling in', haze:'a heavy haze in the air', ash:'ash falling from the sky' }[env.weatherType] || env.weatherType;
    return { type:'examine', message:`Through ${win.name} you see ${weatherDesc} outside. It is ${env.time}, ${env.season}.${win.glass_state === 'broken' ? ' Cold air drifts in through the broken glass.' : ''}` };
  }
  const otherZone = getZone(win.zone_exterior);
  if (!otherZone) return { type:'examine', message:`You peer through ${win.name} but can't make out what's on the other side.` };
  const otherVis = getZoneVisibility(win.zone_exterior);
  if (otherVis.category === 'pitch_dark') {
    return { type:'examine', message:`Through ${win.name} you can see ${otherZone.name}, but it's completely dark in there.` };
  }
  return { type:'examine', message:`Through ${win.name} you can see into <span style="color:var(--accent)">${otherZone.name}</span>:\n${otherZone.description}` };
}

function cmdLookSky(player) {
  let env;
  try { env = getEnvironmentState(); } catch { env = {}; }
  const vis = getZoneVisibility(player.current_zone);

  const zone = getZone(player.current_zone);
  const isIndoor = !!(zone?.flags?.is_interior || zone?.flags?.is_apartment);
  if (isIndoor) {
    const ceilingLines = [
      "You stare at the ceiling. It stares back. Neither of you blink.",
      "It's a ceiling. Flat. Featureless. Deeply unimpressive. You've seen better.",
      "You look up. Ceiling. No sky. This is what happens when you live indoors.",
      "The ceiling offers no weather information. It is simply there, being a ceiling.",
      "You crane your neck upward. Yep. That's a ceiling alright. Mystery solved.",
      "Sky unavailable in this location. Please proceed to an exit and try again.",
      "A ceiling. Possibly the same ceiling as before. You can't be sure.",
    ];
    return { type: 'examine', message: ceilingLines[Math.floor(Math.random() * ceilingLines.length)] };
  }

  if (vis.category === 'pitch_dark') return { type: 'examine', message: "It's too dark to see the sky." };
  const weatherLines = {
    clear: 'The sky is clear, a vast expanse stretching overhead.',
    cloudy: 'Clouds drift across the sky, patchy and slow.',
    overcast: 'A heavy overcast blankets everything above, flat and grey.',
    rain: 'Dark clouds hang low, rain falling steadily from them.',
    sleet: 'An ugly mix of sleet and rain falls from a leaden sky.',
    thunderstorm: 'Angry storm clouds roil overhead, lit from within by lightning.',
    storm: 'The sky is a churning mass of dark cloud. The storm is fierce.',
    snow: 'Pale grey clouds fill the sky, sending snow drifting down.',
    blizzard: 'A white-grey wall of blowing snow swallows the sky entirely.',
    fog: 'Thick fog diffuses what little light there is. The sky is invisible.',
    haze: 'A dirty haze sits over everything, muting the sky to a dull brown-grey.',
    ash: 'Ash falls from a rust-coloured sky. The air tastes of smoke.',
  };
  const base = weatherLines[env.weatherType] || 'You look up at the sky.';
  const timeNote = env.timePhase ? ` It is ${env.timePhase}.` : '';
  const tempNote = env.tempC !== undefined ? ` The temperature is ${Math.round(env.tempC)}°C.` : '';
  return { type: 'examine', message: base + timeNote + tempNote };
}

async function cmdLookGround(player) {
  const vis = getZoneVisibility(player.current_zone);
  if (vis.category === 'pitch_dark') return { type: 'examine', message: "It's too dark to make out the ground." };
  const zone = getZone(player.current_zone);
  const base = zone ? `You look at the ground around you in ${zone.name}.` : 'You look at the ground.';
  const { rows } = await query(
    `SELECT pi.id, i.name FROM player_inventory pi
     JOIN items i ON i.id = pi.item_id
     WHERE pi.player_id = $1 AND pi.container_id IS NULL LIMIT 10`,
    [`_ground_${player.current_zone}`]
  );
  if (!rows.length) return { type: 'examine', message: `${base} Nothing of note lies here.` };
  const itemList = rows.map(r => r.name).join(', ');
  return { type: 'examine', message: `${base} On the ground: ${itemList}.` };
}

function cmdLookDistance(player) {
  const vis = getZoneVisibility(player.current_zone);
  if (vis.category === 'pitch_dark') return { type: 'examine', message: "It's too dark to make out anything in the distance." };
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'examine', message: 'You see nothing in the distance.' };
  const exits = allExits(zone);
  if (!exits.length) return { type: 'examine', message: 'No obvious exits lead away from here.' };
  const parts = exits.map(({ dir, target }) => {
    const z = getZone(target);
    return z ? `to the ${dir}: ${z.name}` : `to the ${dir}: somewhere`;
  });
  return { type: 'examine', message: `Looking into the distance you can make out — ${parts.join('; ')}.` };
}

async function cmdLook(player, targetStr, broadcast) {
  if (targetStr === 'sky' || targetStr === 'up') return cmdLookSky(player);
  if (targetStr === 'ground' || targetStr === 'down') return cmdLookGround(player);
  if (targetStr === 'distance' || targetStr === 'out') return cmdLookDistance(player);
  if (!targetStr || targetStr === 'room' || targetStr === 'around') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id) };
  }
  const inMatch = targetStr.match(/^in\s+(.+)$/i);
  if (inMatch) {
    const { cmdLookInContainer } = await import('./inventory.js');
    return cmdLookInContainer(inMatch[1], player);
  }
  if (targetStr === 'me' || targetStr === 'self' || targetStr === 'myself') {
    return cmdExamineFallback(targetStr, player, broadcast);
  }
  const throughMatch = targetStr.match(/^(?:through\s+)?(.+)$/i);
  const windowTarget = throughMatch?.[1] || targetStr;
  const windows = getWindowsForZone(player.current_zone);
  const win = windows.find(w => w.name.toLowerCase().includes(windowTarget.toLowerCase()));
  if (win || /^(through|window|peer)/.test(targetStr)) {
    if (!win) return { type:'examine', message:`You don't see a window here.` };
    return cmdLookThroughWindow(win, player);
  }
  return cmdExamineFallback(targetStr, player, broadcast);
}

// Thin fallback so "look <thing>" works without a circular import with world.js
async function cmdExamineFallback(targetStr, player, broadcast) {
  const { handlers: worldH } = await import('./world.js');
  return worldH.examine([targetStr], `examine ${targetStr}`, player, broadcast || (() => {}));
}

async function cmdGo(argText, player, broadcast) {
  if (!argText) return { type: 'error', message: 'Go where? (north, south, east, west, up, down, in, out — or a building/room name)' };
  if (RAW_DIRECTIONS.includes(argText)) return cmdMove(argText, player, broadcast);
  // "go in 2" — a direction plus a numbered same-direction exit.
  const goParts = argText.split(/\s+/);
  if (goParts.length === 2 && RAW_DIRECTIONS.includes(goParts[0]) && /^\d+$/.test(goParts[1])) {
    return cmdMove(goParts[0], player, broadcast, { exitIndex: Number(goParts[1]) });
  }
  const zone = getZone(player.current_zone);
  if (!zone) return { type: 'error', message: 'Your zone is missing.' };
  const resolved = resolveNamedDestination(zone, argText);
  if (resolved.type === 'unique') return cmdMove(resolved.match.direction, player, broadcast, { targetZoneId: resolved.match.targetId });
  if (resolved.type === 'ambiguous') {
    const names = resolved.candidates.map(c => c.name).join(', ');
    return { type: 'error', message: `That could mean several things here: ${names}. Try being more specific.` };
  }
  return cmdMove(argText, player, broadcast);
}

function buildBattleCryMessages(enemies, playerHandle) {
  // Group enemies by templateId, keeping one representative per type
  const byType = new Map();
  for (const e of enemies) {
    if (!byType.has(e.templateId)) byType.set(e.templateId, { enemy: e, count: 0 });
    byType.get(e.templateId).count++;
  }

  const lines = [];
  for (const { enemy, count } of byType.values()) {
    const cries = enemy.flags?.battle_cries;
    if (!Array.isArray(cries) || !cries.length || !tryBattleCry(enemy.templateId)) continue;
    const cry = cries[Math.floor(Math.random() * cries.length)];
    const plural = count > 1;
    const typeName = plural ? `${enemy.name}s` : enemy.name;

    // Replace $enemy and $player tokens, then fix possessives
    const forPlayer = cry
      .replace(/\$enemy/g, typeName)
      .replace(/\$player/g, 'you')
      .replace(/\b[Hh]is\b|\b[Hh]ers\b|\b[Ii]ts\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m)
      .replace(/\b[Hh]er\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m);
    const forBystander = cry
      .replace(/\$enemy/g, typeName)
      .replace(/\$player/g, playerHandle)
      .replace(/\b[Hh]is\b|\b[Hh]ers\b|\b[Ii]ts\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m)
      .replace(/\b[Hh]er\b/g, m => plural ? (m[0] === m[0].toUpperCase() ? 'Their' : 'their') : m);

    lines.push({ forPlayer, forBystander, name: enemy.name });
  }
  return lines;
}

// Same-direction exits numbered in a stable order (destination name), so a bare
// direction's picker, an inline `in 2`, and any later `look` all agree on which
// exit is #2. The order is independent of the stored exit-array order.
function orderedExitCandidates(targets) {
  return targets
    .map((id) => ({ id, name: getZone(id)?.name || id }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

// A trailing number on a movement verb (`in 2`, `up 3`) selects the Nth exit of
// a multi-exit direction. Non-numeric args are ignored (no exit index).
function exitIndexOpts(args) {
  return args?.length && /^\d+$/.test(args[0]) ? { exitIndex: Number(args[0]) } : {};
}

export async function cmdMove(direction, player, broadcast, opts = {}) {
  if (!direction) return { type:'error', message:'Go where? (north, south, east, west, up, down)' };
  const zone = getZone(player.current_zone);
  if (!zone) return { type:'error', message:'Your zone is missing.' };
  let targets = exitTargets(zone, direction);
  if (!targets.length && (direction === 'in' || direction === 'out' || direction === 'exit')) {
    const all = allExits(zone);
    if (all.length === 1) {
      direction = all[0].dir;
      targets = [all[0].target];
    }
  }
  if (!targets.length) {
    const cardinal = ['north', 'south', 'east', 'west'].includes(direction);
    return { type:'error', message: cardinal ? `No exit to the ${direction}.` : `No exit ${direction}.` };
  }

  // Resolve which exit when a direction holds several. An explicit target (from
  // name-based navigation, e.g. `go bar`) picks directly; an inline index
  // (`in 2`) jumps straight to the Nth; otherwise open a numbered picker.
  let targetId;
  if (opts.targetZoneId && targets.includes(opts.targetZoneId)) {
    targetId = opts.targetZoneId;
  } else if (targets.length === 1) {
    targetId = targets[0];
  } else {
    // Same-direction exits are numbered in a stable order (below), so `in 2`, the
    // picker's [2], and a repeated look all agree — you can jump to a numbered
    // exit without seeing the list first.
    const candidates = orderedExitCandidates(targets);
    if (opts.exitIndex != null) {
      const pick = candidates[opts.exitIndex - 1];
      if (!pick) return { type:'error', message:`There ${candidates.length === 1 ? 'is' : 'are'} only ${candidates.length} way${candidates.length === 1 ? '' : 's'} ${direction} (you asked for #${opts.exitIndex}).` };
      targetId = pick.id;
    } else {
      // Numbered SIFT picker. Selecting a number moves straight to that zone id
      // (see the selection intercept in commands/index.js) — no name round-trip.
      createSelectionState(player.id, candidates, { verb: 'move', moveDirection: direction });
      return { type: 'output', message: `Several ways lead ${direction}.\n${formatSelectionPage(getSelectionState(player.id))}` };
    }
  }
  const targetZone = getZone(targetId);
  if (!targetZone) return { type:'error', message:'That exit leads nowhere yet.' };

  // Door may be on either side: in this zone going out, or in the target zone going back
  let door = getDoorForExit(zone.id, direction, targetId) || getDoorForExit(targetId, OPPOSITE[direction], zone.id) || null;

  // Gate chain: pure vetoes (engine laws below + plugin-registered gates) run
  // before anything mutates. Previously the door opened before the encumbrance
  // check could veto, leaving it standing open on a blocked move.
  const veto = await runMoveGates({ player, from: zone, to: targetZone, direction, door, opts });
  // A gate may block silently (veto.silent) — e.g. the pacing plugin deferring a
  // too-fast step into its move queue — in which case no error line is shown; the
  // step is simply not executed now.
  if (veto) return veto.silent ? null : { type:'error', message: veto.message, html: veto.html };

  let doorWasClosed = false;
  let doorWasLocked = false;
  if (door && door.hp > 0) {
    // Gates passed — a still-locked door means the player has auth to pass it.
    doorWasLocked = door.lock_state === 'locked';
    if (!door.is_open) {
      doorWasClosed = true;
      // RAM-only: the door closes again below, so the DB resting state never
      // changes during a transit. Explicit open/close verbs still persist.
      door.is_open = 1;
      setDoorCache(door.id, door);
    }
  }

  const oldZoneId = player.current_zone;

  closeShopSession(player.id); // leaving the zone ends any active shop session (unpauses the vendor)
  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, targetId);
  player.current_zone = targetId;
  emit('zone.entered', { actor: player, zone: targetId, from: oldZoneId, opts });
  player.combatTargetId = null;
  const interrupted = forceStand(player, 'moved');
  if (interrupted === 'sitting') {
    broadcast(null, { type: 'emote', message: 'You stand up.' }, null, player.id);
    broadcast(oldZoneId, { type: 'zone_event', message: `${player.handle} stands up.` }, player.id);
  }
  if (player.pvpTargetId) {
    const opponent = getLivePlayer(player.pvpTargetId);
    if (opponent) {
      opponent.pvpTargetId = null;
      broadcast(null, { type: 'output', message: `${player.handle} flees the fight. Combat ends.` }, null, opponent.id);
    }
    player.pvpTargetId = null;
  }
  await query('UPDATE players SET current_zone=$1 WHERE id=$2', [targetId, player.id]);

  const arrivalDir = OPPOSITE[direction] || null;

  const hadDoor = !!(door && door.hp > 0);
  const lockTag = hadDoor ? getLockTagPublic(door) : null;

  const departMsg = doorWasLocked
    ? `The lock disengages. ${player.handle} opens the door and heads ${direction}.`
    : doorWasClosed
      ? `${player.handle} opens the door and heads ${direction}.`
      : `${player.handle} heads ${direction}.`;
  const arriveMsg = (doorWasLocked || doorWasClosed)
    ? (arrivalDir ? `${player.handle} comes through the door from the ${arrivalDir}.` : `${player.handle} comes through the door.`)
    : buildArriveMsg(player.handle, arrivalDir, zone.name);
  broadcast(zone.id, { type:'zone_event', message: departMsg, refresh: true }, player.id);
  broadcast(targetId, { type:'zone_event', message: arriveMsg, refresh: true }, player.id);

  // Close (and re-lock if locked) the door behind the player
  if (hadDoor && doorWasClosed) {
    door.is_open = 0;
    if (doorWasLocked) {
      door.lock_state = 'locked';
      setDoorCache(door.id, door);
      broadcast(zone.id, { type:'zone_event', message:'The door swings closed and locks.' }, player.id);
      broadcast(targetId, { type:'zone_event', message:'The door swings closed and locks.' }, player.id);
    } else {
      setDoorCache(door.id, door);
      broadcast(zone.id, { type:'zone_event', message:'The door swings closed.' }, player.id);
      broadcast(targetId, { type:'zone_event', message:'The door swings closed.' }, player.id);
    }
    // Now that the door has shut behind the player, recompute the weather
    // leak-in so the rain/wind they hear is the muffled, door-closed level —
    // zone.entered above ran while the door was still open (louder).
    emit('door.toggled', { zoneId: door.zone_id, targetZoneId: door.target_zone });
  }

  let radGain = 0;
  if (targetZone.radiation_level > 0) {
    radGain = Math.floor(targetZone.radiation_level * 0.1);
    if (radGain > 0) {
      player.radiation = Math.min(100, (player.radiation||0) + radGain);
      await query('UPDATE players SET radiation=$1 WHERE id=$2', [player.radiation, player.id]);
    }
  }
  const zoneDesc = await describeZone(targetZone, player);

  const destName = targetZone.name;
  let narration;
  if (doorWasLocked) {
    const unlockMsg = lockTag?.messages?.unlock ?? 'The lock disengages.';
    const closeMsg = doorWasClosed ? ' It swings closed and locks behind you.' : '';
    narration = `→ ${unlockMsg} You open the door ${direction} into ${destName}.${closeMsg}`;
  } else if (doorWasClosed) {
    narration = `→ You open the door ${direction} into ${destName}. It swings closed behind you.`;
  } else {
    narration = `→ You head ${direction} to ${destName}.`;
  }

  // Wind/weather attrition — draining stamina for pushing into exposed severe
  // weather. Skipped for system-driven relocations (shove, .gohome auto-walk),
  // which pass bypassEncumbrance. Never blocks the move.
  if (!opts.bypassEncumbrance) {
    const sev = getZoneSeverity(targetId);
    if (sev >= WIND_MOVE_SEVERITY) {
      const cost = Math.round(WIND_MOVE_BASE + sev * WIND_MOVE_SPAN);
      const before = player.stamina ?? (player.stamina_max ?? 100);
      player.stamina = Math.max(0, before - cost);
      if (player.stamina !== before) {
        await query('UPDATE players SET stamina=$1 WHERE id=$2', [player.stamina, player.id]);
        broadcast(null, { type:'resource_tick', messages:[], player_update:{ stamina: player.stamina } }, null, player.id);
      }
      narration += sev >= 0.75
        ? ' Forcing your way through the brutal weather leaves you gasping.'
        : ' You struggle against the weather the whole way; it wears at you.';
    }
  }

  // Run-mode stamina toll — pay per step while running. System-driven relocations
  // (shove, .gohome, follow-drag) pass bypassEncumbrance and never charge it. If
  // you can't afford the toll you walk the step for free — the gate that drops a
  // runner back to a jog when the tank hits empty.
  if (player.running && !opts.bypassEncumbrance) {
    const before = player.stamina ?? (player.stamina_max ?? 100);
    if (before >= RUN_STEP_STAMINA) {
      player.stamina = before - RUN_STEP_STAMINA;
      await query('UPDATE players SET stamina=$1 WHERE id=$2', [player.stamina, player.id]);
      broadcast(null, { type:'resource_tick', messages:[], player_update:{ stamina: player.stamina } }, null, player.id);
    }
  }

  // Battle cries: one per enemy type in the destination zone
  const arrivedEnemies = getZoneEnemies(targetId);
  if (arrivedEnemies.length) {
    const cryLines = buildBattleCryMessages(arrivedEnemies, player.handle);
    for (const { forPlayer, forBystander, name } of cryLines) {
      broadcast(null, { type: 'zone_event', message: formatBattleCry(name, forPlayer) }, null, player.id);
      broadcast(targetId, { type: 'zone_event', message: formatBattleCry(name, forBystander) }, player.id);
    }
  }

  await dragFollowers(player.id, oldZoneId, direction, broadcast);

  // District boundary crossing — turn an invisible neighborhood edge into a felt
  // threshold. Fires only when the district key actually changes; the one-line
  // mood blurb is shown once per district per player (gated in player_flags).
  const fromDistrict = districtFor(zone), toDistrict = districtFor(targetZone);
  if (toDistrict.key !== fromDistrict.key) {
    narration += `\n\nYou cross into ${toDistrict.name}.`;
    const seenKey = `district_seen_${toDistrict.key}`;
    if (toDistrict.blurb && !(await getFlag('player', seenKey, player))) {
      narration += ` ${toDistrict.blurb}`;
      await setFlag('player', seenKey, 'true', player);
    }
  }

  return { type:'move', message:zoneDesc, narration, zone:targetId, direction, radiation_gain:radGain, minimap: getMinimapData(targetId), tempC: getZoneTemperature(targetId) };
}

// Move every live player following `leaderId` (a player or NPC id) out of
// `fromZoneId` in `direction`, mirroring the leader's move. Used by cmdMove
// (player leaders) and by ai-behaviour's moveEntity (NPC leaders).
export async function dragFollowers(leaderId, fromZoneId, direction, broadcast) {
  if (leaderId == null) return; // enemies key on instanceId, so entity.id is undefined — never drag on a nullish leader (would match every non-following player)
  const followers = getAllLivePlayers().filter(p => p.following === leaderId && p.current_zone === fromZoneId);
  for (const follower of followers) {
    const followerResult = await cmdMove(direction, follower, broadcast);
    if (followerResult) broadcast(null, followerResult, null, follower.id);
  }
}

function cmdFollow(args, player, broadcast) {
  if (!args.length) {
    if (!player.following) return { type: 'output', message: 'You are not following anyone.' };
    player.following = null;
    return { type: 'output', message: 'You stop following.' };
  }
  const targetHandle = args.join(' ').toLowerCase();
  const target = getAllLivePlayers().find(p => p.handle.toLowerCase() === targetHandle && p.id !== player.id);
  if (!target) return { type: 'error', message: `No player named "${args.join(' ')}" is online.` };
  player.following = target.id;
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} starts following ${target.handle}.` }, player.id);
  return { type: 'output', message: `You are now following ${target.handle}. Type "follow" with no arguments to stop.` };
}

function cmdUnfollow(player, broadcast) {
  if (!player.following) return { type: 'output', message: 'You are not following anyone.' };
  player.following = null;
  broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} stops following.` }, player.id);
  return { type: 'output', message: 'You stop following.' };
}

const MAP_DIR_OFFSET = { north:[0,-1], south:[0,1], east:[1,0], west:[-1,0] };

// Coarse land-use / function category for a zone — the district key, derived from
// its id prefix. The mapping + metadata now live in the district registry
// (server/engine/districts.js); this thin wrapper keeps the map's `func` field.
function mapFunc(z) {
  return districtFor(z).key;
}

const MAP_WINDOW_HALF = 5; // 11×11 window: dx,dy ∈ −5..+5

// Building names at a tile: exits leading to an is_building zone (same rule as
// describe.js's "Buildings:" line). Data for the map's hover tooltip.
function buildingsAt(zone) {
  const names = [];
  for (const { target } of allExits(zone)) {
    const t = getZone(target);
    if (t?.flags?.is_building) names.push(t.flags.building_name || t.name);
  }
  return names;
}

// Map POI icon — the single most salient landmark at a tile, for legibility.
// Uses the clean signals (airfield_name flag, building_type on adjacent buildings)
// plus vendor NPCs and up/down stairs. Deliberately SPARSE: most tiles return null.
// Priority is the "what matters most here" order. { icon, poi } | null.
const POI_ICON = { airport: '✈', police: '★', power: '⚡', club: '♥', bar: '🍺', hotel: '🏨', vendor: '$', home: '⌂', stairs: '⇕' };
const POWER_RE = /coolant|turbine|reactor|powerplant/i;
function buildingTypesAt(zone) {
  const types = new Set();
  for (const { target } of allExits(zone)) {
    const t = getZone(target);
    if (t?.flags?.is_building && t.flags.building_type) types.add(t.flags.building_type);
  }
  return types;
}
function hasVendorNpc(zoneId) {
  for (const npc of getZoneNpcs(zoneId) || [])
    if (npc.npc_type === 'vendor' || npc.flags?.personality === 'vendor' || npc.vendor_inventory?.length) return true;
  return false;
}
function mapPoi(zone) {
  if (zone.flags?.airfield_name) return { icon: POI_ICON.airport, poi: 'airport' };
  const bt = buildingTypesAt(zone);
  if (bt.has('police')) return { icon: POI_ICON.police, poi: 'police' };
  if (POWER_RE.test(zone.id || '') || POWER_RE.test(zone.name || '') ||
      allExits(zone).some(e => { const t = getZone(e.target); return t?.flags?.is_building && (POWER_RE.test(t.id || '') || POWER_RE.test(t.name || '')); }))
    return { icon: POI_ICON.power, poi: 'power' };
  if (bt.has('club')) return { icon: POI_ICON.club, poi: 'club' };
  // Bar vs hotel are split by whether the building houses people (hotel = lodging);
  // both outrank the generic vendor $ so a bar with a bartender-vendor still reads as a bar.
  if (bt.has('hotel')) return { icon: POI_ICON.hotel, poi: 'hotel' };
  if (bt.has('bar')) return { icon: POI_ICON.bar, poi: 'bar' };
  if (bt.has('shop') || bt.has('grocery') || bt.has('store') || hasVendorNpc(zone.id)) return { icon: POI_ICON.vendor, poi: 'vendor' };
  // Residential blocks (not hotels — those returned above) get a home marker, ranked
  // below service/vendor POIs so a shop-fronted apartment tile still reads as a shop.
  if (bt.has('apartment')) return { icon: POI_ICON.home, poi: 'home' };
  if (zone.exits?.up || zone.exits?.down) return { icon: POI_ICON.stairs, poi: 'stairs' };
  return null;
}

// One tile snapshot, positioned at (x,y) relative to the map's origin.
function mapTile(zone, x, y, placed, currentId) {
  const links = {};
  for (const [dir, target] of Object.entries(primaryExits(zone))) {
    if (placed.has(target) && MAP_DIR_OFFSET[dir]) links[dir] = target;
  }
  const poi = mapPoi(zone);
  return {
    id: zone.id, x, y, name: zone.name,
    danger: zone.danger_rating || null, marker: zone.marker || null,
    color: zone.color || null, bg_color: zone.bg_color || null,
    func: mapFunc(zone),
    description: zone.description || '',
    buildings: buildingsAt(zone),
    icon: poi?.icon || null, poi: poi?.poi || null,
    // Street name(s) this tile sits on (an intersection can carry more than one) — null if none.
    artery: Array.isArray(zone.flags?.artery) ? zone.flags.artery : (zone.flags?.artery ? [zone.flags.artery] : null),
    exits: links, isCurrent: zone.id === currentId,
  };
}

// 11×11 window centered on centerId, tiles positioned relative to it (center at 0,0).
// Placed centers use grid coords; unplaced (coordless interior) centers fall back to a
// BFS virtual grid clamped to the window.
function window11(centerId) {
  const center = getZone(centerId);
  if (!center) return [];
  const H = MAP_WINDOW_HALF;

  if (center.map_id && center.grid_x != null && center.grid_y != null) {
    const cx = center.grid_x, cy = center.grid_y, cz = center.grid_z ?? 0;
    const onMap = getAllZones().filter(z =>
      z.map_id === center.map_id && (z.grid_z ?? 0) === cz &&
      z.grid_x != null && z.grid_y != null &&
      Math.abs(z.grid_x - cx) <= H && Math.abs(z.grid_y - cy) <= H);
    const placed = new Set(onMap.map(z => z.id));
    return onMap.map(z => mapTile(z, z.grid_x - cx, z.grid_y - cy, placed, centerId));
  }

  const coords = new Map([[centerId, [0, 0]]]);
  const dist = new Map([[centerId, 0]]);
  const queue = [centerId];
  while (queue.length) {
    const id = queue.shift();
    if (dist.get(id) >= 8) continue;
    const zone = getZone(id);
    if (!zone) continue;
    const [x, y] = coords.get(id);
    for (const [dir, targetId] of Object.entries(primaryExits(zone))) {
      if (coords.has(targetId)) continue;
      const off = MAP_DIR_OFFSET[dir];
      if (!off) continue;
      coords.set(targetId, [x + off[0], y + off[1]]);
      dist.set(targetId, dist.get(id) + 1);
      queue.push(targetId);
    }
  }
  const inWindow = new Map();
  for (const [id, [x, y]] of coords) {
    if (Math.abs(x) <= H && Math.abs(y) <= H) inWindow.set(id, [x, y]);
  }
  const placed = new Set(inWindow.keys());
  const tiles = [];
  for (const [id, [x, y]] of inWindow) {
    const zone = getZone(id);
    if (zone) tiles.push(mapTile(zone, x, y, placed, centerId));
  }
  return tiles;
}

// Tiles within REGIONAL_REACH hops of the player's overworld tile (following exits
// that stay on map_world floor 0). Everything else on the regional map renders dimmed
// — visible, but out of reach.
const REGIONAL_REACH = 15;
function regionalReachable(startId) {
  const reachable = new Set();
  if (!startId) return reachable;
  const dist = new Map([[startId, 0]]);
  reachable.add(startId);
  const queue = [startId];
  while (queue.length) {
    const id = queue.shift();
    const d = dist.get(id);
    if (d >= REGIONAL_REACH) continue;
    const zone = getZone(id);
    if (!zone) continue;
    for (const targetId of Object.values(primaryExits(zone))) {
      if (reachable.has(targetId)) continue;
      const t = getZone(targetId);
      if (!t || t.map_id !== 'map_world' || (t.grid_z ?? 0) !== 0) continue;
      reachable.add(targetId);
      dist.set(targetId, d + 1);
      queue.push(targetId);
    }
  }
  return reachable;
}

// Full overworld (map_world, floor 0), absolute coords — the regional land-use view.
export function regionalTiles(currentOverworldId) {
  const onMap = getAllZones().filter(z =>
    z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 &&
    z.grid_x != null && z.grid_y != null);
  const placed = new Set(onMap.map(z => z.id));
  const reachable = regionalReachable(currentOverworldId);
  return onMap.map(z => {
    const t = mapTile(z, z.grid_x, z.grid_y, placed, currentOverworldId);
    t.reachable = reachable.has(z.id);
    return t;
  });
}

// The overworld tile the player occupies: their own tile on the surface, or the
// building's parent_zone_id tile when they're inside an interior.
function overworldTileId(current) {
  if (!current) return null;
  if (current.map_id === 'map_world') return current.id;
  return getMap(current.map_id)?.parent_zone_id || null;
}

// Three zoom levels — interior (your floor), zone (overworld 11×11 at your tile),
// regional (full overworld). Interior only exists when you're inside one.
// Returns just the map data ({ mode, tiles, insideInterior }); cmdMap tags it with
// type:'map' for the popup, and the Tablet Map app (plugins/tablet/map-app.js)
// reuses it verbatim so both views share one source of truth for the tiles.
export function buildMapPayload(player, arg = '') {
  const current = getZone(player.current_zone);
  if (!current) return { mode:'zone', tiles: [], insideInterior: false };
  const inside = isInteriorZone(current);
  arg = String(arg || '').toLowerCase();

  let mode;
  if (arg === 'regional') mode = 'regional';
  else if (arg === 'interior') mode = inside ? 'interior' : 'zone';
  else if (['zone','zones','rooms','raw','default','legacy'].includes(arg)) mode = 'zone';
  else mode = inside ? 'interior' : 'zone'; // bare `map`

  if (mode === 'interior') return { mode, tiles: window11(current.id), insideInterior: inside };
  const owId = overworldTileId(current);
  if (mode === 'regional') return { mode, tiles: regionalTiles(owId), insideInterior: inside };
  // zone: 11×11 overworld centered on your surface tile (owId), or current if unresolved.
  return { mode:'zone', tiles: window11(owId || current.id), insideInterior: inside };
}

function cmdMap(player, args = []) {
  const arg = Array.isArray(args) ? (args[0] || '') : '';
  return { type:'map', ...buildMapPayload(player, arg) };
}

export const handlers = {
  look:  (args, raw, player, broadcast) => cmdLook(player, args.length ? args.join(' ') : undefined, broadcast),
  move:  (args, raw, player, broadcast) => cmdGo(args.join(' '), player, broadcast),
  north: (args, raw, player, broadcast) => cmdMove('north', player, broadcast),
  south: (args, raw, player, broadcast) => cmdMove('south', player, broadcast),
  east:  (args, raw, player, broadcast) => cmdMove('east', player, broadcast),
  west:  (args, raw, player, broadcast) => cmdMove('west', player, broadcast),
  up:    (args, raw, player, broadcast) => cmdMove('up', player, broadcast, exitIndexOpts(args)),
  down:  (args, raw, player, broadcast) => cmdMove('down', player, broadcast, exitIndexOpts(args)),
  in:    (args, raw, player, broadcast) => cmdMove('in', player, broadcast, exitIndexOpts(args)),
  out:   (args, raw, player, broadcast) => cmdMove('out', player, broadcast, exitIndexOpts(args)),
  exit:  (args, raw, player, broadcast) => cmdMove('exit', player, broadcast, exitIndexOpts(args)),
  map:      (args, raw, player) => cmdMap(player, args),
  follow:   (args, raw, player, broadcast) => cmdFollow(args, player, broadcast),
  unfollow: (args, raw, player, broadcast) => cmdUnfollow(player, broadcast),
};
