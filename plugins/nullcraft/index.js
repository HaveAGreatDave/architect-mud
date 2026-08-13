/**
 * NULLCRAFT — the verbs.
 *
 * The substrate is server/engine/nullcraft.js and the vocabulary is
 * server/engine/nullcraft-ops.js; read both before changing anything here. This
 * file is the player-facing half: three verbs and the consequences of failing at
 * them.
 *
 * ── The loop ────────────────────────────────────────────────────────────────
 *
 *   nullscan            free, no roll — what is powered in this room
 *   analyze <target>    a check — what it is made of and where it is soft
 *   null <op> <target> <subsystem>   the operation itself
 *
 * `nullscan` costs nothing on purpose. It is the discoverability rung: a player
 * who has just put a point in Nullcraft needs one verb that always works and
 * always shows them the surface exists, and the first mention of `analyze` in its
 * output is a teachVerb shimmer per the house convention. Making the entry verb a
 * dice roll would mean a new Null's first experience of the discipline is it not
 * working, which is how a system gets abandoned at level one.
 *
 * ── Two rules to preserve ───────────────────────────────────────────────────
 *
 * 1. THE CONTRIBUTOR APPLIES, THIS FILE NARRATES. Every mutation goes through
 *    `target.apply(...)`, supplied by the plugin that owns the thing. Nothing in
 *    this file may import augments, surveillance or flight — the moment it does,
 *    Nullcraft has a second opinion about whether a camera is jammed.
 *
 * 2. A FAILURE IS NEVER JUST A FAILURE (spec §30). Every failed operation has to
 *    do something to the world: trace jumps, the owner may be told, the deck may
 *    burn. `failureReaction` is that table and it is not decoration — a system
 *    whose failure state is a grey message teaches players that failing is free.
 */
import { on } from '../../server/engine/events.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { awardSkillUse } from '../../server/engine/skills.js';
import {
  damageHackDeck, marginOf,
  getNullDevice, nullIntrusion, nullStealth, nullJam,
} from '../../server/engine/hack-gear.js';
import { textRender } from '../../server/engine/minigame.js';
import { emit } from '../../server/engine/events.js';
import { resolveInventoryItem } from '../../server/engine/inventory.js';
import { query } from '../../server/models/db.js';
import {
  gatherTechTargets, matchTarget, operationRefusal, operationCheck,
  operationDifficulty, nullcraftLevel, addTrace, traceOf, forgetPlayer,
  suppressSubsystem, subsystemDown,
  setCarriedJammer, stopCarriedJammer, jammerOf, setVeil, clearVeil,
  TRACE_ALERT, TRACE_LOCKOUT,
} from '../../server/engine/nullcraft.js';
import {
  getNullOperation, getNullOperations, operationsFor,
} from '../../server/engine/nullcraft-ops.js';
import { getReputation } from '../../server/engine/ideologies.js';

// How long a transient operation holds. Scaled by how well the check went, so a
// squeaked jam is a moment and a clean one buys you the room. The floor matters
// more than the ceiling: a two-second lock is indistinguishable from a failure,
// and a player cannot tell the difference between "it barely worked" and "it's
// broken" unless the short version is still long enough to notice.
const HOLD_FLOOR_MS = 8_000;
const HOLD_PER_MARGIN_MS = 2_500;
const HOLD_CEILING_MS = 90_000;

const holdFor = (margin) => Math.min(
  HOLD_CEILING_MS,
  HOLD_FLOOR_MS + Math.max(0, margin) * HOLD_PER_MARGIN_MS,
);

// Security ratings are 0..100; players get a band, never the number. A number
// invites arithmetic and this is meant to be read at a glance under pressure.
function securityBand(rating) {
  const r = Number(rating) || 0;
  if (r >= 85) return { label: 'ARCHITECT-GRADE', cls: 'text-red' };
  if (r >= 70) return { label: 'MILITARY', cls: 'text-red' };
  if (r >= 50) return { label: 'HARDENED', cls: 'text-amber' };
  if (r >= 30) return { label: 'STANDARD', cls: 'text-amber' };
  if (r >= 15) return { label: 'CONSUMER', cls: 'text-green' };
  return { label: 'OPEN', cls: 'text-green' };
}

