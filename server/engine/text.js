// Display-only name formatting.
//
// Stored names are prose-case (see server/models/temp/normalize-name-case.js):
// generic words lowercase, brand/acronym words capitalized, so prose reads
// naturally ("You pick up a pipe wrench."). But when a name appears in a LIST —
// inventory panel, room "Lying here:"/"Furniture:", a vendor shelf, a loot
// window, the Hostiles line — it reads as an entry, not prose, and should be
// Title Case ("Pipe Wrench").
//
// titleCaseName capitalizes each word's first letter while leaving the rest of
// the word intact, so brand/acronym tokens survive ("EMP drone" -> "EMP Drone",
// not "Emp Drone"; "9mm pistol" -> "9mm Pistol"). Apply it at the list/display
// point only — never mutate the stored name.
export function titleCaseName(name) {
  return String(name || '').replace(/(^|\s)([a-z])/g, (_, sp, ch) => sp + ch.toUpperCase());
}

// Attribute-safe text. MANDATORY for any name interpolated into an action-link's
// data-target/title: a name with a double quote in it (an NPC nickname like
// Grady "Two-Cell" Okonkwo, and so his floor safe) closes the attribute early,
// and the browser then reads data-target as the truncated fragment before the
// quote — Grady's safe silently became `examine grady`, which SIFT resolved to
// something else entirely. Escaping keeps the real name in the attribute, so the
// click sends the whole thing and lands on the piece the player tapped.
export function escAttr(s) {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/"/g, '&quot;');
}

// A room inside a building is shown as "Building - Room", so a player knows where
// they are at a glance. Display only: the stored names stay as written, and they
// were written three ways: bare ("Lobby"), "Building: Room", and the old
// authorBuilding form with an em dash between. A prefix that already names the
// building, with or without its "The", is taken off before the building goes back
// on, so nothing reads the name twice; a room named for its building shows the
// name alone. An em or en dash between words in either name becomes " - " too, so
// the composed name never shows one.
const ROOM_SEP = /^(?:\s*[:,-]\s+|\s+)/;
const dashes = (s) => String(s || '').trim().replace(/\s+[—–]\s+/g, ' - ');
export function composeRoomName(building, room) {
  if (!String(building || '').trim()) return String(room || '').trim();
  const b = dashes(building);
  let r = dashes(room);
  if (!r) return b;
  const bare = b.replace(/^the\s+/i, '');
  const lowR = r.toLowerCase();
  for (const head of new Set([b, bare, `The ${bare}`])) {
    const h = head.toLowerCase();
    if (lowR === h) return b;
    if (!lowR.startsWith(h)) continue;
    const sep = r.slice(head.length).match(ROOM_SEP);
    if (sep && r.length > head.length + sep[0].length) {
      r = r.slice(head.length + sep[0].length);
      break;
    }
  }
  return `${b} - ${r.charAt(0).toUpperCase()}${r.slice(1)}`;
}
