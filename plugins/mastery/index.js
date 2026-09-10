/**
 * Mastery — the Long Watch's third path.
 *
 * Wildblood become something else. Ascendants replace what they were born with.
 * The Long Watch master the body they were issued, and the whole system is built
 * around one rule: A LONG WATCH VETERAN MUST NOT LOOK SUPERNATURAL ON INSPECTION.
 * There is no entry on the paper doll, nothing in `player.appearanceNotes`,
 * nothing an `examine` can see. They look like an ordinary person until you
 * watch what they actually do. Mutations are visible and chrome is visible; this
 * one's invisibility is the fiction, not an omission.
 *
 * Which forces three things this deliberately is NOT:
 *
 *   NOT a stat block. Mutations and augments both apply stat_modifiers. The
 *   moment mastery grants a permanent passive number it IS a mutation you can't
 *   see, and the fantasy is dead. Every technique costs something at the moment
 *   of use and can fail.
 *
 *   NOT baked. Contributions are derived at read time, exactly as
 *   docs/systems-mutations.md had to learn. `rank` is stored raw and the purity
 *   cap is applied on READ (purity.js), so pulling chrome back out returns you
 *   what you earned rather than leaving the arithmetic unrecoverable.
 *
 *   NOT a second grind. An instructor raises your CEILING; doing the hard thing
 *   raises the number. There is no training dummy in this game.
 *
 * The mechanical identity is Read (P3): a fighter learns an opponent DURING the
 * fight, so the longer it lasts the more dangerous they get. Everything else in
 * Architect decays over a long fight — stamina, condition, bleeding — and that
 * inversion is the entire reason this system exists.
 */
import { on } from '../../server/engine/events.js';
import { schedule } from '../../server/engine/scheduler.js';
import { getZoneNpcs, getZoneEnemies, getLivePlayer, world } from '../../server/engine/world.js';
import { getReputation } from '../../server/engine/ideologies.js';
import { dispatchAction, registerAction } from '../../server/engine/actions.js';
import { registerSwingContributor } from '../../server/engine/combat.js';
import { registerSanityResistor } from '../../server/engine/condition.js';
import { getFlag, setFlag } from '../../server/engine/flags.js';
import { resolve as siftResolve, createSelectionState, formatSelectionPage } from '../../server/engine/sift.js';
import {
  DISCIPLINES, hydrateMastery, flushMastery, storedRank, allRanks, setRank, getRead,
} from './state.js';
import {
  purityCap, effectiveRank, capReason, standingGreeting, standingWord, regardOf,
  carriesModification, cleanseDemand,
} from './purity.js';
import {
  archetypeOf, noteExchange, bankHeat, sweepStaleFights, tierOn, tierLine, tierAtLeast,
} from './reads.js';
import { exploitById } from './exploits.js';
import { applyBlindFighting, blindFightingLine } from './senses.js';
import { fearResist } from './mind.js';
import {
  canArm, armWindow, resolveWindow, clearWindow, takeAnswer, OPTIONS,
} from './readgame.js';
import {
  getComposure, awardComposure, spendComposure, decayComposure, clearComposure, composureLine,
} from './composure.js';
import {
  STANCES, TECHNIQUES, stanceFor, techniqueFor, knownStances, knownTechniques,
  activeStance, stanceSoak, endStance, attemptRoll,
} from './techniques.js';
import {
  isOnCooldown, setCooldown, clearCooldown, getCooldownRemaining,
} from '../../server/engine/combat.js';
import { registerMoveGate } from '../../server/engine/movement-gates.js';
import { registerConditionShape } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

const WAS_MUTATED_FLAG = 'mastery_was_mutated';

// Techniques draw on the SAME 10s window as `pow` and `dodge`. One shared
// budget: you get one clever thing per window and you have to choose which.
// That is what makes mastery a replacement for brute force rather than an
// addition to it.
const MOVE_KEY = 'combat_move';
const FOCUS_COST = 3;

const LONG_WATCH = 'ideology_long_watch';

