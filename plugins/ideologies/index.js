import { getPlayerIdeologyRep, adjustReputation, hydrateIdeologyProfile, PATHS } from '../../server/engine/ideologies.js';
import { classifyLean } from '../../server/engine/ideologies.js';
import { registerAction } from '../../server/engine/actions.js';
import { getFlag, setFlag, registerConditionShape } from '../../server/engine/flags.js';
import { getReputation, getTier, REP_TIERS } from '../../server/engine/ideologies.js';

/**
 * `{ ideology_rep: 'ideology_wildblood', tier: 'inner_circle' }` as a VINE
 * condition, so authored dialogue can gate on standing rather than on a quest
 * flag standing in for it.
 *
 * This existed nowhere before Phase 2 of the mutation work, which meant the only
 * way to gate a node on how an order actually felt about you was to mirror the
 * rep into a flag by hand and then keep the two in step forever. Registered here
 * rather than in flags.js because reputation is this plugin's domain, and the
 * shape registry is the seam for exactly that (server/engine/flags.js).
 *
 * `tier` takes a tier id; `min` takes a raw number. Unknown tiers fail CLOSED,
 * which is the same rule every other condition shape follows: a typo locks the
 * option rather than silently opening it.
 */
registerConditionShape('ideology_rep', async (cond, player) => {
  const id = cond.ideology_rep || cond.ideology_id;
  if (!id || !player?.id) return false;
  const rep = Number(await getReputation(player.id, id)) || 0;

  if (cond.min != null) return rep >= Number(cond.min);
  if (!cond.tier) return rep > 0;

  const want = REP_TIERS.findIndex(t => t.id === cond.tier);
  if (want < 0) return false;                       // unknown tier: fail closed
  return REP_TIERS.indexOf(getTier(rep)) >= want;
});

// One bipolar axis + a categorical path (see server/engine/ideologies.js). The
// player's stance is a signed flag; each path is a separate affinity flag. Both
// are surfaced only through the ideology they lean toward, never as raw numbers.
const STANCE_FLAG = 'stance_axis';                 // -100 renounce .. +100 redeem
const pathFlag = (p) => `path_${p}`;               // path_machine / _flesh / _mind / _human

const PATH_LABEL = {
  machine: 'the Machine — merge with technology',
  flesh:   'the Flesh — adapt the body',
  mind:    'the Mind — awaken consciousness',
  human:   'the Human way — stay as we are',
};

// An 11-cell slider with a marker for a -100..100 value.
function stanceBar(v) {
  const idx = Math.max(0, Math.min(10, Math.round((v + 100) / 200 * 10)));
  return '─'.repeat(idx) + '◆' + '─'.repeat(10 - idx);
}

async function readState(player) {
  const stance = Number(await getFlag('player', STANCE_FLAG, player)) || 0;
  const paths = {};
  for (const p of PATHS) paths[p] = Number(await getFlag('player', pathFlag(p), player)) || 0;
  return { stance, paths };
}

function strongestPath(paths) {
  let best = null, bestV = 0;
  for (const p of PATHS) if (paths[p] > bestV) { bestV = paths[p]; best = p; }
  return best;
}

async function cmdIdeologies(args, raw, player) {
  const reps = await getPlayerIdeologyRep(player.id);
  let msg = '<span class="skills-header">IDEOLOGY STANDING</span>\n\n';
  for (const f of reps) {
    if (f.expansion) {
      msg += `<span style="color:${f.color}">${f.name.padEnd(24)}</span> <span style="opacity:.7">emerging</span>\n`;
    } else {
      msg += `<span style="color:${f.color}">${f.name.padEnd(24)}</span> <span style="color:${f.tier_color}">${f.tier_label}</span> (${f.reputation})\n`;
    }
  }

  const { stance, paths } = await readState(player);
  msg += '\n<span class="skills-header">WHERE YOU STAND</span>\n\n';
  msg += `  Renounce ${stanceBar(stance)} Redeem\n`;
  msg += `  <span style="opacity:.85">is the world worth saving?</span>\n\n`;

  const top = strongestPath(paths);
  msg += `  Your path: ${top ? PATH_LABEL[top] : '<span style="opacity:.7">undecided</span>'}\n`;

  const lean = classifyLean(stance, paths, reps);
  msg += lean
    ? `\nYou lean toward <span style="color:${lean.color}">${lean.name}</span>.\n`
    : '\nYou have not yet taken a side.\n';
  return { type: 'ideologies', message: msg };
}

export const commands = {
  ideologies: cmdIdeologies,
  rep: cmdIdeologies,
};

// --- Standing-, stance- and path-shifting dialogue Actions -----------------
//
// The levers behind the "philosophical encounters." Nothing here is labelled good
// or bad; a choice just shifts where you stand. All dispatch through the canonical
// Action path (like SET_FLAG) and are authored on dialogue options via the VINE
// editor (see client/devpanel/js/vine/vine-action-types.js).

// ADJUST_REPUTATION {ideology_id, delta, reason?} — standing over player_ideology_rep.
registerAction({
  type: 'ADJUST_REPUTATION',
  handler: async ({ actor, params }) => {
    const ideologyId = params.ideology_id || params.faction_id || params.faction;
    const delta = Number(params.delta) || 0;
    if (!actor?.id || !ideologyId) {
      return { type: 'error', message: 'ADJUST_REPUTATION requires an actor and ideology_id.' };
    }
    const res = await adjustReputation(actor.id, ideologyId, delta, params.reason || 'dialogue');
    return { type: 'reputation', ...res };
  },
});

// ADJUST_STANCE {delta} — moves the player's stance on the world (stance_axis,
// -100 renounce .. +100 redeem). Positive = the world can be saved.
registerAction({
  type: 'ADJUST_STANCE',
  handler: async ({ actor, params }) => {
    if (!actor?.id) return { type: 'error', message: 'ADJUST_STANCE requires an actor.' };
    const delta = Number(params.delta) || 0;
    const current = Number(await getFlag('player', STANCE_FLAG, actor)) || 0;
    const next = Math.max(-100, Math.min(100, current + delta));
    await setFlag('player', STANCE_FLAG, next, actor);
    // The engine caches this profile on the live player (reputation decay reads
    // it on every vendor price lookup). The flag write is the only way it moves,
    // so this is where the cache is kept coherent — a stale profile would rest
    // an opposed player's standing at neutral.
    await hydrateIdeologyProfile(actor);
    return { type: 'stance', value: next, delta };
  },
});

// ADJUST_PATH {path, delta} — nudges affinity toward one path (machine/flesh/
// mind/human), clamped 0..100. The paths are not opposed; you can hold several
// and the strongest steers your lean.
registerAction({
  type: 'ADJUST_PATH',
  handler: async ({ actor, params }) => {
    if (!actor?.id) return { type: 'error', message: 'ADJUST_PATH requires an actor.' };
    const path = params.path;
    if (!PATHS.includes(path)) return { type: 'error', message: `ADJUST_PATH: unknown path "${path}".` };
    const delta = Number(params.delta) || 0;
    const current = Number(await getFlag('player', pathFlag(path), actor)) || 0;
    const next = Math.max(0, Math.min(100, current + delta));
    await setFlag('player', pathFlag(path), next, actor);
    await hydrateIdeologyProfile(actor);   // keep the cached profile coherent (see ADJUST_STANCE)
    return { type: 'path', path, value: next, delta };
  },
});
