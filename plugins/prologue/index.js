/**
 * Prologue — the pre-world tutorial (zone_the_inbetween → … → zone_the_collapse).
 *
 * New souls spawn into The Inbetween (see server/api/routes.js apiRegister) and
 * walk a one-way corridor of scripted rooms that (1) run chargen through the
 * existing (free) MORPHEX terminal, (2) at the holosign grant a permanent +1 to
 * every attribute — off the XP books — plus a first Architect Interface point and
 * the X-90 holocaster, and (3) close with an eerie broadcast before collapsing
 * them into the Coldwater clone vat (zone_start), their respawn point forever after.
 *
 * Everything here is content-driven and self-contained:
 *   - move gates hard-gate the three narrative doors (alignment, the holocaster,
 *     the finished broadcast);
 *   - the lightless void-rooms are seen ("there is no light, but you can see")
 *     via the engine's zones.flags.always_lit property — no lighting content;
 *   - `use holosign` grants +1 to every stat (via gifted_stat_points, so it costs
 *     no XP) + a first point of Architect Interface IP (interfacing IS the skill) +
 *     the X-90 holocaster; `use holocaster` opens the broadcast door and is
 *     consumed; sitting in The Broadcast drops the kit.
 *
 * No engine files are imported in reverse; the only engine touch-points are the
 * generic seams (move gates, events, flags, specialized `use`, the no_attack NPC
 * flag on the attendant, and cosmetic-machine's appearance.changed event).
 */
import { randomUUID } from 'crypto';
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { sendToPlayer, teachVerb, pointAt } from '../../server/engine/messaging.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { maxHpForEndurance, invalidateSkillCache } from '../../server/engine/ip.js';
import { getZone, getMinimapData, getLivePlayer } from '../../server/engine/world.js';
import { describeZone } from '../../server/engine/commands/describe.js';

const Z_INBETWEEN = 'zone_the_inbetween';
const Z_LATTICE   = 'zone_the_lattice';
const Z_BROADCAST = 'zone_the_broadcast';
const Z_COLLAPSE  = 'zone_the_collapse';
const Z_CLONEVAT  = 'zone_start';
const PROLOGUE_ZONES = new Set([Z_INBETWEEN, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE]);

const ITEM_HOLOCASTER = 'item_x90_holocaster';

