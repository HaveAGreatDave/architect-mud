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
