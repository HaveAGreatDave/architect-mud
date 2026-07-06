/**
 * Prologue — the pre-world tutorial (zone_the_inbetween → … → zone_the_collapse).
 *
 * New souls spawn into The Inbetween (see server/api/routes.js apiRegister) and
 * walk a one-way corridor of scripted rooms that (1) run chargen through the
 * existing (free) MORPHEX terminal, (2) at the holosign grant a permanent +1 to
 * every attribute — off the XP books — plus a primer tablet and the X-90
 * holocaster, and (3) close with an eerie broadcast before collapsing them into
 * the Coldwater clone vat (zone_start), their respawn point forever after.
 *
 * Everything here is content-driven and self-contained:
 *   - move gates hard-gate the three narrative doors (alignment, the holocaster,
 *     the finished broadcast);
 *   - the lightless void-rooms are seen ("there is no light, but you can see")
 *     via the engine's zones.flags.always_lit property — no lighting content;
 *   - `use holosign` grants +1 to every stat (via gifted_stat_points, so it costs
 *     no XP) + the primer tablet + the X-90 holocaster; `use holocaster` opens the
 *     broadcast door and is consumed; sitting in The Broadcast drops the kit.
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
import { maxHpForEndurance } from '../../server/engine/ip.js';
import { getZone, getMinimapData } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';

const Z_INBETWEEN = 'zone_the_inbetween';
const Z_LATTICE   = 'zone_the_lattice';
const Z_BROADCAST = 'zone_the_broadcast';
const Z_COLLAPSE  = 'zone_the_collapse';
const Z_CLONEVAT  = 'zone_start';
const PROLOGUE_ZONES = new Set([Z_INBETWEEN, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE]);

const ITEM_TABLET     = 'item_prologue_tablet';
const ITEM_HOLOCASTER = 'item_x90_holocaster';

// The Broadcast-room starter kit — the ONLY starting gear (registration hands out
// nothing). Order = drop order. Names must match the items rows so the take-links
// and the look refresh resolve.
const KIT = [
  { id: 'item_bat',             name: 'aluminum bat',      qty: 1 },
  { id: 'item_football_helmet', name: 'football helmet',   qty: 1 },
  { id: 'item_credit_chip_100', name: 'credit chip (100₵)', qty: 1 },
  { id: 'item_ration',          name: 'vacuum ration',     qty: 5 },
  { id: 'canteen',              name: 'canteen',           qty: 1 },
];

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

// The holosign's gift: a permanent +1 to every attribute, FREE of the XP economy.
// The +1s land on the stat columns (so combat/skills/carry all see them), and
// gifted_stat_points records them so statSpent() refunds their cost — the boost
// touches neither Net nor Total XP. Endurance +1 also lifts the HP cap by 2.
async function grantAllStatsPlusOne(player) {
  // Guard the players-row FK / the regress harness's in-memory player.
  const { rows } = await query('SELECT stat_endurance, hp FROM players WHERE id=$1', [player.id]);
  if (!rows.length) return;
  await query(`UPDATE players SET
      stat_brawn = stat_brawn + 1, stat_reflexes = stat_reflexes + 1,
      stat_endurance = stat_endurance + 1, stat_brains = stat_brains + 1,
      stat_cool = stat_cool + 1, stat_senses = stat_senses + 1,
      gifted_stat_points = COALESCE(gifted_stat_points, 0) + 6
    WHERE id = $1`, [player.id]);
  const newHpMax = maxHpForEndurance((Number(rows[0].stat_endurance) || 0) + 1);
  await query('UPDATE players SET hp_max = $1, hp = LEAST(COALESCE(hp, 0) + 2, $1) WHERE id = $2', [newHpMax, player.id]);
  // Mirror onto the live player so combat/skills read the boost immediately, and
  // push the HP cap change to the HUD.
  for (const s of ['brawn', 'reflexes', 'endurance', 'brains', 'cool', 'senses']) {
    player[`stat_${s}`] = (Number(player[`stat_${s}`]) || 0) + 1;
  }
  player.gifted_stat_points = (Number(player.gifted_stat_points) || 0) + 6;
  player.hp_max = newHpMax;
  player.hp = Math.min((Number(player.hp) || newHpMax) + 2, newHpMax);
  sendToPlayer(player.id, { type: 'player_update', hp: player.hp, hp_max: player.hp_max });
}

// ── Move gates: the three narrative doors ────────────────────────────────────
// Pure checks; a blocked move returns its in-fiction refusal. Non-prologue moves
// short-circuit before any DB read.
async function prologueMoveGate({ player, to }) {
  if (!to || !PROLOGUE_ZONES.has(to.id)) return undefined;

  if (to.id === Z_LATTICE && !(await isSet(player, F_ALIGNED))) {
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
  // Match the holosign — including a bare "holo" — but NOT the similarly-named
  // holocaster (its own handler owns those terms, and "holocaster" contains "holo").
  const holocasterTerm = target.includes('holocaster') || target.includes('caster') || target.includes('x-90') || target.includes('x90') || target.includes('sequence');
  const holosignTerm = !holocasterTerm && (target.includes('holosign') || target.includes('holo') || target.includes('sign'));
  if (!holosignTerm) return undefined;
  if (player.current_zone !== Z_LATTICE) return undefined;

  if (await isSet(player, F_INTERFACED)) {
    return { type: 'emote', message: `You reach into the holosign again. It has already given you what it had to give — strength, a tablet, and a way onward. The rest you take out there.` };
  }

  await raise(player, F_INTERFACED);
  await grantAllStatsPlusOne(player);
  await grantItem(player, ITEM_TABLET);
  await grantItem(player, ITEM_HOLOCASTER);

  out(player, `<span class="ip-gain">The lattice pours into you and leaves you more than it found you. +1 to every attribute — brawn, reflexes, endurance, brains, cool, senses.</span>`);
  out(player, `A warm glass tablet resolves in your hands, dense with text about what you are made of and how you grow. <span class="hint">(examine tablet to read it)</span>`);
  out(player, `Something else settles into your inventory: an <span class="action-link" data-action="use" data-target="X-90 Sequence Holocaster" title="Use the X-90 Sequence Holocaster"><b>X-90 Sequence Holocaster</b></span>. <span class="hint">(open your inventory with 'i', then use it)</span>`);

  return { type: 'emote', message: `You reach into the holosign and, impossibly, the lattice reaches back. For one bright second you are touching the thoughts of the thing that made you — and it does not leave you as it found you. Every sinew, every nerve, every thought sits a fraction sharper than before.` };
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
  const step = 6400; // per-line interval; halved playback speed (was 3200)
  for (const line of lines) {
    setTimeout(() => out(player, line), t);
    t += step;
  }
  // After the last line: the kit hits the floor and the way opens.
  setTimeout(async () => {
    try {
      const ground = `_ground_${Z_BROADCAST}`;
      for (const { id, qty } of KIT) await grantItem(player, id, qty, ground);
      await raise(player, F_COLLAPSE);
      // Highlight each dropped item as a clickable take-link (same convention as
      // the room's "Lying here:" list), then refresh the room so the ground items
      // are actually visible without the player having to look again.
      const mentions = KIT.map(({ name, qty }) => {
        const label = qty > 1 ? `${qty}x ${name}` : name;
        return `<span class="action-link room-item" data-action="take" data-target="${name}" title="Take ${name}">${label}</span>`;
      }).join(', ');
      out(player, `<span class="ambient">Objects thud onto the invisible floor in front of you, one after another, as if the dark is emptying its pockets:</span> ${mentions}. <span class="hint">(take them or leave them — then go north to the collapse)</span>`);
      const zone = getZone(Z_BROADCAST);
      if (zone) sendToPlayer(player.id, { type: 'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id) });
    } catch (e) {
      console.error('[prologue] broadcast kit drop failed:', e.message);
    }
  }, t + 400);
}

// Test surface for plugins/prologue/regress.js (never used in production).
export const _test = {
  prologueMoveGate, useHolosign, useHolocaster,
  grantAllStatsPlusOne, isSet, raise,
  Z_INBETWEEN, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE,
  ITEM_HOLOCASTER, ITEM_TABLET,
  F_ALIGNED, F_INTERFACED, F_BROADCAST, F_COLLAPSE, F_PLAYED,
};

console.log('[prologue] Plugin loaded.');
