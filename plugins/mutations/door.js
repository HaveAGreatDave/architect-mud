/**
 * THE THORN GATES — the way into the Thornwarren, and the rule behind it.
 *
 * The Wildblood's sibling to the Exodus's outer gate (plugins/psionics/door.js), and deliberately
 * the same shape: two halves, one social and one about who you have already promised yourself to.
 * Two orders, two walls, one rule, written twice rather than shared, because the day they need to
 * diverge is the day a shared helper becomes a knot.
 *
 * ── Why there is a gate at all now ──────────────────────────────────────────
 *
 * The Thornwarren shipped OPEN: 195 tiles of town anybody could walk into off the waste. That was
 * survivable while the town was scenery, and stops being survivable the moment there is a mutagen
 * store, a ritual room and ten people in beds behind the wall. These are the most hunted people on
 * the map. A town that has grown a hedge for thirty years and then lets strangers walk in past the
 * nursery is not a town, it is a set.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 *   1. SOMEBODY LET YOU IN. `thorn_admitted`, set at the gate by the warden once you have done the
 *      one thing she asks. The gate is never opened by standing at it.
 *   2. YOU ARE NOT ALREADY SOMEBODY ELSE'S. The Wildblood's path is `flesh`, and if you have
 *      declared harder for the machine, the mind or the human way, this is not your wall.
 *
 * It reads the ordinary ideology PATH FLAGS and nothing else — no membership number, no second copy
 * of "which side is this player on". Reputation is deliberately NOT read: half this town has taken
 * money off the city and all of them despise it, and standing is what you have done rather than
 * what you have decided to be.
 *
 * Ties refuse. Somebody equally committed to the flesh and the machine has not chosen, and choosing
 * is the entire toll at this gate.
 *
 * ── The refusal, and why it is not silent ───────────────────────────────────
 *
 * Every other door in the game refuses flatly. This one, ONCE, does not — because the whole point
 * of these people is that they are direct to the point of rudeness and have never in their lives
 * softened anything. A Wildblood who refused you without saying why would be behaving like the
 * city. So Quarrel Nine tells you, once, in about eleven words, and never again.
 */
import { registerLockType } from '../../server/engine/locks.js';
import { setFlagById } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';

const ADMITTED = 'thorn_admitted';
const TOLD = 'thorn_gate_told';

/**
 * The warden's one line. It names what the player has done, never the creed, and never the order
 * they belong to: she can see it, and she does not need to have been told its name.
 *
 * Em dashes are fine here (that tell belongs to the Ascendants and the Architect, and she is
 * neither), but she does not get one, because she does not talk in clauses.
 */
const WARDEN_LINE =
  '<span class="ambient">The thorn doesn\'t move.</span><br>' +
  '<span class="ambient">Quarrel Nine looks at you for a while. "You already went somewhere," ' +
  'she says. "I don\'t care where. But you can\'t stand in two places, and you\'re standing in ' +
  'that one." She turns back to the road. "Come back when you\'re not."</span>';

const pathFlag = (player, name) => Number(player?._flags?.get(`path_${name}`)) || 0;

export function registerThornGate() {
  registerLockType('thornwarrengate', {
    tagType: 'lock:thornwarrengate',
    kitTag: 'lockkit:thornwarrengate',
    defaults: {
      // There is no mechanism in a hedge. Not hackable, not pickable, and marked unbreakable in
      // content: cutting it is exactly the thing the wall is famous for surviving, and a gate whose
      // answer is a blade would be the one place in the region that forgot that.
      canHack: false,
      messages: {
        lock: 'The thorn closes over the gap, unhurried, the way it has for thirty years.',
        unlock: 'The thorn draws back off the frame and lets you through.',
        denied: "The thorn doesn't move.",
      },
    },

    authFn: async (lockTag, door, player) => {
      if (!player?._flags?.get(ADMITTED)) return false;

      const flesh = pathFlag(player, 'flesh');
      const other = Math.max(pathFlag(player, 'machine'), pathFlag(player, 'mind'),
                             pathFlag(player, 'human'));
      if (other > 0 && other >= flesh) {
        if (!player?._flags?.get(TOLD)) {
          // Write through the live Map as well as the row: flags.js hydrates at login and every
          // sync reader takes the Map, so setting only the row lets this fire twice in a session.
          player._flags?.set(TOLD, '1');
          setFlagById(player.id, TOLD, '1').catch(() => {});
          sendToPlayer(player.id, { type: 'output', message: WARDEN_LINE });
        }
        return false;
      }
      return true;
    },
  });
}

export const _test = { WARDEN_LINE, ADMITTED, TOLD, pathFlag };
