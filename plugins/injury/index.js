/**
 * Injuries — wounds that outlive the fight.
 *
 * Combat already rolls a body part and resolves a damage type on every hit and
 * then throws both away. This turns them into something that persists: one
 * injury per part, three severities, healing on its own clock.
 *
 * PHASE 2 of docs/proposals/injury-system.md. Wounds appear, are named, decay,
 * and display. **Nothing penalises yet** — that is Phase 3, deliberately split
 * so this half can be played with and reverted independently.
 *
 * The design constraint that governs everything here:
 *
 *     An injury is something you NOTICE, not something you administer.
 *
 * No bar to watch, no upkeep, no consumable you are obliged to carry. Wounds
 * always heal on their own; medicine (Phase 5) only makes it faster.
 *
 * ── Read tier (docs/architecture.md) ─────────────────────────────────────────
 * ZERO queries at runtime. Injuries live on the live player object, hydrated
 * from the `injuries` player_flag (already in memory — flags.js hydrates the
 * whole flag set at login into `player._flags`), and flushed coalesced from the
 * minute tick. The damage observer is SYNCHRONOUS BY CONTRACT because it runs on
 * the combat hot path — every swing of every fight. It must never await.
 *
 * ── Decay is lazy, with no tick of its own ───────────────────────────────────
 * The `player_npc_relations` pattern: store a stamp, compute the current value
 * on read. A wound that has healed while you were logged out is already healed
 * when you look at it, and a restart cannot reset anyone's injuries.
 */
import { registerDamageObserver } from '../../server/engine/damage-events.js';
import { registerImpairmentProvider } from '../../server/engine/impairment.js';
import { AIM_PENALTY } from '../../server/engine/combat.js';
import { setFlag } from '../../server/engine/flags.js';
import { sendToPlayer, teachVerb } from '../../server/engine/messaging.js';
import { world } from '../../server/engine/world.js';
import { buildImpairment } from './penalties.js';
// Side-effect import: registers the enemy-side damage observer (§8b). Kept as a
// separate module because the two halves share only `severityFor` — the enemy
// side has no storage, no decay and no display, and mixing them would hide that.
import './enemy.js';
import { enemyWoundNote, partLabel } from './enemy.js';
import {
  PARTS, PART_LABELS, SEVERITY_LABELS, SEVERITY_BANDS,
  BRUISED, MAIMED, typeRules, injuryName,
  CRIT_THRESHOLD_SCALE, CUMULATIVE_THRESHOLD_SCALE, HEAD_THRESHOLD_SCALE,
  SLEEP_HEAL_MULTIPLIER,
} from './tables.js';

const FLAG_KEY = 'injuries';

// ── State ────────────────────────────────────────────────────────────────────
//
// player._injuries : Map<part, { sev, type, at }>   (`at` = ms stamp of the
//                    severity currently stored, moved forward as it decays)
// player._injuriesDirty : boolean, flushed by the minute tick.

// Parse lazily and SYNCHRONOUSLY out of the already-hydrated flag Map. Doing it
// on first touch rather than at login keeps this plugin off the login path
// entirely — one less thing that can slow a connect.
function injuriesOf(player) {
  if (!player) return new Map();
  if (player._injuries) return player._injuries;

  const map = new Map();
  const raw = player._flags?.get(FLAG_KEY);
  if (raw) {
    try {
      for (const [part, rec] of Object.entries(JSON.parse(raw))) {
        if (PARTS.includes(part) && rec?.sev > 0) {
          map.set(part, { sev: Number(rec.sev), type: String(rec.type || 'kinetic'), at: Number(rec.at) || Date.now() });
        }
      }
    } catch {
      // A corrupt blob reads as an uninjured body. Degraded, never broken —
      // and never worth failing a login or a swing over.
    }
  }
  player._injuries = map;
  return map;
}