/**
 * The `mastery` dialogue/script condition shape.
 *
 *   { mastery: 'body', min: 40 }     — that discipline is worth at least 40
 *   { mastery: 'any',  min: 40 }     — your best discipline is
 *   { mastery: 'any',  pure: true }  — and the body is carrying nothing
 *
 * ⚠ IT READS `effectiveRank`, NEVER `storedRank`. The purity cap applies on
 * READ by design (docs/systems-mastery.md) — a chromed player keeps their raw
 * number and simply cannot use it — so a gate on the stored number would let
 * somebody bolt on an arm and still walk through a door the discipline is
 * supposed to hold shut. `pure` is the separate, stricter claim: a cap of 100
 * means no chrome, no mutation, and no STAIN, which is what makes "clean" cost
 * time rather than a trip to a surgeon.
 *
 * ⚠ AND IT MUST NEVER READ `regardOf`/`standingGreeting`. Those exist to be
 * SAID, not checked (purity.js says so at length). This shape is the sanctioned
 * way to gate on the body; the social ladder is not and never will be.
 *
 * Sync by contract, like everything in state.js/purity.js — no query.
 */
registerConditionShape('mastery', (cond, player) => {
  if (!player) return false;
  const want = String(cond.mastery || 'any');
  const min = Number(cond.min) || 0;

  if (cond.pure && purityCap(player) < 100) return false;

  if (want === 'any') {
    return DISCIPLINES.some(d => effectiveRank(player, d) >= min);
  }
  if (!DISCIPLINES.includes(want)) return false;   // typo: fail closed, as every shape does
  return effectiveRank(player, want) >= min;
});

// What an instructor moves you by in one session. Small on purpose: the ceiling
// is the thing they sell, and the number is meant to come from being hit.
const TEACH_STEP = 6;

// How a rank reads on the sheet. Deliberately words and not a percentage — the
// player never sees the raw number, because a number invites grinding it.
const BANDS = [
  [0, 'untrained'], [10, 'green'], [25, 'schooled'], [40, 'practised'],
  [60, 'accomplished'], [80, 'expert'], [95, 'masterful'],
];
// The rite, slot 10 of the Long Watch's forty. See docs/systems-faction-arcs.md.
// Stated once here rather than trusted to every instructor's authored config,
// for the same reason `MIN_INSTALL_TIER` is stated once in plugins/augments: an
// instructor authored without it would be a way to skip the commitment entirely.
const LW_ARC_FLAG = 'lw_arc';
const MIN_ARC_SLOT = 10;

export function bandOf(rank) {
  let out = 'untrained';
  for (const [floor, label] of BANDS) if (rank >= floor) out = label;
  return out;
}

// ── the sheet ───────────────────────────────────────────────────────────────

function cmdMastery(args, raw, player) {
  const cap = purityCap(player);
  const ranks = allRanks(player);
  const known = DISCIPLINES.filter(d => ranks[d] > 0);

  if (!known.length) {
    return {
      type: 'output',
      message: "You have never been taught anything you didn't work out for yourself."
        + '\n<span class="text-dim">The Long Watch teach. They don\'t advertise.</span>',
    };
  }

  const lines = ['<span class="heading">DISCIPLINE</span>'];
  for (const d of DISCIPLINES) {
    const stored = ranks[d];
    if (!stored) continue;
    const eff = Math.min(stored, cap);
    // A capped discipline says so IN PROSE — never "40/100". The player is meant
    // to understand they are held back, not to compute by how much.
    const held = eff < stored ? ' <span class="text-dim">— held back by what you have done to yourself</span>' : '';
    lines.push(`  ${d.padEnd(9)} <span class="hit-part">${bandOf(eff)}</span>${held}`);
  }
  const reason = capReason(player);
  if (reason) lines.push(`\n<span class="text-dim">You won't get further than this: ${reason}.</span>`);
  return { type: 'output', message: lines.join('\n') };
}

// ── read ────────────────────────────────────────────────────────────────────

/**
 * A deliberate look at something you are fighting, or could be.
 *
 * Prints what you already know. It does NOT advance the read — you learn by
 * exchanging blows, not by staring, and a `read` that paid out would be a free
 * action every player would spam at the top of every fight.
 */
function cmdRead(args, raw, player) {
  if (effectiveRank(player, 'combat') < 10) return undefined;   // not yours — fall through

  const q = args.join(' ').trim();
  const candidates = (getZoneEnemies?.(player.current_zone) || []);
  if (!candidates.length) return { type: 'output', message: "There's nothing here worth watching that closely." };

  const r = q ? siftResolve(q, candidates) : { type: 'match', candidate: candidates[0] };
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'mastery.read', dispatchParam: 'candidate' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (r.type !== 'match' || !r.candidate) return { type: 'output', message: "You don't see that." };
  return readReport(player, r.candidate);
}

