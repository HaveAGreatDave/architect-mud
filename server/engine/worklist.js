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
// interval (default an hour). A missed writer therefore costs a delay bounded
// by reconcileMs, not a permanent stall. Correctness leans on the probe; the
// counter is only an optimisation.
//
// The interval used to be 5 minutes, which is exactly how long Neon waits with no
// queries before it suspends, so the probes alone kept the compute awake for as
// long as anyone was online.
//
// ── Due times ───────────────────────────────────────────────────────────────
//
// Most queued work isn't due the moment it's written: a delivery lands in three
// minutes, a bet settles when the game ends. A probe may return
// `{ n, nextDue }` (nextDue in epoch ms) instead of a bare count, and a writer may
// call `noteWork(dueAt)`. The gate then stays shut until the earliest item is
// due, rather than letting the tick run its query every minute in between.
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
//   gate.noteWork();          // or gate.noteWork(dueAtMs) when the due time is known
//
//   // after the tick has done its work, so the next call re-probes what's left:
//   gate.noteWork();
//
// noteWork() with no argument is deliberately cheap and forgiving: it just marks
// the gate dirty. With a due time it records the item without a probe, which
// also means a write inside an uncommitted transaction can't be probed away.
// Callers never have to keep a running total, and double-calling is harmless.

const gates = new Map();

export function createWorkGate({ name, probe, reconcileMs = 60 * 60_000 }) {
  if (!name) throw new Error('createWorkGate needs a name');
  if (typeof probe !== 'function') throw new Error(`work gate "${name}" needs a probe function`);
  if (gates.has(name)) return gates.get(name);

  const state = {
    name,
    known: null,      // last probed count; null = never probed
    nextDue: null,    // epoch ms the earliest item is due; null = due now / unknown
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
          const got = await probe();
          if (got && typeof got === 'object') {
            state.known = Number(got.n) || 0;
            state.nextDue = got.nextDue == null ? null : Number(got.nextDue);
          } else {
            state.known = Number(got) || 0;
            state.nextDue = null;
          }
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
      if (state.known > 0 && (state.nextDue == null || state.nextDue <= now)) return true;
      state.skips += 1;
      return false;
    },
    // Called by anything that writes a row the tick would pick up. With a due time
    // the gate records it directly; without one it re-probes on the next call.
    noteWork(dueAt) {
      if (dueAt == null || state.known === null) { state.dirty = true; return; }
      // known > 0 with no nextDue means something is due now; a later item can't hide it.
      const dueNow = state.known > 0 && state.nextDue == null;
      state.known += 1;
      if (!dueNow) state.nextDue = state.nextDue == null ? Number(dueAt) : Math.min(state.nextDue, Number(dueAt));
    },
    // Called when the tick knows it drained everything, so the next call can
    // skip without waiting for a reconcile.
    noteDrained(remaining = 0) { state.known = remaining; state.nextDue = null; state.dirty = false; state.lastProbe = Date.now(); },
    stats() { return { ...state }; },
  };
  gates.set(name, gate);
  return gate;
}

export function getWorkGate(name) { return gates.get(name) || null; }
export function allWorkGateStats() { return [...gates.values()].map(g => g.stats()); }
// Test seam: drop registered gates so a suite can build fresh ones.
export function _resetWorkGates() { gates.clear(); }
