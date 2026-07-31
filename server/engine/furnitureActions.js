/**
 * Furniture affordances — the single source of truth for "what can you do to this
 * piece of furniture". Drawn from the two authored places affordances actually
 * live: `flags.interactions` (the posture/verb array a designer sets, e.g.
 * ['sit','lean','watch']) and the tag-gated specialized-action registry
 * (`availableActions`, e.g. switch/flip/turn on a switchable light).
 *
 * Both the room description (describe.js emits these as `data-actions` so the
 * mobile smart bar knows each piece's verbs) and `examine` (world.js renders
 * them as clickable Actions links) read from here, so the two can never drift.
 *
 * The design rule the user asked for: everything a piece affords shows by
 * default. The ONLY hardcoded exceptions are the two small sets below —
 * OBJECT_FORM (verbs that read an "on <name>" object) and STRUCTURAL (verbs a
 * caller renders itself, state-dependently, so they don't double up here).
 */
import { availableActions } from './specializedActions.js';
import { escAttr } from './text.js';

// Verbs that act on an "on <name>" object ("sit on couch", "lie on bed").
// Every other verb targets the bare name.
const OBJECT_FORM = new Set(['sit', 'lie', 'lean', 'watch']);

// Verbs handled structurally by the caller (built-ins, or state-dependent links
// like a light's on/off switch), so the generic list never re-emits them.
const STRUCTURAL = new Set(['examine', 'look', 'open', 'close', 'switch', 'flip', 'turn']);

// The canonical, de-duped verb list a furniture entity affords.
// `viewer` (optional) is the player being shown this list — a few verbs hide
// themselves from anyone but the room's owner (see `visibleFor` in
// specializedActions.js), so pass the looking player wherever one is in scope.
export function furnitureVerbs(f, viewer) {
  const seen = new Set();
  const out = [];
  const add = (v) => { if (v && !seen.has(v)) { seen.add(v); out.push(v); } };
  for (const ix of (f.flags?.interactions || [])) add(ix);
  for (const v of availableActions(f, viewer)) add(v);
  return out;
}

// Command target for a verb acting on furniture named `name`.
export function verbTarget(verb, name) {
  return OBJECT_FORM.has(verb) ? `on ${name}` : name;
}

// Clickable action-link spans for the affordances the caller hasn't already
// rendered itself. `exclude` lists verbs the caller emitted structurally (e.g.
// a light's state-aware `switch off`), so they aren't duplicated here.
export function genericFurnitureLinks(f, exclude = [], viewer) {
  const skip = new Set([...STRUCTURAL, ...exclude]);
  const n = f.name.toLowerCase();
  return furnitureVerbs(f, viewer)
    .filter((v) => !skip.has(v))
    .map((v) => `<span class="action-link" data-action="${v}" data-target="${escAttr(verbTarget(v, n))}">${v}</span>`);
}