// Apply elapsed-time healing in place. Called by every reader, which is what
// makes this tick-free: nothing decays until someone looks.
//
// Returns true if anything actually changed, so callers can mark dirty.
function decay(player, now = Date.now()) {
  const map = injuriesOf(player);
  if (!map.size) return false;
  let changed = false;

  for (const [part, rec] of map) {
    const stepMs = typeRules(rec.type).healMins * 60_000;
    const steps = Math.floor((now - rec.at) / stepMs);
    if (steps <= 0) continue;

    const sev = rec.sev - steps;
    if (sev <= 0) {
      map.delete(part);
    } else {
      rec.sev = sev;
      // Advance the stamp by the steps CONSUMED, not to `now` — otherwise a
      // wound that sat unread for a day would lose only one rung and then
      // restart its clock, healing slower the less you looked at it.
      rec.at += steps * stepMs;
    }
    changed = true;
  }
  return changed;
}

// ── Public read API (sync, query-free) ───────────────────────────────────────

/** Current injuries as an array, freshest state first. Never returns healed rows. */
export function injuryReport(player) {
  if (decay(player)) player._injuriesDirty = true;
  const out = [];
  for (const [part, rec] of injuriesOf(player)) {
    out.push({
      part,
      partLabel: PART_LABELS[part] || part,
      severity: rec.sev,
      severityLabel: SEVERITY_LABELS[rec.sev] || 'Injured',
      band: SEVERITY_BANDS[rec.sev] || 'warn',
      type: rec.type,
      name: injuryName(rec.type, rec.sev, part),
    });
  }
  return out.sort((a, b) => b.severity - a.severity);
}

/** Severity integer for one part (0 = uninjured). The hot-path read for Phase 3. */
export function severityOf(player, part) {
  decay(player);
  return injuriesOf(player).get(part)?.sev || 0;
}

/**
 * All seven parts, injured or not — the shape the Vitals paper doll wants. An
 * uninjured part is present and `good`, so the client renders a whole body
 * rather than a scatter of marks.
 */
export function bodyReport(player) {
  const byPart = new Map(injuryReport(player).map(i => [i.part, i]));
  return PARTS.map(part => {
    const inj = byPart.get(part);
    if (!inj) {
      return { part, partLabel: PART_LABELS[part], severity: 0, band: 'good', name: null, detail: null };
    }
    return { ...inj, detail: `${cap(inj.partLabel)} — ${inj.name}. ${flavour(inj)}` };
  });
}

const cap = s => String(s || '').charAt(0).toUpperCase() + String(s || '').slice(1);

// What the wound is actually costing you, in the player's own terms. These must
// stay true to `penalties.js` — a detail line that promises a penalty the engine
// doesn't apply is worse than no line at all.
const CONSEQUENCE = {
  head:      { 2: 'Thinking is slower than it should be.', 3: 'You cannot think straight and your hands shake.' },
  torso:     { 2: 'Breathing hurts. You get your wind back slowly.', 3: 'Every breath is short. Recovery is a crawl.' },
  left_arm:  { 2: 'Your swing goes wide.', 3: 'You can barely lift it. Everything you swing misses.' },
  right_arm: { 2: 'Your swing goes wide.', 3: 'You can barely lift it. Everything you swing misses.' },
  left_leg:  { 2: 'You are limping. Walking costs more.', 3: 'It will not take your weight. You cannot run.' },
  right_leg: { 2: 'You are limping. Walking costs more.', 3: 'It will not take your weight. You cannot run.' },
  feet:      { 2: 'Every step is a wince.', 3: 'You cannot run on these.' },
};

function flavour(inj) {
  if (inj.severity === BRUISED) return 'Sore, nothing worse.';
  return CONSEQUENCE[inj.part]?.[inj.severity] || 'It hurts to use.';
}

// ── Writing (the hot path) ───────────────────────────────────────────────────

/**
 * Severity a hit of this size would inflict, ignoring what's already there.
 * Exported for the regress suite and for tuning — this is the function you poke
 * when kinetic feels wrong.
 */
