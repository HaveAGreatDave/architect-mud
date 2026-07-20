/**
 * Consume plugin — drinking and smoking as a timed act, not an instant hit.
 *
 * Beer, cigarettes and joints aren't downed in a single tick: you crack the beer,
 * take a couple of pulls, and drain it; you spark a cigarette, draw on it, and
 * grind out the butt. The physical act plays out over ~12–18 seconds with varied
 * narration, and the drug EFFECT lands at the very end (the useDrug call, the
 * intox meter, the cool-reaction, appetite suppression, tolerance — all of it).
 *
 * How it hooks in: the engine's cmdUse offers every non-inline drug to this
 * plugin via the `consume.begin` Action (registerAction/dispatchAction — the
 * cross-plugin path, no import coupling into cmdUse). This plugin decides by drug
 * CATEGORY whether to defer:
 *   • flags.alcoholic → a drink   • flags.smokeable → a cigarette   • flags.cannabis → a joint
 * Anything else returns { passthrough:true } and cmdUse consumes it instantly as
 * before. Category flavour lives here (like the smoking/cannabis line pools),
 * driven entirely by existing content flags — no drug-row edits required.
 *
 * The item is HELD (never burned) until the finish timer fires, which calls back
 * into the engine's finishConsume (re-queried fresh, so a row dropped mid-drink
 * isn't applied off a stale snapshot). Moving interrupts you; starting a second
 * slow consume is blocked; death/logout clears the timers. All state is the
 * in-memory `player._consume`, cleared on death/logout like other runtime fields.
 */
import { registerAction } from '../../server/engine/actions.js';
import { getDrugCache } from '../../server/engine/drugs.js';
import { finishConsume, finishConsumeItem } from '../../server/engine/commands/inventory.js';
import { sendToPlayer, sendToZone } from '../../server/engine/messaging.js';
import { getAllLivePlayers } from '../../server/engine/world.js';
import { applyThirst } from '../../server/engine/bodily.js';
import { query } from '../../server/models/db.js';
import { on } from '../../server/engine/events.js';

const pick = (arr) => arr[Math.floor(Math.random() * arr.length)];
// n distinct random draws (or the whole pool if it's smaller).
function sample(arr, n) {
  const pool = [...arr];
  const out = [];
  while (out.length < n && pool.length) out.push(pool.splice(Math.floor(Math.random() * pool.length), 1)[0]);
  return out;
}
const fill = (s, name) => s.replace(/\{name\}/g, name);
const sys = (s) => `<span class="msg-system">${s}</span>`;

