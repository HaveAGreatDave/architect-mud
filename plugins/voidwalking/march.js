// THE WALKER'S TRAVERSAL VERB — `march`.
//
// A room is a tile (see the long note in index.js), which is both the change that made this
// necessary and the reason it could not have existed before. Coldwater to Terminus is 282 rooms;
// walked by hand that is 282 typed `south`es, and every one of them is the same decision — the one
// you already made when you set out. The 32 authored highlights in flavour.js are spread over those
// 282 tiles at a 5.5% roll, so the walk that was meant to be a landscape is mostly a keystroke count
// with a landscape somewhere inside it.
//
// `march` walks the trail and stops when there is something to decide. Nothing else changes: the
// same tiles, the same encounters, the same water.
//
// ── THREE RULES ──────────────────────────────────────────────────────────────
//
// ⚠ IT IS THE ORDINARY MOVE, NOT A SECOND ONE. Every step calls the engine's own `cmdMove('south')`
// — the identical function the `south` handler is bound to — so the move gates, `zone.entered`, the
// window refresh, the encounter roll, followers, stamina, the persistence tier and the arrival
// teardown all come along without this file knowing that any of them exist. There is deliberately no
// fast path, and the payoff is visible in what is NOT written here: voidwalking's two move gates (a
// live foe seals `south`, a pitch seals `south`) already halt a march, because a blocked move comes
// back as an error and an error ends the run. The day somebody adds a third gate, a march obeys it.
//
// ⚠ IT COSTS THE SAME MINUTES, AND THAT IS THE WHOLE OF THE PACING DECISION. Thirst runs on the WALL
// CLOCK and not on the step: one point per 12 minutes awake, and `SWEAT_THIRST_PER_MIN = 2` in real
// heat (gameLoop.js). A march that fired all 282 moves inside one tick would therefore cost
// approximately no water at all — and the springs, the cisterns, the wayside barrels, `camp`'s
// twelve-thirst price and the entire reason a cut's "save twenty tiles" is worth anything would go
// with it. One tile per two-second tick is roughly the tempo a person types at, so the verb removes
// the KEYSTROKES and not the JOURNEY. (The same cadence, and the same reasoning, as the text
// driver's — see the TICK note in plugins/trucking/textdrive.js.)
//
// ⚠ AND THE HALT LIST IS SHORTER THAN THE INTERESTING LIST. Encounters land every ~22 tiles and
// features every ~18, so halting on both is about 28 stops on the long haul rather than the ~13 that
// makes this worth having — and `KIND_WEIGHTS` puts MARKER at 34% of all features, which is a hubcap
// shrine, a line of boots and a chair. Scenery is not a decision. A marker goes past in the pane the
// way the ground does; water, shelter, respite, salvage and hazard stop you, because every one of
// them is a thing you would do something about.
//
// ── WHAT IS DELIBERATELY NOT HERE ────────────────────────────────────────────
//
// No distance argument. `march 20` would be a number the player has to estimate about country they
// cannot see, and the halts already answer the question it was trying to ask.
//
// No pathfinding, and no route table. `south` is forward everywhere on the graph — trunk, limb and
// cut all wire it that way — so the walk is "take the exit in front of you" and nothing more.
//
// ⚠ BUT THE FORK IS NAMED EXPLICITLY, AND THE FIRST DRAFT OF THIS FILE DID NOT NAME IT. The reasoning
// that got it wrong is worth keeping, because it reads as sound: the trunk loop in `planFor` only
// writes `exits.south` for `i < trunkLen - 1`, so the last trunk room has no way on and a march would
// stop there for free. What that misses is the next loop — `rooms.get(fork).exits[d.dir] =
// limbId(d.key, 0)` — which hangs each limb off the fork in ITS OWN direction, and Coldwater's first
// destination heads **south**. So the fork has a `south` exit after all, and a march would have
// walked straight through the only real choice in the crossing and picked a heading for the player
// without saying so. The regress case that found it is the one that asserts the fork carries a limb
// south AND that a march stops there anyway.

