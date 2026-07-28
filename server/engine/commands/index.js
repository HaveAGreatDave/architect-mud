import { handlers as moveHandlers } from './movement.js';
import { wakeFromDream } from '../dreamscape.js';
import { handlers as combatHandlers } from './combat.js';
import { handlers as invHandlers } from './inventory.js';
import { handlers as socialHandlers } from './social.js';
import { handlers as housingHandlers } from './housing.js';
import { handlers as worldHandlers } from './world.js';
import { fireCommand, fireInputMatchers } from '../plugins.js';
import { deactivateForcefield } from '../apartments.js';
import { fireSpecializedAction } from '../specializedActions.js';
import { getSelectionState, advanceSelectionState, formatSelectionPage } from '../sift.js';
import { getLivePlayer } from '../world.js';
import { emit } from '../events.js';
import { setPosture } from '../posture.js';
import { getAlias } from './aliases.js';

export { describeZone, describeVoidTeleport } from './describe.js';
export { recomputeArmor, recomputeInsulation, recomputeEquipped, EQUIP_SLOTS } from './inventory.js';

// The only verbs that work from inside a dreamscape. Deliberately tiny: walking
// and looking touch nothing that has to outlive the room, and dream rooms are
// deleted the moment you wake. Anything that writes the world from in here —
// dropping, stowing, building, trading — would file its result against a zone id
// that is about to stop existing. See the gate in handleCommand.
export const DREAM_VERBS = new Set([
  'north', 'south', 'east', 'west', 'up', 'down', 'in', 'out',
  'northeast', 'northwest', 'southeast', 'southwest',
  'move', 'look', 'examine', 'wake',
  // Talking in a dream is safe (nothing it writes outlives the room) and is the
  // most dream-like thing there is — an empty room, and you answering it.
  'talk', 'say',
]);

// A dream refuses you the way dreams do — not with an error, with the thing
// simply not being there.
const DREAM_REFUSALS = [
  'You go to do it and find you have no hands for it. The thought slides off.',
  'You mean to. You are quite sure you mean to. Nothing happens, and it does not seem strange.',
  'Whatever you reach for is not here, and was not, and you knew that.',
  'The intention arrives without a body attached to it. Nothing moves.',
  'You try. Somewhere very far away, your real arm twitches under a blanket.',
];

const builtins = new Map([
  ...Object.entries(moveHandlers),
  ...Object.entries(combatHandlers),
  ...Object.entries(invHandlers),
  ...Object.entries(socialHandlers),
  ...Object.entries(housingHandlers),
  ...Object.entries(worldHandlers),
]);

// Unified STOP: one verb ends every ongoing/recurring action at once — combat,
// following, and (via the player.stop event) every plugin's repeating actions
// (scavenging, butchering, MIS events, …).
async function cmdStopAll(args, raw, player, broadcast) {
  const stopped = [];

  if (player.combatTargetId || player.pvpTargetId || player.npcCombatTargetId) {
    // Only clear our own attack — the opponent's side of pvpTargetId is theirs to
    // let go of. If they haven't stopped too, their auto-attack keeps landing on us.
    if (player.pvpTargetId) {
      const opponent = getLivePlayer(player.pvpTargetId);
      if (opponent) {
        broadcast(null, { type: 'output', message: `${player.handle} disengages.` }, null, opponent.id);
      }
    }
    player.combatTargetId = null;
    player.pvpTargetId = null;
    player.npcCombatTargetId = null;
    // Grace window so enemy/NPC retaliation and aggro don't instantly re-arm our
    // target on the next combat tick — long enough to actually break off and flee.
    player.disengagedUntil = Date.now() + 6000;
    // A wound-up power swing has nothing left to land on.
    player._powQueued = false;
    stopped.push('fighting');
  }

  // An armed break-away attempt is an ongoing action too — `stop` abandons it
  // rather than leaving the gameLoop retrying a move you've changed your mind about.
  if (player._fleeIntent) {
    player._fleeIntent = null;
    stopped.push('trying to break away');
  }

  if (player.following) {
    player.following = null;
    stopped.push('following');
  }

  // Let plugins halt their own repeating actions (e.g. scavenging). Synchronous
  // subscribers push a label onto `stopped` before this returns.
  emit('player.stop', { player, broadcast, stopped });

  if (!stopped.length) return { type: 'output', message: "You aren't doing anything to stop." };
  return { type: 'output', message: `You stop ${stopped.join(', ')}.` };
}

