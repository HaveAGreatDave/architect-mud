// Dialogue node rendering — shared by the live WS dialogue handler
// (server/index.js handleDialogue) and anything else that needs to force-open
// a dialogue at a specific node (e.g. Tablet OS "Turn In" routing a player into
// the NPC's actual turn-in line, plugins/tablet/quests-app.js).
//
// Extracted so option-gating can't drift between the two places server/index.js
// used to filter a node's options (once for the freshly-rendered node, once to
// re-resolve which option a player clicked from the previous node) — both now
// call the same filterDialogueOptions().
import { dispatchAction } from './actions.js';
import { evalConditions, getFlag } from './flags.js';
import { query } from '../models/db.js';
import { getTier } from './ideologies.js';

// A "report back"/turn-in option can be authored either as an action on the
// option itself (fires immediately on click) or as an action on the node it
// leads to (fires once that node is reached) — dialogue content in this
// codebase uses the latter (see npc_registrar, npc_ma_cinder, npc_slake).
// Detect either shape so authors don't have to think about which one applies.
function actionOnOptionOrTarget(opt, tree, name) {
  const own = (opt.actions || []).find((a) => a?.action === name);
  if (own) return own;
  const target = opt.next && tree ? tree[opt.next] : null;
  return (target?.actions || []).find((a) => a?.action === name) || null;
}

function turnInQuestId(opt, tree) {
  return actionOnOptionOrTarget(opt, tree, 'TURN_IN')?.quest_id || null;
}

// What an option LEADS TO, as a single tag the client turns into a glyph, so a
// player can see "this one opens the shop / takes a job / hands one in / ends the
// conversation" instead of inferring it from the wording. Same own-action-or-target-
// node lookup turn-ins already used — dialogue in this codebase authors the action
// on either side. Order matters: an option is tagged by the most consequential
// thing it does. Mirrored for authoring preview in client/devpanel/js/vine/
// vine-dialogue-preview.js (_OPT_KINDS) — keep the two rule lists in step.
export function dialogueOptionKind(opt, tree) {
  if (isHostileOption(opt, tree)) return 'hostile';
  if (opt.next === '__shop__' || actionOnOptionOrTarget(opt, tree, 'OPEN_SHOP')) return 'shop';
  if (actionOnOptionOrTarget(opt, tree, 'TURN_IN')) return 'turnin';
  if (actionOnOptionOrTarget(opt, tree, 'START_QUEST')) return 'quest';
  if (actionOnOptionOrTarget(opt, tree, 'END_CONVERSATION')) return 'leave';
  return null;
}

// An option you can't walk back: it starts violence, gets you arrested/charged,
// raises heat, or burns reputation. Tagged FIRST (ahead of shop/quest/leave) so a
// line that both ends the conversation and swings at you reads as the swing —
// this is the one tag a player must never have to infer from the wording.
const HOSTILE_ACTIONS = ['ATTACK', 'ARREST', 'APPREHEND', 'CHARGE_CRIME', 'WANTED_RAISE', 'HEAT_RAISE'];
function isHostileOption(opt, tree) {
  if (HOSTILE_ACTIONS.some((a) => actionOnOptionOrTarget(opt, tree, a))) return true;
  const rep = actionOnOptionOrTarget(opt, tree, 'ADJUST_REPUTATION');
  return Number(rep?.delta ?? rep?.params?.delta ?? 0) < 0;
}

// One line of stakes per option kind, shown in the panel's footer band while the
// player hovers/keys onto the option — so "where does this go" is answerable
// before the click, not after. Kept on the server beside the kind rules so the
// glyph and the sentence can't drift apart.
const OPT_KIND_HINT = {
  hostile: 'This one turns ugly. There is no taking it back.',
  shop:    'Opens their stock — you can browse without buying.',
  quest:   'Takes the job on. It lands in your Tablet.',
  turnin:  'Hands the job in and settles up.',
  leave:   'Ends the conversation.',
};