import { schedule } from '../../server/engine/scheduler.js';
import { getLivePlayer, getZone, getZoneEnemies } from '../../server/engine/world.js';
import { sendToPlayer, getBroadcast } from '../../server/engine/messaging.js';
import { stampToLog } from '../../server/engine/room-brief.js';
import { on } from '../../server/engine/events.js';
// The move itself. Imported rather than reimplemented — see rule one.
import { cmdMove } from '../../server/engine/commands/movement.js';

// ── Wiring ───────────────────────────────────────────────────────────────────
// index.js hands this module the two things it needs and imports nothing back, the same registration
// shape `registerCrossingPoints` and `registerTrailCuts` already use in that file. A plain import
// both ways would be a cycle, and the plan is index.js's to own.
let CTX = null;
export function wireMarch(ctx) { CTX = ctx; }

const TICK = '2s';

// Live marches, keyed by player id. RAM only, exactly like a crossing itself — logging out ends one,
// and there is nothing to persist because the walk is a series of ordinary moves that have each
// already happened.
const runs = new Map();
export const isMarching = (pid) => runs.has(pid);

// The kinds of highlight that are a decision rather than a view. See rule three.
const ACTIONABLE_KINDS = new Set(['water', 'respite', 'shelter', 'salvage', 'hazard']);

// ⚠ THIRST HALTS ARE GATES YOU CROSS, NOT A LEVEL YOU ARE AT. A flat "stop below 40" makes the verb
// stop working at exactly the point in a crossing where you most want it — you would be halted on
// every single tile for the rest of the walk. So a run takes the gates that are still ahead of it at
// the moment you set off and spends them one at a time: below 40 you get one warning at 20 and one
// at 10, and below 10 the desert has already said everything it has to say.
const THIRST_GATES = [40, 20, 10];

const dim = (s) => `<span class="text-dim">${s}</span>`;
const amber = (s) => `<span class="text-amber">${s}</span>`;

// ── Where a room sits along the walk ─────────────────────────────────────────
// Read off the PLAN, which is ordered by construction, rather than parsed back out of a room id.
// A cut or a detour is off the spine and has no reading of its own — which is correct, and is the
// same answer `crossingChain` gives a driver for the same reason.
function spineAt(c, roomId) {
  const t = c.plan.trunk.indexOf(roomId);
  if (t >= 0) return { i: t, total: null, key: null };
  for (const key of Object.keys(c.plan.limbs)) {
    const j = c.plan.limbs[key].indexOf(roomId);
    if (j >= 0) return { i: c.plan.trunkLen + j, total: c.plan.trunkLen + c.plan.limbs[key].length, key };
  }
  return null;
}

function headingOf(c, key) {
  return c.dests?.find(d => d.key === key)?.heading || null;
}

// What the fork says, in one place, because the verb refuses to START here for the same reason the
// tick refuses to walk past it and both should say the same thing.
function forkLine(c) {
  const dests = (c.dests || []).map(d => `<b>${d.heading}</b>`).join(' or ');
  return dests
    ? `The trail comes apart here. From here it is ${dests} — pick one and the walk goes on.`
    : 'The trail comes apart here, and nothing goes on from it.';
}

