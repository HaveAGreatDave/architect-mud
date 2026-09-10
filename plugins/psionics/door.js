/**
 * THE DOOR — the induction beat, and the best tutorial in the system.
 *
 * Every door in an Exodus space looks like an ordinary automatic door. People walk
 * up to them, people walk through them. They are not automatic. They are being
 * opened by the people walking through them.
 *
 * The first time a newcomer is let inside, they walk face-first into one. Their
 * guide explains, without ceremony and mildly amused, that they will be
 * controlling considerably more than doors before long.
 *
 * ── Why this is worth building ───────────────────────────────────────────────
 *
 * It teaches the mechanic by DOING IT TO YOU. Before the player has any power at
 * all they have felt what it does from the receiving end, which is a better
 * tutorial than any amount of text. It also reads as architecture rather than as
 * a lock: no keypad, no guard, nothing to pick or hack. A Null cannot jam it and
 * an Ascendant cannot buy past it, and neither of them can be told why.
 *
 * And it costs almost nothing, because `registerLockType` already exists and the
 * doors plugin's own header invites exactly this ("drop a registerLockType() call
 * in any plugin"). The Long Watch blast door is the model followed here.
 *
 * ── The one place the Exodus explain themselves ──────────────────────────────
 *
 * Terminus's rule is that nothing is ever named. This is the deliberate exception,
 * and it is correct because you are being INDUCTED — somebody has decided to teach
 * you. It happens exactly once. Every refusal after the first is a quiet,
 * unexplained non-opening, which is far more unsettling than an error message and
 * puts the voice straight back where it belongs.
 */
import { registerLockType } from '../../server/engine/locks.js';
import { setFlagById } from '../../server/engine/flags.js';
import { sendToPlayer } from '../../server/engine/messaging.js';
import { isAwakened } from '../../server/engine/psionics.js';

const WALKED_INTO_IT = 'psi_walked_into_door';

/**
 * The guide's line. The ONLY time an Exodus explains the discipline plainly.
 *
 * No em dashes (they belong to the Architect and the Ascendants), and note it
 * never says "psionics" — even here, being taught, nobody names the thing. The
 * guide describes what you will be able to DO, which is the Exodus's whole
 * pedagogy and is also the joke: they are not impressed, and this happens to
 * everybody.
 */
const GUIDE_LINE =
  '<span class="ambient">You walk into the door.</span><br>' +
  '<span class="ambient">Your guide waits for you to finish being surprised, then says: ' +
  '"It isn\'t automatic. None of them are." A pause. "You\'ll get it. Doors are ' +
  'the easy part, and you\'ll be doing a great deal more than doors."</span>';

export function registerPsiDoor() {
  registerLockType('psi', {
    tagType: 'lock:psi',
    kitTag:  'lockkit:psi',
    defaults: {
      // Not hackable, not pickable, not bashable. There is no mechanism in it to
      // attack — which is the point, and is why Exodus doors must also be marked
      // unbreakable in content the way the Long Watch blast door is.
      canHack: false,
      messages: {
        lock:   'The door settles closed. Nothing moved it.',
        unlock: 'The door opens for you.',
        // Deliberately flat and unexplained. After the first time, a refusal
        // should feel like the building declining to notice you.
        denied: "The door doesn't open.",
      },
    },

    /**
     * Awakened or not. That is the whole gate.
     *
     * Note what is NOT here: no rank floor, no focus, no skill check. Opening a
     * door the Exodus have already tuned is the lowest thing this discipline can
     * do, and gating it any harder would lock initiates out of their own home.
     *
     * The side effect is the tutorial. An authFn is not the obvious place for
     * one, but it is the only hook that fires at the exact moment of the bump,
     * and the moment IS the lesson. Guarded to fire once, ever.
     */
    authFn: async (lockTag, door, player) => {
      if (isAwakened(player)) return true;

      if (!player?._flags?.get(WALKED_INTO_IT)) {
        // Write through the live Map as well as the table: flags.js hydrates at
        // login and every sync reader (including this one, next time) reads the
        // Map, so setting only the row would let it fire twice this session.
        player._flags?.set(WALKED_INTO_IT, '1');
        setFlagById(player.id, WALKED_INTO_IT, '1').catch(() => {});
        sendToPlayer(player.id, { type: 'output', message: GUIDE_LINE });
      }
      return false;
    },
  });
}