// --- category config ---------------------------------------------------------
// `seconds` = whole act; `steps` = intermediate lines dribbled evenly across it.
const CONFIG = {
  drink: {
    seconds: 12,
    steps: 2,
    zoneStart: ['{who} cracks open a drink.', '{who} pops the cap off a bottle.'],
    start: [
      'You crack the cap off the {name} with a hiss.',
      'You twist the top off the {name} and it fizzes up at you.',
      'You pop the {name} open and take the first cold pull.',
    ],
    mid: [
      'You tip it back and take a long pull.',
      'You swallow, then take another swig.',
      'You drink deep, foam clinging to your lip.',
      'You guzzle a couple of mouthfuls.',
      'You knock back another gulp.',
    ],
    finish: [
      'You drain the last of the {name} and set the empty down with a clink.',
      'You tip the {name} back, drain it dry, and toss the empty aside.',
      'You finish the {name} in one last swallow and wipe your mouth.',
    ],
    interrupt: 'You lower the {name} mid-swig, the drink left unfinished.',
    examineSelf: 'You are nursing a drink.',
    examineOther: 'They are nursing a drink.',
  },
  smoke: {
    seconds: 15,
    steps: 3,
    zoneStart: ['{who} lights a cigarette.', '{who} sparks up a smoke.'],
    start: [
      'You shake a cigarette loose, put it to your lips, and spark it.',
      'You tap a cigarette from the pack and light up, cupping the flame.',
      'You flick the lighter and get the cigarette going with a first slow drag.',
    ],
    mid: [
      'You take a slow drag and let the smoke curl out.',
      'You draw on it, the tip glowing orange.',
      'Ash builds on the end; you tap it off.',
      'You exhale a thin grey stream and watch it drift.',
    ],
    finish: [
      'You take the last drag and grind the butt out underfoot.',
      'You suck it down to the filter and flick the butt away.',
      'You finish the cigarette, crush it out, and blow the last of the smoke.',
    ],
    interrupt: 'You take the cigarette from your lips, the moment broken.',
    examineSelf: 'You are working on a cigarette.',
    examineOther: 'They are smoking a cigarette.',
  },
  joint: {
    seconds: 18,
    steps: 3,
    zoneStart: ['{who} sparks up a joint.', '{who} lights a joint, and the smell rolls out.'],
    start: [
      'You spark the joint and draw the first slow lungful.',
      'You light the twisted end and pull gently until it catches.',
      'You put the joint to your lips and get it burning.',
    ],
    mid: [
      'You take a long toke and hold it.',
      'You pull again, the cherry crackling softly.',
      'Smoke leaks from the corner of your mouth as you inhale.',
      'You pass it to yourself — nobody else is offering — and toke.',
    ],
    finish: [
      'You smoke it down to the roach and pinch it out.',
      'You take the last toke, cough softly, and stub out the roach.',
      'You burn the joint down to nothing and flick the roach away.',
    ],
    interrupt: 'You lower the joint, the moment gone, and let it smoulder.',
    examineSelf: 'You are working on a joint, eyes going soft.',
    examineOther: 'They are smoking a joint.',
  },
};

function categoryOf(drug) {
  const f = drug?.flags || {};
  if (f.alcoholic) return 'drink';
  if (f.smokeable) return 'smoke';
  if (f.cannabis)  return 'joint';
  return null;
}

// The drink's whole thirst restore (structured `effects.instant.thirst` or a flat
// `effects.thirst`). This is the total we dole out one sip at a time.
function thirstOf(drug) {
  const eff = drug?.effects || {};
  const instant = eff.instant || eff;
  return Math.max(0, Number(instant.thirst) || 0);
}

// Credit one sip's worth of thirst mid-drink: bump the meter + bladder in memory,
// persist (a rare, player-driven write, not a hot path), push the meter to the
// client, and return a "+N Thirst." note to tack onto the sip line. The full
// restore is skipped at finish (skipThirstRestore) so this never double-counts.
function creditThirst(player, amount) {
  amount = Math.max(0, Math.round(amount));
  if (!amount) return '';
  applyThirst(player, amount);
  query('UPDATE players SET thirst=$1, hydration_load=$2 WHERE id=$3',
    [player.thirst, player.hydration_load, player.id]).catch(() => {});
  sendToPlayer(player.id, { type: 'player_update', thirst: player.thirst });
  return ` +${amount} Thirst.`;
}

// One evenly-sized sip from the running total, capped at whatever's left.
function sip(player) {
  const c = player?._consume;
  if (!c || !c.thirstPer) return '';
  const amount = Math.min(c.thirstPer, c.thirstTotal - c.thirstApplied);
  c.thirstApplied += Math.max(0, amount);
  return creditThirst(player, amount);
}

// --- lifecycle ---------------------------------------------------------------

function clearConsume(player) {
  if (!player?._consume) return;
  for (const t of player._consume.timers) clearTimeout(t);
  player._consume = null;
}

function interrupt(player) {
  const c = player?._consume;
  if (!c) return;
  const line = fill(CONFIG[c.category].interrupt, c.name);
  clearConsume(player);
  sendToPlayer(player.id, { type: 'output', message: sys(line) });
}

