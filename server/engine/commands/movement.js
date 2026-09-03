import { query } from '../../models/db.js';
import { formatBattleCry } from '../combat.js';
import { renderMapBriefing, renderMapChart } from '../map-text.js';
import { loggedPanelsSync, textMinigamesSync } from '../presentation.js';
import { getZone, getMinimapData, getAllZones, getMap, addPlayerToZone, removePlayerFromZone, getDoorForExit, doorOnLink, setDoorCache, getAllLivePlayers, getLivePlayer, getZoneEnemies, getZoneNpcs, tryBattleCry, isEnterableFacade, frontDoorOf, getMapByParentZone, buildingIconSvg, buildingTypeOf, zoneTerrain, tileIconSvg, buildingEntranceDir, interiorExitDirs, interiorOpenDirs, interiorLockedDirs, facadeStreetTile, applyMinimapVisibility, specOf, persistableZone, propsOf } from '../world.js';
import { getZoneVisibility, getWindowsForZone, getEnvironmentState, getZoneTemperature, getZoneSeverity } from '../environment.js';
import { describeZone, resolveNamedDestination, isInteriorZone } from './describe.js';
import { exitTargets, allExits, primaryExits } from '../exits.js';
import { checkLockAuth, getLockTagPublic, syncApartmentLock } from './doors.js';
import { lockTypePassesWhileLocked } from '../locks.js';
import { impairmentOf } from '../impairment.js';
import { emit } from '../events.js';
import { fireHook } from '../plugins.js';
import { closeShopSession } from '../vendor-session.js';
import { computeCarriedWeight, carryCapacity, formatWeight } from './inventory.js';
import { OPPOSITE } from '../directions.js';
import { forceStand } from '../posture.js';
import { isSneaking } from '../stealth.js';
import { isDreamZone, pushDreamFx } from '../dreamscape.js';
import { registerMoveGate, runMoveGates, climbCheck, registerLockedProvider } from '../movement-gates.js';
import { doorGuardsOnlyUnownedApartment, isResidentOf, getBuildingName } from '../apartments.js';
import { createSelectionState, getSelectionState, formatSelectionPage } from '../sift.js';
import { districtFor } from '../districts.js';
import { getFlag, setFlag } from '../flags.js';
import { zoneDanger } from '../danger.js';
import { addSewerGrime } from '../hygiene.js';
import { mutationFlag } from '../mutations.js';

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
// Push a running stride you can't afford and you're WINDED for this long: stamina
// regen is throttled (gameLoop restRegenTick reads player._windedUntil) until it
// lapses, so recovering means actually resting — not jogging in place on empty.
const WINDED_DURATION_MS = 30000;

// ── Engine move gates (the law layer) ────────────────────────────────────────
// Registered through the same chain plugins use (registerMoveGate), so engine
// laws and plugin gates run in one ordered, listable pipeline. Gates are pure;
// door open/close side effects happen in cmdMove after every gate passes.

// Locked doors block unless the player's lock auth clears them.
// "in"/"out"/"exit" read badly as "the door to the out" — name the destination
// zone instead (door to <exterior/interior zone name>). Cardinal directions keep
// the natural "the door to the north" phrasing.
const NAMED_LOCK_DIRS = new Set(['in', 'out', 'exit']);