// The Broadcast-room starter kit — the ONLY starting gear (registration hands out
// nothing). Order = drop order. Names must match the items rows so the take-links
// and the look refresh resolve.
const KIT = [
  { id: 'item_bat',             name: 'aluminum bat',      qty: 1 },
  { id: 'item_football_helmet', name: 'football helmet',   qty: 1 },
  { id: 'item_credit_chip',     name: 'credit chip',       qty: 1, credits: 100 },
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

async function grantItem(player, itemId, quantity = 1, owner = player.id, customData = null) {
  await query(
    'INSERT INTO player_inventory (id,player_id,item_id,quantity,condition,custom_data) VALUES ($1,$2,$3,$4,1.0,$5)',
    [randomUUID(), owner, itemId, quantity, customData ? JSON.stringify(customData) : null]
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

// Touching the holosign IS an act of Architect Interface — so the touch itself
// teaches the skill. Grant a deterministic first point of IP (the normal use-path
// award is probabilistic; this one moment is guaranteed), demonstrating live that
// skills climb by use. Guarded by the players-row FK for the regress fake player.
async function grantArchitectInterfaceIp(player) {
  const { rowCount } = await query(
    `INSERT INTO player_skills (player_id, skill_id, ip) VALUES ($1, 'architect_interface', 1)
       ON CONFLICT (player_id, skill_id) DO UPDATE SET ip = player_skills.ip + 1`,
    [player.id]
  ).catch(() => ({ rowCount: 0 }));
  // Direct player_skills write behind ip.js's per-player cache — bust it.
  invalidateSkillCache(player.id);
  return rowCount > 0;
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
    return { type: 'emote', message: `You reach into the holosign again. It has already given you what it had to give — strength, and a way onward. The rest you take out there.` };
  }

  await raise(player, F_INTERFACED);
  await grantAllStatsPlusOne(player);
  await grantArchitectInterfaceIp(player);
  await grantItem(player, ITEM_HOLOCASTER);

  out(player, `<span class="ip-gain">The lattice pours into you and leaves you more than it found you. +1 to every attribute — brawn, reflexes, endurance, brains, cool, senses.</span> <span class="hint">(that's your six STATS — buy more later with XP and RAISE)</span>`);
  out(player, `<span class="ip-gain">+1 IP — Architect Interface</span> <span class="hint">(reaching into the lattice was itself a SKILL; skills climb every time you use them — 100 IP is a level)</span>`);
  out(player, `Something settles into your inventory: an <span class="action-link" data-action="examine" data-target="X-90 Sequence Holocaster" title="Examine the X-90 Sequence Holocaster"><b>X-90 Sequence Holocaster</b></span>. <span class="hint">(open your inventory with 'i', examine it, then use it to go on)</span>`);

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

// ── The Broadcast: sitting plays the welcome ──────────────────────────────────
// Guarded by a per-player in-memory cooldown rather than the permanent F_PLAYED
// flag. The completion beat (kit drop + F_COLLAPSE door) only fires from the
// final setTimeout, so a player who disconnects mid-playback would otherwise be
// left with F_PLAYED set but F_COLLAPSE never raised — permanently soft-locked,
// since re-sitting was blocked and the door never opened. Now: once the door is
// open we're done for good (F_COLLAPSE); otherwise a re-sit after the cooldown
// (which the disconnect clears) replays the welcome and can finish it properly.
const BROADCAST_COOLDOWN_MS = 60000; // longer than one full playback (~45s)
on('posture.changed', async ({ player, to }) => {
  if (!player || to !== 'sitting' || player.current_zone !== Z_BROADCAST) return;
  if (await isSet(player, F_COLLAPSE)) return; // already finished it — door is open
  const now = Date.now();
  if (player._prologueBroadcastAt && now - player._prologueBroadcastAt < BROADCAST_COOLDOWN_MS) return;
  player._prologueBroadcastAt = now;
  await raise(player, F_PLAYED); // marks "has begun" for the move-gate message; no longer gates replay
  playBroadcast(player);
});

// ── Arrival: the first thought a new soul ever has ───────────────────────────
// Registration drops the player straight into The Inbetween, so there is no
// zone.entered to hang this off — the login push is the arrival. Two beats: the
// missing memory, then the attendant, closing on the first verb the game ever
// teaches (talk, shimmering per teachVerb) plus a ripple on the attendant's link
// up in the room pane, so the nudge exists in both places a player might look.
const F_ARRIVED = 'prologue_arrival_seen';
on('player.login', async ({ id }) => {
  const player = getLivePlayer(id);
  if (!player || player.current_zone !== Z_INBETWEEN) return;
  if (await isSet(player, F_ARRIVED)) return;
  await raise(player, F_ARRIVED);

  // The cold open runs FIRST and alone (client/game/js/panels/intro-cinematic.js).
  // Nothing below is scheduled here: the client echoes `introdone` when the
  // sequence ends or is skipped, and that verb starts the arrival. Otherwise a
  // player who watches the whole thing comes back to a log full of prose that
  // scrolled past while they were reading a different screen.
  sendToPlayer(player.id, { type: 'intro_cinematic' });
  // Safety net for a client that never answers (an old cached bundle, a tab
  // closed and reopened mid-play): the prologue must never be able to stall.
  // beginArrival is idempotent, so the real echo winning this race is fine.
  setTimeout(() => { const p = getLivePlayer(id); if (p) beginArrival(p); }, INTRO_FALLBACK_MS);
});

// Everything the prologue says on arrival, gated behind the cold open. Split out
// of the login handler so `introdone` can trigger it, and guarded by an in-memory
// claim (not a flag) because both callers can arrive within the same tick.
const INTRO_FALLBACK_MS = 78000;   // longer than the full cinematic (75s) + fade
// If the interface question is never answered — a tab left open on the veil, a
// client that lost the socket mid-tour — the prose comes anyway rather than the
// player standing in a silent room forever. Generous, because a first-timer
// reading every tour card genuinely can take minutes.
const TOUR_FALLBACK_MS = 480000;
async function beginArrival(player) {
  if (player._prologueArrivalStarted) return;
  player._prologueArrivalStarted = true;
  // Before any fiction: the interface question, and NOTHING ELSE. The prose used
  // to start 900ms behind the offer, which meant a new player answering it — or
  // walking the tour — came back to a log they'd already scrolled past. The
  // client dims the whole interface around the question (tour.js), and speaks
  // only once it's answered: `tutorial no` releases it immediately, `tutorial
  // done` releases it at the end of the walkthrough. Client-side from here — the
  // server only records the answer so a player isn't asked again on a second
  // device.
  if (!(await isSet(player, F_TOUR_ASKED))) {
    // 1200ms, not 500: the cinematic's own closing dissolve is still running.
    // The question should arrive as the logo finishes leaving, not over it.
    setTimeout(() => sendToPlayer(player.id, { type: 'tour_offer' }), 1200);
    setTimeout(() => { const p = getLivePlayer(player.id) || player; speakArrival(p); }, TOUR_FALLBACK_MS);
    return;
  }
  speakArrival(player);
}

// The arrival prose itself. Split out of beginArrival so the tour can gate it,
// and claimed in memory (not a flag) because several callers race for it: the
// tour answer, the tour's end, and both fallbacks.
function speakArrival(player) {
  // Zone-guarded: `tutorial` is replayable forever, and a veteran replaying it in
  // Coldwater must not be told they don't know how they got here.
  if (!player || player.current_zone !== Z_INBETWEEN) return;
  if (player._prologueArrivalSpoken) return;
  player._prologueArrivalSpoken = true;
  setTimeout(() => out(player, `<span class="ambient">I don't know how I got here. That's the first thing — not <i>where</i> I am, but <i>how</i>. I reach back for the moment before this one and my hand closes on nothing at all. There was something. There must have been something. A name, a room, a life with a Tuesday in it. It's gone the way a dream goes, and I can't even find the shape of the hole it left.</span>`), 1400);
  setTimeout(() => {
    out(player, `<span class="ambient">Then I notice I'm not alone.</span>`);
  }, 8200);
  setTimeout(() => {
    out(player, `<span class="ambient">It's tall, and it's chrome — warm chrome, seamless, shaped like a person the way a word is shaped like the thing it means. No face, just a smooth curve where one belongs, and I'd swear it's looking at me. When it shifts its weight the light follows a half-second late. One hand rests on a humming terminal. It doesn't hurry. It has the stillness of something that's been standing exactly there for a very long time, waiting for exactly me.</span>`);
  }, 11400);
  setTimeout(() => {
    out(player, `<span class="ambient">Maybe I should ${teachVerb('talk', 'talk', 'chrome attendant')} to it.</span>`);
    pointAt(player.id, 'talk', 'chrome attendant');
  }, 17600);
}

// ── Room telegraphs + the wake-up beat ────────────────────────────────────────
on('zone.entered', async ({ actor, zone, from }) => {
  if (!actor) return;
  if (zone === Z_LATTICE) {
    out(actor, `<span class="ambient">The holosign turns to face you. It wants to be read.</span> <span class="hint">(try: examine holosign)</span>`);
  } else if (zone === Z_BROADCAST) {
    out(actor, `<span class="ambient">The chair is the only thing here, and it is unmistakably for you.</span> <span class="hint">(try: sit)</span>`);
  } else if (zone === Z_CLONEVAT && from === Z_COLLAPSE) {
    out(actor, `<span class="clone-vat-message">You wake. There is a floor now, cold and real, and a body on it that is yours, and it already aches. The vat behind you hisses shut. The between is gone as if it never was. Somewhere far above, an algorithm notes that its very large number is, once again, correct.</span>`);
    firstClothing(actor);
  }
});

// The first emergence from the vat plays the same body-assimilation and dressing-
// robot beats a respawn gets (see scheduleVatEmergence in gameLoop.js) — but the
// very first clone is on the house, so no cloning bill prints. Timings mirror the
// respawn sequence so the two feel like the same machine.
function firstClothing(actor) {
  setTimeout(() => {
    out(actor, `<span class="clone-vat-message">Your new body reports in, one seam at a time. Nerve endings find their sockets and announce themselves — cold, ache, the dumb weight of your own hands. Muscle remembers what muscle is for. You are, unmistakably, meat again.</span>`);
  }, 2600);
  setTimeout(async () => {
    try {
      const { equipStarterOutfit } = await import('../../server/engine/gameLoop.js');
      equipStarterOutfit(actor.id, actor.biological_sex || 'male');
    } catch (e) {
      console.error('[prologue] starter outfit failed:', e.message);
    }
    out(actor, `<span class="clone-vat-message">A dressing gantry unfolds on too many arms and plants you upright in the lab. It sheathes you — underwear, pants, a t-shirt, a pair of shoes — with the tenderness of an industrial press. No invoice prints. The first clone, it seems, is free.</span>`);
  }, 5200);
}

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
      if (await isSet(player, F_COLLAPSE)) return; // a prior playback already finished — don't re-drop the kit
      // The kit hits the FLOOR, and the prologue is one-way: walk north without
      // taking it and the bat, the helmet and the ₵100 chip are gone for good.
      // That hazard is deliberate — briefly changed to a straight inventory grant
      // on 2026-07-21 and reverted the same day. Leave it on the ground.
      const ground = `_ground_${Z_BROADCAST}`;
      for (const { id, qty, credits } of KIT) await grantItem(player, id, qty, ground, credits ? { credits, name: `credit chip (₵${credits})` } : null);
      await raise(player, F_COLLAPSE);
      // Highlight each dropped item as a clickable take-link (same convention as
      // the room's "Lying here:" list), then refresh the room so the ground items
      // are actually visible without the player having to look again.
      const mentions = KIT.map(({ name, qty }) => {
        const label = qty > 1 ? `${qty}x ${name}` : name;
        return `<span class="action-link room-item" data-action="take" data-target="${name}" title="Take ${name}">${label}</span>`;
      }).join(', ');
      out(player, `<span class="ambient">Objects thud onto the invisible floor in front of you, one after another, as if the dark is emptying its pockets:</span> ${mentions}. <span class="hint">(take them or leave them — then go north to the collapse)</span>`);
      // …and the record of what you just watched. Volume I of the CODEX is handed
      // over whole here rather than earned, because the player has already seen
      // it — the cold open IS that volume, cut to thirty seconds. Everything in
      // Volume II is still sealed, and is learned out there. (Deliberately after
      // the kit line: gear first, reading second.)
      try {
        const { grantVolume } = await import('../tablet/codex-app.js');
        await grantVolume(player, 'quiet');
        out(player, `<span class="ambient">Something else arrives with no sound at all — a document, already open on your tablet, as though it had been waiting for someone to hand it to.</span> <span class="hint">(read it any time with <b>codex</b> — the rest of the record you'll have to go and find)</span>`);
      } catch (e) {
        console.error('[prologue] codex grant failed:', e.message);
      }
      const zone = getZone(Z_BROADCAST);
      if (zone) sendToPlayer(player.id, { type: 'look', message: await describeZone(zone, player), zone: zone.id, minimap: getMinimapData(zone.id, 8, player) });
    } catch (e) {
      console.error('[prologue] broadcast kit drop failed:', e.message);
    }
  }, t + 400);
}