function exposureBand(exposure) {
  const e = Number(exposure) || 0;
  if (e >= 70) return { label: 'wide open', cls: 'text-green' };
  if (e >= 45) return { label: 'exposed', cls: 'text-green' };
  if (e >= 25) return { label: 'reachable', cls: 'text-amber' };
  if (e >= 10) return { label: 'tight', cls: 'text-amber' };
  return { label: 'sealed', cls: 'text-red' };
}

function traceLine(playerId) {
  const t = Math.round(traceOf(playerId));
  if (t <= 0) return '';
  const cls = t >= TRACE_ALERT ? 'text-red' : t >= TRACE_ALERT / 2 ? 'text-amber' : 'text-dim';
  return `\n<span class="${cls}">Trace ${t}%.</span>`;
}

// ── nullscan ─────────────────────────────────────────────────────────────────

async function cmdNullscan(args, raw, player) {
  const targets = await gatherTechTargets(player, { zoneId: player.current_zone });
  if (!targets.length) {
    return { type: 'output', message: `<span class="msg-system">You listen for powered hardware. Nothing here is talking.</span>` };
  }

  const lines = targets.map(t => {
    const owner = t.ownerName && t.ownerId !== player.id ? ` <span class="text-dim">(${t.ownerName})</span>` : '';
    const radio = t.security?.wireless === false
      ? ` <span class="text-dim">— no radio</span>`
      : '';
    return `  <span class="text-amber">${t.name}</span>${owner}${radio}`;
  });

  // The teaching moment. First verb a new Null needs after this one.
  const hint = `\n<span class="text-dim">${teachVerb('analyze')} one of them to see what it's made of.</span>`;

  return { type: 'output', message:
    `<span class="msg-system">You go quiet and listen to the room's electronics.</span>\n`
    + lines.join('\n') + hint + traceLine(player.id) };
}

// ── analyze ──────────────────────────────────────────────────────────────────

async function cmdAnalyze(args, raw, player) {
  const fragment = args.join(' ').trim().replace(/^the\s+/i, '');
  if (!fragment) return { type: 'error', message: `Analyze what? Try ${teachVerb('nullscan')} first.` };

  const targets = await gatherTechTargets(player, { zoneId: player.current_zone });
  const target = matchTarget(targets, fragment);
  if (!target) return { type: 'error', message: `There's nothing here called "${fragment}" that runs on electricity.` };

  const skill = await nullcraftLevel(player);
  const security = Number(target.security?.rating) || 0;
  // Reading is easier than breaking — you are listening to a machine describe
  // itself, not arguing with it. Detail scales with how far ahead you are.
  const check = await operationCheck(player, target, { kind: 'telemetry', exposure: 40 }, 'jam');
  addTrace(player.id, 1, 1);

  const band = securityBand(security);
  const out = [`<span class="msg-system">${target.name}</span>`];
  out.push(`  Security: <span class="${band.cls}">${band.label}</span>`);

  if (!check.success) {
    out.push(`  <span class="text-dim">You can't get a clean read. It knows it's being looked at.</span>`);
    await failureReaction(player, target, null, 'analyze', check);
    return { type: 'output', message: out.join('\n') + traceLine(player.id) };
  }

  out.push(`  Radio: ${target.security?.wireless === false
    ? `<span class="text-red">DISCONNECTED</span> <span class="text-dim">(somebody pulled it on purpose)</span>`
    : `<span class="text-green">LIVE</span>`}`);

  const subs = target.subsystems || [];
  if (!subs.length) {
    out.push(`  <span class="text-dim">Nothing on it you could get a hand into.</span>`);
  } else {
    out.push(`  <span class="text-dim">Attack surfaces:</span>`);
    for (const s of subs) {
      const ex = exposureBand(s.exposure);
      const down = subsystemDown(target.key, s.id);
      const state = down ? ` <span class="text-red">[${getNullOperation(down)?.label.toUpperCase()}]</span>` : '';
      // Which operations are worth naming is a function of skill: a beginner is
      // told the surface exists, an expert is told what to do with it.
      const ops = skill >= 3
        ? operationsFor(s.kind).filter(o => o.minSkill <= skill + 2).map(o => o.id).join(' ')
        : '';
      const opHint = ops ? ` <span class="text-dim">→ ${ops}</span>` : '';
      out.push(`    <span class="text-amber">${s.id}</span> <span class="${ex.cls}">${ex.label}</span>${state}${opHint}`);
    }
  }

  // The overclock tell (spec §18) — a target running hot says so to anyone
  // equipped to hear it, and this is the read that makes it actionable.
  if (target.notes?.length) {
    for (const n of target.notes) out.push(`  <span class="text-amber">${n}</span>`);
  }

  await awardSkillUse(player.id, 'nullcraft', Math.abs(check.margin));
  return { type: 'output', message: out.join('\n') + traceLine(player.id) };
}

