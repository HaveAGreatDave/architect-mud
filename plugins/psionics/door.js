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
  '"It is not automatic. None of them are." A pause. "You will get it. Doors are ' +
  'the easy part, and you will be doing a great deal more than doors."</span>';

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
        denied: 'The door does not open.',
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

export const _test = { GUIDE_LINE, WALKED_INTO_IT };