// ── First blood → Grady's chair ──────────────────────────────────────────────
// The one tutorial beat that lands AFTER the vat: the game never says out loud
// that sitting heals you. Grady does, once, the first time you walk back into
// his shop having killed something. Two flags — one records that you've fought,
// one that he's said his piece — so the tip can't fire before the fight or twice
// after it. Sitting itself is the interactions plugin's `sit`; the HP regen is
// the engine's (see docs/systems-posture.md). Nothing here touches either.
const Z_TWOCELL     = 'zone_twocell_interior';
const F_FIRST_BLOOD = 'grady_first_blood';   // player has won a fight
const F_SEAT_TIP    = 'grady_seat_tip';      // Grady has given the sit-to-heal tip

on('enemy.killed', async ({ actor }) => {
  if (!actor?.id) return;
  if (await isSet(actor, F_FIRST_BLOOD)) return;
  await raise(actor, F_FIRST_BLOOD);
});

on('zone.entered', async ({ actor, zone }) => {
  if (!actor || zone !== Z_TWOCELL) return;
  if (!(await isSet(actor, F_FIRST_BLOOD))) return;
  if (await isSet(actor, F_SEAT_TIP)) return;
  await raise(actor, F_SEAT_TIP);
  setTimeout(() => {
    out(actor, `<span class="ambient">Grady looks up, takes one read of the state of you, and jerks his chin at the sagging armchair by the crates. "Sit down before you fall down. Go on — off your feet, and stay off 'em a while. Body knits itself back together when you stop asking it to carry you around. Cheapest medicine in the basin, and I can't charge you a credit for it."</span>`);
  }, 1200);
  setTimeout(() => {
    out(actor, `<span class="ambient">Maybe I should ${teachVerb('sit', 'sit', 'sagging vinyl armchair')} and let it mend.</span>`);
    pointAt(actor.id, 'sit', 'sagging vinyl armchair');
  }, 8000);
});