function readReport(player, enemy) {
  const tier = tierOn(player, enemy);
  const rec = getRead(player, archetypeOf(enemy));
  const lines = [];

  const line = tierLine(tier, enemy.name);
  lines.push(line || `<span class="text-dim">You haven't watched ${enemy.name} long enough to see anything in it yet.</span>`);

  if (rec.familiarity >= 20) {
    lines.push(`<span class="text-dim">You have fought this kind of thing before, and it shows.</span>`);
  }
  // Exploits you have already found on this KIND. Reprinted every time, because
  // a weakness you worked out once should not need working out again.
  for (const id of rec.exploits || []) {
    const ex = exploitById(id);
    if (ex) lines.push(`<span class="crit-tag">${ex.prose(enemy)}</span>`);
  }
  return { type: 'output', message: lines.join('\n') };
}

// ── stance / technique / focus ──────────────────────────────────────────────

function cmdStance(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  const known = knownStances(player);
  if (!known.length) return undefined;   // not yours — fall through to the combat stance verb

  const live = activeStance(player);
  if (!sub) {
    return {
      type: 'output',
      message: live
        ? `You're holding ${stanceFor(live.name)?.name}.\n<span class="text-dim">stance drop</span>`
        : `You can hold: ${known.map(s => s.name).join(', ')}.\n<span class="text-dim">stance &lt;name&gt;</span>`,
    };
  }
  if (sub === 'drop') {
    const line = endStance(player, 'drop');
    return { type: 'output', message: line || "You aren't holding anything." };
  }

  const def = known.find(s => s.id === sub || s.name.toLowerCase().startsWith(sub));
  if (!def) return undefined;
  if (isOnCooldown(player.id, 'stance')) {
    return { type: 'error', message: "You haven't got your breath back yet." };
  }
  player._stance = { name: def.id, startedAt: Date.now(), expiresAt: Date.now() + def.durationMs };
  setCooldown(player.id, 'stance');
  return { type: 'output', message: def.enter, refresh: true };
}

function cmdTechnique(args, raw, player) {
  const known = knownTechniques(player);
  if (!known.length) return undefined;

  const q = (args[0] || '').toLowerCase();
  if (!q) {
    const lines = known.map(t => `  ${t.name.padEnd(16)} <span class="text-dim">${t.composure} composure</span>`);
    return { type: 'output', message: `<span class="heading">TECHNIQUE</span>\n${lines.join('\n')}\n${composureLine(player)}` };
  }
  const def = known.find(t => t.id === q || t.name.toLowerCase().replace(/\s+/g, '_').startsWith(q));
  if (!def) return { type: 'error', message: "You don't know that one." };

  // One shared window with pow and dodge — you get one clever thing per cycle.
  if (isOnCooldown(player.id, MOVE_KEY)) {
    const s = Math.ceil(getCooldownRemaining(player.id, MOVE_KEY) / 1000);
    return { type: 'error', message: `You aren't set for it yet. (${s}s)` };
  }
  if (!spendComposure(player, def.composure)) {
    return { type: 'error', message: "You aren't composed enough for that." };
  }
  player._technique = { id: def.id, kind: def.kind, armedAt: Date.now() };
  setCooldown(player.id, MOVE_KEY);
  return { type: 'combat', noRefresh: true, message: def.arm };
}

/**
 * Spend composure to reopen the window early.
 *
 * ⚠ THE TRAP: `playerDefence` already calls clearCooldown against the **attack**
 * key. This must clear `combat_move` and NOTHING else — clearing `attack` would
 * make composure buy free swings, i.e. a damage passive in a resource's
 * clothing, which is the one thing this system may not contain. Regress asserts
 * the attack cooldown survives a focus.
 */
function cmdFocus(args, raw, player) {
  if (effectiveRank(player, 'will') < 20) return undefined;
  if (!isOnCooldown(player.id, MOVE_KEY)) {
    return { type: 'output', message: "You're already set. Nothing to gather." };
  }
  if (!spendComposure(player, FOCUS_COST)) {
    return { type: 'error', message: 'You have nothing left to gather.' };
  }
  clearCooldown(player.id, MOVE_KEY);
  return { type: 'combat', noRefresh: true, message: 'You breathe out. The window opens again.' };
}