builtins.set('stop', cmdStopAll);
builtins.set('disengage', cmdStopAll);

// `wake` is intercepted by the sleep gate in handleCommand whenever it would do
// something; this registration is what stops it reading as an unknown verb when
// you're already awake, and what puts it in the help/command list at all.
builtins.set('wake', () => ({ type: 'output', message: "You're already awake. As far as you can tell." }));

// Final fallback once every plugin's `hack` target (vendor safes, hackable
// door locks, …) has had a chance to claim the verb and passed.
builtins.set('hack', () => ({ type: 'error', message: "There's nothing worth hacking here." }));

// Engine verb names, exposed so the plugin loader can report which builtins
// are shadowed by plugin-registered verbs (dispatch order makes those dead).
export function builtinCommandNames() { return [...builtins.keys()]; }

// Nonsense the insane gate throws back instead of running a command. Kept here
// beside the engine gate that uses them (like WAKE_MESSAGES below); the sanity
// plugin owns the *state* (player.insane), the engine owns this substrate law.
const INSANE_REFUSALS = [
  'The word makes no sense the moment you think it. Your hands do something else entirely.',
  "You reach for the action and it isn't there — just a wet, laughing hole where the thought was.",
  'The letters of your own command melt and run together. Nothing happens.',
  'Something screams the instant you try, and you forget what you were doing.',
  "You try, but the room tilts and the intent slides off it like water. Nonsense. All of it.",
  'Your body refuses to be told. It has other ideas now, and it will not share them.',
];

