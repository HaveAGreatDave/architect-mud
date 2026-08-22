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

// ── THE CLIMB SEAM ───────────────────────────────────────────────────────────
// A gate can only ever VETO — `runMoveGates` returns the first { block: true } and
// there is deliberately no { allow: true }, because a chain where a later gate can
// overturn an earlier one has an evaluation order players would have to know. That
// is the right rule and it is also why the climb exemption cannot be a gate: the
// impassable-terrain law has already said no by the time a climbing plugin's gate
// would run.
//
// So the law ASKS instead, through here. The engine keeps the law and the property
// (`propsOf(id).climbable`); the system that knows what a rope is keeps the gear,
// the stamina, the skill and every word of the prose. Neither imports the other —
// this is the substrate they meet in (the interaction rule, boundary doc §2).
//
// verdict: { ok: true }              — let them through, the provider is satisfied
//          { ok: false, message }    — refuse, and say it in the PROVIDER's words
//          null / undefined          — no opinion; the law's own refusal stands
//
// ⚠ IT FAILS CLOSED, AND THAT IS THE POINT. With no provider registered — the
// plugin disabled, or a regress fixture that never loaded it — a climbable tile is
// an ordinary cliff and the map is exactly as honest as it was before any of this
// existed. A seam that failed open would mean disabling a plugin silently opened
// every rock face in the world.
let climbProvider = null;
export function registerClimbProvider(fn) {
  if (typeof fn !== 'function') throw new Error('registerClimbProvider: function required');
  climbProvider = fn;
}
export function hasClimbProvider() { return !!climbProvider; }

// A provider that throws is treated as no opinion, for the same reason a gate that
// throws is skipped: a broken system must not wall off the map, and it must not
// open it either.
export async function climbCheck(player, to) {
  if (!climbProvider) return null;
  try {
    return await climbProvider(player, to);
  } catch (e) {
    console.error(`[climbProvider] error: ${e.message}`);
    return null;
  }
}