/**
 * The client reporting its answer. Silent — fired by the panel, never typed.
 *
 * `readresolve <token> <0|1|CHOICE>`. At the visual and text rungs the client
 * sends the CHOICE and the server decides; at the log rung it echoes the
 * server's own bit back, which is the only case where a client-supplied verdict
 * is trusted.
 */
function cmdReadResolve(args, raw, player) {
  const [token, answer] = args;
  const bit = String(answer || '');
  const trustClient = bit === '0' || bit === '1';
  const res = resolveWindow(player, token, bit, { trustClient, clientWon: bit === '1' });

  if (!res) return { type: 'output', message: '', noRefresh: true };   // stale or forged: say nothing
  if (res.lapsed) return { type: 'output', message: '', noRefresh: true };
  return {
    type: 'combat', noRefresh: true,
    message: res.correct
      ? '<span class="crit-tag">Read.</span>'
      : `<span class="text-dim">Wrong read. You brace for something it wasn't going to do.</span>`,
  };
}

// ── training ────────────────────────────────────────────────────────────────

/** Instructors in the room, as [{ npc, cfg }]. An instructor is content, not a table. */
function instructorsHere(player) {
  const out = [];
  for (const npc of getZoneNpcs(player.current_zone) || []) {
    const cfg = npc?.flags?.mastery_instructor;
    if (cfg && typeof cfg === 'object') out.push({ npc, cfg });
  }
  return out;
}

async function doTrain(player, entry, wanted) {
  const { npc, cfg } = entry;
  const offered = Array.isArray(cfg.disciplines) ? cfg.disciplines.filter(d => DISCIPLINES.includes(d)) : [];
  if (!offered.length) return { type: 'error', message: `${npc.name} has nothing to teach.` };

  // THE DOOR, and it is checked FIRST — before reputation, before discipline,
  // before anything. A picket sees the metal long before they get round to
  // asking who vouched for you, and a chromed stranger who is told "come back
  // when someone can vouch" would go away and do the wrong work for a week.
  //
  // Sync, no query, and it reads `carriesModification` rather than the social
  // ladder — see the note over `cleanseDemand`. Someone who has CLEANED UP is
  // let through here and met by the ceiling instead, which is the whole reason
  // the stain exists.
  if (carriesModification(player)) {
    return { type: 'output', message: cleanseDemand(player, npc.name) };
  }

  // The reputation gate. The refusal NEVER names reputation, a tier or a flag —
  // same convention the mutagen gate follows. An NPC who does not trust you says
  // so as a person; they do not read you your standing.
  const need = Number(cfg.rep_required) || 0;
  if (need > 0 && (await getReputation(player.id, LONG_WATCH)) < need) {
    return {
      type: 'output',
      message: `${npc.name} looks at you for a while, and goes back to what they were doing.`
        + `\n<span class="text-dim">"Come back when someone can vouch for you."</span>`,
    };
  }

  // ── THE OATH ────────────────────────────────────────────────────────────────
  //
  // Mastery is the Long Watch's discipline and they do not teach it to people who
  // have not sworn in. Standing gets you spoken to; the rite is what gets you
  // taught, and it is checked AFTER reputation on purpose: somebody who has done
  // nothing at all for the Watch should be told to find a voucher, not told to
  // finish a rite they have never been offered.
  //
  // ⚠ THIS IS THE COMMITMENT GATE AND IT IS THE ONLY ONE MASTERY HAS. Chrome has
  // `chromed_ever` — one install and the flesh path is shut for ever, so the
  // machine path locks you in by construction. Nothing did that for this one:
  // before this gate a player could climb the whole discipline on reputation
  // alone and never commit to anybody.
  //
  // ⚠ `Number(undefined)` is `NaN` and `NaN >= 10` is false, so an unset arc
  // fails the gate with no special case — the same trick the forty-slot ladder
  // uses for every one of its own gates.
  //
  // It gates TEACHING, never what you already know. A rank earned before this
  // shipped is still yours and still rides every seam; you simply cannot be
  // taught more until you have stood the watch.
  if (Number(await getFlag('player', LW_ARC_FLAG, player)) < MIN_ARC_SLOT) {
    return {
      type: 'output',
      message: `${npc.name} stops, and looks at you properly for the first time.`
        + `\n<span class="text-dim">"You haven't stood a watch. I'm not going to teach you how we move before you have done that. Talk to Pike."</span>`,
    };
  }

  const discipline = wanted || (offered.length === 1 ? offered[0] : null);
  if (!discipline) {
    return {
      type: 'output',
      message: `${npc.name} can teach you ${offered.join(', ')}.`
        + `\n<span class="text-dim">train &lt;discipline&gt;</span>`,
    };
  }
  if (!offered.includes(discipline)) {
    return { type: 'output', message: `${npc.name} shakes their head. "Not my line. I do ${offered.join(', ')}."` };
  }

  const cap = purityCap(player);
  const stored = storedRank(player, discipline);
  const instructorCeiling = Math.min(Number(cfg.max_rank) || 100, 100);

  // The purity cap, explained by someone who can see it. Never a number.
  if (stored >= cap) {
    const reason = capReason(player);
    return {
      type: 'output',
      message: `${npc.name} watches you move, and stops you before you have finished.`
        + `\n<span class="text-dim">"I can't teach you past this. ${reason ? reason[0].toUpperCase() + reason.slice(1) : "You're as far as you go"}."</span>`,
    };
  }
  if (stored >= instructorCeiling) {
    return {
      type: 'output',
      message: `${npc.name} shrugs. "You already do this better than I can show you. Find someone who's seen more than I have."`,
    };
  }

  const to = Math.min(stored + TEACH_STEP, instructorCeiling, cap);
  setRank(player, discipline, to);

  // The mirror of what plugins/augments pays the Long Watch for installing chrome.
  await dispatchAction({ type: 'ADJUST_PATH', actor: player, params: { path: 'human', delta: 2 } });
  await dispatchAction({
    type: 'ADJUST_REPUTATION', actor: player,
    params: { ideology_id: LONG_WATCH, delta: 3, reason: 'mastery training' },
  });

  const crossed = bandOf(to) !== bandOf(stored);
  // What they make of you, said before the lesson and never instead of it.
  const greeting = standingGreeting(player, npc.name);
  return {
    type: 'output',
    message: (greeting ? `${greeting}\n\n` : '')
      + `${npc.name} works you through it until your arms shake, and then a while longer.`
      + (crossed
        ? `\n<span class="crit-tag">Your ${discipline} is ${bandOf(to)}.</span>`
        : `\n<span class="text-dim">Something in it settles.</span>`),
    refresh: true,
  };
}