// ── The interface tour ───────────────────────────────────────────────────────
// The only out-of-fiction beat in the prologue: a first-time player is asked
// once whether they've played a multiplayer text game before, and if not the
// client walks them round the UI (spotlight + shimmer + a card per region; see
// client/game/js/panels/tour.js). The server's whole job is the memory of it —
// two flags, so the offer doesn't repeat on another browser — plus the verb
// that replays the tour on demand.
const F_TOUR_ASKED = 'tour_asked';   // the question has been put to them
const F_TOUR_TAKEN = 'tour_taken';   // they finished (or started) the walkthrough

async function cmdTutorial(args, _raw, player) {
  const arg = (args[0] || '').toLowerCase();

  // Each of these is also the release valve on the held-back arrival prose (see
  // beginArrival): no tour → speak now, tour → speak when it ends. speakArrival
  // claims itself, so a replayed tutorial long after the fact is a no-op.
  if (arg === 'no') { // "yes, I've played text games" → never ask again
    await raise(player, F_TOUR_ASKED);
    speakArrival(player);
    return { type: 'system', message: `<span class="hint">Noted — no tour. Type <b>tutorial</b> any time if you want the interface walkthrough.</span>` };
  }
  if (arg === 'yes') { // they asked to be shown around
    await raise(player, F_TOUR_ASKED);
    return null; // the client is already running the tour; nothing to say — and the prose waits for `done`
  }
  if (arg === 'done') {
    await raise(player, F_TOUR_ASKED);
    await raise(player, F_TOUR_TAKEN);
    speakArrival(player);
    return { type: 'system', message: `<span class="hint">That's the interface. Everything else you learn by doing. (<b>help</b> lists the commands; <b>tutorial</b> replays this.)</span>` };
  }

  // Bare `tutorial` — replay it.
  await raise(player, F_TOUR_ASKED);
  sendToPlayer(player.id, { type: 'tour_start' });
  return null;
}

// ── The cold open's two verbs ────────────────────────────────────────────────
// `introdone` is the client's echo, not something a player types (it's silent and
// harmless if they do). `intro` replays the sequence on demand — the same reason
// `tutorial` exists: a first impression you can't get back is a bad deal.
async function cmdIntroDone(args, _raw, player) {
  if (player?.current_zone === Z_INBETWEEN) await beginArrival(player);
  return null;
}

async function cmdIntro(args, _raw, player) {
  sendToPlayer(player.id, { type: 'intro_cinematic' });
  return null;
}

export const commands = {
  tutorial: cmdTutorial,
  introdone: cmdIntroDone,
  intro: cmdIntro,
};

// Test surface for plugins/prologue/regress.js (never used in production).
export const _test = {
  prologueMoveGate, useHolosign, useHolocaster,
  grantAllStatsPlusOne, isSet, raise,
  Z_INBETWEEN, Z_LATTICE, Z_BROADCAST, Z_COLLAPSE,
  ITEM_HOLOCASTER,
  F_ALIGNED, F_INTERFACED, F_BROADCAST, F_COLLAPSE, F_PLAYED,
  cmdTutorial, F_TOUR_ASKED, F_TOUR_TAKEN,
};

console.log('[prologue] Plugin loaded.');