// ── Why a march stops ────────────────────────────────────────────────────────
//
// Returns null to keep walking, `QUIET` to stop with nothing to add, or a line. Checked against the
// room you have just ARRIVED in, so everything here is about the tile under your feet rather than the
// one ahead of it — the tile ahead is the move gates' business and they answer it themselves.
//
// QUIET is a real answer and not an absence. An ambush has already been broadcast to the whole room
// by `spawnFoe`; printing "you stop" underneath it would be the system narrating over its own event.
const QUIET = Symbol('march.quiet');
function haltReason(c, player) {
  const id = player.current_zone;
  const z = getZone(id);
  if (!z) return 'The ground stops making sense. You stop with it.';

  // Something is in the room with you. The encounter roll fired on arrival (zone.entered, in
  // index.js) and its own line has already been broadcast, so this only has to stop walking.
  if (getZoneEnemies(id).length) return QUIET;

  const r = c.plan.rooms.get(id);

  // ⚠ THE FORK, BY IDENTITY AND NEVER BY ITS EXITS. See the note at the head of this file: a limb
  // hangs off the fork in its own direction, and the first one out of Coldwater goes SOUTH, so
  // "no way on" is false here and a march would take that limb and call it forward. This is the
  // one decision the whole crossing is shaped around; it is checked first and it is unconditional.
  if (id === c.plan.fork) return forkLine(c);

  // A camp on the road: water, a fire, a barrel, and the one place `camp` works.
  if (z.flags?.void_wayside) return 'A camp on the road. You stop.';

  // Nothing in front of you at all — a detour's dead end, or a room whose way on has not been made.
  if (!z.exits?.south) return 'There is no way on from here.';

  // A branch off the spine. ⚠ READ OFF THE PLAN, NEVER OFF THE ZONE'S EXITS: a limb's first room
  // carries a lateral exit back to the fork (`OPPOSITE[d.dir]`, which for an east limb IS west), so
  // "has a west exit" would stop a march at the head of every limb in the game for no reason.
  if (r) {
    const west = r.exits?.west;
    if (west && c.plan.detourIds.has(west)) return 'Something off to the west, away from the trail. You stop to weigh it up.';
    if (r.cutSaves != null && r.exits?.east) return `A path goes off east from here, ${r.cutSaves} tiles shorter than the road. You stop.`;
  }

  // A highlight worth acting on. Markers pass — see rule three.
  const kind = z.flags?.void_feature_kind;
  if (kind && ACTIONABLE_KINDS.has(kind)) return `<b>${z.name}</b>. You stop.`;

  return null;
}

// ── The tick ─────────────────────────────────────────────────────────────────
async function stepMarch(player, run) {
  const live = player._crossing;
  if (!live) return end(run, null);                     // arrived, bailed, died — that path has its own prose
  const c = CTX?.crossings?.get(live.instanceId);
  if (!c) return end(run, null);

  // Anything that took your body out of your own hands. A march is a thing you are doing; if you are
  // not doing it, it is not paused, it is over.
  if (player._koUntil > Date.now() || player.sleeping) return end(run, 'You are in no state to be walking.');
  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId) return end(run, null);

  const before = player.current_zone;
  const result = await cmdMove('south', player, getBroadcast());
  // A gate that vetoes silently (the pacing plugin deferring a too-fast step) returns null and has
  // not moved anybody. Try again on the next tick rather than ending the walk over it.
  if (result === null) return;
  if (result.type === 'error') {
    sendToPlayer(player.id, { type: 'output', message: result.message, html: result.html !== false });
    return end(run, null);
  }
  if (player.current_zone === before) return end(run, null);   // refused without saying so

  // The pane and the minimap, exactly as a typed `south` would paint them — and stamped through the
  // room-brief rule so the bottom Display Mode rung gets the same per-tile record it gets when the
  // player walks this by hand. A march must never be a way to be told less.
  sendToPlayer(player.id, stampToLog(player, result, false));

  run.steps++;
  if (!player._crossing) return end(run, null);   // that step was the arrival

  // Water, on the way down. Spent gates are dropped so a warning fires once.
  const thirst = player.thirst ?? 100;
  let gate = null;
  while (run.gates.length && thirst <= run.gates[0]) gate = run.gates.shift();
  if (gate != null) return end(run, amber('Your mouth is dry and your head has started to ache. You stop walking to think about water.'));

  const why = haltReason(c, player);
  if (why !== null) return end(run, why === QUIET ? null : why);

  // Progress, on a stride rather than a step. The pane already says where you are; this is for the
  // scrollback, and for anyone reading rather than watching.
  if (run.steps % 10 === 0) {
    const at = spineAt(c, player.current_zone);
    const head = at?.key ? headingOf(c, at.key) : null;
    const left = at?.total != null ? at.total - at.i : null;
    sendToPlayer(player.id, { type: 'output', message: dim(
      left != null && head
        ? `— ${run.steps} tiles marched. About ${left} to ${head}. —`
        : `— ${run.steps} tiles marched. —`) });
  }
}

