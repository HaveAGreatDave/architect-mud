// STREET DOORS: the kinds of door a building with a Stage can have in its street doorway, and how its entry room's
// `flags.room.street_door` says which and how it looks. One table for the plan (building-graph.js), the server that
// sends each door to the street view (plugins/roomstage streetDoorsNear) and the renderer that draws it
// (client/game/js/panels/glass/street-doors.js), so a new kind or a new look key is added here and nowhere else.
//
// The doorway itself is not here. Where it stands, how wide it is and how high its head is come off the building's
// model (glass/doorway-measure.js), so the leaves fill the opening the model drew and nothing of the model's own
// door shows round them. See docs/reference/street-doors.md.
//
// No imports: the server, the plan and the browser all load this.

// leaves  how many leaves the door has (a revolving door's are its wings)
// glass   glazed, so the room shows through it; false is a painted leaf or a grille
// auto    opens as you come up to it on foot; false waits for F at the door
// move    how a leaf moves: 'slide' into the wall beside it, 'hinge' about its outer jamb, 'revolve' about the middle
export const DOOR_KINDS = {
  sliding:   { leaves: 2, glass: true,  auto: true,  move: 'slide' },     // an automatic pair, the airport's and the marina's
  swing:     { leaves: 2, glass: true,  auto: true,  move: 'hinge' },     // a hinged pair in metal frames, an old hotel's
  single:    { leaves: 1, glass: true,  auto: true,  move: 'hinge' },     // one glazed leaf, a shop's
  revolving: { leaves: 4, glass: true,  auto: true,  move: 'revolve' },   // four glass wings in a drum, an office lobby's
  plain:     { leaves: 1, glass: false, auto: false, move: 'hinge' },     // one painted leaf, a club's or a back street's
  grille:    { leaves: 1, glass: false, auto: false, move: 'hinge' },     // a steel cage for a door, the Cherry Pit's
};

// The kind a street_door flag asks for. `kind` names it; a flag with no kind is the plain door it always was, or a
// grille when it has `bars`. Null when the room has no street_door at all.
export function streetDoorKind(sd) {
  if (!sd || typeof sd !== 'object') return null;
  if (DOOR_KINDS[sd.kind]) return sd.kind;
  return sd.bars ? 'grille' : 'plain';
}

// The plan's view of a glazed door (building-graph.js): how wide the opening is cut, whether its leaves hinge, and
// `hand`, a hinged door that stays shut from inside until F opens it. Null for a painted door or a grille, which the
// plan cuts as an ordinary doorway.
export function glassDoorOf(sd) {
  const kind = streetDoorKind(sd), K = kind && DOOR_KINDS[kind];
  if (!K || !K.glass) return null;
  const hinge = K.move === 'hinge';
  return { kind, w: Math.max(1.2, Math.min(3, Number(sd.w) || 1.8)), swing: hinge, hand: sd.hand === true, ...(sd.dark ? { dark: true } : {}), ...(HEX.test(sd.glass || '') ? { glass: sd.glass } : {}) };
}

// How the door looks from the street, from the same flag: the glass's tint, the trim round each leaf, a monogram
// or an S pull on the handles, a painted leaf's colour, a grille, a fanlight over a hinged pair, a runner's colour
// out across the pavement, `dark` (black behind the doors instead of the lobby, so the step in is a step into the
// dark and the loading veil), `cx` (tiles along the front, a hint for which of the model's doors it is) and `h`
// (metres, the head when the model has no door of its own to read it from). Null when the flag says none of it.
const HEX = /^#[0-9a-f]{6}$/i;
export function streetDoorLook(sd) {
  if (!sd || typeof sd !== 'object') return null;
  const kind = streetDoorKind(sd);
  const L = {
    ...(sd.glass ? { glass: String(sd.glass) } : {}),
    ...(sd.trim ? { trim: String(sd.trim) } : {}),
    ...(sd.monogram ? { monogram: String(sd.monogram).slice(0, 2) } : {}),
    ...(sd.handle === 's' ? { handle: 's' } : {}),
    ...(sd.leaf ? { leaf: String(sd.leaf) } : {}),
    ...(sd.bars ? { bars: true } : {}),
    // the light in a painted leaf, so the room shows through it: 'porthole', 'half' or 'slot' (the default)
    ...(['porthole', 'half', 'slot'].includes(sd.lite) ? { lite: sd.lite } : {}),
    ...(sd.fanlight ? { fanlight: true } : {}),
    ...(sd.dark ? { dark: true } : {}),
    // `own`: the model draws its own door and its animation (the clone arm's, a fresh clone in the doorway), so
    // nothing is drawn over it; the door is still where you walk in
    ...(sd.own ? { own: true } : {}),
    ...(Number.isFinite(sd.cx) ? { cx: sd.cx } : {}),
    ...(Number.isFinite(sd.h) && sd.h > 1.5 && sd.h < 8 ? { h: sd.h } : {}),
    ...(HEX.test(sd.runner || '') ? { runner: sd.runner } : {}),
    ...(Number.isFinite(sd.runner_m) && sd.runner_m > 0.5 && sd.runner_m < 8 ? { runner_m: sd.runner_m } : {}),
  };
  // the kind rides along only when it says something the plan's slide/swing don't (single, revolving)
  if (kind === 'single' || kind === 'revolving') L.kind = kind;
  return Object.keys(L).length ? L : null;
}
