// THE STADIUM KIT'S SHARED NUMBERS: the ice crew's routine and the resurfacer they drive out of its bay
// (plugins/stands crew.js on the server, room-machine.js on the client), and how a ticket reads on a seat
// door's card (room-stage.js). Pure and venue-agnostic: nothing here names a building.

// The resurfacer as the Room Stage stands it, metres: GLASS's machine (gl/arena-mesh.js buildZamboni, in
// feet) scaled 1:1, its length along the piece's front. `seat` is the driver's, from the piece's middle:
// `fwd` towards the nose, `side` to the right as the machine faces (the driver sits on its left), `h` the cushion's top.
export const RESURFACER = Object.freeze({ l: 3.4, w: 2.3, h: 1.85, seat: Object.freeze({ fwd: -0.78, side: -0.46, h: 0.98 }) });

// The routine at each intermission, ms. Boarding is the walk from the post to the machine and climbing on;
// the drive is out through the door (or back in); alighting is climbing down and walking back.
export const CREW = Object.freeze({ walk: 4000, climb: 2500, drive: 6500, alight: 2500, back: 4000,
  // the break has to have this long left for him to go out at all, and he comes back in this long before it ends
  least: 75000, lead: 20000 });
// Where the routine is `ms` after its phase began: { step, k } with k 0..1 through the step.
// Phases (crew.js): 'board' walk then climb, 'leave' the drive out, 'away', 'return' the drive in, 'alight' then 'back'.
export function crewStep(phase, ms) {
  const steps = phase === 'board' ? [['walk', CREW.walk], ['climb', CREW.climb]]
    : phase === 'leave' || phase === 'return' ? [[phase, CREW.drive]]
      : phase === 'alight' ? [['alight', CREW.alight], ['back', CREW.back]] : [[phase, 0]];
  let t = Math.max(0, ms);
  for (const [step, d] of steps) { if (t < d || !d) return { step, k: d ? t / d : 1 }; t -= d; }
  const [step] = steps[steps.length - 1];
  return { step, k: 1, done: true };
}
export const crewPhaseMs = (phase) => (phase === 'board' ? CREW.walk + CREW.climb : phase === 'leave' || phase === 'return' ? CREW.drive : phase === 'alight' ? CREW.alight + CREW.back : 0);

// How a ticket reads on a seat door's card: "Sit: Centre Lower, Row C, Seat 7", or when it's for later
// "Upper Centre, Row A, Seat 2 (tomorrow at 20:00)"; `cmd` is the verb its button sends.
export function ticketActs(tickets, door) {
  const want = Array.isArray(door?.sections) ? door.sections : null;
  return (tickets || []).filter((t) => (!door?.stands || t.venue === door.stands) && (!want || want.includes(t.section)))
    .map((t) => ({ verb: 'ticket', label: t.now ? `Sit: ${t.label}` : `${t.label} (${t.when})`, cmd: t.cmd, ...(t.now ? {} : { later: true }) }));
}