// End a run. `line` is the reason, or null when the reason has already spoken for itself (an ambush
// broadcast to the room, an arrival banner, a gate's own refusal).
function end(run, line) {
  runs.delete(run.pid);
  if (line) sendToPlayer(run.pid, { type: 'output', message: line });
  return null;
}

async function tick() {
  for (const [pid, run] of [...runs]) {
    const player = getLivePlayer(pid);
    if (!player) { runs.delete(pid); continue; }
    try { await stepMarch(player, run); }
    catch (e) { console.error('[voidwalking] march error:', e.message); runs.delete(pid); }
  }
}

schedule(TICK, () => tick().catch(e => console.error('[voidwalking] march tick error:', e.message)));

// ── The verb ─────────────────────────────────────────────────────────────────
export async function cmdMarch(args, raw, player) {
  if (!player?._crossing) return { type: 'error', message: 'There is nothing out here to march along. This is a thing you do on the trail.' };
  const c = CTX?.crossings?.get(player._crossing.instanceId);
  if (!c) return { type: 'error', message: 'There is nothing out here to march along.' };
  if (runs.has(player.id)) return { type: 'emote', message: `You are already walking. ${dim('stop')}` };

  const z = getZone(player.current_zone);
  if (getZoneEnemies(player.current_zone).length)
    return { type: 'error', message: 'Not with that still on its feet.' };
  // Standing ON the fork, a march has no forward to take — see haltReason. It refuses rather than
  // guessing, and it refuses with the same sentence the tick stops with.
  if (player.current_zone === c.plan.fork) return { type: 'error', message: forkLine(c) };
  if (!z?.exits?.south) return { type: 'error', message: 'There is no way on from here.' };

  const thirst = player.thirst ?? 100;
  runs.set(player.id, { pid: player.id, steps: 0, gates: THIRST_GATES.filter(g => g < thirst) });
  return { type: 'emote', message: `You put your head down and walk. ${dim('Anything you type stops you — or ')}<b>stop</b>${dim('.')}` };
}

// ── What ends a march ────────────────────────────────────────────────────────
//
// ⚠ SILENT COMMANDS MUST NOT COUNT, AND THIS IS THE TRAP THE WHOLE SEAM EXISTS FOR. The client's own
// `move` handler calls `refreshTabletMapIfOpen()`, which fires `sendCmdSilent('tabletnav map …')` on
// every single step. Cancelling on "any command" would therefore stop a march on its first tile for
// anybody with the tablet map open, with nothing on screen to explain it. `silent` was already on the
// wire and already load-bearing for idle-logoff; it reaches `player.command` now (engine change, see
// commands/index.js) so a repeating action can tell a player apart from their own client.
//
// The event fires BEFORE the command runs, so `march` itself never cancels the run it is about to
// start — there is nothing in the map yet when it lands.
on('player.command', ({ player, cmd, silent }) => {
  if (silent || !player || !runs.has(player.id)) return;
  if (cmd === 'march') return;                       // handled by the verb, which answers "already walking"
  end(runs.get(player.id), null);
});

// The unified `stop`, which is what the verb's own prompt points at.
on('player.stop', ({ player, stopped }) => {
  if (!player || !runs.has(player.id)) return;
  runs.delete(player.id);
  stopped.push('walking');
});

on('player.logout', ({ id }) => { runs.delete(id); });

// A crossing torn down under somebody's feet (a server-side teardown, a death, a party dissolving)
// takes every march on it with it.
on('crossing.ended', ({ instanceId }) => {
  for (const [pid] of [...runs]) {
    const p = getLivePlayer(pid);
    if (!p?._crossing || p._crossing.instanceId === instanceId) runs.delete(pid);
  }
});

export const _test = { runs, THIRST_GATES, ACTIONABLE_KINDS, QUIET, spineAt, haltReason, stepMarch, tick, TICK };
