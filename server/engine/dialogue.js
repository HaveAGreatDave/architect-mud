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
import { emit, on } from './events.js';
import { evalConditions, getFlag, registerConditionShape } from './flags.js';
import { isNpcScheduledNow } from './broadcast-bridge.js';
import { query } from '../models/db.js';
import { getTier, getReputation } from './ideologies.js';
import { interp } from './interp.js';
import { getRelation, relationTier, touchRelation, RELATION_TIERS } from './relations.js';

// ── `{ on_air: true|false }` — don't talk to a man who is live ───────────────
//
// A working NPC is a scheduled one: `isNpcScheduledNow` is the same sync bridge
// predicate the AT_WORK behaviour node holds on, so a dialogue gated this way can
// never disagree with what the NPC is actually doing.
//
// Dialogue does NOT interrupt a behaviour graph — AT_WORK keeps returning RUNNING
// whether or not someone is talking — so this is not a mechanical safeguard. It's
// a fiction one: it lets an author write a performer who will not hold a
// conversation about pasta thirty seconds before air, without hand-maintaining a
// second copy of his schedule.
//
// Sync and query-free, like the bridge under it. Defaults FALSE for any NPC with
// no schedule at all, so `{ on_air: false }` on an ordinary NPC is simply true and
// the gate costs unscheduled speakers nothing.
registerConditionShape('on_air', (condition, _player, context) => {
  const npcId = context?.npc?.id;
  const live = npcId ? !!isNpcScheduledNow(npcId) : false;
  return condition.on_air ? live : !live;
});

// ── Relationship-aware node text (fallback by construction) ──────────────────
//
// A node MAY author `text_by_relation: { known: "...", close: [...] }`. Nothing
// is required: an unauthored node, an unauthored tier, or a player this NPC has
// never met all land on the node's ordinary `text`. This is the property that
// lets the substrate ship across 167 NPCs without touching a single existing
// tree — every one of them keeps behaving exactly as it does today until
// someone writes a warmer line for it.
//
// When a tier IS missing, we don't fall straight to default: we walk TOWARD
// NEUTRAL and take the first authored line on the way. An NPC with only a
// `close` line still reads as authored at `familiar`; one with only a `wary`
// line still reads as authored at `hostile`. Walking toward neutral (rather
// than simply down the ladder) is what stops a beloved regular ever picking up
// the line written for someone the NPC despises.
//
// One key is not a tier: `first`. It plays ONCE, on the render where this player
// and this NPC have no history at all — the introduction an NPC only ever gets
// to make once ("Folks call me Two-Cell"). It works because `touchRelation` is
// deliberately called AFTER the text is chosen, so the conversation that
// introduces you still sees met_at === 0; every later visit falls through to the
// ordinary tier walk below. `stranger` is therefore the EVERY-DAY greeting for
// someone who hasn't become a regular yet — the two are different questions and
// this is the key that separates them.
function relationVariant(node, npc, player) {
  const byRel = node?.text_by_relation;
  if (!byRel || !npc?.id || !player) return null;
  const rel = getRelation(player, npc.id);
  if (byRel.first && !rel.met_at) return byRel.first;
  const tier = relationTier(rel);
  const neutral = RELATION_TIERS.indexOf('stranger');
  let i = RELATION_TIERS.indexOf(tier);
  const step = i > neutral ? -1 : 1;
  for (; i !== neutral; i += step) {
    const line = byRel[RELATION_TIERS[i]];
    if (line) return line;
  }
  return byRel.stranger || null;
}

