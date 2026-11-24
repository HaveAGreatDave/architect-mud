// What a piece in a room offers, in the order the Room Stage's card lists it. Pure, so a gate can read
// it. The server sends each piece's `acts` (furnitureActs in server/engine/furnitureActions.js); a
// room with no server behind it, the Room Lab, works from the piece's own `verbs`.

const LABELS = {
  sit: 'Sit down', lie: 'Lie down', sleep: 'Sleep', lean: 'Lean on it', watch: 'Watch', open: 'Open',
  drink: 'Have a drink', fill: 'Fill up', shower: 'Take a shower', flush: 'Flush', pee: 'Pee', poop: 'Poop',
  workspace: 'Cook', launder: 'Wash your clothes', dress: 'Change clothes', switch: 'Flick the switch', examine: 'Look closer',
  buyticket: 'Buy a ticket', buypack: 'Buy a pack',
};
// Most wanted first. Anything not listed goes after these and before `lean` and `examine`.
const RANK = ['sit', 'lie', 'sleep', 'watch', 'open', 'dress', 'shower', 'pee', 'poop', 'flush', 'workspace', 'drink', 'fill'];
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
  // at a wardrobe you can change: the Room Stage opens the Pack on what you can wear (room-stage.js runAct, room-pack.js)
  if (piece.arche === 'wardrobe') add('dress', 'roompack');
  add('examine');
  // a bed is for lying on, though you can sit on one
  const first = piece.arche === 'bed' ? 'lie' : null;
  return [...acts.values()].sort((a, b) => (b.verb === first) - (a.verb === first) || rankOf(a.verb) - rankOf(b.verb));
}

// What a person offers you, in the same order the Room Stage's card lists it: Talk, and for a dancer on shift (`tip`
// on her, plugins/roomstage) a tip of each size and a private dance. Sat, Get up last. The Stage (room-stage.js) and a
// room walked in GLASS (panels/oneworld-card.js) both read it. Pure.
export const PERSON_TIPS = [10, 50];
export function personActs(p, { sat = false } = {}) {
  const who = String(p.name || '').toLowerCase();
  return [{ verb: 'talk', label: 'Talk', cmd: `talk ${who}` },
    ...(p.tip ? PERSON_TIPS.map((n) => ({ verb: 'tip', label: `Tip ₵${n}`, cmd: `tip ${who} ${n}`, n })) : []),
    ...(p.tip ? [{ verb: 'lapdance', label: 'Private dance ₵150', cmd: `lapdance ${who}` }] : []),
    ...(sat ? [{ verb: 'stand', label: 'Get up', cmd: 'stand' }] : [])];
}

// What a vending machine offers (a piece of form `vendor` with `vend`, plugins/vending): a button for each flavour,
// `vend <machine> <item>`, and pulling it out from the wall to get at its plug. Pulled out, the plug comes first. The
// Room Stage's machine (panels/room-vendor.js) and GLASS's card both read it. Pure.
export function vendorActs(p) {
  const v = p.vend || {}, name = String(p.name || '').toLowerCase();
  const flav = (v.menu || []).map((m) => ({ verb: 'vendpress', item: m.item, label: `${m.label}${m.price ? ` ₵${m.price}` : ''}`, cmd: `vend ${name} ${m.item}` }));
  const nudge = { verb: 'nudge', label: v.out ? 'Push it back' : 'Pull it out from the wall', cmd: `nudge ${name} ${v.out ? 'back' : 'out'}` };
  if (!v.out) return [...flav, nudge];
  const plug = v.plugged === false ? { verb: 'plug', label: 'Plug it back in', cmd: `plug ${name}` } : { verb: 'unplug', label: 'Pull the plug', cmd: `unplug ${name}` };
  return [plug, nudge, ...flav];
}
