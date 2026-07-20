/**
 * NPC drugs — offensive dosing of NPCs, the counterpart to the player-only drug
 * system. Players already buy/sell to NPC dealers; this makes NPCs *subjects* of
 * drugs, not just the counterparty.
 *
 * Three delivery verbs, one shared core (`doseNpc`):
 *   • spike <npc> [with <drug>]   — covert. A Deception check (Cool+Brains) vs the
 *                                    room. Success doses them unaware and draws NO
 *                                    heat; failure = they notice → assault heat.
 *   • jab <npc> [with <drug>]     — forced needle. Always lands, always assault heat.
 *   • slip <drug> to <npc>        — willing hand-off. Only NPCs who use drugs
 *                                    (flags.uses_drugs) or an already-loosened NPC
 *                                    take it; consensual, no heat. This is the seam
 *                                    the future addict-customer economy grows into.
 *
 * The EFFECT is derived from the drug's existing data — no drug-content edits:
 *   effects.hallucination            → 'paranoid'  (panic + flee)
 *   stimulant signature (reflexes/stamina up) → 'wired'  (jittery, agitated)
 *   everything else (downers, alcohol, benzos, cannabis) → 'sedated'
 *     1 dose  → 'loose'   (glassy, pacified, blurts candid lines)
 *     2+ doses→ 'out'     (collapses; setPosture lying + ai.dosedOut)
 *
 * State is runtime-only on the live NPC's AI blackboard (`npc._ai.dose`) — never a
 * DB write (the no-new-npc-columns rule; NPC rows are uncached). A reboot sobers
 * everyone. The engine reacts to exactly one plugin-set boolean, `ai.dosedOut`,
 * the same "plugin owns the state, engine yields the graph" contract burglary uses
 * with `ai.alarm` and posture uses with `player.posture`. The seam is one line in
 * tickEntityAI; expiry, flee steps and flavour are driven by this plugin's own tick.
 */
import { query } from '../../server/models/db.js';
import { world, getZoneNpcs, getZone, getZonePlayers, getNpcsByFlag } from '../../server/engine/world.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getDrugCache } from '../../server/engine/drugs.js';
import { sendToZone } from '../../server/engine/messaging.js';
import { setPosture, forceStand } from '../../server/engine/posture.js';
import { moveEntity } from '../../server/engine/ai-behaviour.js';
import { neighborZoneIds } from '../../server/engine/exits.js';
import { resolve as siftResolve } from '../../server/engine/sift.js';
import { effectiveSkill, awardSkillUse } from '../../server/engine/skills.js';
import { on, emit } from '../../server/engine/events.js';

// ── Tunables ──────────────────────────────────────────────────────────────────
const SEDATE_MS     = 90000;   // a downer runs ~90s on an NPC
const PARANOID_MS   = 60000;   // a bad trip ~60s
const WIRED_MS      = 60000;   // a stimulant jag ~60s
const SPIKE_DC      = 6;       // Deception difficulty for a clean covert spike

// ── State ───────────────────────────────────────────────────────────────────
const DOSED = new Set();       // npcIds currently carrying an effect (drives the tick)

const pick = (a) => a[Math.floor(Math.random() * a.length)];
const roll2d8 = () => Math.floor(Math.random() * 8) + 1 + Math.floor(Math.random() * 8) + 1;
const err = (message) => ({ type: 'error', message });
const out = (message) => ({ type: 'output', message });
const fleeBroadcast = (zoneId, payload, excludeId) => sendToZone(zoneId, payload, excludeId);

// ── Effect classification (from the drug's own data — no content edits) ────────
function classify(effects) {
  const eff = effects || {};
  if (eff.hallucination) return 'paranoid';
  const peak = eff.phases?.peak_mods || {};
  const inst = eff.instant || {};
  if ((peak.stat_reflexes || 0) > 0 || (inst.stamina || 0) > 0) return 'wired';
  return 'sedated';
}

