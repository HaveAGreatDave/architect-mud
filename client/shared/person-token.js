// A PERSON'S TOKEN: the FNV-1a hash of their id in base 36. It's what a figure's look is rolled from (gl/room-people.js
// streetLook), so somebody is dressed the same on the street (server/engine/street-actors.js, which sends it as `t`),
// in a room walked in GLASS (panels/oneworld-people.js) and on the TV. One copy, so the two sides can't hash apart.
// Collisions are cosmetic (two figures dress alike), and cheap matters more: it runs per person per push.
export function token(id) {
  let h = 0x811c9dc5;
  const s = String(id);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(36);
}
