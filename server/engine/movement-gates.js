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

// ── THE SHUT SEAM — ASKING THE GATE'S QUESTION WITHOUT WALKING INTO IT ────────
// A move gate only ever answers at the moment of the step, which is the right
// place to ENFORCE a law and the wrong place to be told about one. Shop hours
// were a gate and nothing else: a closed shop kept its accent outline on the
// minimap, its dpad arrow stayed lit, and `look` listed it as an ordinary way in,
// because none of those surfaces has a door row to read a lock off (there are 158
// doors in the whole world, and a shop front is usually not one of them). You
// found out by trying it. That is exactly the failure describe.js already fixed
// for real doors — "58 closed doors read as ordinary open exits in `look` and then
// stopped you on the step" — and the hours law never got the same treatment.
//
// So a system that shuts a destination declares it here, and every surface that
// draws a way in can ask ahead of the step. The gate stays the enforcement; this
// is the same fact, told before you walk into it.
//
// provider(player, zone) → { shut: true, label } | null
//   label — the word a surface prints for it ("closed"), never a sentence. The
//           REASON stays with the gate, which has room for it; a door tag has not.
//
// ⚠ SYNC BY CONTRACT, and no query. `getMinimapData` asks this per tile of an
// 81-tile window on every move by every player. A provider reads the world Maps
// and a cached index or it does not belong here.
//
// It fails OPEN, unlike the climb seam next door, and for the mirror of that
// reason: this decides what a surface DRAWS, never what a body may do. With no
// provider registered every way in looks open — which is exactly how it looked
// before any of this existed — and the gate still refuses the step.
// Keyed by owner, like every other sync contributor registry in the engine, so a
// re-registration replaces rather than stacks.
const shutProviders = new Map();
export function registerShutProvider(fn, owner = 'plugin') {
  if (typeof fn !== 'function') throw new Error('registerShutProvider: function required');
  shutProviders.set(owner, fn);
}

// The first provider that calls this destination shut, or null. A provider that
// throws is skipped: a broken system must not paint the whole map shut.
export function shutStatus(player, zone) {
  if (!zone) return null;
  for (const [owner, fn] of shutProviders) {
    try {
      const r = fn(player, zone);
      if (r?.shut) return { shut: true, label: r.label || 'closed' };
    } catch (e) {
      console.error(`[shutProvider:${owner}] error: ${e.message}`);
    }
  }
  return null;
}

export function getRegisteredShutProviders() { return [...shutProviders.keys()]; }

// ── THE SAME QUESTION, ASKED ABOUT A LINK ────────────────────────────────────
// The shut seam above asks about a DESTINATION, which is the shape shop hours
// have: the room is closed however you reach it. A lock is not that shape. It
// hangs on ONE link, and the room behind it is wide open from its other three
// sides — so a surface that draws the sides of a room has a second question to
// ask, and it is the same question one step down.
//
// The minimap's edge lines are that surface: every side of an interior room with
// a way through drew green, so a bolted apartment door and an empty doorway were
// the same line, and you found out which by walking into it. Same failure the
// shut seam fixed for a facade, one surface further in.
//
// provider(player, from, dir, to) → { locked: true, unlockable?: true } | null
//   from/to — zone objects; dir — the cardinal being looked along.
//   unlockable — this player can undo this lock, so a surface can draw it as a
//           door of their own rather than as a wall. OPTIONAL and it fails to
//           false: a provider that cannot answer cheaply must not guess, because
//           the reassuring direction is the one that gets somebody killed.
//
// ⚠ SYNC BY CONTRACT, and no query. This is asked about every cardinal side of
// every interior tile in an 81-tile window, on every move by every player.
//
// It fails OPEN, like the shut seam and unlike the climb seam, and for the same
// reason: it decides what a surface DRAWS, never what a body may do. With no
// provider registered every side looks open — exactly how it looked before this
// existed — and the door-lock gate still refuses the step.
const lockedProviders = new Map();
export function registerLockedProvider(fn, owner = 'plugin') {
  if (typeof fn !== 'function') throw new Error('registerLockedProvider: function required');
  lockedProviders.set(owner, fn);
}

// The first provider that calls this link locked, or null. A provider that throws
// is skipped: a broken system must not paint every doorway shut.
export function lockedOnLink(player, from, dir, to) {
  if (!from || !dir) return null;
  for (const [owner, fn] of lockedProviders) {
    try {
      const r = fn(player, from, dir, to);
      if (r?.locked) return { locked: true, unlockable: !!r.unlockable };
    } catch (e) {
      console.error(`[lockedProvider:${owner}] error: ${e.message}`);
    }
  }
  return null;
}

export function getRegisteredLockedProviders() { return [...lockedProviders.keys()]; }