async function finish(player, broadcast) {
  const c = player?._consume;
  if (!c) return;
  player._consume = null;   // finish is the last timer; the mids already fired
  // The last swallow lands the drug and pours out whatever thirst the earlier
  // sips didn't cover — with skipThirstRestore so the dose doesn't add it again.
  const drink = c.category === 'drink';
  const finishNote = drink ? creditThirst(player, c.thirstTotal - c.thirstApplied) : '';
  const finisher = c.kind === 'item' ? finishConsumeItem : finishConsume;
  const result = await finisher(player, c.itemRowId, broadcast, {
    takeLine: sys(fill(c.finishLine, c.name) + finishNote),
    suppressComeupMessage: !drink,
    skipThirstRestore: drink,
  });
  if (!result) {
    sendToPlayer(player.id, { type: 'output', message: sys('You reach for it — but it is gone.') });
    return;
  }
  if (result.message) sendToPlayer(player.id, { type: 'output', message: result.message });
  if (result.player_update) sendToPlayer(player.id, { type: 'player_update', ...result.player_update });
}

// --- consume.begin action (called by the engine cmdUse) ----------------------

registerAction({
  type: 'consume.begin',
  handler: async ({ actor: player, params, context }) => {
    const { item } = params;
    const broadcast = context.broadcast;
    // Two shapes reach here: a drug-item drink/smoke/joint (kind 'drug', category
    // read off the drug row), or a laced *alcoholic* consumable (kind 'item' — a
    // cocktail whose thirst lives on the item, not a drug). Both drink over time.
    const kind = params.itemKind === 'item' ? 'item' : 'drug';
    const drug = getDrugCache()[item.drug_id];
    const category = kind === 'item' ? 'drink' : categoryOf(drug);
    if (!category) return { passthrough: true };   // not a slow-consume drug → cmdUse handles it instantly
    if (player._consume) return { type: 'error', message: "You're still working on that. Finish it first." };

    const cfg = CONFIG[category];
    const raw = params.cd?.name || item.name || 'it';
    const name = category === 'drink' ? raw.toLowerCase() : raw;

    const startLine = fill(pick(cfg.start), name);
    const midLines = sample(cfg.mid, cfg.steps).map(m => fill(m, name));
    const finishLine = pick(cfg.finish);

    // Split a drink's thirst restore evenly across every drinking action —
    // start + each mid + the finish — so you gain a slice per sip instead of the
    // whole lot on the last swallow. Non-drinks (smoke/joint) carry no thirst.
    // Drug-drinks read it off the drug; laced cocktails off the item's restore.
    const thirstTotal = category !== 'drink' ? 0
      : kind === 'item' ? (Math.max(0, Number(item.tags?.restore_thirst) || 0)) : thirstOf(drug);
    const thirstSteps = cfg.steps + 2;   // start, the mids, finish
    const thirstPer = Math.round(thirstTotal / thirstSteps);

    const total = cfg.seconds * 1000;
    const timers = [];
    midLines.forEach((line, k) => {
      const t = Math.round(total * (k + 1) / (cfg.steps + 1));
      timers.push(setTimeout(() => {
        if (player._consume) sendToPlayer(player.id, { type: 'output', message: sys(line + sip(player)) });
      }, t));
    });
    timers.push(setTimeout(() => { finish(player, broadcast).catch(() => {}); }, total));

    player._consume = { itemRowId: item.id, timers, finishLine, category, name, kind, thirstTotal, thirstPer, thirstApplied: 0 };
    sendToZone(player.current_zone, { type: 'zone_event', message: pick(cfg.zoneStart).replace('{who}', player.handle) }, player.id);
    return { type: 'use', message: sys(startLine + sip(player)) };
  },
});

// --- interrupts + cleanup ----------------------------------------------------

// Moving off breaks the moment — you can't walk away and still finish your drink.
on('zone.entered', ({ actor }) => { if (actor?._consume) interrupt(actor); });
on('player.death',  ({ player }) => clearConsume(player));
on('player.logout', ({ id })     => clearConsume(getAllLivePlayers().find(p => p.id === id)));

// --- examine note while consuming --------------------------------------------

export const hooks = {
  'player.appearanceNotes': ({ target, isSelf }) => {
    const c = target?._consume;
    if (!c) return undefined;
    const cfg = CONFIG[c.category];
    return isSelf ? cfg.examineSelf : cfg.examineOther;
  },
};

// Exposed for the regression suite.
export const _test = { CONFIG, categoryOf, interrupt, clearConsume, thirstOf };