// Egress-and-residents rule for a door an NPC locked by itself. `from` is the zone
// being LEFT, which after the facade swap is still the real origin — so a customer
// stepping out of a shop's entry room matches even though the door is nominally on
// the facade seam. Same map counts as the same inside: a back room is still indoors.
function autoLockLetsThrough(player, door, from) {
  const inside = door._autoLockedInside;
  if (!inside || !from) return false;
  if (from.id === inside) return true;                                   // walking out
  const insideMap = getZone(inside)?.map_id;
  if (insideMap && from.map_id === insideMap) return true;               // walking out of a back room
  const building = getBuildingName(getZone(inside));                     // a resident holds a key
  return !!building && isResidentOf(player, building);
}
registerMoveGate(async ({ player, direction, door, to, from }) => {
  if (!door || door.hp <= 0 || door.lock_state !== 'locked') return;
  if (doorGuardsOnlyUnownedApartment(door)) return; // unrented unit — the lock is vestigial
  // An NPC's own lock-up (ai-behaviour.js: shopkeeper closing, resident securing
  // their door) is the one lock nobody chose to put between you and the street,
  // so it is the one lock that must never trap you. `_autoLockedInside` names the
  // side that is indoors: you may always walk OUT of it, and a resident of that
  // building may also walk in. Everyone else reads the closed sign.
  //
  // Deliberately not a general "you can always leave" law — a jail cell, a vault
  // and a privacy bolt are all locks somebody meant to hold you, and they still do.
  if (door._autoLockedInside && autoLockLetsThrough(player, door, from)) return;
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

// The drawn half of the gate above. A surface that shows the sides of a room can
// now ask what the gate would answer, without a body walking into it — and it asks
// HERE so the two can never drift: same door lookup, same three exemptions, in the
// one place a change to either would be made.
//
// It is deliberately NOT the whole gate. Lock AUTH is async (resolveLockAuth reads
// a player's keys), and this is called per side of every tile in the minimap
// window, so the question it answers is "is this door locked", which is true for
// everyone standing there, rather than "would it open for you". A resident sees
// their own front door red and unlocks it, which is what the room description has
// always told them too.
registerLockedProvider((player, from, dir, to) => {
  const door = doorOnLink(from.id, dir, to?.id);
  if (!door || door.hp <= 0 || door.lock_state !== 'locked') return null;
  if (doorGuardsOnlyUnownedApartment(door)) return null;       // unrented unit — vestigial
  if (door._autoLockedInside && autoLockLetsThrough(player, door, from)) return null;
  if (!getLockTagPublic(door)) return null;                    // locked with no lock installed
  return { locked: true };
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

// IMPASSABLE GROUND. `props.passable` is false on exactly one terrain (cliff), and
// this is the only law that reads it. It exists because of what a cliff has to be
// able to do that nothing else in the engine could: shape where players may walk
// WITHOUT anybody hand-editing an exit graph. A painter drags a run of cliff across
// a map in the Studio and the map now has a pass in it.
//
// Everything else that stops you is either mass (a building_type footprint, which is
// what the Thornwarren's thorn is) or an exit that was never written. Both are
// authored per tile by something that knows the whole map. Terrain is painted, and a
// paint stroke has to be able to mean something on its own or the Studio is drawing
// wallpaper.
//
// It is a gate rather than a filter on the exit graph on purpose: the graph stays
// TRUE (the tiles are still adjacent, the minimap still draws the join, derive still
// projects the edge), and the refusal happens at the moment a body tries to move.
// Deleting the edges instead would mean a terrain stroke silently rewrites world
// geometry, and repainting it back would not restore what it removed.
//
// FLIGHT is the first named exemption, added 2026-08-13. It takes a body that grew
// wings, which is a Wildblood mutagen outcome at high expression and costs you your
// torso armour slot permanently.
//
// CLIMBING is the second, added 2026-08-21, and it is a GEAR exemption — which the
// rule written here used to forbid outright, in these words:
//
//   > No climb, deliberately, and no GEAR exemption. A wall you can sometimes get
//   > over is not a funnel, it is a difficulty check, and the whole value of the
//   > feature is that a player can look at the map and KNOW where the ways through
//   > are.
//
// ⚠ THAT SENTENCE IS STILL THE LAW; WHAT CHANGED IS WHERE IT BINDS. Read it again
// and the objection is to "sometimes" and to "you cannot see it coming" — not to
// rope. Both survive here, because the exemption is not a property of the GEAR, it
// is a property of the TILE:
//
//   • Bare `cliff` has no `climbable` prop and never will. It is absolutely
//     impassable to everything but wings, exactly as before. Nothing you can buy,
//     steal or carry opens one.
//   • A `scree` tile is PAINTED — its own terrain, its own fill, its own minimap
//     class. A player looking at the map still KNOWS where the ways through are;
//     there is simply one more kind of way through, and it is drawn.
//   • Passage is DETERMINISTIC. Gear or no gear, stamina or no stamina — never a
//     roll. "Sometimes" is what the rule forbade, and a climb is never sometimes.
//     (The Climbing skill scales the COST, the way Swimming scales a stroke; it
//     does not decide the outcome.)
//
// The engine owns the law and the property and knows nothing about rope: what a
// climber needs is asked of `climbCheck`, and every word of the refusal is the
// provider's. See the ⚠ in movement-gates.js for why it fails closed.
registerMoveGate(async ({ player, to }) => {
  if (!to) return;
  const props = propsOf(to.id);
  if (props.passable) return;
  if (mutationFlag(player, 'flight')) return;
  if (props.climbable) {
    const verdict = await climbCheck(player, to);
    if (verdict?.ok) return;
    if (verdict?.message) return { block: true, message: verdict.message };
  }
  return { block: true, message: 'The rock goes up sheer in front of you. There is no way up it here.' };
}, 'engine:impassable-terrain');

// Water is no longer a wall. Entering a water tile is a SWIM, not a block — the
// swimming plugin (plugins/swimming) charges the stamina, soaks you, pulls your
// core toward hypothermia in the cold, and drowns you if you run dry. Carrying an
// uncontained `boat`-tagged item rides you across dry and free (handled there).
// So there is deliberately no engine:water move gate anymore; the old boat-or-die
// gate was retired when swimming shipped.

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

// Location-gated ambient soundscape for the client (naval gulls/surf on deck, engine-room rumble
// below). Purely a flag lookup — a zone opts in with flags.naval_ambience / flags.engine_ambience.
function ambienceFor(zone) {
  const f = zone?.flags || {};
  return f.naval_ambience ? 'naval' : f.engine_ambience ? 'engine' : null;
}

async function cmdLook(player, targetStr, broadcast) {
  if (targetStr === 'sky' || targetStr === 'up') return cmdLookSky(player);
  if (targetStr === 'ground' || targetStr === 'down') return cmdLookGround(player);
  if (targetStr === 'distance' || targetStr === 'out') return cmdLookDistance(player);
  if (!targetStr || targetStr === 'room' || targetStr === 'around') {
    const zone = getZone(player.current_zone);
    if (!zone) return { type:'error', message:'You are nowhere. This is a bug.' };
    return { type:'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id, 8, player), ambience: ambienceFor(zone) };
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
  // "go <dir> <name>" — the click path sends the direction the link was drawn
  // under alongside the destination name. The name picks the specific exit; if
  // it can't be resolved at all, we still walk the direction.
  const dirHint = goParts.length > 1 && RAW_DIRECTIONS.includes(goParts[0]) ? goParts[0] : null;
  const nameText = dirHint ? goParts.slice(1).join(' ') : argText;
  const resolved = resolveNamedDestination(zone, nameText, dirHint);
  if (resolved.type === 'unique') return cmdMove(resolved.match.direction, player, broadcast, { targetZoneId: resolved.match.targetId });
  if (dirHint && resolved.type !== 'ambiguous') return cmdMove(dirHint, player, broadcast);
  if (resolved.type === 'ambiguous') {
    // Numbered SIFT picker, one line per candidate with the way it lies — picking
    // a number moves straight to that zone id (see the intercept in index.js),
    // which is the only route that works when the names are identical.
    const candidates = resolved.candidates.map(c => ({
      id: c.targetId,
      name: `${c.name} (${c.direction})`,
      direction: c.direction,
    }));
    createSelectionState(player.id, candidates, { verb: 'go' });
    return {
      type: 'output',
      message: `Several places here are called that.\n${formatSelectionPage(getSelectionState(player.id))}`,
    };
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

// The facade pass-through (zone redesign Phase 5). Returns null when `to`
// isn't an enterable facade — or when it is one but has no usable street tile
// to spill onto (legacy fallback: the facade stays standable rather than
// walling the player in).
function resolveFacadeTransit(from, to) {
  if (!isEnterableFacade(to)) return null;
  const interior = getMapByParentZone(to.id);
  if (from.map_id === interior.id) {
    // Exiting: interior → facade → street, in one move. The facade is
    // non-standable, so spill straight onto the entrance street tile rather than
    // stranding the player on the facade for an extra step. The exit-side front
    // door was already found by the standard lookup (interior↔facade link), so
    // leave `door` untouched (frontDoor: null). Fall back to landing on the
    // facade only when no street tile resolves (the legacy walled-in guard).
    const streetId = facadeStreetTile(to);
    const street = streetId ? getZone(streetId) : null;
    if (!street) return null;
    return { finalId: streetId, finalZone: street, frontDoor: null };
  }
  // Entering: anywhere else → facade → interior entry zone. The front door lives on
  // the facade↔interior link, so surface it for the gate chain (the street→facade hop
  // has no door of its own). frontDoorOf owns that lookup — the door verbs reach
  // through the facade with the same call, so what you can walk through is what you
  // can also open.
  const entryId = interior.entry_zone_id;
  const entryZone = getZone(entryId);
  return { finalId: entryId, finalZone: entryZone, frontDoor: frontDoorOf(to) };
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
    // No authored exit this way — but a plugin may turn a map edge into a
    // transition (walking off the perimeter into the void-travel waste). Offer
    // the edge to any handler before reporting a wall; a returned result is the
    // move outcome. A law never names a system, so this is a generic seam.
    const edge = await fireHook('movement.edge', { player, zone, direction, broadcast, opts });
    if (edge) return edge;
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
      // movePicker carries the ordered candidate zone ids so a client that already
      // knows which destination it wants (GPS auto-walk) can answer the right number
      // itself instead of stalling. Numbers match the rendered [1]/[2] order.
      return {
        type: 'output',
        message: `Several ways lead ${direction}.\n${formatSelectionPage(getSelectionState(player.id))}`,
        movePicker: { direction, candidates: candidates.map((c, i) => ({ n: i + 1, id: c.id })) },
      };
    }
  }
  let targetZone = getZone(targetId);
  if (!targetZone) return { type:'error', message:'That exit leads nowhere yet.' };

  // Door may be on either side: in this zone going out, or in the target zone going back
  let door = doorOnLink(zone.id, direction, targetId);

  // Revolving-door seam: an enterable facade is never stood on. Stepping onto
  // it from the street forwards straight into the interior entry zone; walking
  // out of the interior forwards straight back onto its entrance street tile
  // (facadeStreetTile). The swap happens BEFORE the gate chain, so gates
  // run exactly once with from=origin, to=final destination, door=front door —
  // no pacing double-charge, and the lock law is checked on the real door.
  const transit = resolveFacadeTransit(zone, targetZone);
  if (transit) {
    if (!door) door = transit.frontDoor;
    targetId = transit.finalId;
    targetZone = transit.finalZone;
  }

  // Gate chain: pure vetoes (engine laws below + plugin-registered gates) run
  // before anything mutates. Previously the door opened before the encumbrance
  // check could veto, leaving it standing open on a blocked move.
  const veto = await runMoveGates({ player, from: zone, to: targetZone, direction, door, opts });
  // A gate may block silently (veto.silent) — e.g. the pacing plugin deferring a
  // too-fast step into its move queue — in which case no error line is shown; the
  // step is simply not executed now.
  // A GATE'S MESSAGE IS PROSE, AND PROSE HERE IS HTML. Nine of the ten gates that
  // write markup never set `html`, so the shoplifting door prompt was showing the
  // player a literal `<b>` — the flag was opt-in and every author but one missed
  // it, which makes it the wrong default rather than nine mistakes. Gate messages
  // are server-authored (the one player-controlled string that reaches them, a
  // storefront's shop_name, has `<>` stripped at the input boundary in
  // `cmdRenameShop`), so this is the same trust level as every zone_event
  // broadcast. `html: false` still opts out. `.msg` is `white-space: pre-wrap`,
  // so the `\n` in a two-line prompt survives the switch to innerHTML.
  if (veto) return veto.silent ? null : { type:'error', message: veto.message, html: veto.html !== false };

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
      // The narration already says a locked door disengages and you open it. The
      // sound is that same sentence, for someone who isn't reading it — and the
      // lock leads, because that is the order it happens in.
      if (doorWasLocked) emit('door.sfx', { door, zoneId: player.current_zone, actorId: player.id, cue: 'unlock' });
      emit('door.sfx', { door, zoneId: player.current_zone, actorId: player.id, cue: 'open' });
    }
  }

  const oldZoneId = player.current_zone;

  closeShopSession(player.id); // leaving the zone ends any active shop session (unpauses the vendor)
  removePlayerFromZone(player.id, player.current_zone);
  addPlayerToZone(player.id, targetId);
  player.current_zone = targetId;
  // Runtime-only, no query — the zone object is already loaded, so this is a
  // free field check, not a hot-path DB read. Grease-skinned sewer water rubs
  // off a little on every step down there; see hygiene.js's sewer grime meter.
  if (targetZone.flags?.district === 'sewer') addSewerGrime(player);
  emit('zone.entered', { actor: player, zone: targetId, from: oldZoneId, opts });
  player.combatTargetId = null;
  // Walking in a dream is the MIND moving; the body is still lying in a bed
  // somewhere and must stay lying, or the first step in a dreamscape would stand
  // the sleeper up and broadcast it to a room they aren't awake in.
  // Walking between rooms of a dream changes the particle field with you; walking
  // OUT of one clears it, which is what hands the real weather back.
  if (isDreamZone(targetId) || isDreamZone(oldZoneId)) pushDreamFx(player, broadcast);
  // Sneaking SURVIVES a step. It is the one posture whose entire purpose is to
  // be held while crossing rooms — forceStand('moved') clearing it meant you
  // could never sneak anywhere, only sneak where you already were.
  const sneaking = isSneaking(player);

  // ── The step ────────────────────────────────────────────────────────────────
  //
  // A DEDICATED event, deliberately not `zone.entered`. That one is also emitted
  // by scripted teleports (graph.js), and it is how flight, voidwalking and dream
  // transitions announce an arrival — so hanging a footstep off it means boots
  // when you fast-travel, and gating that back out is a list of exclusions
  // somebody eventually forgets to extend. Only walking calls cmdMove, so the
  // gate here is structural rather than a condition anyone has to remember.
  //
  // Everything it carries is already in hand — no query, on the per-move path.
  // Intensity is weight and pace: sneaking is most of the point of sneaking, and
  // running is the one thing a room ought to hear coming.
  emit('movement.step', {
    actor: player,
    zone: targetId,
    from: oldZoneId,
    intensity: sneaking ? 0.12 : player.running ? 0.85 : 0.5,
  });

  const interrupted = (player.sleeping?.inDream || sneaking) ? null : forceStand(player, 'moved');
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
  // The per-move players write is coalesced into ONE UPDATE further down
  // (current_zone always; radiation/stamina only when this move changed them) —
  // this path used to issue up to three serial single-column UPDATEs on the
  // same row, each a full round trip. In-memory state is authoritative
  // mid-move (the row write is durability only), so nothing between here and
  // the flush reads the DB copy of these columns.
  const pendingWrite = { current_zone: targetId };

  const arrivalDir = OPPOSITE[direction] || null;

  const hadDoor = !!(door && door.hp > 0);
  const lockTag = hadDoor ? getLockTagPublic(door) : null;

  // Elevator flavour, mirroring moveEntity (ai-behaviour.js) so a player and an
  // NPC read the same when the doors open: every floor shares the car's `up`/`in`
  // exit, so the raw direction lands as "climbs the stairs" in a lift.
  const toCar   = !!targetZone.flags?.elevator;
  const fromCar = !!zone.flags?.elevator;
  const departMsg = toCar
    ? `${player.handle} steps into the elevator.`
    : fromCar
      ? `${player.handle} steps out of the elevator.`
      : doorWasLocked
        ? `The lock disengages. ${player.handle} opens the door and heads ${direction}.`
        : doorWasClosed
          ? `${player.handle} opens the door and heads ${direction}.`
          : `${player.handle} heads ${direction}.`;
  let arriveMsg = toCar
    ? `The doors part and ${player.handle} steps into the car.`
    : fromCar
      ? `The elevator chimes and ${player.handle} steps out.`
      : (doorWasLocked || doorWasClosed)
        ? (arrivalDir ? `${player.handle} comes through the door from the ${arrivalDir}.` : `${player.handle} comes through the door.`)
        : buildArriveMsg(player.handle, arrivalDir, zone.name);
  // A plugin may replace the arrival line entirely (drama: armed dramatic entrances).
  const customArrive = await fireHook('movement.arriveMessage', { player, fromZone: zone, toZoneId: targetId, direction, arrivalDir, defaultMessage: arriveMsg });
  if (typeof customArrive === 'string' && customArrive.trim()) arriveMsg = customArrive.trim();
  // A sneaker's coming and going is NOT announced. The room-wide line is the
  // thing that made stealth cosmetic: you could roll unnoticed and still be
  // read out on arrival. Anyone who does notice is told by the sneak plugin's
  // sweep instead, per observer — which is the only place that knows who did.
  if (!sneaking) {
    broadcast(zone.id, { type:'zone_event', message: departMsg, refresh: true, _movement: true }, player.id);
    broadcast(targetId, { type:'zone_event', message: arriveMsg, refresh: true, _movement: true }, player.id);
  }

  // Close (and re-lock if locked) the door behind the player
  if (hadDoor && doorWasClosed) {
    door.is_open = 0;
    // "The door swings closed." Both zones are told, in the two broadcasts below,
    // because a door shutting is audible from either side of it — so the sound
    // follows the same two rooms rather than inventing its own audience.
    emit('door.sfx', { door, zoneId: oldZoneId, actorId: player.id, cue: 'close' });
    emit('door.sfx', { door, zoneId: targetId, cue: 'close' });
    if (doorWasLocked) {
      door.lock_state = 'locked';
      setDoorCache(door.id, door);
      // Mirror it onto the apartment row. `apartments.is_locked` and
      // `doors.lock_state` are two records of one fact, and the apartment
      // description reads the FORMER — so a door that re-locked here without
      // this call left the room cheerfully announcing "The door is unlocked"
      // while the hololock had just snapped shut behind you. Every other path
      // that moves a lock already mirrors it; this one was the hole.
      syncApartmentLock(door, 'locked').catch(e =>
        console.error('[movement] apartment lock mirror failed for door', door.id, e.message));
      emit('door.sfx', { door, zoneId: zone.id, actorId: player.id, cue: 'lock' });
      emit('door.sfx', { door, zoneId: targetId, cue: 'lock' });
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

  // Radiation no longer accrues on movement. Exposure is driven by the RADIATION
  // MODEL (a tile's radiation tag), applied as a slow trickle in the minute tick
  // (gameLoop.js) — not a per-step spike keyed on which district you walked into.
  const describeOut = {};
  const zoneDesc = await describeZone(targetZone, player, describeOut);

  const destName = targetZone.name;
  // The word the narration uses for the way you went. Normally the direction you
  // typed, but a caller can override it when the exit's compass label isn't what
  // the move IS — stepping off an elevator rides the car's shared `up` exit, and
  // "you head up to the Sky Pad" reads as stairs.
  const narrateDir = opts.narrateDir || direction;
  let narration;
  if (doorWasLocked) {
    const unlockMsg = lockTag?.messages?.unlock ?? 'The lock disengages.';
    const closeMsg = doorWasClosed ? ' It swings closed and locks behind you.' : '';
    narration = `→ ${unlockMsg} You open the door ${narrateDir} into ${destName}.${closeMsg}`;
  } else if (doorWasClosed) {
    narration = `→ You open the door ${narrateDir} into ${destName}. It swings closed behind you.`;
  } else {
    narration = `→ You head ${narrateDir} to ${destName}.`;
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
        pendingWrite.stamina = player.stamina;
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
  // Walking hurt costs you. Charged on the same terms as the run toll — system
  // relocations are exempt — and deliberately NEVER blocks the step: a player who
  // cannot move is a player with nothing to do but wait, which is the one failure
  // state this whole system is built to avoid.
  const moveExtra = opts.bypassEncumbrance ? 0 : impairmentOf(player).moveStaminaExtra;
  if (moveExtra > 0) {
    player.stamina = Math.max(0, (player.stamina ?? (player.stamina_max ?? 100)) - moveExtra);
    pendingWrite.stamina = player.stamina;
    broadcast(null, { type:'resource_tick', messages:[], player_update:{ stamina: player.stamina } }, null, player.id);
  }

  if (player.running && !opts.bypassEncumbrance) {
    const before = player.stamina ?? (player.stamina_max ?? 100);
    if (before >= RUN_STEP_STAMINA) {
      player.stamina = before - RUN_STEP_STAMINA;
      pendingWrite.stamina = player.stamina;
      broadcast(null, { type:'resource_tick', messages:[], player_update:{ stamina: player.stamina } }, null, player.id);
    } else {
      // Still trying to run on an empty tank — you're gassed. Stamp (and keep pushing
      // forward) the winded window so regen stays throttled until you rest; announce
      // only on the transition in, not on every wheezing stride.
      const wasWinded = (player._windedUntil ?? 0) > Date.now();
      player._windedUntil = Date.now() + WINDED_DURATION_MS;
      if (!wasWinded) broadcast(null, { type:'resource_tick', messages:['You\'re completely winded — chest heaving, you have to catch your breath before you can run again.'], player_update:{ stamina: player.stamina } }, null, player.id);
    }
  }

  // Persistence tier: current_zone (and the stamina that rides a move) is
  // CHECKPOINT, not write-through. Live position is authoritative in RAM (see the
  // pendingWrite note above), so the per-step round trip was pure durability on the
  // hottest path in the game. We write through immediately only when the move
  // crosses a meaningful threshold — into or out of an interior/apartment/building,
  // a place it would be jarring to NOT be after a crash. Every other step just marks
  // the player dirty and lets the idle-gated periodic flush (flushDirtyPositions,
  // registered in gameLoop.js) batch the whole server into one UPDATE. See
  // docs/architecture.md (Persistence Tiers) and the movement-lag audit (Read Tiers).
  if (isInteriorZone(zone) !== isInteriorZone(targetZone)) {
    const cols = Object.keys(pendingWrite);
    await query(
      `UPDATE players SET ${cols.map((c, i) => `${c}=$${i + 1}`).join(', ')} WHERE id=$${cols.length + 1}`,
      [...cols.map(c => pendingWrite[c]), player.id]
    );
    player._posDirty = false;
  } else {
    player._posDirty = true;
  }

  // Stamp the move for the rest/regen tick — stamina only recovers after a short
  // idle delay since your last step (see restRegenTick in gameLoop.js).
  player._lastMoveAt = Date.now();

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

  return { type:'move', message:zoneDesc, narration, zone:targetId, direction, minimap: getMinimapData(targetId, 8, player), tempC: getZoneTemperature(targetId), ambience: ambienceFor(targetZone), visibility: describeOut.vis };
}

// Idle-gated periodic checkpoint of live positions (registered on '1m' in
// gameLoop.js). current_zone/stamina are CHECKPOINT-tier — live state is
// RAM-authoritative (see cmdMove), so rather than a per-step round trip we batch
// every player who has moved since the last flush into ONE UPDATE. Never a
// per-player loop: N moved players cost exactly one round trip. A throw here is
// benign — the rows stay dirty and the next tick retries. The scheduler idle-gates
// this by default, so an empty world writes nothing.
export async function flushDirtyPositions() {
  const dirty = getAllLivePlayers().filter(p => p._posDirty);
  if (!dirty.length) return;
  const rows = [];
  const params = [];
  dirty.forEach((p, i) => {
    const b = i * 3;
    rows.push(`($${b + 1}::text, $${b + 2}::text, $${b + 3}::int)`);
    // persistableZone, not current_zone: a dreamer walking between dream rooms
    // marks _posDirty like any other move, and this batch would otherwise write
    // a RAM-only zone id into the durable row.
    params.push(p.id, persistableZone(p), Math.round(p.stamina ?? p.stamina_max ?? 100));
  });
  try {
    await query(
      `UPDATE players AS pl SET current_zone = v.zone, stamina = v.stam
       FROM (VALUES ${rows.join(', ')}) AS v(id, zone, stam)
       WHERE pl.id = v.id`,
      params
    );
    for (const p of dirty) p._posDirty = false;
  } catch (err) {
    console.error(`flushDirtyPositions failed: ${err.message}`);
  }
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

// Default window half-radius (interior floor plans + the innermost overworld stop).
// dx,dy ∈ −HALF..+HALF; both map surfaces bounding-box the tiles they get.
const MAP_WINDOW_HALF = 5;

// Unified map-zoom ladder, most-zoomed-IN first. Each overworld stop is a window
// half-radius; the terminal stop (index === MAP_ZOOM_MAX) is the whole contiguous
// landmass (regional). Zooming out on either map surface walks this ladder, growing
// the tile window until it saturates the region. Interior, when inside a building,
// sits one stop inside z0. Kept in step with the client pixel-size ladders in
// panels/minimap.js and panels/tablet-os.js by index.
const MAP_ZOOM_HALVES = [5, 8, 12, 17, 23]; // z0 11×11 · z1 17×17 · z2 25×25 · z3 35×35 · z4 47×47
const MAP_ZOOM_MAX = MAP_ZOOM_HALVES.length; // z{MAX} = regional (terminal stop)

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
// Uses the clean signals (airfield membership, building_type on adjacent buildings)
// plus vendor NPCs and up/down stairs. Deliberately SPARSE: most tiles return null.
// Priority is the "what matters most here" order. { icon, poi } | null.
const POI_ICON = { aa: '⌖', airport: '✈', police: '★', power: '⚡', club: '♥', nightclub: '🎶', bar: '🍺', hotel: '🏨', bathhouse: '♨', noodle_bar: '🍜', vendor: '$', home: '⌂', stairs: '⇕' };
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
  // AA emplacements outrank everything (incl. the up/down-hatch stairs marker below)
  // so a battery reads as a battery, not a stairwell.
  if (zone.flags?.aa_site) return { icon: POI_ICON.aa, poi: 'aa' };
  // MEMBERSHIP, not the name. This tested `flags.airfield_name` until 2026-08-02 —
  // a display string standing in for "is this an airfield" — so the two hangar
  // interiors that carried a courtesy copy of their field's name drew an airport
  // marker, and a field would have lost its icon the moment someone left the name
  // to fall back to the tile's own.
  if (zone.flags?.airfield_id) return { icon: POI_ICON.airport, poi: 'airport' };
  const bt = buildingTypesAt(zone);
  if (bt.has('police')) return { icon: POI_ICON.police, poi: 'police' };
  if (POWER_RE.test(zone.id || '') || POWER_RE.test(zone.name || '') ||
      allExits(zone).some(e => { const t = getZone(e.target); return t?.flags?.is_building && (POWER_RE.test(t.id || '') || POWER_RE.test(t.name || '')); }))
    return { icon: POI_ICON.power, poi: 'power' };
  if (bt.has('club')) return { icon: POI_ICON.club, poi: 'club' };
  if (bt.has('nightclub')) return { icon: POI_ICON.nightclub, poi: 'nightclub' };
  // Bar vs hotel are split by whether the building houses people (hotel = lodging);
  // both outrank the generic vendor $ so a bar with a bartender-vendor still reads as a bar.
  if (bt.has('hotel')) return { icon: POI_ICON.hotel, poi: 'hotel' };
  if (bt.has('bar')) return { icon: POI_ICON.bar, poi: 'bar' };
  // Marrow Street's two destination-in-their-own-right shops outrank the generic $:
  // you go to a bathhouse or a noodle counter for the thing, not for the shelf.
  if (bt.has('bathhouse')) return { icon: POI_ICON.bathhouse, poi: 'bathhouse' };
  if (bt.has('noodle_bar')) return { icon: POI_ICON.noodle_bar, poi: 'noodle_bar' };
  if (bt.has('shop') || bt.has('grocery') || bt.has('store') || bt.has('dept_store') ||
      bt.has('hardware') || bt.has('outfitter') || bt.has('bodega') || hasVendorNpc(zone.id))
    return { icon: POI_ICON.vendor, poi: 'vendor' };
  // Residential blocks (not hotels — those returned above) get a home marker, ranked
  // below service/vendor POIs so a shop-fronted apartment tile still reads as a shop.
  if (bt.has('apartment')) return { icon: POI_ICON.home, poi: 'home' };
  if (zone.exits?.up || zone.exits?.down) return { icon: POI_ICON.stairs, poi: 'stairs' };
  return null;
}

// One tile snapshot, positioned at (x,y) relative to the map's origin.
function mapTile(zone, x, y, placed, currentId, viewer = null) {
  const links = {};
  for (const [dir, target] of Object.entries(primaryExits(zone))) {
    if (placed.has(target) && MAP_DIR_OFFSET[dir]) links[dir] = target;
  }
  const poi = mapPoi(zone);
  return {
    id: zone.id, x, y, name: zone.name,
    danger: zoneDanger(zone), marker: zone.marker || null,
    color: zone.color || null, bg_color: zone.bg_color || null,
    spec: specOf(zone.id),  // generated presentation — what the tile is actually painted from
    func: mapFunc(zone),
    district: districtFor(zone).key, // land-use district key — the regional map shows only your own

    description: zone.description || '',
    buildings: buildingsAt(zone),
    icon: poi?.icon || null, poi: poi?.poi || null,
    // The footprint SVG and the map code are spec.feature / spec.label — see the note
    // in world.js's minimap payload. `svg` was the same value under a second name.
    building_type: buildingTypeOf(zone), // facade tile's type — drives the labels/icons map overlay
    building_name: zone.flags?.building_name || null,
    entrance: buildingEntranceDir(zone), // which edge the door faces — drives the map entrance arrow
    exit_dirs: interiorExitDirs(zone), // interior room's ways out — drives the interior map's exit arrows
    open_dirs: interiorOpenDirs(zone), // every cardinal side that's open — drives the "edge lines" door style
    locked_dirs: interiorLockedDirs(zone, viewer), // ...and which of those a lock holds shut — the same lines, drawn red
    terrain: zoneTerrain(zone), // 'road' | 'water' | 'grass' | null — tileable terrain styling

    // `water:` used to ride here, described as "the client refuses to route onto it".
    // No client code ever read it — the minimap styles water off `terrain` and the
    // auto-walker follows the server's own route. Routability is a server decision
    // (propsOf().routable, honoured in pathfinding), so the payload doesn't restate it.

    curtain: zone.flags?.curtain ? true : null, // the Architect's perimeter wall edge
    perimeter_gate: zone.flags?.perimeter_gate ? true : null, // the one break in the Curtain
    glacis: zone.flags?.glacis ? true : null, // turret killing-ground outside the gate

    // Street name(s) this tile sits on (an intersection can carry more than one) — null if none.
    artery: Array.isArray(zone.flags?.artery) ? zone.flags.artery : (zone.flags?.artery ? [zone.flags.artery] : null),
    exits: links, isCurrent: zone.id === currentId,
  };
}

// Square window of half-radius `half` centered on centerId, tiles positioned relative
// to it (center at 0,0). Placed centers use grid coords; unplaced (coordless interior)
// centers fall back to a BFS virtual grid clamped to the window.
function windowTiles(centerId, viewer = null, half = MAP_WINDOW_HALF) {
  const center = getZone(centerId);
  if (!center) return [];
  const H = half;

  if (center.map_id && center.grid_x != null && center.grid_y != null) {
    const cx = center.grid_x, cy = center.grid_y, cz = center.grid_z ?? 0;
    const onMap = applyMinimapVisibility(getAllZones().filter(z =>
      z.map_id === center.map_id && (z.grid_z ?? 0) === cz &&
      z.grid_x != null && z.grid_y != null &&
      Math.abs(z.grid_x - cx) <= H && Math.abs(z.grid_y - cy) <= H), viewer);
    const placed = new Set(onMap.map(z => z.id));
    // (The whole-map coord index that stood here fed roadConnector. The build resolves
    // the connector now — see world.js tileIconSvg.)
    return onMap.map(z => mapTile(z, z.grid_x - cx, z.grid_y - cy, placed, centerId, viewer));
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
    if (zone) tiles.push(mapTile(zone, x, y, placed, centerId, viewer));
  }
  return tiles;
}

// The contiguous landmass (4-adjacent grid tiles) the player's overworld tile sits
// on. The overworld holds more than one disconnected cluster — the live district and
// orphaned legacy geometry (the old Coldwater map) parked ~900 tiles away — and the
// regional view should show only the one you're standing on, so a far-off island
// doesn't sit in the corner shrinking everything else. Returns the whole set if the
// player's tile can't be located (fall back to showing all).
function landmassTiles(onMap, startId) {
  const byXY = new Map(onMap.map(z => [`${z.grid_x},${z.grid_y}`, z]));
  const start = onMap.find(z => z.id === startId);
  if (!start) return onMap;
  const seen = new Set([`${start.grid_x},${start.grid_y}`]);
  const queue = [start];
  while (queue.length) {
    const z = queue.shift();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const key = `${z.grid_x + dx},${z.grid_y + dy}`;
      const n = byXY.get(key);
      if (n && !seen.has(key)) { seen.add(key); queue.push(n); }
    }
  }
  return onMap.filter(z => seen.has(`${z.grid_x},${z.grid_y}`));
}

// Full overworld (map_world, floor 0), absolute coords — the regional land-use view,
// scoped to the player's own contiguous landmass (see landmassTiles).
export function regionalTiles(currentOverworldId, viewer = null) {
  const onMap = applyMinimapVisibility(getAllZones().filter(z =>
    z.map_id === 'map_world' && (z.grid_z ?? 0) === 0 &&
    z.grid_x != null && z.grid_y != null), viewer);
  const tilesOnLandmass = landmassTiles(onMap, currentOverworldId);
  const placed = new Set(tilesOnLandmass.map(z => z.id));
  return tilesOnLandmass.map(z =>
    mapTile(z, z.grid_x, z.grid_y, placed, currentOverworldId, viewer));
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
  if (!current) return { mode:'zone', tiles: [], insideInterior: false, zoomLevel: 0, maxZoom: MAP_ZOOM_MAX };
  const inside = isInteriorZone(current);
  arg = String(arg || '').toLowerCase();

  // Off the grid — a void-crossing room isn't on any world map, so the normal city
  // map has no signal. Every zoom arg collapses to the "journey map": the same trail
  // chart the minimap draws (getMinimapData nodes), rendered full-screen in the Map
  // app. Client renderMap keys on mode:'crossing' (renderJourneyMap).
  if (current.flags?.void_crossing)
    return { mode: 'crossing', nodes: getMinimapData(current.id, 8, player), insideInterior: false, zoomLevel: 0, maxZoom: 0 };

  const owId = overworldTileId(current);

  // Interior — the innermost stop; only exists inside a building. Bare `map` while
  // inside defaults here (interior stays automatic); `map interior` requests it.
  if ((arg === 'interior' || arg === '') && inside)
    return { mode:'interior', tiles: windowTiles(current.id, player), insideInterior: true, zoomLevel: -1, maxZoom: MAP_ZOOM_MAX };

  // Overworld zoom level on the unified ladder. `z<n>` picks it directly; `regional`
  // (and other legacy words) map onto the ladder ends for back-compat.
  let level;
  const m = /^z(\d+)$/.exec(arg);
  if (m) level = Math.max(0, Math.min(MAP_ZOOM_MAX, parseInt(m[1], 10)));
  else if (arg === 'regional') level = MAP_ZOOM_MAX;
  else level = 0; // zone / bare-not-inside / legacy words → innermost overworld stop

  if (level >= MAP_ZOOM_MAX)
    return { mode:'regional', tiles: regionalTiles(owId, player), insideInterior: inside, zoomLevel: MAP_ZOOM_MAX, maxZoom: MAP_ZOOM_MAX };
  // Overworld window centered on your surface tile (owId), or current if unresolved,
  // widening with the zoom level until the region saturates → regional above.
  return { mode:'zone', tiles: windowTiles(owId || current.id, player, MAP_ZOOM_HALVES[level]), insideInterior: inside, zoomLevel: level, maxZoom: MAP_ZOOM_MAX };
}

function cmdMap(player, args = []) {
  const arg = Array.isArray(args) ? (args[0] || '') : '';
  // The two text rungs want genuinely different maps — the only surface where that
  // is true. A character grid is still a visual-spatial artefact: fine to glance
  // at, close to useless read aloud. See server/engine/map-text.js.
  if (loggedPanelsSync(player)) return { type: 'output', message: renderMapBriefing(player) };
  if (textMinigamesSync(player)) return { type: 'output', message: renderMapChart(player) };
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