async function cmdTrain(args, raw, player, broadcast) {
  const here = instructorsHere(player);
  // Fall THROUGH rather than erroring: another plugin may own `train` somewhere
  // this one does not, and eating the verb everywhere would be a collision.
  if (!here.length) return undefined;

  const wanted = (args[0] || '').toLowerCase();
  const discipline = DISCIPLINES.includes(wanted) ? wanted : null;

  if (here.length === 1) return doTrain(player, here[0], discipline);

  // More than one teacher in the room — SIFT decides, never a .find().
  const q = discipline ? '' : args.join(' ').trim();
  if (!q) {
    return {
      type: 'output',
      message: `More than one of them could teach you. ${here.map(e => e.npc.name).join(', ')}.`
        + `\n<span class="text-dim">train &lt;name&gt;</span>`,
    };
  }
  const r = siftResolve(q, here.map(e => ({ ...e.npc, _entry: e })));
  if (r.type === 'ambiguous') {
    createSelectionState(player.id, r.candidates, { dispatchType: 'mastery.train', dispatchParam: 'candidate' });
    return { type: 'output', message: formatSelectionPage({ allCandidates: r.candidates, visibleIndex: 0, pageSize: 5 }) };
  }
  if (r.type !== 'match' || !r.candidate) return { type: 'output', message: 'Nobody here by that name teaches.' };
  return doTrain(player, r.candidate._entry, discipline);
}

// ── wiring ──────────────────────────────────────────────────────────────────

registerAction({
  type: 'mastery.train',
  handler: async ({ actor, params }) => doTrain(actor, params.candidate?._entry, null),
});