// ── null <op> <target> <subsystem> ───────────────────────────────────────────

async function cmdNull(args, raw, player, broadcast) {
  if (!args.length) {
    const ops = getNullOperations().map(o => o.id).join(', ');
    return { type: 'error', message: `Which operation? <span class="text-dim">${ops}</span>\nUsage: <span class="text-amber">null &lt;operation&gt; &lt;target&gt; &lt;subsystem&gt;</span>` };
  }

  const opId = args[0].toLowerCase();
  const op = getNullOperation(opId);
  if (!op) {
    return { type: 'error', message: `"${args[0]}" isn't an operation. Try: <span class="text-dim">${getNullOperations().map(o => o.id).join(', ')}</span>` };
  }

  const rest = args.slice(1).join(' ').trim();
  if (!rest) return { type: 'error', message: `${op.label} what? Usage: <span class="text-amber">null ${opId} &lt;target&gt; &lt;subsystem&gt;</span>` };

  const targets = await gatherTechTargets(player, { zoneId: player.current_zone });
  if (!targets.length) return { type: 'error', message: `There's nothing powered here to work on.` };

  // The last word MAY be a subsystem id. Resolve the target from what's left, and
  // fall back to treating the whole string as the target name — so both
  // `null jam camera optics` and `null jam camera` parse without a strict grammar.
  const words = rest.split(/\s+/);
  const maybeSub = words[words.length - 1].toLowerCase();
  let target = words.length > 1 ? matchTarget(targets, words.slice(0, -1).join(' ')) : null;
  let subName = target ? maybeSub : null;
  if (!target) { target = matchTarget(targets, rest); subName = null; }
  if (!target) return { type: 'error', message: `There's nothing here called "${rest}".` };

  const subs = target.subsystems || [];
  const subsystem = subName
    ? subs.find(s => s.id.toLowerCase() === subName) || subs.find(s => s.id.toLowerCase().startsWith(subName))
    : null;

  if (!subsystem) {
    const usable = subs.filter(s => op.appliesTo.has(s.kind)).map(s => s.id);
    return { type: 'error', message: usable.length
      ? `Which part of ${target.name}? <span class="text-dim">${usable.join(', ')}</span>`
      : `There's nothing on ${target.name} you can ${opId}.` };
  }

  const refusal = operationRefusal(player, target, subsystem, opId);
  if (refusal) return { type: 'error', message: refusal };

  // Lockout — spec §11's "how long do I stay inside this system" made real.
  if (traceOf(player.id) >= TRACE_LOCKOUT) {
    return { type: 'error', message: `<span class="text-red">You're too hot. Everything you touch is closing before you reach it.</span> Give it a few minutes.` };
  }

  const skill = await nullcraftLevel(player);
  if (skill < op.minSkill) {
    return { type: 'error', message: `You know what ${op.label.toLowerCase()} means. You do not know how to do it.` };
  }

  // ── Arm the board ─────────────────────────────────────────────────────────
  // The intrusion is PLAYED, not rolled. The pending operation is parked in RAM
  // under a nonce and `nullresolve` completes it, which is the same shape every
  // other minigame family uses: the server hands over the two numbers that scale
  // the game and is told the outcome.
  //
  // `{ skill: 'nullcraft' }` is not optional. textRender defaults to `hacking`,
  // and the log rung would otherwise grade a different competence than the other
  // two rungs — minigame.js:71 says so explicitly.
  // The rig in your hands cancels points of the target's security. Applied here
  // rather than inside operationDifficulty because the substrate must stay free
  // of inventory reads — it is sync-by-contract and this is one query on a
  // deliberate action.
  const device = await getNullDevice(player.id);
  const difficulty = Math.max(1, operationDifficulty(target, subsystem, opId) - nullIntrusion(device));
  const opNonce = `${player.id}:${Date.now().toString(36)}`;
  pending.set(player.id, {
    nonce: opNonce, targetKey: target.key, opId,
    subsystemId: subsystem.id, difficulty, at: Date.now(),
    // The resolved target is held so the consequence lands on the SAME object
    // that was analysed — re-gathering at resolve time would let a player arm
    // against one camera and cash out against another.
    target, subsystem,
  });

  return await textRender(player, {
    type: 'null_intrusion',
    opId: opNonce,
    deviceName: target.name,
    subsystem: subsystem.id,
    operation: op.label,
    skill,
    difficulty,
    resolveCmd: 'nullresolve',
  }, { skill: 'nullcraft' });
}