// ── Flavour ───────────────────────────────────────────────────────────────────
const LINE = {
  loose:    (n) => `${n}'s eyes go glassy and the wary edge slides right off them.`,
  out:      (n) => `${n}'s knees fold — they slump bonelessly to the floor and don't get up.`,
  paranoid: (n) => `${n}'s pupils blow wide; they flinch at nothing and start scanning the room like the walls just moved.`,
  wired:    (n) => `${n}'s jaw starts working overtime, one heel jackhammering the floor, eyes too bright.`,
};
const LOOSE_MUTTER = [
  (n) => `${n} mumbles something they'd never say sober, then loses the thread.`,
  (n) => `${n} leans in far too close and starts oversharing.`,
  (n) => `${n} giggles at nothing and lets half a secret slip before trailing off.`,
];
const OUT_MUTTER  = [(n) => `${n} sprawls where they fell, breathing slow and heavy.`];
const WIRED_MUTTER = [
  (n) => `${n} grinds their teeth and mutters too fast to follow.`,
  (n) => `${n} paces a tight, twitchy circle, can't seem to stop moving.`,
];
const SOBER = {
  sedated:  (n) => `${n} drags in a breath, blinks hard, and slowly comes back to themselves.`,
  paranoid: (n) => `${n} shudders, and whatever they were seeing loses its colour. They're back.`,
  wired:    (n) => `${n} crashes hard, shoulders sagging as the jitters drain out.`,
};

// ── The shared core: apply an effect to a live NPC ─────────────────────────────
function doseNpc(npc, kind, drugName) {
  const ai = npc._ai || (npc._ai = {});
  const d = ai.dose || (ai.dose = { doses: 0 });
  d.kind = kind;                    // last dose wins on kind
  d.doses += 1;
  d.drugName = drugName;
  const now = Date.now();

  // Reset the sub-flags each dose; set the ones this kind needs.
  d.loose = d.out = d.flee = d.wired = false;

  if (kind === 'sedated') {
    d.until = now + SEDATE_MS;
    if (d.doses >= 2) {
      d.out = true;
      ai.dosedOut = true;                              // engine yields the graph
      try { setPosture(npc, 'lying'); } catch { /* posture best-effort */ }
      sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.out(npc.name) });
    } else {
      d.loose = true;
      sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.loose(npc.name) });
    }
  } else if (kind === 'paranoid') {
    d.until = now + PARANOID_MS;
    d.flee = true;
    ai.dosedOut = true;                                // suppress graph; we drive the flee
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.paranoid(npc.name) });
  } else { // wired
    d.until = now + WIRED_MS;
    d.wired = true;
    sendToZone(npc.zone_id, { type: 'zone_event', message: LINE.wired(npc.name) });
  }
  DOSED.add(npc.id);
}

// Return the NPC to its normal AI: clear the effect, stand it up, restart the graph.
function sober(npc) {
  DOSED.delete(npc.id);
  const ai = npc._ai;
  const kind = ai?.dose?.kind || 'sedated';
  const wasDown = !!(ai?.dose?.out || ai?.dose?.flee);
  if (ai) {
    ai.dose = null;
    ai.dosedOut = false;
    ai.currentNode = null;      // mirror burglary's endAlarm: graph resumes from _start
    ai.waitUntil = 0;
  }
  if (wasDown) { try { forceStand(npc); } catch { /* best-effort */ } }
  sendToZone(npc.zone_id, { type: 'zone_event', message: (SOBER[kind] || SOBER.sedated)(npc.name) });
}

// One blind-panic flee step toward a random neighbour; cower if boxed in.
function stepFlee(npc) {
  const zone = getZone(npc.zone_id);
  const neighbors = zone ? neighborZoneIds(zone).filter(Boolean) : [];
  if (!neighbors.length) {
    if (Math.random() < 0.5)
      sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} presses into a corner, warding off things that aren't there.` });
    return;
  }
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} bolts in a blind panic!` });
  moveEntity(npc, pick(neighbors), fleeBroadcast, query);
}

// ── Driver tick: flavour, flee, expiry (self-gates when nobody's dosed) ────────
function tick() {
  if (!DOSED.size) return;
  const now = Date.now();
  for (const id of [...DOSED]) {
    const npc = world.npcs.get(id);
    if (!npc || !npc._ai?.dose) { DOSED.delete(id); continue; }
    if (npc.hp != null && npc.hp <= 0) { DOSED.delete(id); continue; }
    const d = npc._ai.dose;
    if (now >= d.until) { sober(npc); continue; }
    if (d.flee) { stepFlee(npc); continue; }
    if (d.out)   { if (Math.random() < 0.3) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(OUT_MUTTER)(npc.name) }); continue; }
    if (d.loose && Math.random() < 0.4) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(LOOSE_MUTTER)(npc.name) });
    if (d.wired && Math.random() < 0.4) sendToZone(npc.zone_id, { type: 'zone_event', message: pick(WIRED_MUTTER)(npc.name) });
  }
}
schedule('4s', () => { try { tick(); } catch (e) { console.error('[npc-drugs] tick error:', e.message); } });

// ── Pre-show habit: an NPC's own vice ─────────────────────────────────────────
// Data-driven, not hardcoded to anyone: any NPC with flags.preshow_habit set to a
// drug name will *rarely* dose themselves at home, when a player is around to see
// it. It reads as a nervy pre-show ritual — the performer who can't go on flat —
// and applies the same effect the drug would (a stimulant → wired). The rarity is
// a long cooldown × a low per-scan roll × "only when watched," so it's a treat you
// stumble into, not a thing that's always happening.
const PRESHOW_COOLDOWN  = 30 * 60 * 1000;   // at most once every 30 min
const PRESHOW_CHANCE    = 0.12;             // per scan, once all conditions are met
const preshowLast = new Map();              // npcId -> ts of last ritual
const PRESHOW_LINES = [
  `checks the countdown feed — "...live in ten" — and racks up a neat line of {drug} with the ease of long habit.`,
  `dabs a little {drug} onto his gums, blinks twice as the room sharpens to a razor's edge, and grins at his own reflection.`,
  `"Nobody tunes in for flat," he mutters, tipping a hit of {drug} under his tongue before the cameras roll.`,
  `does a quick, practised bump off the back of his hand, rolls his shoulders, and shakes out the pre-show nerves.`,
];

