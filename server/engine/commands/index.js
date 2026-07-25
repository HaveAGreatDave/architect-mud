import { handlers as moveHandlers } from './movement.js';
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

  // `cmd` is already alias-resolved above, so `rest` has become `sleep` here.
  if (player.sleeping && cmd !== 'sleep') {
    const wasHome = player.sleeping.reason === 'home';
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
