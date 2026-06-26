/**
 * Item Tag Catalog — single source of truth for item behavior.
 *
 * Every behavioral property an item can have is a tag. This catalog documents
 * what each tag does, what shape its value takes, and how the dev panel should
 * render an editor widget for it. The engine reads behavior from tags; this
 * file is the reference so functionality isn't forgotten as the list grows.
 *
 * Dual-mode by design: the dev panel loads this as a classic <script> (so it
 * can't use a bare `export`), while the Node engine imports it for its side
 * effect and reads the global. Both land on `globalThis.TAG_CATALOG`.
 *
 * shape — drives the dev-panel input widget and serialization:
 *   text    free text (textarea)
 *   flag    valueless marker (stored as `true`)
 *   int     integer
 *   enum    one of `options`
 *   range   { min, max }
 *   hot     heal-over-time { amount, duration_seconds }
 *   statmap JSON object of key -> number (small JSON textarea)
 *
 * scope — 'class' tags live on the item template (items.tags); 'instance' tags
 * are presence-only flags on a carried item (player_inventory.custom_data).
 */
(function (global) {
  const TAG_CATALOG = {
    // --- Core / identity ---
    description: { label: 'Description', shape: 'text', scope: 'class', group: 'Core',
    stackable: { label: 'Stackable', shape: 'flag', scope: 'class', group: 'Core',
    quest_item: { label: 'Quest Item', shape: 'flag', scope: 'class', group: 'Core',
    unique: { label: 'Unique', shape: 'flag', scope: 'class', group: 'Core',

    // --- Type markers (filtering / flavor / routing) ---
    weapon: { label: 'Weapon', shape: 'flag', scope: 'class', group: 'Type',
    consumable: { label: 'Consumable', shape: 'flag', scope: 'class', group: 'Type',
    drug: { label: 'Drug', shape: 'flag', scope: 'class', group: 'Type',
    material: { label: 'Material', shape: 'flag', scope: 'class', group: 'Type',
    currency: { label: 'Currency', shape: 'flag', scope: 'class', group: 'Type',
    misc: { label: 'Misc', shape: 'flag', scope: 'class', group: 'Type',

    // --- Equipment ---
    slot: { label: 'Equip Slot', shape: 'enum', scope: 'class', group: 'Equipment',
      options: ['head', 'torso', 'hands', 'legs', 'feet', 'weapon_hand', 'accessory'],
    armor: { label: 'Armor', shape: 'int', scope: 'class', group: 'Equipment',
    armor_soak: { label: 'Armor Soak', shape: 'statmap', scope: 'class', group: 'Equipment',
    insulation: { label: 'Insulation', shape: 'int', scope: 'class', group: 'Equipment',
    bulkiness: { label: 'Bulkiness', shape: 'int', scope: 'class', group: 'Equipment',
    allowed_layer_range: { label: 'Allowed Layer Range', shape: 'range', scope: 'class', group: 'Equipment',
    gets_wet: { label: 'Gets Wet', shape: 'flag', scope: 'class', group: 'Equipment',
    auto_equip: { label: 'Auto-Equip', shape: 'flag', scope: 'class', group: 'Equipment',
    stat_bonus: { label: 'Stat Bonus', shape: 'statmap', scope: 'class', group: 'Equipment',
    requires: { label: 'Requirements', shape: 'statmap', scope: 'class', group: 'Equipment',

    // --- Combat ---
    damage: { label: 'Damage', shape: 'range', scope: 'class', group: 'Combat',
    weapon_skill: { label: 'Weapon Skill', shape: 'enum', scope: 'class', group: 'Combat',
      options: ['blunt', 'bladed', 'energy'],
    damage_type: { label: 'Damage Type', shape: 'enum', scope: 'class', group: 'Combat',
      options: ['kinetic', 'edged', 'energy', 'fire', 'radiation'],
    status_chance: { label: 'Status Chance', shape: 'statmap', scope: 'class', group: 'Combat',

    // --- Consumable effects ---
    restore_hp: { label: 'Restore HP', shape: 'int', scope: 'class', group: 'Consumable',
    restore_hunger: { label: 'Restore Hunger', shape: 'int', scope: 'class', group: 'Consumable',
    restore_thirst: { label: 'Restore Thirst', shape: 'int', scope: 'class', group: 'Consumable',
    restore_radiation: { label: 'Restore Radiation', shape: 'int', scope: 'class', group: 'Consumable',
    restore_sanity: { label: 'Restore Sanity', shape: 'int', scope: 'class', group: 'Consumable',
    grants_credits: { label: 'Grants Credits', shape: 'int', scope: 'class', group: 'Consumable',
    heal_over_time: { label: 'Heal Over Time', shape: 'hot', scope: 'class', group: 'Consumable',
    well_fed: { label: 'Well-Fed', shape: 'flag', scope: 'class', group: 'Consumable',
    hydrating: { label: 'Hydrating', shape: 'flag', scope: 'class', group: 'Consumable',

    // --- Container ---
    container: { label: 'Container Capacity', shape: 'int', scope: 'class', group: 'Container',

    
    // --- Locks ---
    "lock:hololock": { label: 'Holographic Lock', shape: 'statmap', scope: 'class', group: 'Hardware', help: 'Electronic holographic authorization matrix.', install_lock: 'installHoloLock', uninstall_lock: 'uninstallHoloLock' },
    "lock:keycardlock": { label: 'Magnetic Keycard Reader', shape: 'statmap', scope: 'class', group: 'Hardware', help: 'Magnetic reader checking passcode clearance profiles.', install_lock: 'installKeycardLock', uninstall_lock: 'uninstallKeycardLock' },

    // --- Installation Kits ---
    "lockkit:hololock": { label: 'Hololock Installation Kit', shape: 'flag', scope: 'class', group: 'Tools', help: 'Consumable installation kit used to deploy a holographic lock setup onto a door or frame.' },
    "lockkit:keycardlock": { label: 'Keycard Lock Installation Kit', shape: 'flag', scope: 'class', group: 'Tools', help: 'Consumable installation kit used to deploy a magnetic keycard reader onto a door or frame.' },

    // --- Instance flags (presence-only, on a carried item) ---
    broken: { label: 'Broken', shape: 'flag', scope: 'instance', group: 'Instance',
    cursed: { label: 'Cursed', shape: 'flag', scope: 'instance', group: 'Instance',
  };

  global.TAG_CATALOG = TAG_CATALOG;
})(typeof window !== 'undefined' ? window : globalThis);