function kindForNamed(name) {
  const d = Object.values(getDrugCache()).find(x => (x.name || '').toLowerCase() === String(name).toLowerCase());
  return d ? classify(d.effects) : 'wired';   // pre-show default is an upper
}

function preshowScan() {
  const npcs = getNpcsByFlag('preshow_habit');
  if (!npcs.length) return;
  const now = Date.now();
  for (const npc of npcs) {
    if (npc.hp != null && npc.hp <= 0) continue;
    if (DOSED.has(npc.id)) continue;                                   // already high
    if (!npc.home_zone || npc.zone_id !== npc.home_zone) continue;     // only in his own place
    if (now - (preshowLast.get(npc.id) || 0) < PRESHOW_COOLDOWN) continue;
    if (!getZonePlayers(npc.zone_id).length) continue;                 // nobody there to enjoy it
    if (Math.random() >= PRESHOW_CHANCE) continue;
    preshowLast.set(npc.id, now);
    const drugName = (typeof npc.flags.preshow_habit === 'string' && npc.flags.preshow_habit) ? npc.flags.preshow_habit : 'something';
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} ${pick(PRESHOW_LINES).replace('{drug}', drugName)}` });
    doseNpc(npc, kindForNamed(drugName), drugName);
  }
}
schedule('45s', () => { try { preshowScan(); } catch (e) { console.error('[npc-drugs] preshow error:', e.message); } });

// A killed/despawned NPC drops its effect so nothing lingers on a stale row.
on('npc.killed', ({ npc }) => {
  if (!npc || !DOSED.has(npc.id)) return;
  DOSED.delete(npc.id);
  if (npc._ai) { npc._ai.dose = null; npc._ai.dosedOut = false; }
});

// ── Verb plumbing ─────────────────────────────────────────────────────────────

// Resolve a live NPC in the room by name (returns the live world object, not a copy).
function resolveNpc(who, player) {
  const pool = getZoneNpcs(player.current_zone).filter(n => n && (n.hp == null || n.hp > 0));
  if (!pool.length) return { type: 'none' };
  return siftResolve(who, pool);
}

// Find one carried drug (matching `name`, or the first drug carried if name is null).
async function findCarriedDrug(player, name) {
  const like = `%${(name || '').trim()}%`;
  const filter = name ? 'AND (i.name ILIKE $2 OR pi.custom_data->>\'name\' ILIKE $2)' : '';
  const params = name ? [player.id, like] : [player.id];
  const { rows } = await query(
    `SELECT pi.id AS inv_id, pi.quantity, pi.custom_data,
            i.id AS item_id, i.name AS item_name,
            d.effects, d.name AS drug_name
       FROM player_inventory pi
       JOIN items i ON i.id = pi.item_id
       JOIN drugs d ON d.item_id = i.id
      WHERE pi.player_id = $1 AND pi.container_id IS NULL AND pi.is_equipped = 0 ${filter}
      ORDER BY i.name LIMIT 1`,
    params
  );
  return rows[0] || null;
}

// Burn one dose from the stack.
async function consumeDose(row) {
  if (row.quantity <= 1) await query('DELETE FROM player_inventory WHERE id=$1', [row.inv_id]);
  else await query('UPDATE player_inventory SET quantity=quantity-1 WHERE id=$1', [row.inv_id]);
}

const drugDisplay = (row) => row.custom_data?.name || row.drug_name || row.item_name;

// Split "<npc> with <drug>" → { who, drug }. `with` is optional (drug auto-picks).
function parseTargetWith(args) {
  const toks = args.filter(Boolean);
  const wi = toks.findIndex(t => t.toLowerCase() === 'with');
  if (wi === -1) return { who: toks.join(' ').trim(), drug: null };
  return { who: toks.slice(0, wi).join(' ').trim(), drug: toks.slice(wi + 1).join(' ').trim() || null };
}

// Shared front half of spike/jab: resolve target + drug, or return an error object.
async function setup(args, player, verb) {
  const { who, drug } = parseTargetWith(args);
  if (!who) return { error: err(`Usage: ${verb} <someone> [with <drug>].`) };
  const r = resolveNpc(who, player);
  if (r.type === 'none') return { error: err(`There's no "${who || 'one'}" here to ${verb}.`) };
  if (r.type === 'ambiguous') return { error: err(`Who do you mean — ${r.candidates.map(c => c.name).join(', ')}?`) };
  const npc = r.candidate;
  const row = await findCarriedDrug(player, drug);
  if (!row) return { error: err(drug ? `You're not carrying a "${drug}".` : "You're not carrying anything to dose them with.") };
  return { npc, row, kind: classify(row.effects) };
}