// Options are gated by their authored Conditions AND, additively, an implicit
// gate on any "turn in" option, driven by the player's quest status flag. Three
// states, so a player is never offered a hand-in they can't actually make:
//   • completed              → shown and clickable (normal option)
//   • active (accepted, not
//     yet complete)          → shown but DISABLED (`_turninDisabled`); the client
//                              routes a click to the Tablet Quests screen for this
//                              quest (`_turninQuestId`) so they see what's left.
//   • unset / turned_in /
//     abandoned               → hidden entirely (never accepted, or already done).
export async function filterDialogueOptions(options, tree, player) {
  // Options gate independently, so evaluate them concurrently instead of
  // serially chaining each option's condition/flag round trips — a node with
  // several gated options used to cost ~2 sequential queries per option.
  // Order is preserved: map, then drop the nulls.
  const gated = await Promise.all((options || []).map(async (opt) => {
    if (player && !(await evalConditions(opt.conditions || opt.condition, player))) return null;
    const kind = dialogueOptionKind(opt, tree);
    const tagged = kind ? { ...opt, _kind: kind, _hint: OPT_KIND_HINT[kind] } : opt;
    const questId = turnInQuestId(opt, tree);
    if (questId && player) {
      const status = await getFlag('player', questId, player);
      if (status === 'active') {
        return { ...tagged, _turninDisabled: true, _turninQuestId: questId,
          _hint: 'Not finished yet — opens the Tablet so you can see what is outstanding.' };
      }
      if (status !== 'completed') return null;
    }
    return tagged;
  }));
  return gated.filter(Boolean);
}

// ── Speaker state: the NPC reacting, in text ───────────────────────────────────
// Two channels, both plain prose so nothing here needs art:
//   • `mood`  — how they hold you, from your reputation with the org they belong
//               to (npcs.faction is the ideology id). Tints their name plate.
//   • `stage` — a stage direction: what their body is doing as you arrive, and
//               what changed in their manner when a line of yours moved rep.
// Deliberately NOT computed on every node: one indexed single-row read, only on
// arrival (root) or on a node that actually shifted reputation. Middle-of-tree
// nodes reuse nothing and cost nothing (see the read tiers in docs/architecture.md).
const MOOD_BY_TIER = {
  hostile: 'hostile', unknown: 'cold', neutral: 'neutral',
  known: 'warm', trusted: 'warm', inner_circle: 'devoted',
};

async function speakerMood(npc, player) {
  if (!npc?.faction || !player?.id) return null;
  const { rows } = await query(
    'SELECT reputation FROM player_ideology_rep WHERE player_id = $1 AND ideology_id = $2',
    [player.id, npc.faction]
  );
  if (!rows.length) return null;
  return MOOD_BY_TIER[getTier(rows[0].reputation || 0).id] || 'neutral';
}

// How they're sitting/standing when you open on them. Posture is live runtime
// state on the NPC object (plugins/posture), so this is free.
const ARRIVAL_STAGE = {
  sitting: 'They stay seated, and let you come to them.',
  lying: 'They do not get up.',
};

// What a reputation swing looks like from the outside. The player never sees the
// number here — only the shift in the room.
function repStage(delta, tieredUp) {
  if (delta > 0) return tieredUp ? 'Something settles. You have been re-filed, upward.' : 'Their guard drops a notch.';
  return tieredUp ? 'Whatever credit you had here is spent.' : 'Something in their manner cools.';
}

