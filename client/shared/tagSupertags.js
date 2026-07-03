/**
 * Item Supertag Registry — reusable bundles of tags ("classes" of items), for
 * dev-panel use only.
 *
 * A supertag groups a set of catalog tags (with values) under one name, e.g. a
 * "weapon" supertag carrying { weapon:true, slot:"weapon_hand", ... } so every
 * weapon starts from the same wiring. Applying a supertag to an item in the dev
 * panel is a *one-time template*: its member tags are copied into the item's
 * own editable tag fields once, pre-filled with the supertag's defaults, so the
 * user can adjust sub-values (e.g. `damage`) before saving. There is no ongoing
 * link — editing a supertag definition later does not change items that were
 * already stamped with it.
 *
 * Dual-mode by design, exactly like tagCatalog.js: the dev panel loads this as a
 * classic <script>, while the Node engine imports it for its side effect. Both
 * land on `globalThis.TAG_SUPERTAGS`.
 *
 * Each entry: { label, group, help, members } where `members` is a map of
 * catalog-tag-name -> value (`true` for flag-shaped tags), the same shape an
 * item's `tags` object uses.
 */
(function (global) {
  const TAG_SUPERTAGS = {
    // --- Weapon classes ---
    // One per combat skill. Each supplies the shared weapon wiring (equippable in
    // the weapon hand, a combat weapon, and which skill it trains) plus sensible
    // default damage/type. A weapon's own `damage`/`damage_type` tags override the
    // defaults, so applying a class never changes an authored weapon's numbers.
    weapon_fists: { label: 'Fists Weapon', group: 'Weapons',
      help: 'Knuckles, power fists, cesti — trains the Fists skill.',
      members: { weapon: true, slot: 'weapon_hand', weapon_skill: 'fists', damage_type: 'kinetic', damage: { min: 2, max: 4 } } },
    weapon_blades: { label: 'Bladed Weapon', group: 'Weapons',
      help: 'Knives, machetes, swords — anything with an edge. Trains Blades.',
      members: { weapon: true, slot: 'weapon_hand', weapon_skill: 'blades', damage_type: 'edged', damage: { min: 3, max: 7 } } },
    weapon_clubs: { label: 'Club Weapon', group: 'Weapons',
      help: 'Pipes, bats, sledges, and improvised cudgels. Trains Clubs.',
      members: { weapon: true, slot: 'weapon_hand', weapon_skill: 'clubs', damage_type: 'kinetic', damage: { min: 4, max: 9 } } },
    weapon_firearms: { label: 'Firearm', group: 'Weapons',
      help: 'Pistols, rifles, and anything that chambers a round. Trains Firearms.',
      members: { weapon: true, slot: 'weapon_hand', weapon_skill: 'firearms', damage_type: 'kinetic', damage: { min: 5, max: 10 } } },
    weapon_science: { label: 'Science Weapon', group: 'Weapons',
      help: 'Energy weapons, charges, and homemade bad ideas. Trains Science.',
      members: { weapon: true, slot: 'weapon_hand', weapon_skill: 'science', damage_type: 'energy', damage: { min: 4, max: 9 } } },
  };

  global.TAG_SUPERTAGS = TAG_SUPERTAGS;
})(typeof window !== 'undefined' ? window : globalThis);