export function severityFor(damage, hpMax, type, { critical = false, existing = 0, head = false } = {}) {
  const rules = typeRules(type);
  const frac = damage / Math.max(1, hpMax);

  let threshold = rules.threshold;
  if (critical) threshold *= CRIT_THRESHOLD_SCALE;
  if (rules.cumulative && existing > 0) threshold *= CUMULATIVE_THRESHOLD_SCALE;
  if (head) threshold *= HEAD_THRESHOLD_SCALE;

  if (frac < threshold) return 0;
  // Geometric rungs: each severity costs a MULTIPLE of the bar, not a flat slice
  // of max HP. Damage far above the threshold tapers instead of guaranteeing a
  // maim — see the balance note in tables.js for the numbers that forced this.
  const rungs = Math.log(frac / threshold) / Math.log(rules.step);
  return Math.min(MAIMED, BRUISED + Math.floor(rungs));
}

// The observer. SYNC BY CONTRACT — no awaits, no queries, no exceptions that
// escape (damage-events catches, but don't rely on it).
function onDamage(player, { part, damage, baseDamage, type, critical, forceSeverity }) {
  if (!part || !PARTS.includes(part) || !(damage > 0)) return;

  const map = injuriesOf(player);
  decay(player);

  const existing = map.get(part);
  // Score the BASE blow, not the crit/head-inflated one — those two are threshold
  // modifiers here and would otherwise count twice. `baseDamage` is optional so an
  // older or third-party damage source still works, just slightly hot.
  const scored = baseDamage > 0 ? baseDamage : damage;
  // `forceSeverity` is the one override: a called head shot that met every
  // condition but the damage floor ruins the skull outright rather than rolling
  // for it. Combat decided; this is not a second opinion.
  const sev = forceSeverity > 0
    ? Math.min(MAIMED, forceSeverity)
    : severityFor(scored, player.hp_max || 100, type, {
        critical, existing: existing?.sev || 0, head: part === 'head',
      });
  if (sev <= 0) return;

  // A second wound DEEPENS rather than stacks — one injury per part, forever.
  // Taking the max also means a graze can never downgrade a fracture.
  const next = Math.max(sev, existing?.sev || 0);
  const worsened = !existing || next > existing.sev;

  map.set(part, {
    sev: next,
    // The type that caused the CURRENT severity owns the name and the heal rate.
    type: worsened ? (type || existing?.type || 'kinetic') : existing.type,
    // Reset the clock only when it actually got worse; otherwise a flurry of
    // harmless grazes would keep a bad wound fresh forever.
    at: worsened ? Date.now() : existing.at,
  });
  player._injuriesDirty = true;

  if (worsened) announceWound(player, part, next, type || 'kinetic');
}

// ── Telling the player ───────────────────────────────────────────────────────
//
// The governing sentence of this design is "an injury is something you NOTICE,
// not something you administer." Until this existed it was the opposite: wounds
// accrued in total silence and you only found out by typing `injuries` or
// opening Vitals. A field was set for this and read by nothing.
//
// Announced from the observer, at the moment it happens, because that is the
// only moment it means anything. `sendToPlayer` is a synchronous socket write,
// so this respects the sync/query-free contract — the same way durability
// announces a band change from the combat hot path.
const SEVERITY_CLASS = { 1: 'ambient', 2: 'dmg-taken', 3: 'crit-tag-in' };
const TAUGHT_FLAG = 'taught_injuries';

function announceWound(player, part, sev, type) {
  const label = PART_LABELS[part] || part;
  const name = injuryName(type, sev, part);
  const cls = SEVERITY_CLASS[sev] || 'ambient';

  // Bruised is flavour and says so quietly; Maimed is the loudest thing that can
  // happen to you short of dying.
  const line = sev >= MAIMED
    ? `<span class="${cls}">Your ${label} is ${name}. Something has gone badly wrong in there.</span>`
    : sev === BRUISED
      ? `<span class="${cls}">Your ${label} is ${name} — sore, nothing worse.</span>`
      : `<span class="${cls}">Your ${label} is ${name}.</span>`;

  // First wound ever: teach the verb that explains the rest, once, using the
  // house shimmer convention. Read is sync off the hydrated flag cache; the
  // write is fire-and-forget because nothing downstream depends on it landing.
  let teach = '';
  if (!player._flags?.get(TAUGHT_FLAG)) {
    teach = ` <span class="ambient">(${teachVerb('injuries')} to take stock of yourself.)</span>`;
    setFlag('player', TAUGHT_FLAG, '1', player).catch(() => {});
  }

  sendToPlayer(player.id, { type: 'output', message: line + teach });
}

