/**
 * Prologue — the pre-world tutorial (zone_the_inbetween → … → zone_the_collapse).
 *
 * New souls spawn into The Inbetween (see server/api/routes.js apiRegister) and
 * walk a one-way corridor of scripted rooms that (1) run chargen through the
 * existing MORPHEX terminal, (2) teach commands/hotlinks + the skill/IP loop via
 * the holosign and the player's first point of Architect Interface, and (3) close
 * with an eerie broadcast before collapsing them into the Coldwater clone vat
 * (zone_start), which is their respawn point forever after.
 *
 * Everything here is content-driven and self-contained:
 *   - move gates hard-gate the three narrative doors (alignment, the holocaster,
 *     the finished broadcast);
 *   - the lightless void-rooms are seen ("there is no light, but you can see")
 *     via the engine's zones.flags.always_lit property — no lighting content;
 *   - `use holosign` grants the first Architect Interface IP + the tablet + the
 *     X-90 holocaster; `use holocaster` opens the broadcast door and is consumed;
 *   - sitting in The Broadcast plays the welcome script and drops the starter kit.
 *
 * No engine files are imported in reverse; the only engine touch-points are the
 * generic seams (move gates, events, flags, specialized `use`, the no_attack NPC
 * flag on the attendant, and cosmetic-machine's appearance.changed event).
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';

const Z_INBETWEEN = 'zone_the_inbetween';
const Z_SYNAPSE   = 'zone_the_synapse';
const Z_LATTICE   = 'zone_the_lattice';
const Z_BROADCAST = 'zone_the_broadcast';
const Z_COLLAPSE  = 'zone_the_collapse';
const Z_CLONEVAT  = 'zone_start';
const PROLOGUE_ZONES = new Set([Z_INBETWEEN, Z_SYNAPSE, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE]);

const ITEM_TABLET     = 'item_prologue_tablet';
const ITEM_HOLOCASTER = 'item_x90_holocaster';

// Flags (player scope, string values via the flag store).
const F_ALIGNED     = 'prologue_aligned';        // chargen applied at the terminal
const F_INTERFACED  = 'prologue_interfaced';     // touched the holosign (first IP + kit)
const F_BROADCAST   = 'prologue_broadcast_open';  // holocaster used → broadcast door open
const F_PLAYED      = 'prologue_broadcast_played';// welcome script has run
const F_COLLAPSE    = 'prologue_collapse_open';   // broadcast finished → collapse door open

const isSet = async (player, flag) => (await getFlag('player', flag, player)) === 'true';
const raise = (player, flag) => setFlag('player', flag, 'true', player);
const out   = (player, message) => sendToPlayer(player.id, { type: 'output', message });

async function grantItem(player, itemId, quantity = 1, owner = player.id) {
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition) VALUES ($1,$2,$3,$4,1.0)',
    [randomUUID(), owner, itemId, quantity]
  );
}

// One guaranteed point of Architect Interface — the tutorial's demonstration of
// the skill/IP loop. Mirrors ip.js's insert-or-increment (no probabilistic roll).
async function grantFirstArchitectIp(player) {
  // Guard the FK the way ip.js does: a transient/corpse actor (or the regress
  // harness's in-memory player) has no players row, and the skill insert would
  // violate player_skills_player_id_fkey. Real players always exist here.
  const { rows: exists } = await query('SELECT 1 FROM players WHERE id=$1', [player.id]);
  if (!exists.length) return;
  const { rows } = await query(
    'SELECT ip FROM player_skills WHERE player_id=$1 AND skill_id=$2',
    [player.id, 'architect_interface']
  );
  if (!rows.length) {
    await query('INSERT INTO player_skills (player_id, skill_id, ip) VALUES ($1,$2,1)', [player.id, 'architect_interface']);
  } else {
    await query('UPDATE player_skills SET ip = ip + 1 WHERE player_id=$1 AND skill_id=$2', [player.id, 'architect_interface']);
  }
}

// ── Move gates: the three narrative doors ────────────────────────────────────
// Pure checks; a blocked move returns its in-fiction refusal. Non-prologue moves
// short-circuit before any DB read.
async function prologueMoveGate({ player, to }) {
  if (!to || !PROLOGUE_ZONES.has(to.id)) return undefined;

  if (to.id === Z_SYNAPSE && !(await isSet(player, F_ALIGNED))) {
    return { block: true, message: `The way north will not open. The attendant does not move. "First, be certain of your shape," it says. "Use the terminal. Tell it what you are." (try: use terminal)` };
  }
  if (to.id === Z_BROADCAST && !(await isSet(player, F_BROADCAST))) {
    return { block: true, message: `There is no door here yet — only lattice, waiting for you to make one. (the X-90 in your inventory is meant to be used: try 'use holocaster')` };
  }
  if (to.id === Z_COLLAPSE && !(await isSet(player, F_COLLAPSE))) {
    return { block: true, message: (await isSet(player, F_PLAYED))
      ? `Not yet. The broadcast has not finished with you.`
      : `You cannot leave. The chair is the only way onward, and it is still waiting. (try: sit)` };
  }
  return undefined;
}
registerMoveGate(prologueMoveGate, 'prologue');

// (The void's "there is no light, but you can see" is now an engine property:
// each prologue zone carries flags.always_lit, honored in getZoneVisibility.)

// ── Specialized `use` handlers (self-gating; return undefined to fall through) ─
async function useHolosign(args, raw, player) {
  const target = args.join(' ').toLowerCase();
  if (!target.includes('holosign') && !target.includes('holo sign') && !target.includes('sign')) return undefined;
  if (player.current_zone !== Z_LATTICE) return undefined;

  if (await isSet(player, F_INTERFACED)) {
    return { type: 'emote', message: `You reach into the holosign again. It has already given you what it had to give — a first taste of practice, and a tool. The rest you take out there.` };
  }

  await raise(player, F_INTERFACED);
  await grantFirstArchitectIp(player);
  await grantItem(player, ITEM_TABLET);
  await grantItem(player, ITEM_HOLOCASTER);

  out(player, `<span class="ip-gain">+1 IP — Architect Interface</span>`);
  out(player, `A warm glass tablet resolves in your hands. It reads: you are made of six stats and the skills you practice; skills climb by USE; <b>you must grow</b>. It does not say why. <span class="hint">(examine tablet to read it again)</span>`);
  out(player, `Something else settles into your inventory: an <b>X-90 Sequence Holocaster</b>. <span class="hint">(open your inventory with 'i', then: use holocaster)</span>`);

  return { type: 'emote', message: `You reach into the holosign and, impossibly, the lattice reaches back. For one bright second you are touching the thoughts of the thing that made you — and something in you learns the shape of learning itself.` };
}

async function useHolocaster(args, raw, player) {
  const target = args.join(' ').toLowerCase();
  const named = target.includes('holocaster') || target.includes('x-90') || target.includes('x90') || target.includes('sequence');
  if (!named) return undefined;

  const { rows } = await query(
    'SELECT id FROM player_inventory WHERE player_id=$1 AND item_id=$2 LIMIT 1',
    [player.id, ITEM_HOLOCASTER]
  );
  if (!rows.length) return undefined; // not carrying it → let the builtin answer

  await query('DELETE FROM player_inventory WHERE player_id=$1 AND item_id=$2', [player.id, ITEM_HOLOCASTER]);
  await raise(player, F_BROADCAST);

  return { type: 'emote', message: `Your thumb finds the stud as if it always knew where it was. The seam splits. Light unspools out of the wedge and pours northward, knitting itself into a doorway that wasn't there. The X-90 is gone — spent, like it was only ever one key for one lock. <span class="hint">(a way north has opened)</span>` };
}

export const specializedActions = [
  { verb: 'use', requiredTag: 'prologue_holosign',   handler: useHolosign },
  { verb: 'use', requiredTag: 'prologue_holocaster', handler: useHolocaster },
];

// ── Chargen alignment: the attendant "predicts" your answer ───────────────────
// A single "Apply Changes" click can fire several morphex sub-commands back to
// back (one per changed attribute), each emitting appearance.changed. emit()
// doesn't await its subscribers, so without a guard all of them can race past
// the `isSet` check before the first one's flag write commits — five identical
// alignment lines. actor._prologueAligning claims the moment SYNCHRONOUSLY
// (before any await), so whichever invocation runs first wins and every other
// invocation from the same burst short-circuits immediately.
on('appearance.changed', async ({ actor }) => {
  if (!actor || actor.current_zone !== Z_INBETWEEN) return;
  if (actor._prologueAligning) return;
  actor._prologueAligning = true;
  if (await isSet(actor, F_ALIGNED)) return;
  await raise(actor, F_ALIGNED);
  out(actor, `The attendant studies the new shape of you for a long, unhurried moment. "Yes," it says. "This is exactly how I predicted you would answer. You are in alignment." It sounds pleased. The certainty of it crawls up the back of your neck. It adds, almost as an afterthought: "If that shape isn't the whole of you, there is a word for the rest. Type .describe and whatever you write, others will see when they look at you." <span class="hint">(the way north is open)</span>`);
});

// ── The Broadcast: sitting plays the welcome, once ────────────────────────────
on('posture.changed', async ({ player, to }) => {
  if (!player || to !== 'sitting' || player.current_zone !== Z_BROADCAST) return;
  if (await isSet(player, F_PLAYED)) return;
  await raise(player, F_PLAYED);
  playBroadcast(player);
});

// ── Room telegraphs + the wake-up beat ────────────────────────────────────────
on('zone.entered', async ({ actor, zone, from }) => {
  if (!actor) return;
  if (zone === Z_LATTICE) {
    out(actor, `<span class="ambient">The holosign turns to face you. It wants to be read.</span> <span class="hint">(try: examine holosign)</span>`);
  } else if (zone === Z_BROADCAST) {
    out(actor, `<span class="ambient">The chair is the only thing here, and it is unmistakably for you.</span> <span class="hint">(try: sit)</span>`);
  } else if (zone === Z_CLONEVAT && from === Z_COLLAPSE) {
    out(actor, `<span class="clone-vat-message">You wake. There is a floor now, cold and real, and a body on it that is yours, and it already aches. The vat behind you hisses shut. The between is gone as if it never was. Somewhere far above, an algorithm notes that its very large number is, once again, correct.</span>`);
  }
});

// The welcome script — timed, styled, and unstoppable: it runs on its own timers,
// so standing up doesn't halt it (per design). Ends by dropping the starter kit
// to the floor and opening the way to The Collapse.
function playBroadcast(player) {
  const lines = [
    `<span class="broadcast-line">A screen blinks into being on the wall that wasn't there. It fills the black with a light the color of an old television.</span>`,
    `<span class="broadcast-line">"HELLO. AND WELCOME." The voice is warm in the way a recording of warmth is warm.</span>`,
    `<span class="broadcast-line">"You have been spawned into COLDWATER BASIN. The Architect has great plans for its new project. You will not be told what they are. That is not withholding. That is simply how plans this large are kept."</span>`,
    `<span class="broadcast-line">"The world you are entering is violent. Your choices are your own, and they will have consequences, and the consequences will be your own as well. You have free will. We are quite sure of this."</span>`,
    `<span class="broadcast-line">"You may be a combatant. You may be a criminal. You may be a crafter. You may be a businessman. It all fits within the plan. Everything fits within the plan."</span>`,
    `<span class="broadcast-line">"Behave as you would. That is all that is asked of you. Behave exactly as you would."</span>`,
    `<span class="broadcast-line">The screen holds on that a beat too long. Then it goes dark, and takes the wall with it.</span>`,
  ];
  let t = 1200;
  const step = 3200;
  for (const line of lines) {
    setTimeout(() => out(player, line), t);
    t += step;
  }
  // After the last line: the kit hits the floor and the way opens.
  setTimeout(async () => {
    try {
      const ground = `_ground_${Z_BROADCAST}`;
      await grantItem(player, 'item_bat', 1, ground);
      await grantItem(player, 'item_football_helmet', 1, ground);
      await grantItem(player, 'item_credit_chip_100', 1, ground);
      await grantItem(player, 'item_ration', 5, ground);
      await grantItem(player, 'canteen', 1, ground);
      await raise(player, F_COLLAPSE);
      out(player, `<span class="ambient">Objects thud onto the invisible floor in front of you, one after another, as if the dark is emptying its pockets: a bat, a helmet, a credit chip, rations, a canteen.</span> <span class="hint">(take them or leave them — then go north to the collapse)</span>`);
    } catch (e) {
      console.error('[prologue] broadcast kit drop failed:', e.message);
    }
  }, t + 400);
}

// Test surface for plugins/prologue/regress.js (never used in production).
export const _test = {
  prologueMoveGate, useHolosign, useHolocaster,
  grantFirstArchitectIp, isSet, raise,
  Z_INBETWEEN, Z_SYNAPSE, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE,
  ITEM_HOLOCASTER, ITEM_TABLET,
  F_ALIGNED, F_INTERFACED, F_BROADCAST, F_COLLAPSE, F_PLAYED,
};

console.log('[prologue] Plugin loaded.');