// Land on `nodeKey` in an NPC's dialogue_tree for `player`: runs the node's own
// Actions (TURN_IN/GRANT_ITEM/SET_FLAG/… via the canonical dispatchAction path,
// `grants_item` kept as a legacy GRANT_ITEM shorthand) and gates its options the
// same way the live handler does. Returns null if the node doesn't exist.
export async function renderDialogueNode(npc, nodeKey, player, context) {
  const tree = npc.dialogue_tree || {};
  const node = tree[nodeKey];
  if (!node) return null;

  const actions = [...(node.actions || [])];
  if (node.grants_item?.item_id) {
    actions.push({ action: 'GRANT_ITEM', params: { item_id: node.grants_item.item_id, quantity: node.grants_item.quantity || 1 } });
  }
  let appendMessage = '';
  let resolvedQuestName = '';
  let stage = '';
  let repMoved = false;
  if (player) {
    for (const a of actions) {
      if (!a?.action) continue;
      const result = await dispatchAction({
        type: a.action,
        actor: player,
        // Dialogue actions are authored FLAT ({action, quest_id, …}) by the VINE
        // dialogue editor, so fall back to the action object itself as the params
        // bag (AI/script graphs nest under .params — hence the `|| a`).
        params: a.params || a,
        context,
      });
      if (result?.type === 'grant' && result.granted) {
        appendMessage += `\n\n<span class="item-grant">You receive: ${result.name}${result.quantity > 1 ? ` x${result.quantity}` : ''}.</span>`;
      } else if (result?.type === 'dialogue_line' && result.text) {
        appendMessage += `\n\n${result.text}`;
      } else if (result?.type === 'reputation' && result.delta) {
        // A line that cost or earned you standing shows in their manner, not in a number.
        repMoved = true;
        stage = repStage(result.delta, result.tiered_up);
      } else if (result?.type === 'quest' && result.quest_name) {
        // A generic hand-in node (Marta's job_turnin) resolved the gig itself, with no
        // Tablet OS context to name it — carry the name so `{quest}` below still fills.
        resolvedQuestName = result.quest_name;
      } else if (result?.type === 'error') {
        console.warn(`[dialogue] action ${a.action} failed: ${result.message}`);
      }
    }
  }

  const options = await filterDialogueOptions(node.options, tree, player);
  // Vendors get an implicit "Browse your wares." entry so any shopkeeper is
  // shoppable even if their dialogue never authored a shop option. Injected in
  // the SHARED renderer (not just the `talk` entry point) so the option set is
  // identical on first talk and on every return to root — otherwise the shop
  // link appears then vanishes as you navigate. Skipped when: not the root node,
  // a covert vendor (shop is passphrase-gated, never advertised), or the tree
  // already authors its own shop door (an option leading to __shop__ or to a node
  // that fires OPEN_SHOP) so we don't double it up.
  if (nodeKey === 'root' && npc.vendor_inventory?.length && !npc.flags?.covert) {
    const authorsShop = (node.options || []).some((o) =>
      o.next === '__shop__' ||
      (tree[o.next]?.actions || []).some((a) => a?.action === 'OPEN_SHOP'));
    if (!authorsShop) options.push({ label: 'Browse your wares.', next: '__shop__', _kind: 'shop' });
  }
  // `{quest}` in a node's text resolves to the quest name a generic hand-in node is
  // turning in (context.quest_name, set by Tablet OS) so the NPC can name the job.
  // A node may carry an ARRAY of interchangeable lines (e.g. an NPC's varied sign-offs);
  // pick one at random each render so repeated visits don't read from a fixed script.
  const baseText = Array.isArray(node.text) ? node.text[Math.floor(Math.random() * node.text.length)] : node.text;
  let text = baseText + appendMessage;
  const questName = context?.quest_name || resolvedQuestName;
  if (questName) text = text.replace(/\{quest\}/g, questName);

  // Mood is read on arrival and whenever a line just moved rep — the two moments
  // it can have changed. Arrival also carries the posture stage direction, unless
  // a rep swing already claimed the slot (one stage line at a time).
  const atRoot = nodeKey === 'root';
  const mood = (atRoot || repMoved) ? await speakerMood(npc, player) : null;
  if (atRoot && !stage) stage = ARRIVAL_STAGE[npc.posture] || '';

  return { text, options, stage, mood };
}