// ── Persistence ──────────────────────────────────────────────────────────────

function serialize(map) {
  const obj = {};
  for (const [part, rec] of map) obj[part] = { sev: rec.sev, type: rec.type, at: rec.at };
  return JSON.stringify(obj);
}

/**
 * Clear wounds outright — the SURGICAL tier, and the one thing no field kit can
 * do (they all floor at Bruised). Called by the clinic plugin after it takes the
 * money. Returns the parts actually treated so the caller can price and describe
 * it; an empty array means there was nothing to charge for.
 */
export function clearInjuries(player, { parts = null, minSeverity = 1 } = {}) {
  const map = injuriesOf(player);
  decay(player);
  const cleared = [];
  for (const [part, rec] of [...map]) {
    if (parts && !parts.includes(part)) continue;
    if (rec.sev < minSeverity) continue;
    cleared.push({ part, partLabel: PART_LABELS[part] || part, severity: rec.sev, name: injuryName(rec.type, rec.sev, part) });
    map.delete(part);
  }
  if (cleared.length) player._injuriesDirty = true;
  return cleared;
}

export async function flushInjuries(player) {
  if (!player?._injuriesDirty) return;
  player._injuriesDirty = false;
  const map = injuriesOf(player);
  try {
    await setFlag('player', FLAG_KEY, serialize(map), player);
  } catch (e) {
    player._injuriesDirty = true;   // try again next tick rather than losing it
    console.error(`[injury] flush failed for ${player.id}: ${e.message}`);
  }
}

// ── Hooks ────────────────────────────────────────────────────────────────────

registerDamageObserver(onDamage, 'injury');

// Phase 3. Reads through `severityOf`, which decays first — so an impairment can
// never outlive the wound that caused it, with no invalidation to get wrong.
// The fast path matters: an uninjured player exits on the empty Map check inside
// `injuriesOf` before `buildImpairment` is ever called.
registerImpairmentProvider(
  (player) => (injuriesOf(player).size ? buildImpairment(player, part => severityOf(player, part)) : null),
  'injury'
);

export const hooks = {
  // One pass a minute: decay everyone, credit sleepers, flush the dirty.
  //
  // Sleeping heals faster, and it's implemented by BACKDATING the wound's stamp
  // rather than by a second decay path — a sleeping player's clock simply runs
  // fast. That keeps the lazy model intact: there is still exactly one place
  // that turns elapsed time into healing.
  'tick.minute': async () => {
    const dirty = [];
    for (const player of world.players.values()) {
      if (!player?._flags && !player?._injuries) continue;
      const map = injuriesOf(player);
      if (!map.size) { if (player._injuriesDirty) dirty.push(player); continue; }

      if (player.sleeping) {
        const bonus = (SLEEP_HEAL_MULTIPLIER - 1) * 60_000;
        for (const rec of map.values()) rec.at -= bonus;
        player._injuriesDirty = true;
      }
      if (decay(player)) player._injuriesDirty = true;
      if (player._injuriesDirty) dirty.push(player);
    }
    for (const p of dirty) await flushInjuries(p);
  },

  // MEDICINE (Phase 5). Fired by the engine's consumable path for every item
  // used, so this must be cheap and silent for the overwhelming majority that
  // are food. Nothing here is ever REQUIRED — every wound heals on its own, and
  // a kit only buys time. That is the whole reason there is no bandage upkeep.
  'item.consumed': (player, tags) => {
    const rx = tags?.treat_injury;
    if (!rx) return undefined;

    const injuries = injuryReport(player);
    if (!injuries.length) return 'Nothing on you needs it. You put it away.';

    // `types` narrows an item to the wounds it's actually for — a splint sets a
    // fracture and does nothing at all for a burn. This is what makes damage type
    // something you carry gear FOR rather than merely something that happens.
    const eligible = rx.types?.length
      ? injuries.filter(i => rx.types.includes(i.type))
      : injuries;
    if (!eligible.length) {
      return `That is the wrong thing entirely for a ${injuries[0].name} ${injuries[0].partLabel}.`;
    }

    // Improvised gear can simply fail. It's the cheap tier; it should feel cheap.
    if (rx.chance != null && Math.random() > rx.chance) {
      return 'You make a mess of it. Whatever that accomplished, it was not treatment.';
    }

    // `all` treats every eligible wound at once — which is what makes a trauma
    // kit worth its weight when you limped out of an ambush with four of them,
    // and wasted on one bruised arm.
    const targets = rx.all ? eligible : [eligible[0]];
    const map = injuriesOf(player);
    const floor = Number(rx.floor ?? BRUISED);   // field medicine can't clear a wound outright
    const treated = [];

    for (const inj of targets) {
      const rec = map.get(inj.part);
      if (!rec || rec.sev <= floor) continue;
      rec.sev = Math.max(floor, rec.sev - Number(rx.steps || 1));
      rec.at = Date.now();
      treated.push(inj.partLabel);
    }
    if (!treated.length) return 'It is as patched as anything out of a kit is going to get.';
    player._injuriesDirty = true;
    return `You work on your ${treated.join(', ')}. Better — not good, but better.`;
  },

  // §8b — what's visibly wrong with a creature you are fighting. This is the
  // feedback loop that makes aiming at a limb worth doing: you work the leg, and
  // `examine` eventually tells you the leg is ruined.
  'enemy.appearanceNotes': ({ target }) => enemyWoundNote(target) || undefined,

  // What a wound looks like from the outside. Only Maimed shows to others — a
  // bruise is not visible across a room, and this is the line that makes a bad
  // injury a social fact rather than a private number.
  'player.appearanceNotes': ({ target, isSelf }) => {
    const injuries = injuryReport(target);
    if (!injuries.length) return undefined;

    const visible = injuries.filter(i => i.severity >= MAIMED);
    if (isSelf) {
      return injuries.map(i => `Your ${i.partLabel} is ${i.name}.`).join(' ');
    }
    if (!visible.length) return undefined;
    const them = target.handle || 'They';
    return visible.map(i => `${them} is favouring a ${i.name} ${i.partLabel}.`).join(' ');
  },
};

