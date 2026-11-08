// What a piece in a room offers, in the order the Room Stage's card lists it. Pure, so a gate can read
// it. The server sends each piece's `acts` (furnitureActs in server/engine/furnitureActions.js); a
// room with no server behind it, the Room Lab, works from the piece's own `verbs`.

const LABELS = {
  sit: 'Sit down', lie: 'Lie down', sleep: 'Sleep', lean: 'Lean on it', watch: 'Watch', open: 'Open',
  drink: 'Have a drink', fill: 'Fill up', shower: 'Take a shower', flush: 'Flush', pee: 'Pee', poop: 'Poop',
  workspace: 'Cook', launder: 'Wash your clothes', switch: 'Flick the switch', examine: 'Look closer',
};
// Most wanted first. Anything not listed goes after these and before `lean` and `examine`.
const RANK = ['sit', 'lie', 'sleep', 'watch', 'open', 'shower', 'pee', 'poop', 'flush', 'workspace', 'drink', 'fill'];
const LAST = ['lean', 'examine'];
const rankOf = (v) => { const i = RANK.indexOf(v); if (i >= 0) return i; const j = LAST.indexOf(v); return j >= 0 ? 100 + j : 50; };
const labelOf = (v) => LABELS[v] || v[0].toUpperCase() + v.slice(1);
const ON = new Set(['sit', 'lie', 'lean', 'watch']);

// `seats` is the layout's seats on this piece: a seat you can see is always a seat you can try.
export function pieceActs(piece, seats = []) {
  const acts = new Map();
  const add = (verb, cmd) => { if (verb && !acts.has(verb)) acts.set(verb, { verb, cmd: cmd ?? `${verb} ${ON.has(verb) ? 'on ' : ''}${piece.name}`, label: labelOf(verb) }); };
  for (const a of piece.acts || []) add(a.verb, a.cmd);
  if (!piece.acts) { for (const v of piece.verbs || []) add(v); if (piece.container) add('open'); }
  for (const s of seats) add(s.lie ? 'lie' : 'sit');
  add('examine');
  // a bed is for lying on, though you can sit on one
  const first = piece.arche === 'bed' ? 'lie' : null;
  return [...acts.values()].sort((a, b) => (b.verb === first) - (a.verb === first) || rankOf(a.verb) - rankOf(b.verb));
}
