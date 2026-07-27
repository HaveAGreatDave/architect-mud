// server/engine/worklist.js
//
// A gate for scheduled ticks that poll a table for outstanding work.
//
// The shape is everywhere: a tick fires every N seconds and asks the database
// "is there anything due?", and the answer is almost always no. Measured on an
// idle server, script_waits, jail_prisoners and smuggle_orders were all being
// asked that question on a loop while holding ZERO rows between them. Each poll
// is a remote round trip, and a round trip on a quiet server is the thing that
// stops Neon's compute from ever suspending.
//
// So keep the count in memory and let the tick skip the query entirely when
// there is provably nothing to do.
//
// ── Why this is safe, and the failure mode it refuses to have ────────────────
//
// The obvious version of this — a counter incremented by writers, decremented on
// completion — has a nasty failure mode: miss one writer and the gate says "no
// work" forever, so jail sentences never end and parked scripts never resume.
// Silent, permanent, and invisible in testing because the counter is right until
// the one path nobody wired.
//
// This gate refuses that. It NEVER trusts the counter to stay right indefinitely:
// even while it believes the count is zero, it re-probes the table on a slow
// interval (default 5 minutes). A missed writer therefore costs a delay bounded
// by reconcileMs, not a permanent stall — and the tick still skips ~97% of its
// polls. Correctness leans on the probe; the counter is only an optimisation.
//
// Usage:
//   const gate = createWorkGate({
//     name: 'script_waits',
//     probe: async () => (await query('SELECT COUNT(*)::int AS n FROM script_waits')).rows[0].n,
//   });
//
//   // in the tick:
//   if (!await gate.shouldRun()) return;
//   …existing query + work…
//
//   // wherever a row is written:
//   gate.noteWork();
//
// noteWork() is deliberately cheap and forgiving: it just marks the gate dirty.
// Callers never have to keep a running total, and double-calling is harmless.

const gates = new Map();

export function createWorkGate({ name, probe, reconcileMs = 5 * 60_000 }) {
  if (!name) throw new Error('createWorkGate needs a name');
  if (typeof probe !== 'function') throw new Error(`work gate "${name}" needs a probe function`);
  if (gates.has(name)) return gates.get(name);

  const state = {
    name,
    known: null,      // last probed count; null = never probed
    dirty: true,      // something may have been written since the last probe
    lastProbe: 0,
    probes: 0,
    skips: 0,
  };

  const gate = {
    // True when the tick should go ahead and do its real query.
    async shouldRun() {
      const now = Date.now();
      const stale = now - state.lastProbe >= reconcileMs;
      if (state.dirty || state.known === null || stale) {
        try {
          state.known = Number(await probe()) || 0;
        } catch {
          // A failed probe must not be read as "nothing to do" — that would
          // silently switch the tick off. Fail open: run the tick.
          state.dirty = true;
          return true;
        }
        state.dirty = false;
        state.lastProbe = now;
        state.probes += 1;
      }
      if (state.known > 0) return true;
      state.skips += 1;
      return false;
    },
    // Called by anything that writes a row the tick would pick up.
    noteWork() { state.dirty = true; },
    // Called when the tick knows it drained everything, so the next call can
    // skip without waiting for a reconcile.
    noteDrained(remaining = 0) { state.known = remaining; state.dirty = false; state.lastProbe = Date.now(); },
    stats() { return { ...state }; },
  };
  gates.set(name, gate);
  return gate;
}

export function getWorkGate(name) { return gates.get(name) || null; }
export function allWorkGateStats() { return [...gates.values()].map(g => g.stats()); }
// Test seam: drop registered gates so a suite can build fresh ones.
export function _resetWorkGates() { gates.clear(); }
