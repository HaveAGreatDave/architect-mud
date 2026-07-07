// Move gate chain — the veto seam for MOVE (docs/proposals/engine-plugin-boundary.md, E1).
//
// A gate is ideally a PURE check, but side effects are permitted where the seam
// needs them (govgate records checkpoint heat + dispatches an arrest; pacing
// enqueues a deferred step). All gates run in registration order before any part
// of a move mutates state; the first { block: true } wins and its message is
// returned to the player.  The engine registers its own laws (door locks,
// encumbrance) through this same chain in commands/movement.js, so laws and plugin
// gates are listable side by side.
//
// gate({ player, from, to, direction, door, opts }) → { block, message, silent } | undefined
//   from/to    — zone objects
//   door       — the door on this exit (either side), or null
//   opts       — cmdMove opts; opts.bypassEncumbrance is the named exemption
//                system moves (shove, .gohome) pass
//   silent     — when a blocking gate sets silent:true, cmdMove returns null instead
//                of an error line (the step is quietly not executed — used by the
//                pacing plugin to defer a too-fast move into its queue)

const gates = [];

export function registerMoveGate(gate, owner = 'plugin') {
  if (typeof gate !== 'function') throw new Error('registerMoveGate: gate function required');
  gates.push({ gate, owner });
}

// Returns the first blocking result, or null if every gate passes. A gate that
// throws is skipped (logged) — an erroring gate must not wall off the map.
export async function runMoveGates(ctx) {
  for (const { gate, owner } of gates) {
    try {
      const r = await gate(ctx);
      if (r?.block) return r;
    } catch (e) {
      console.error(`[moveGate:${owner}] error: ${e.message}`);
    }
  }
  return null;
}

export function getRegisteredMoveGates() { return gates.map(g => g.owner); }