// ── Command ──────────────────────────────────────────────────────────────────

// ── `aim` — opt-in manual body targeting ─────────────────────────────────────
//
// The whole system is optional and this is the opt-in. Automatic targeting (the
// weighted roll combat has always done) is the default and is sufficient for all
// combat; a player can finish the game without ever typing this.
//
// State is `player._aimPart`, read directly by combat.js. DELIBERATELY NOT
// PERSISTED: it resets to auto on login. That costs one flag write we don't
// have to make, removes a hydration path that could go stale, and matches how it
// reads — you re-shoulder your weapon each session rather than resuming an aim
// you set days ago and forgot about.
const AIM_ALIASES = {
  auto: null, off: null, none: null, centre: 'torso', center: 'torso',
  chest: 'torso', body: 'torso', 'centre mass': 'torso', 'center mass': 'torso',
  skull: 'head', gut: 'torso', belly: 'torso', abdomen: 'torso',
  arm: 'right_arm', leg: 'right_leg', hands: 'right_arm', foot: 'feet',
  'left arm': 'left_arm', 'right arm': 'right_arm',
  'left leg': 'left_leg', 'right leg': 'right_leg',
};

// The thing you are currently fighting, if any. Read straight off the live
// player object and the world Maps — no query, because `aim` is typed mid-fight.
function currentFoe(player) {
  if (!player?.combatTargetId) return null;
  return world.enemies?.get(player.combatTargetId) || null;
}

// A creature's targetable anatomy, in the order it was authored. Falls back to
// the humanoid spread for anything with no `body_parts` of its own — the same
// fallback `rollBodyPart` uses, so what this prints is always what you'd hit.
function foeAnatomy(foe) {
  const list = Array.isArray(foe?.body_parts) ? foe.body_parts.filter(p => p?.part) : [];
  if (list.length) return list.map(p => ({ part: p.part, label: partLabel(p.part) }));
  return PARTS.map(p => ({ part: p, label: PART_LABELS[p] }));
}