// The authored route: an NPC explains a thing in a VINE node, and you come away
// able to do it. Same shape as CODEX_UNLOCK.
registerAction({
  type: 'MASTERY_TEACH',
  handler: async ({ actor, params }) => {
    const d = String(params?.discipline || '').toLowerCase();
    if (!DISCIPLINES.includes(d)) return { type: 'error', message: `Unknown discipline: ${d}` };
    const to = Math.min(storedRank(actor, d) + (Number(params.amount) || TEACH_STEP), purityCap(actor));
    setRank(actor, d, to);
    return { type: 'mastery', discipline: d, rank: to };
  },
});

// Hydration lives HERE and not in the login Promise.all in server/index.js,
// even though joining that batch would cost no extra round trip. The engine
// must not import a plugin — mutations gets into the batch because its
// substrate is engine (server/engine/mutations.js) and mastery's is not. Same
// call plugins/augments makes, and it pays the same one extra statement for it.
//
// On a RECONNECT the prior live object may still hold an unflushed fight, so
// flush it before reading or the hydrate races it and the last few exchanges of
// knowing something are lost.
on('player.login', async ({ id }) => {
  const p = getLivePlayer(id);
  if (!p) return;
  await hydrateMastery(p);
  // What the body USED to be. Chrome already latches its own (`_chromedEver`,
  // set by plugins/augments at login); mutation needs one because treating a
  // mutation removes the row, and the stain has to outlive the evidence.
  p._mutatedEver = (await getFlag('player', WAS_MUTATED_FLAG, p)) === '1';
});

// The latch. Fires on every grant path — radiation, mutagen and the authored
// GRANT_MUTATION action all emit this.
on('mutation.gained', async ({ player }) => {
  if (!player?.id || player._mutatedEver) return;
  player._mutatedEver = true;
  await setFlag('player', WAS_MUTATED_FLAG, '1', player).catch(() => {});
});

// ── the swing seam ──────────────────────────────────────────────────────────
//
// SYNC BY CONTRACT: no await, no query, no send. Prose rides ctx.lines and the
// engine appends it to the message it was already sending.
registerSwingContributor((phase, ctx) => {
  const { player, enemy } = ctx;
  if (!player || !enemy) return;

  if (phase === 'pre') {
    // Senses: give back part of what the dark took. In a lit room this is a
    // no-op by arithmetic rather than by a guard — see senses.js for why it
    // rides this seam and not `visibility.perceive`.
    if (ctx.kind === 'outgoing' && applyBlindFighting(player, ctx)) {
      const line = blindFightingLine(player, enemy);
      if (line) ctx.lines.push(line);
    }

    // A held brace is read HERE, at the moment the blow lands, rather than baked
    // into player.soak — see the header of techniques.js for why.
    if (ctx.kind === 'incoming') {
      ctx.soakBonus += stanceSoak(player);

      // The window armed by the LAST swing is answered by this one.
      if (takeAnswer(player, enemy)) {
        ctx.negate = true;
        ctx.negateLine = `<span class="crit-tag">You saw it coming.</span> You're moving before ${enemy.name} is, and it closes on air.`;
        // The counter rides the engine's OWN swing path, so soak, body parts,
        // crits, injury and loot-on-death all still apply.
        player._powQueued = true;
      }
    }

    // An armed technique is consumed by exactly one swing, in its own direction.
    const armed = player._technique;
    if (armed && armed.kind === ctx.kind) {
      player._technique = null;                       // consumed either way
      const def = techniqueFor(armed.id);
      if (def) {
        const roll = attemptRoll(player, def, enemy);
        const outcome = def.apply(ctx, roll);
        ctx.lines.push(outcome ? '' : `\n<span class="text-dim">${def.fail}</span>`);
        if (outcome) player._techniqueLanded = def.id;
      }
    }
    return;
  }

  if (phase !== 'post') return;

  // Composure is earned by fighting WELL, never by fighting long.
  if (ctx.kind === 'incoming') {
    if (!ctx.hit) awardComposure(player, 1, 'clean defence');
    else if ((ctx.damage || 0) <= 1) awardComposure(player, 1, 'ate it');
    // A hard blow breaks a held stance. Nothing else in the game would notice.
    if (ctx.hit && (ctx.damage || 0) > (player.hp_max || 100) * 0.15) {
      const line = endStance(player, 'broken');
      if (line) ctx.lines.push(`\n<span class="text-dim">${line}</span>`);
    }
  }

  const res = noteExchange(player, enemy, ctx);
  if (!res) return;

  // Crossing a tier is said out loud once, when it happens. Saying it every
  // exchange would turn the best line in the system into wallpaper.
  if (res.crossed) {
    const line = tierLine(res.crossed, enemy.name);
    if (line) ctx.lines.push(`\n${line}`);
    awardComposure(player, 1, 'the read clicked');
  }
  if (res.exploit) ctx.lines.push(`\n<span class="crit-tag">${res.exploit.prose(enemy)}</span>`);

  // Arm the reaction beat off the swing that just landed — see readgame.js for
  // why it cannot be armed and answered within one swing.
  if (ctx.kind === 'incoming' && canArm(player, enemy)) armWindow(player, enemy);

  // A fight that ended here banks what it taught. The 1m sweep catches the
  // fights that simply stopped instead.
  if (ctx.killed) {
    bankHeat(player, enemy.instanceId || enemy.id);
    // A stale token must never resolve against a corpse.
    if (player._readWindow?.enemyId === (enemy.instanceId || enemy.id)) clearWindow(player);
  }
}, 'mastery');