// spike — covert. Deception vs the room; success = clean dose, failure = caught.
async function cmdSpike(args, raw, player) {
  const s = await setup(args, player, 'spike');
  if (s.error) return s.error;
  const { npc, row, kind } = s;
  const name = drugDisplay(row);

  const margin = (await effectiveSkill(player, 'deception')) - SPIKE_DC + (roll2d8() - roll2d8());
  await awardSkillUse(player.id, 'deception', margin);   // trains on success or near-miss

  if (margin < 0) {
    // Caught tipping it into their drink — assault-tier heat, no dose lands.
    emit('npc.attacked', { actor: player, npc });
    sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} knocks the ${name} aside — "What the hell did you just put in that?!"` }, player.id);
    return err(`${npc.name} catches you slipping the ${name} into their drink. Busted.`);
  }

  await consumeDose(row);
  doseNpc(npc, kind, name);
  return out(`You palm the ${name} into ${npc.name}'s drink, unseen.`);
}

// jab — forced needle. Always lands, always assault heat.
async function cmdJab(args, raw, player) {
  const s = await setup(args, player, 'jab');
  if (s.error) return s.error;
  const { npc, row, kind } = s;
  const name = drugDisplay(row);

  emit('npc.attacked', { actor: player, npc });          // it's an assault, in the open
  await consumeDose(row);
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${player.handle} jams a dose of ${name} into ${npc.name}'s neck!` }, player.id);
  doseNpc(npc, kind, name);
  return out(`You jam the ${name} into ${npc.name}'s neck.`);
}

// slip — willing hand-off. Only a user (or an already-loosened mark) takes it.
async function cmdSlip(args, raw, player) {
  const toks = args.filter(Boolean);
  const ti = toks.findIndex(t => t.toLowerCase() === 'to');
  if (ti < 1) return err('Usage: slip <drug> to <someone>.');
  const drug = toks.slice(0, ti).join(' ').trim();
  const who = toks.slice(ti + 1).join(' ').trim();
  if (!drug || !who) return err('Usage: slip <drug> to <someone>.');

  const r = resolveNpc(who, player);
  if (r.type === 'none') return err(`There's no "${who}" here.`);
  if (r.type === 'ambiguous') return err(`Who do you mean — ${r.candidates.map(c => c.name).join(', ')}?`);
  const npc = r.candidate;

  const willing = !!(npc.flags?.uses_drugs || npc._ai?.dose?.loose);
  if (!willing) return err(`${npc.name} isn't interested, and waves you off.`);

  const row = await findCarriedDrug(player, drug);
  if (!row) return err(`You're not carrying a "${drug}".`);
  const name = drugDisplay(row);

  await consumeDose(row);
  sendToZone(npc.zone_id, { type: 'zone_event', message: `${npc.name} takes the ${name} from ${player.handle} without a second thought.` }, player.id);
  doseNpc(npc, classify(row.effects), name);
  return out(`You slip ${npc.name} the ${name}. They take it eagerly.`);
}

export const commands = {
  spike: cmdSpike,
  jab: cmdJab,
  slip: cmdSlip,
};

// Exposed for the regression suite (pure helpers — no side effects).
export const _test = { classify, parseTargetWith };

console.log('[npc-drugs] Plugin loaded.');