// `valid` is the anatomy of whatever you are actually fighting, so `aim middle
// left arm` works on a thresher and `aim fluke` works on a leviathan. Falls back
// to the humanoid seven when you are not fighting anything — you can still set an
// aim before the fight starts, which is the whole point of it persisting.
function resolveAimPart(raw, valid = PARTS) {
  const s = String(raw || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (!s) return { ok: false };
  if (s in AIM_ALIASES) return { ok: true, part: AIM_ALIASES[s] };
  const underscored = s.replace(/ /g, '_');
  if (valid.includes(underscored)) return { ok: true, part: underscored };
  // Prefix match, so `aim hea` works like every other verb in the game.
  const hits = valid.filter(p => p.startsWith(underscored) || partLabel(p).startsWith(s));
  if (hits.length === 1) return { ok: true, part: hits[0] };
  return { ok: false };
}

export const commands = {
  aim: (args, raw, player) => {
    const arg = (args || []).join(' ');

    if (!arg) {
      const cur = player._aimPart;
      // What you are actually looking at, if anything. Anatomy is data — most
      // things are broadly humanoid, but a leviathan is coils and a fluke and a
      // maw, and a thresher has six arms. Reading the list off the target beats
      // making the player guess what a creature is even made of.
      const foe = currentFoe(player);
      const anatomy = foe ? foeAnatomy(foe) : null;

      const head = cur
        ? `You are aiming for the <span class="hit-part">${partLabel(cur)}</span>. <span class="dmg-type">(${AIM_PENALTY[cur] ?? 0} to hit before skill)</span>`
        : 'You are not aiming anywhere in particular — you swing for whatever presents itself.';

      if (anatomy?.length) {
        // Capitalised in the list because it reads as a menu of choices, not as
        // prose — and never, ever with the underscores still in it.
        const list = anatomy
          .map(p => (p.part === cur ? `<b>${cap(p.label)}</b>` : cap(p.label)))
          .join(', ');
        return {
          type: 'info',
          message: `${head}\n\n<span class="text-dim">${foe.name} presents:</span> ${list}\n<span class="text-dim">${cur ? 'Type <b>aim auto</b> to stop calling your shots.' : 'Name any of them to call your shot.'}</span>`,
        };
      }

      return {
        type: 'info',
        message: cur
          ? `${head}\nType <b>aim auto</b> to stop calling your shots.`
          : `${head}\nTry <b>aim head</b>, <b>aim left leg</b>, or <b>aim auto</b> to go back to this.`,
      };
    }

    const foe = currentFoe(player);
    const anatomy = foe ? foeAnatomy(foe) : null;
    const validParts = anatomy ? anatomy.map(p => p.part) : PARTS;

    const { ok, part } = resolveAimPart(arg, validParts);
    if (!ok) {
      const offer = anatomy ? anatomy.map(p => p.label).join(', ') : PARTS.map(p => PART_LABELS[p]).join(', ');
      const who = foe ? `${foe.name} has no "${arg}"` : `You cannot aim for a "${arg}"`;
      return { type: 'error', message: `${who}. Try: ${offer} — or <b>auto</b>.` };
    }

    if (!part) {
      player._aimPart = null;
      return { type: 'info', message: 'You stop calling your shots and just fight.' };
    }

    player._aimPart = part;
    const cost = AIM_PENALTY[part] || 0;
    const note = cost === 0
      ? 'Centre mass is where you were swinging anyway — it costs you nothing.'
      : `Harder to land. <span class="dmg-type">(${cost} to hit, less as your weapon skill improves)</span>`;
    return {
      type: 'info',
      message: `You line up on the <span class="hit-part">${PART_LABELS[part]}</span>. ${note}`,
    };
  },

  injuries: (args, raw, player) => {
    const injuries = injuryReport(player);
    if (!injuries.length) {
      return { type: 'info', message: 'Nothing is broken. Nothing is bleeding. Enjoy it.' };
    }
    const lines = injuries.map(i =>
      `  <span class="hit-part">${i.partLabel}</span> — ${i.name} <span class="dmg-type">(${i.severityLabel.toLowerCase()})</span>`
    );
    return {
      type: 'info',
      message: `You take stock of yourself:\n${lines.join('\n')}\n\nTime will fix most of it.`,
    };
  },
};
