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

// A "report back"/turn-in option can be authored either as an action on the
// option itself (fires immediately on click) or as an action on the node it
// leads to (fires once that node is reached) — dialogue content in this
// codebase uses the latter (see npc_registrar, npc_ma_cinder, npc_slake).
// Detect either shape so authors don't have to think about which one applies.
function turnInQuestId(opt, tree) {
  const own = (opt.actions || []).find((a) => a?.action === 'TURN_IN')?.quest_id;
  if (own) return own;
  const target = opt.next && tree ? tree[opt.next] : null;
  return (target?.actions || []).find((a) => a?.action === 'TURN_IN')?.quest_id || null;
}

// Options are gated by their authored Conditions AND, additively, an implicit
// gate: a "turn in" option never shows unless the quest is actually complete
// (player Flag `quest_<id> === 'completed'`) — so authors can't forget to add
// that Condition by hand and leave a "report back" choice always clickable.
export async function filterDialogueOptions(options, tree, player) {
  const out = [];
  for (const opt of options || []) {
    if (player && !(await evalConditions(opt.conditions || opt.condition, player))) continue;
    const questId = turnInQuestId(opt, tree);
    if (questId && player) {
      const status = await getFlag('player', questId, player);
      if (status !== 'completed') continue;
    }
    out.push(opt);
  }
  return out;
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
      } else if (result?.type === 'error') {
        console.warn(`[dialogue] action ${a.action} failed: ${result.message}`);
      }
    }
  }

  const options = await filterDialogueOptions(node.options, tree, player);
  // `{quest}` in a node's text resolves to the quest name a generic hand-in node is
  // turning in (context.quest_name, set by Tablet OS) so the NPC can name the job.
  let text = node.text + appendMessage;
  if (context?.quest_name) text = text.replace(/\{quest\}/g, context.quest_name);
  return { text, options };
}