export async function handleCommand(input, player, broadcast) {
  let raw = input.trim();
  if (!raw) return null;

  // Command-namespace sigils — a leading `@` (admin), `/` (player), or `.`
  // (bookkeeping/OOC) is stripped so a verb can be typed with its namespace
  // (`@tp`, `/sit`, `.status`). Cosmetic here: the bare verb still works and the
  // rest of the pipeline only ever sees the clean command. The distinction is a
  // typing convention — each command enforces its own role gate. (Client-side
  // bookkeeping verbs like `.status`/`.describe` are intercepted before send.)
  if (raw[0] === '@' || raw[0] === '/' || raw[0] === '.') {
    raw = raw.slice(1).trim();
    if (!raw) return null;
  }

  // Blackout gate — while blacked out (heavy intoxication) the player can neither
  // see nor act; the state is time-based and lifts itself. Set by the intoxication
  // plugin, read here as a substrate law (mirrors the `sleeping` gate below).
  if (player.blackedOutUntil && Date.now() < player.blackedOutUntil) {
    return { type: 'error', message: "Everything's black. You can't do anything but ride it out." };
  }

  // SIFT selection-state intercept — runs before all routing.
  const _sel = getSelectionState(player.id);
  if (_sel) {
    const adv = advanceSelectionState(player.id, raw);
    if (!adv) {
      // State expired — fall through to normal pipeline
    } else if (adv.type === 'cancel') {
      return { type: 'output', message: 'Selection cancelled.' };
    } else if (adv.type === 'page') {
      return { type: 'output', message: formatSelectionPage(adv.state) };
    } else if (adv.type === 'selected') {
      const { verb, dispatchType, dispatchParam, moveDirection } = _sel.context;
      // Movement picker: the candidate carries the destination zone id, so move
      // straight there — never a `go <name>` round-trip (long/duplicate names fail).
      if (moveDirection && adv.candidate?.id) {
        const { cmdMove } = await import('./movement.js');
        return cmdMove(moveDirection, player, broadcast, { targetZoneId: adv.candidate.id });
      }
      if (dispatchType && dispatchParam) {
        const { dispatchAction } = await import('../actions.js');
        return dispatchAction({
          type: dispatchType,
          actor: player,
          params: { [dispatchParam]: adv.candidate },
          context: { broadcast },
        });
      }
      const handler = builtins.get(verb);
      if (handler) return handler([adv.candidate.name.toLowerCase()], `${verb} ${adv.candidate.name}`, player, broadcast);
      return { type: 'error', message: 'Selection handler lost.' };
    }
    // adv.type === 'refine': fall through — treat as fresh command
  }

  const parts = raw.toLowerCase().split(/\s+/);
  const cmd = getAlias(parts[0]) ?? parts[0];
  const args = parts.slice(1);
  // Rebuild raw with the canonical verb so handlers that re-parse it see the real
  // command, not the alias. No-op when no alias applied.
  if (cmd !== parts[0]) raw = [cmd, ...raw.trim().split(/\s+/).slice(1)].join(' ');

  // Let plugins react to the player taking any action — fired BEFORE the command
  // runs, so a move/act that lands on a tile doesn't cancel the very task it's about
  // to start. The quests plugin uses this to interrupt an in-progress timed tile task.
  emit('player.command', { player, cmd });

  // ── Inside a dreamscape, your own commands do NOT wake you ─────────────────
  //
  // The sleep gate below wakes you on ANY command, which made the walkable dream
  // unwalkable: the entry message says "You can move. Look around", and the first
  // command accepting that invitation ended the dream. So a dreamer gets a small
  // allowlist that passes straight through, and only `wake` ends it deliberately.
  //
  // It is an ALLOWLIST, not "everything but wake", and that is load-bearing. Dream
  // rooms are transient: `drop` in one files the item under `_ground_<dream zone>`
  // and the room is deleted seconds later, orphaning it in the DB forever. The same
  // goes for anything else that writes the world from inside a room that is about
  // to stop existing. Walking and looking are safe because they touch nothing that
  // outlives the dream.
  //
  // Everything ELSE still wakes you, exactly as before — an alarm, an attack, the
  // game loop, being killed. This changes only what YOUR OWN typing does.
  if (player.sleeping?.inDream) {
    if (cmd === 'wake') {
      wakeFromDream(player);
      player.sleeping = null;
      setPosture(player, 'standing');
      broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} stirs and opens their eyes.` }, player.id);
      broadcast(null, { type: 'force_look' }, null, player.id);
      return { type: 'output', message: 'You surface. The room reassembles itself around you, and this time it stays put.' };
    }
    if (!DREAM_VERBS.has(cmd)) {
      return { type: 'error', message: DREAM_REFUSALS[Math.floor(Math.random() * DREAM_REFUSALS.length)] };
    }
    // Falls through to the normal pipeline — still asleep, still dreaming.
  }

  // `cmd` is already alias-resolved above, so `rest` has become `sleep` here.
  else if (player.sleeping && cmd !== 'sleep') {
    const wasHome = player.sleeping.reason === 'home';
    wakeFromDream(player);
    player.sleeping = null;
    setPosture(player, 'standing');
    const WAKE_MESSAGES = [
      'jolts awake, eyes wild.',
      'snaps awake with a grunt.',
      'wakes with a start, disoriented.',
      'lurches upright, suddenly conscious.',
      'stirs and opens their eyes.',
    ];
    const roomMsg = WAKE_MESSAGES[Math.floor(Math.random() * WAKE_MESSAGES.length)];
    broadcast(player.current_zone, { type: 'zone_event', message: `${player.handle} ${roomMsg}` }, player.id);
    if (wasHome) await deactivateForcefield(player.id, player.home_zone, broadcast);
    const result = await handleCommand(input, player, broadcast);
    if (result) result.message = `You wake up.\n\n${result.message ?? ''}`.trimEnd();
    return result;
  }

  // Insane gate — sanity has bottomed out and deliberate action collapses into
  // nonsense about half the time. Set by the sanity plugin, read here as a
  // substrate law (mirrors the blackout gate above). `sleep`/`rest` always pass
  // — sleep is the only way to climb sanity back out of the insane state.
  if (player.insane && cmd !== 'sleep' && cmd !== 'rest' && Math.random() < 0.55) {
    return { type: 'error', message: INSANE_REFUSALS[Math.floor(Math.random() * INSANE_REFUSALS.length)] };
  }

  // Multi-word verbs (engine and plugin) — first matching pattern wins.
  const matcherResult = await fireInputMatchers(args, raw, player, broadcast);
  if (matcherResult !== undefined) return matcherResult;

  const pluginResult = await fireCommand(cmd, args, raw, player, broadcast);
  if (pluginResult !== undefined) return pluginResult;

  // Tag-gated specialized actions (doors, containers, food, weapons, …). Each
  // handler self-resolves its target and returns undefined to fall through to
  // the built-in handler below — keeping every verb playable mid-port.
  const specialResult = await fireSpecializedAction(cmd, args, raw, player, broadcast);
  if (specialResult !== undefined) return specialResult;

  const handler = builtins.get(cmd);
  if (handler) return handler(args, raw, player, broadcast);
  return { type:'error', message:`Unknown command: "${cmd}". Type HELP for commands.` };
}