/**
 * THE OUTER GATE — a second lock family, and a different rule.
 *
 * The psi door above asks what you can DO. This one asks what you ARE, and the
 * two are deliberately not the same question: you are let through the gate long
 * before you are awakened, because the machine that awakens you is inside it.
 * A gate standing in front of its own key is the commonest way a chain like this
 * dies quietly.
 *
 * ── The rule ────────────────────────────────────────────────────────────────
 *
 * Two halves, both of which must hold:
 *
 *   1. SOMEBODY LET YOU IN. `terminus_admitted`, set by the child at the gate at
 *      the end of the errands. The gate is never opened by standing at it.
 *   2. YOU ARE NOT SIGNED UP TO SOMEBODY ELSE. The Exodus's path is `mind`
 *      (content/orgs/ideology_exodus.json), and if you have declared harder for
 *      the machine, the flesh or the human way, this is not your door.
 *
 * It reads the ordinary ideology PATH FLAGS and nothing else. There is no
 * Terminus membership number, no secret-society flag, and no second copy of
 * "which side is this player on" living in this file — which matters, because a
 * player who later leans back toward the mind through ordinary play walks in,
 * and one who takes Ascendant work walks out, with nothing here to keep in sync.
 *
 * Note what it does NOT read: reputation. You can have run jobs for all four
 * orders and still be let in. Standing is what you have DONE; the path is what
 * you have decided to be, and only the second one is a door somebody else's name
 * is already on.
 *
 * Ties go to the incumbent. `other >= mind` refuses, so a dead heat is a refusal:
 * somebody equally committed to the machine and the mind has not chosen, and the
 * whole gate is about having chosen.
 */
const ADMITTED = 'terminus_admitted';
const GATE_TOLD = 'terminus_gate_told';

/**
 * Verity Strand, saying the one plain thing she is prepared to say, once.
 *
 * The refusal itself is flat and unexplained, like every other door here. But a
 * player who did both errands, answered the child, and is then refused for a
 * reason they cannot see would be looking at a bug rather than at a decision.
 * So the warden standing three feet away says it — and she says it about THEM,
 * not about the creed, which keeps her inside the district's one hard rule.
 *
 * No em dashes, and it never names the order the player belongs to: she can see
 * what they are and does not have to have been told its name.
 */
const WARDEN_LINE =
  '<span class="ambient">The gate doesn\'t open.</span><br>' +
  '<span class="ambient">Verity Strand doesn\'t look at it, or at you. "She said you could come in," ' +
  'she says, "and she was right, and it still will not." A pause, without any unkindness in it at ' +
  'all. "You have already given this to somebody. I don\'t need to know who and I\'m not going to ' +
  'ask. It\'s only that a person can hold one of these, and yours is full."</span>';

const pathFlag = (player, name) => Number(player?._flags?.get(`path_${name}`)) || 0;

export function registerTerminusGate() {
  registerLockType('terminusgate', {
    tagType: 'lock:terminusgate',
    kitTag: 'lockkit:terminusgate',
    defaults: {
      // Nothing to hack, nothing to pick, and marked unbreakable in content. The
      // answer to this door is supposed to be a decision about who you are, and
      // a door you can bash is a door whose answer is a crowbar.
      canHack: false,
      messages: {
        lock: 'The leaves come together without a sound.',
        unlock: 'The gate opens. Nobody touches it.',
        denied: "The gate doesn't open.",
      },
    },

    authFn: async (lockTag, door, player) => {
      // Nobody has said you may. Flat refusal and no explanation: there are four
      // people on this road whose entire job is to explain it, and the gate is
      // not one of them.
      if (!player?._flags?.get(ADMITTED)) return false;

      const mind = pathFlag(player, 'mind');
      const other = Math.max(pathFlag(player, 'machine'), pathFlag(player, 'flesh'),
                             pathFlag(player, 'human'));
      if (other > 0 && other >= mind) {
        if (!player?._flags?.get(GATE_TOLD)) {
          // Same write-through the psi door does: flags.js hydrates at login and
          // every sync reader takes the Map, so setting only the row would let
          // this fire twice in one session.
          player._flags?.set(GATE_TOLD, '1');
          setFlagById(player.id, GATE_TOLD, '1').catch(() => {});
          sendToPlayer(player.id, { type: 'output', message: WARDEN_LINE });
        }
        return false;
      }
      return true;
    },
  });
}

export const _test = { GUIDE_LINE, WALKED_INTO_IT, WARDEN_LINE, ADMITTED, GATE_TOLD, pathFlag };