// Pending intrusions, keyed by player. One at a time by construction — arming a
// second replaces the first, which is correct: you cannot be inside two machines
// at once, and a stale entry is simply overwritten rather than leaking.
const pending = new Map();
const PENDING_TTL_MS = 180_000;

async function cmdNullResolve(args, raw, player, broadcast) {
  const [nonce, wonRaw] = args;
  const p = pending.get(player.id);
  // A resolve that does not match the armed operation is not an error to explain
  // — it is a client that fell behind, or a forged one. Answer nothing.
  if (!p || p.nonce !== nonce) return { type: 'noop' };
  if (Date.now() - p.at > PENDING_TTL_MS) { pending.delete(player.id); return { type: 'noop' }; }
  pending.delete(player.id);

  const { target, subsystem, opId } = p;
  const op = getNullOperation(opId);
  const won = String(wonRaw) === '1';

  // Trace accrues when the operation actually HAPPENS, not when the board opens.
  // Arming and then closing the panel must cost nothing, or a player is punished
  // for looking at a thing and changing their mind.
  //
  // A stealthy rig buys TIME inside a system rather than power over it: the same
  // skill gets more done per visit, and nothing about the target gets weaker.
  const stealth = nullStealth(await getNullDevice(player.id));
  addTrace(player.id, op.traceCost * (1 - stealth), op.traceCost);

  // The board decided; the server still owns the margin the skill learns from.
  // marginOf is the same helper every breach path uses — you learn at the edge
  // of your ability and nothing from a walkover.
  const margin = marginOf(await nullcraftLevel(player), p.difficulty);
  await awardSkillUse(player.id, 'nullcraft', margin);

  if (!won) {
    await failureReaction(player, target, subsystem, opId, { margin: -margin }, broadcast);
    return { type: 'output', message:
      `<span class="text-red">${target.name} holds.</span> The ${subsystem.id} shrugs you off.${traceLine(player.id)}` };
  }

  // THE CONTRIBUTOR APPLIES. This file never touches the target's own state.
  const result = await target.apply(opId, subsystem, { player, broadcast });

  // Transient operations are held here, in RAM, on a timestamp. Persistent and
  // durable ones were written by the contributor above and must NOT also be
  // recorded here — that would be the second copy this whole design refuses.
  //
  // The hold is scaled off how far the player was ahead of the difficulty rather
  // than off the board's own margin: the board reports a boolean, and inventing
  // a margin from it would be a second, quieter difficulty model.
  if (op.kind === 'transient') {
    suppressSubsystem(target.key, subsystem.id, opId, holdFor(margin), player.id);
  }

  // The owner is told when the trace is high enough, or when the operation is
  // simply too loud to miss. A crash always announces itself — a rebooting limb
  // is not a subtle event, and pretending otherwise would make `crash` strictly
  // better than `lock` instead of louder than it.
  const loud = op.kind !== 'transient' || opId === 'crash';
  if (result?.ownerMessage && target.ownerId && target.ownerId !== player.id
      && (loud || traceOf(player.id) >= TRACE_ALERT)) {
    sendToPlayer(target.ownerId, { type: 'message', message: result.ownerMessage });
  }

  return { type: 'output', message:
    (result?.message || `<span class="msg-system">${target.name} — ${subsystem.id} ${op.label.toLowerCase()}ed.</span>`)
    + traceLine(player.id) };
}

// ── Hardware ─────────────────────────────────────────────────────────────────

// Spend one unit of a consumable inventory row. Small and local on purpose:
// `burnCharge` is the PACK model (a tin of ten), and a charge is not a pack.
async function spendOne(row) {
  if (!row) return false;
  if (row.quantity > 1) await query('UPDATE player_inventory SET quantity = quantity - 1 WHERE id = $1', [row.id]);
  else await query('DELETE FROM player_inventory WHERE id = $1', [row.id]);
  return true;
}