// Token bag for a dialogue render. Deliberately small and stable — the speaker,
// the listener, and where they're standing. Objects are referenced, not copied;
// only scalar leaves ever resolve (see engine/interp.js).
function dialogueTokens(npc, player) {
  return {
    npc: npc || {},
    player: player || {},
    zone: npc?.zone_id || player?.current_zone || '',
  };
}

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
export async function filterDialogueOptions(options, tree, player, context) {
  // Options gate independently, so evaluate them concurrently instead of
  // serially chaining each option's condition/flag round trips — a node with
  // several gated options used to cost ~2 sequential queries per option.
  // Order is preserved: map, then drop the nulls.
  const gated = await Promise.all((options || []).map(async (opt) => {
    // `context` carries the speaker, so a `{ relation: 'known' }` gate can default
    // to "this NPC" instead of every author having to name the npc id.
    if (player && !(await evalConditions(opt.conditions || opt.condition, player, context))) return null;
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
  // getReputation, not a raw SELECT: standing decays toward its resting point,
  // and a reader that skips that is a split source — an NPC still holding you at
  // arm's length over standing the ideology app already shows as recovered.
  const rep = await getReputation(player.id, npc.faction, { nullIfUnknown: true });
  if (rep === null) return null;   // no history with this order — no tint, as before
  return MOOD_BY_TIER[getTier(rep).id] || 'neutral';
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

// ── The bottom Display Mode rung: a conversation you read and type ───────────
//
// The dialogue panel is a modal with clickable options, and at the `log` rung
// there is no panel — so before this, a screen-reader player could open a
// conversation and had no written record of what was said and no way to answer
// it. The panel isn't hidden from them, it simply isn't the surface they chose.
//
// So the same frame is written out to #output instead, options NUMBERED, and
// `reply <n>` (or the bare number) picks one. Everything the panel shows has to
// reach the log or this rung isn't done for dialogue: the line, the stage
// direction, what each option LEADS TO, and which ones are locked.
//
// The state is in memory and per player — a conversation is a thing you are in
// the middle of, not a thing that survives a restart. It is keyed to the NPC and
// the zone it opened in, so walking away ends it (see `resumeLogTalk`).
const logTalks = new Map();
on('player.logout', ({ id }) => { if (id) logTalks.delete(id); });

export function getLogTalk(playerId) { return logTalks.get(playerId) || null; }
export function setLogTalk(playerId, talk) { logTalks.set(playerId, talk); }
export function endLogTalk(playerId) { logTalks.delete(playerId); }

// Escape authored content before it goes into the log as HTML. Node TEXT is
// deliberately NOT escaped (it carries the engine's own spans — item grants,
// speech tinting — exactly as the panel receives it), but option labels are
// plain strings the panel escapes client-side, so they get escaped here.
function esc(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// What an option leads to, in words rather than the panel's glyph. Same rule
// list (dialogueOptionKind), said out loud — a screen reader can't read an icon,
// and `hostile` in particular is the one tag a player must never have to infer.
const OPT_KIND_WORD = {
  hostile: 'turns ugly',
  shop:    'shop',
  quest:   'takes the job',
  turnin:  'hands it in',
  leave:   'ends it',
};

// One conversation frame as log lines. Deliberately the same text on the first
// render and on every re-read (`reply` with no number reprints it), so what you
// go back to is exactly what you were told.
export function renderTalkLog({ npcName, text, options, stage }) {
  const lines = [`<span class="speech-line">${esc(npcName)}: ${text}</span>`];
  if (stage) lines.push(`<span class="text-dim">${esc(stage)}</span>`);
  const opts = options || [];
  if (!opts.length) {
    lines.push(`<span class="text-dim">Nothing more to say. (<span class="action-link" data-action="cmd" data-cmd="endtalk">endtalk</span>)</span>`);
    return lines.join('\n');
  }
  opts.forEach((o, i) => {
    const n = i + 1;
    const tag = OPT_KIND_WORD[o._kind] ? ` <span class="text-dim">[${OPT_KIND_WORD[o._kind]}]</span>` : '';
    // A turn-in you haven't finished is SHOWN and refused, never hidden — the
    // panel disables it in place for the same reason: an option that vanishes
    // reads as a bug, and the player needs to know the hand-in is waiting.
    const lock = o._turninDisabled ? ' <span class="text-dim">[not finished yet]</span>' : '';
    lines.push(`  <span class="action-link" data-action="cmd" data-cmd="reply ${n}">${n})</span> ${esc(o.label)}${tag}${lock}`);
  });
  lines.push('<span class="text-dim">reply &lt;number&gt; · '
    + '<span class="action-link" data-action="cmd" data-cmd="reply">reply</span> to hear it again · '
    + '<span class="action-link" data-action="cmd" data-cmd="endtalk">endtalk</span></span>');
  return lines.join('\n');
}

// ── Advancing the conversation ───────────────────────────────────────────────
//
// ONE step of a dialogue, from whatever the player just picked to the next thing
// they see. Extracted out of server/index.js handleDialogue when the bottom
// Display Mode rung got a typed route into the same conversation (`reply <n>`):
// the panel and the log now take the identical path, so option-level actions,
// the GOTO_NODE override, the vendor-hours re-check and the two shop doors can't
// drift between a click and a typed number.
//
// The caller owns everything that needs a socket: opening the shop, tracking the
// current node, and how the result is presented. This returns a decision, not a
// frame on the wire:
//   { type: 'shop', shelf }   — the option IS the shop; caller opens it
//   { type: 'end', message }  — the conversation is over, say this
//   { type: 'frame', node, text, options, stage, mood }
export async function advanceDialogue({ npc, player, choice, optionIndex, prevNode, context }) {
  const tree = npc.dialogue_tree || {};

  // The implicit "Browse your wares." option (injected by renderDialogueNode).
  if (choice === '__shop__') return { type: 'shop', shelf: null };

  // Same gate `talk` applies at the root, re-checked on every node: a panel that
  // was open when the vendor's shift ended can't be clicked on past closing —
  // and a conversation left sitting in somebody's scrollback can't be replied to.
  const { isVendorRole, isVendorOffHours, vendorOffHoursLine } = await import('./ai-behaviour.js');
  if (isVendorRole(npc) && isVendorOffHours(npc)) {
    return { type: 'end', message: vendorOffHoursLine(npc) };
  }

  // Execute option-level actions if the player picked a specific option from the
  // previous node (identified by optionIndex against the SAME filtered list they
  // were shown — hence re-filtering rather than indexing the authored options).
  let appendMessage = '';
  let target = choice;
  if (player && optionIndex != null && prevNode) {
    const prev = tree[prevNode];
    if (prev) {
      const filteredOpts = await filterDialogueOptions(prev.options, tree, player, context);
      const clickedOpt = filteredOpts[optionIndex];
      for (const a of clickedOpt?.actions || []) {
        if (!a?.action) continue;
        const result = await dispatchAction({
          type: a.action,
          actor: player,
          // Dialogue actions are authored FLAT by the VINE dialogue editor; see
          // the same fallback in renderDialogueNode.
          params: a.params || a,
          context,
        });
        if (result?.type === 'grant' && result.granted) {
          appendMessage += `\n\n<span class="item-grant">You receive: ${result.name}${result.quantity > 1 ? ` x${result.quantity}` : ''}.</span>`;
        } else if (result?.type === 'goto_node' && result.node) {
          target = result.node;   // GOTO_NODE overrides the authored destination
        } else if (result?.type === 'error') {
          console.warn(`[dialogue] option action ${a.action} failed: ${result.message}`);
        }
      }
    }
  }

  // A node authored to open the vendor shop IS the shop — route it to the same
  // clean shop-open as "__shop__" rather than rendering a node on top of it.
  // A node may name a SHELF: the only way a back-room catalogue is reachable.
  const openShopAction = (tree[target]?.actions || []).find((a) => a?.action === 'OPEN_SHOP');
  if (openShopAction) {
    return { type: 'shop', shelf: openShopAction.params?.shelf || openShopAction.shelf || null };
  }

  const rendered = await renderDialogueNode(npc, target, player, context);
  if (!rendered) return { type: 'end', message: `${npc.name} has nothing more to say.` };
  return {
    type: 'frame',
    node: target,
    text: appendMessage ? rendered.text + appendMessage : rendered.text,
    options: rendered.options,
    stage: rendered.stage,
    mood: rendered.mood,
  };
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

  const options = await filterDialogueOptions(node.options, tree, player, context);
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
  // A warmth-specific line if one is authored for (roughly) this relationship,
  // otherwise the node's ordinary text — see relationVariant above.
  const chosen = relationVariant(node, npc, player) ?? node.text;
  const baseText = Array.isArray(chosen) ? chosen[Math.floor(Math.random() * chosen.length)] : chosen;
  let text = baseText + appendMessage;
  const questName = context?.quest_name || resolvedQuestName;
  if (questName) text = text.replace(/\{quest\}/g, questName);

  // `${dotted.path}` tokens (the same syntax Script graphs use — engine/interp.js)
  // let ONE authored tree serve many speakers: `${npc.name}`, `${player.handle}`,
  // `${zone}`. Distinct from the legacy `{quest}` brace above, which stays as-is.
  // Option labels get the same treatment, or a parameterised tree would render a
  // greeting with tokens and answers without them.
  const tokens = dialogueTokens(npc, player);
  text = interp(text, tokens);
  for (const o of options) if (o?.label) o.label = interp(o.label, tokens);

  // Mood is read on arrival and whenever a line just moved rep — the two moments
  // it can have changed. Arrival also carries the posture stage direction, unless
  // a rep swing already claimed the slot (one stage line at a time).
  const atRoot = nodeKey === 'root';
  // Talking to someone is how you come to know them. Deliberately AFTER the text
  // is chosen, so the conversation that introduces you still reads as a first
  // meeting — you become familiar by having talked, not while talking. Rate-
  // limited per (player, NPC) inside the substrate, so re-entering root a dozen
  // times in one conversation counts once. Synchronous, memory-only, no query.
  if (atRoot && player && npc?.id) touchRelation(player, npc.id, { reason: 'dialogue' });
  // …and it's also how a quest knows you went and spoke to someone. Fired on the
  // ROOT node only, for the same reason touchRelation is: one conversation is one
  // talk, however many options get clicked inside it. Quests' 'talk' objective is
  // the consumer; dialogue itself stays ignorant of quests (ADR-0002).
  if (atRoot && player && npc?.id) emit('npc.talked', { actor: player, npc });
  const mood = (atRoot || repMoved) ? await speakerMood(npc, player) : null;
  if (atRoot && !stage) stage = ARRIVAL_STAGE[npc.posture] || '';

  return { text, options, stage, mood };
}