// Mind: Fear Discipline, on the seam condition.js added for exactly this. The
// engine owns the arithmetic — resistors combine multiplicatively and each is
// capped, so no stack of them reaches immunity — and mind.js returns one
// fraction. Registered by owner, so a reload replaces rather than stacks.
registerSanityResistor(fearResist, 'mastery');

on('player.logout', async ({ id }) => {
  const p = getLivePlayer(id);
  if (p) await flushMastery(p).catch(() => {});
});

// Coalesced, dirty-gated, idle-gated by the scheduler. Same cadence as augments.
schedule('1m', async () => {
  const dirty = [];
  for (const p of world.players.values()) {
    // Bank anything from a fight that simply stopped rather than ending in a
    // kill — walked away from, fled, or the thing wandered off. Sync, and it is
    // what marks the row dirty, so it has to run before the dirty check.
    sweepStaleFights(p);
    if (p._readsDirty?.size || p._disciplinesDirty?.size || p._purityDirty) dirty.push(p);
  }
  await Promise.all(dirty.map(p => flushMastery(p).catch(() => {})));
});

// Stances, stamina, and composure decay. 10s rather than 1s deliberately —
// nothing here needs to be accurate to the second, and the swing seam already
// carries everything that does.
schedule('10s', () => {
  const now = Date.now();
  for (const p of world.players.values()) {
    const st = activeStance(p, now);          // lazy expiry happens in here
    if (st) {
      const def = stanceFor(st.name);
      p.stamina = Math.max(0, (p.stamina || 0) - (def?.staminaPerTick || 0));
      p._resDirty = true;
      if (p.stamina <= 0) {
        const line = endStance(p, 'drop');
        if (line) sendToPlayer(p.id, { type: 'output', message: `<span class="text-dim">Your legs give up before you do. ${line}</span>` });
      } else if (p.combatTargetId) {
        awardComposure(p, 1, 'held the line');
      }
    }
    // Out of a fight it bleeds away — a stockpile you walk around with is a
    // passive bonus, which is the thing this must never become.
    if (!p.combatTargetId) decayComposure(p);
  }
});

// A rooted fighter is not going anywhere. The cost IS the stance.
registerMoveGate(({ player }) => {
  const st = activeStance(player);
  if (!st) return null;
  const def = stanceFor(st.name);
  if (!def?.immobile) return null;
  return { block: true, message: "You're rooted to the spot. Drop the stance first." };
}, 'mastery');

on('player.death', ({ player }) => {
  if (!player) return;
  clearComposure(player);
  player._stance = null;
  player._technique = null;
  player._readHeat?.clear();
  clearWindow(player);
});

export const commands = {
  mastery: cmdMastery, train: cmdTrain, read: cmdRead,
  stance: cmdStance, technique: cmdTechnique, focus: cmdFocus,
  readresolve: cmdReadResolve,
};

// Declaration-only: examining an instructor advertises TRAIN. The handler is
// null because cmdTrain already owns the verb and re-registering it here would
// run it twice.
export const specializedActions = [
  { verb: 'train', requiredFlag: 'mastery_instructor', handler: null },
];

registerAction({
  type: 'mastery.read',
  handler: async ({ actor, params }) => readReport(actor, params.candidate),
});

export const _internals = {
  bandOf, instructorsHere, doTrain, readReport, TEACH_STEP, LONG_WATCH, WAS_MUTATED_FLAG,
};