// How long one cell runs the field. Short enough that a jammer is a decision you
// keep making rather than a state you switch on in the morning — which is what
// stops "always be jamming" from being the correct play.
const JAM_RUN_MS = 240_000;

async function cmdJammer(args, raw, player) {
  const sub = (args[0] || '').toLowerCase();
  const running = jammerOf(player.id);

  if (sub === 'off' || sub === 'stop') {
    if (!running) return { type: 'error', message: `You aren't running one.` };
    stopCarriedJammer(player.id);
    return { type: 'output', message: `<span class="msg-system">You kill the field. The room's radios come back, one at a time.</span>` };
  }

  if (!sub || sub === 'status') {
    if (!running) return { type: 'output', message: `<span class="text-dim">No field running.</span>` };
    const left = Math.max(0, Math.round((running.until - Date.now()) / 1000));
    return { type: 'output', message:
      `<span class="msg-system">Field up — strength ${running.strength}%, ${left}s of cell left.${running.selective ? ' Selective.' : ''}</span>` };
  }

  if (sub !== 'on' && sub !== 'start') {
    return { type: 'error', message: `Usage: <span class="text-amber">jammer on|off|status</span>` };
  }

  const device = await getNullDevice(player.id);
  const jam = nullJam(device);
  if (!device || jam.strength <= 0) {
    return { type: 'error', message: `You're not carrying anything that puts out a field.` };
  }

  const cell = await resolveInventoryItem(player.id, { tag: 'jammer_cell' });
  if (!cell) return { type: 'error', message: `The ${device.name} is dry. It needs a jammer cell.` };
  await spendOne(cell);

  setCarriedJammer(player.id, {
    zoneId: player.current_zone,
    strength: jam.strength,
    radius: jam.radius,
    selective: jam.selective,
    durationMs: JAM_RUN_MS,
  });
  // Running a field makes YOU loud. That is the whole cost of the blunt version:
  // nobody can see through the noise, and everybody can tell where it comes from.
  addTrace(player.id, 0, jam.selective ? 4 : 20);

  return { type: 'output', message: jam.selective
    ? `<span class="msg-system">The ${device.name} narrows onto one carrier. Everything else in the room keeps working — which is the expensive part.</span>`
    : `<span class="msg-system">The ${device.name} floods the band. Every radio in here goes to static, including the ones you like.</span>` };
}

// How long a scrambler holds you blurry. Deliberately short — a veil is a window
// you open to do something specific, not a coat you wear.
const VEIL_MS = 150_000;

async function cmdVeil(args, raw, player) {
  if ((args[0] || '').toLowerCase() === 'off') {
    clearVeil(player.id);
    return { type: 'output', message: `<span class="msg-system">You let your signature settle back into shape.</span>` };
  }

  const device = await getNullDevice(player.id);
  const strength = nullStealth(device);
  if (!device || strength <= 0) {
    return { type: 'error', message: `You'd need a scrambler, or something like one.` };
  }

  const cell = await resolveInventoryItem(player.id, { tag: 'jammer_cell' });
  if (!cell) return { type: 'error', message: `The ${device.name} has nothing to run on. It needs a jammer cell.` };
  await spendOne(cell);

  setVeil(player.id, strength, VEIL_MS);
  return { type: 'output', message:
    `<span class="msg-system">The ${device.name} warms against your chest. You do not vanish — nothing does. `
    + `Every lens in the district simply stops being sure it saw anything worth writing down.</span>` };
}

async function cmdEmp(args, raw, player, broadcast) {
  const charge = await resolveInventoryItem(player.id, { tag: 'emp_charge' });
  if (!charge) return { type: 'error', message: `You aren't carrying an EMP charge.` };
  await spendOne(charge);

  broadcast?.(player.current_zone, { type: 'zone_event', message:
    `<span class="text-amber">A flat crack of static, and every light in the room browns for a second.</span>` }, null);

  // The SAME pulse the ion storm fires, scoped to this room — same fry rule, same
  // faraday-bag exemption, same chrome blackout, same bench repair. It takes the
  // thrower's own gear too unless it is shielded, and that is the entire tactical
  // decision rather than an oversight.
  emit('weather.empPulse', { minutes: 1, zoneId: player.current_zone });
  addTrace(player.id, 6, 30);

  return { type: 'output', message:
    `<span class="msg-system">You crack the charge. It doesn't care whose pockets it is in.</span>${traceLine(player.id)}` };
}

// ── Failure has consequences (spec §30) ──────────────────────────────────────
//
// The reaction scales with how badly it went and how well defended the thing was.
// Deliberately ordered cheapest-first so an early Null fails informatively and a
// veteran poking Ascendant milspec fails expensively.
async function failureReaction(player, target, subsystem, opId, check, broadcast) {
  const security = Number(target.security?.rating) || 0;
  const badness = Math.abs(Math.min(0, check.margin));

  // Every failure raises trace beyond the operation's own cost. Getting caught
  // trying is worse than succeeding, which is what makes recon worth the time.
  addTrace(player.id, 2 + badness / 2, 1);

  // A hard failure against defended hardware burns the deck — through the
  // EXISTING funnel, so the band the player is told about is the one repair and
  // examine already read.
  if (badness >= 4 && security >= 30) {
    const line = await damageHackDeck(player.id);
    if (line) sendToPlayer(player.id, { type: 'message', message: `<span class="text-red">${line.trim()}</span>` });
  }

  // The owner notices a clumsy attempt on their own body before a subtle one.
  if (target.ownerId && target.ownerId !== player.id && (badness >= 3 || traceOf(player.id) >= TRACE_ALERT)) {
    sendToPlayer(target.ownerId, { type: 'message', message:
      `<span class="text-amber">Your ${target.name} reports a handshake you did not authorise.</span>` });
  }

  // Let the owning plugin have its own say — a camera turning to look at you, a
  // turret waking up. Optional by design: a contributor with nothing to add
  // simply doesn't implement it, and the generic reaction above still fired.
  if (typeof target.onFailure === 'function') {
    try { await target.onFailure({ player, subsystem, opId, check, broadcast }); }
    catch { /* a contributor's reaction must never break the verb */ }
  }
}

// Runtime state is per-session by design (see the substrate header) — drop it.
// `player.logout` carries { id, handle }.
on('player.logout', ({ id }) => { if (id) { forgetPlayer(id); pending.delete(id); } });

// ── the door ─────────────────────────────────────────────────────────────────
//
// NULLCRAFT IS THE NULL'S LADDER AND NOBODY ELSE'S. The Ascendants sell chrome,
// the Wildblood hand out flasks, the Long Watch teach — and each of those is a
// commitment you make before you get the thing. This is the same: you do not
// pick nullcraft up as a hobby, you go and become one of them.
//
// The refusal is a bare `Unknown command.`, the convention psionics already
// keeps, and for the same reason: a surface you cannot reach should not
// advertise itself. A player who has never met the Null has no idea the verb
// exists, which is the correct amount for them to know.
//
// ⚠ THE SKILL IS NOT THE GATE. `nullcraftLevel` still decides how WELL you do
// this; standing decides WHETHER you may. Collapsing the two — gating on the
// skill alone — is what the system did before, and it let anyone who put a
// point in a skill walk through a faction's whole identity.
const NULL_ORDER = 'ideology_null';
// `known`, matching the floor chrome sits behind. Anything lower is not a gate:
// a character who has never met the Null already sits at neutral.
const INITIATE_REP = 200;

async function isInitiated(player) {
  if (!player?.id) return false;
  return (await getReputation(player.id, NULL_ORDER)) >= INITIATE_REP;
}

// One wrapper rather than a check pasted into seven handlers, so a verb added
// later cannot forget it. Awaiting a rep read here is affordable: these are
// deliberate player actions, never a tick and never the swing path.
const initiatesOnly = (fn) => async (args, raw, player, broadcast) => {
  if (!(await isInitiated(player))) return { type: 'error', message: 'Unknown command.' };
  return fn(args, raw, player, broadcast);
};

export const commands = {
  nullscan: initiatesOnly(cmdNullscan),
  analyze: initiatesOnly(cmdAnalyze),
  null: initiatesOnly(cmdNull),
  nullresolve: initiatesOnly(cmdNullResolve),
  jammer: initiatesOnly(cmdJammer),
  veil: initiatesOnly(cmdVeil),
  emp: initiatesOnly(cmdEmp),
};

export const _test = {
  cmdNullscan, cmdAnalyze, cmdNull, cmdNullResolve, failureReaction,
  securityBand, exposureBand, holdFor, pending,
  isInitiated, initiatesOnly, NULL_ORDER, INITIATE_REP,
};
