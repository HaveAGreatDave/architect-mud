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
 * scope — storage semantics for the engine: 'class' tags live on the item
 * template (items.tags); 'instance' tags are presence-only flags on a carried
 * item (player_inventory.custom_data); 'furniture' tags live on a furniture row
 * (furniture.flags). They all surface via tagsOf() the same way.
 *
 * targets — OPTIONAL array controlling which dev-panel editors offer the tag:
 * subset of ['item','furniture']. When present it overrides the default derived
 * from scope, so a single tag can be attachable on both items and furniture
 * (e.g. broadcast_receiver). When absent, applicability is derived from scope
 * (class → item, furniture → furniture, instance → neither; instance flags are
 * runtime-only and never builder-attached). Use tagTargets()/tagAppliesTo().
 */
(function (global) {
  const TAG_CATALOG = {
    // --- Core / identity ---
    description: { label: 'Description', shape: 'text', scope: 'class', group: 'Core',
      help: 'Free text shown on examine / look <item>.' },
    quest_item: { label: 'Quest Item', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Cannot be dropped or sold.' },
    unique: { label: 'Unique', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Prevents stacking. Items stack by default; tag an item Unique to keep each as its own row.' },

    // --- Type markers (filtering / flavor / routing) ---
    weapon: { label: 'Weapon', shape: 'flag', scope: 'class', group: 'Type',
      help: 'Marks a combat weapon. The equipped item with this tag is used when you attack.' },
    consumable: { label: 'Consumable', shape: 'flag', scope: 'class', group: 'Type',
      help: 'Usable via use / eat / drink. Gates the consumable-effect path.' },
    drug: { label: 'Drug', shape: 'flag', scope: 'class', group: 'Type',
      help: 'Marks a drug (visibility/flavor). Mechanics still come from the drugs table joined by item_id.' },
    material: { label: 'Material', shape: 'flag', scope: 'class', group: 'Type',
      help: 'Crafting input. No direct use.' },
    currency: { label: 'Currency', shape: 'flag', scope: 'class', group: 'Type',
      help: 'Credit chip flavor marker. Use grants_credits for the actual payout.' },
    misc: { label: 'Misc', shape: 'flag', scope: 'class', group: 'Type',
      help: 'Catch-all flavor marker for key items, artifacts, accessories.' },

    // --- Equipment ---
    slot: { label: 'Equip Slot', shape: 'enum', scope: 'class', group: 'Equipment',
      options: ['head', 'torso', 'hands', 'legs', 'feet', 'weapon_hand', 'accessory'],
      help: 'Body slot this equips to. Presence of this tag is what makes an item equippable.' },
    armor: { label: 'Armor', shape: 'int', scope: 'class', group: 'Equipment',
      help: 'Flat damage reduction while equipped. Stacks across all worn pieces (legacy; superseded by armor_soak in Phase 5).' },
    armor_soak: { label: 'Armor Soak', shape: 'statmap', scope: 'class', group: 'Equipment',
      help: 'Per-damage-type soak, e.g. { "kinetic": 4, "energy": 1 }. Used when this piece covers the struck body part.' },
    insulation: { label: 'Insulation', shape: 'int', scope: 'class', group: 'Equipment',
      help: 'Thermal insulation in °C. Added to ambient temperature to determine effective temperature for body heat calculations. Stacks across all equipped clothing.' },
    bulkiness: { label: 'Bulkiness', shape: 'int', scope: 'class', group: 'Equipment',
      help: 'Physical thickness of the garment, 1 (paper-thin underwear) to 5 (rigid plate armor). Determines whether the item fits in a layer alongside others.' },
    layer: { label: 'Layer', shape: 'enum', scope: 'class', group: 'Equipment',
      options: ['underwear', 'outerwear', 'armor'],
      help: 'Which of the three worn layers this piece occupies on a body slot (underwear < outerwear < armor, innermost to outermost). Only one item per slot+layer; others see only your outermost layer. Ignored for weapon_hand and accessory. Defaults to outerwear if unset.' },
    covers: { label: 'Also Covers', shape: 'list', scope: 'class', group: 'Equipment',
      help: 'Extra body slots this one garment fills, e.g. ["legs"] on a torso jumpsuit — a single piece that occupies both slots at its layer. Equipping it clears (and is cleared by) anything in the covered slots at that layer; its insulation/armor apply to every covered slot.' },
    gets_wet: { label: 'Gets Wet', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'Accumulates wetness (0–100) when worn in rain or snow. Wet clothing lowers cooling thresholds and speeds heat loss.' },
    sealed: { label: 'Sealed (Respirator)', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'Seals the airway (gas mask / respirator). While equipped, blocks the ashfall choking hazard. Any one sealed item suffices.' },
    auto_equip: { label: 'Auto-Equip', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'When obtained, this item automatically equips to its designated slot if that slot is empty.' },
    stat_bonus: { label: 'Stat Bonus', shape: 'statmap', scope: 'class', group: 'Equipment',
      help: 'Passive stat bumps, e.g. { "stat_brawn": 3 }. Use new stat keys (stat_brawn/reflexes/endurance/brains/cool).' },
    requires: { label: 'Requirements', shape: 'statmap', scope: 'class', group: 'Equipment',
      help: 'Stat gates to equip, e.g. { "stat_brawn": 6 }. Each key must be met or exceeded.' },

    // --- Combat ---
    damage: { label: 'Damage', shape: 'range', scope: 'class', group: 'Combat',
      help: 'Weapon damage roll range { min, max }.' },
    weapon_skill: { label: 'Weapon Skill', shape: 'enum', scope: 'class', group: 'Combat',
      options: ['fists', 'blades', 'clubs', 'firearms', 'science'],
      help: 'Which combat skill earns XP and routes the attack.' },
    damage_type: { label: 'Damage Type', shape: 'enum', scope: 'class', group: 'Combat',
      options: ['kinetic', 'edged', 'energy', 'fire', 'radiation'],
      help: 'Physical damage category. Used to index per-part armor soak on defender.' },
    status_chance: { label: 'Status Chance', shape: 'statmap', scope: 'class', group: 'Combat',
      help: 'Chance to inflict a status, e.g. { "stunned": 0.3 }.' },
    butchering: { label: 'Butchering Tool', shape: 'flag', scope: 'class', group: 'Combat',
      help: 'Carrying any item with this tag lets you butcher corpses (knives, blades, etc.).' },
    demolition: { label: 'Demolition Tool', shape: 'flag', scope: 'class', group: 'Combat',
      help: 'Marks a heavy tool/weapon (sledgehammer, cutting torch, breaching charge) capable of damaging armoured industrial infrastructure — generators and junction boxes. The main power plant can ONLY be damaged by an equipped item with this tag.' },

    // --- Consumable effects ---
    restore_hp: { label: 'Restore HP', shape: 'int', scope: 'class', group: 'Consumable',
      help: 'Instant HP change (can be negative).' },
    restore_hunger: { label: 'Restore Hunger', shape: 'int', scope: 'class', group: 'Consumable',
      help: 'Restores the hunger meter (capped at 100).' },
    restore_thirst: { label: 'Restore Thirst', shape: 'int', scope: 'class', group: 'Consumable',
      targets: ['item', 'furniture'],
      help: 'Restores the thirst meter (capped at 100). On a water-source furniture, sets how much a drink restores.' },
    restore_radiation: { label: 'Restore Radiation', shape: 'int', scope: 'class', group: 'Consumable',
      help: 'Adds/removes radiation (RadAway uses -20).' },
    restore_sanity: { label: 'Restore Sanity', shape: 'int', scope: 'class', group: 'Consumable',
      help: 'Adjusts Sanity (drinks restore it; some items drop it).' },
    grants_credits: { label: 'Grants Credits', shape: 'int', scope: 'class', group: 'Consumable',
      help: 'Currency granted on use (credit chips).' },
    heal_over_time: { label: 'Heal Over Time', shape: 'hot', scope: 'class', group: 'Consumable',
      help: 'Gradual heal { amount, duration_seconds }, ticks once/min, stacks if re-used.' },
    well_fed: { label: 'Well-Fed', shape: 'flag', scope: 'class', group: 'Consumable',
      help: 'Grants the Well-Fed buff (faster HP regen) for 10 minutes.' },
    hydrating: { label: 'Hydrating', shape: 'flag', scope: 'class', group: 'Consumable',
      help: 'Grants the Hydrated buff (faster radiation decay) for 10 minutes.' },

    // --- Container ---
    container: { label: 'Container Capacity', shape: 'int', scope: 'class', group: 'Container',
      help: 'Marks this item as a container. Value is the max total weight it can hold. Contents count at 75% of their weight while carried.' },
    fillable: { label: 'Fillable Capacity', shape: 'int', scope: 'class', group: 'Container',
      help: 'Marks this item as a fillable fluid container. Value is the capacity in fluid units (a neutral volume). Fill at a water source; drink to consume the fluid. How much a fluid restores is a property of the fluid, not the container.' },

    // --- Gear ---
    flashlight: { label: 'Flashlight', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a battery-powered handheld flashlight. LIGHT / UNLIGHT toggle it; RELOAD swaps in a battery. A lit, charged flashlight makes dark rooms readable for the holder. Pair with the Unique tag so each unit keeps its own on/charge state.' },
    battery: { label: 'Battery', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a power cell. Consumed by RELOAD to recharge a flashlight (or other battery-powered device).' },
    hack_device: { label: 'Hacking Device', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as an intrusion deck. Carrying one (in hand, not in a container) is the tool gate for HACK on hololocked doors and for jacking ATM terminals; it is also classed as contraband when jailed. Pair with the Unique tag so each deck keeps its own condition — failed breaches damage it.' },
    fishing_rod: { label: 'Fishing Rod', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a fishing rod. Carrying one (in hand, not in a container) is the tool gate for FISH at a water-adjacent zone. Pair with the Unique tag so each rod keeps its own condition — a botched reel can snap it.' },
    bait: { label: 'Bait', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as fishing bait. Optional while FISHing: one is consumed per catch, shifting the odds toward better catches and unlocking bait-gated fish. A more specific sub-tag (e.g. bait_bloodworm) can gate particular catches.' },

    // --- Locks ---
    "lock:hololock": { label: 'Holographic Lock', shape: 'statmap', scope: 'class', group: 'Hardware', help: 'Electronic holographic authorization matrix.' },
    "lock:keycardlock": { label: 'Magnetic Keycard Reader', shape: 'statmap', scope: 'class', group: 'Hardware', help: 'Magnetic reader checking passcode clearance profiles.' },

    // --- Installation Kits ---
    "lockkit:hololock": { label: 'Hololock Installation Kit', shape: 'flag', scope: 'class', group: 'Tools', help: 'Consumable installation kit used to deploy a holographic lock setup onto a door or frame.' },
    "lockkit:keycardlock": { label: 'Keycard Lock Installation Kit', shape: 'flag', scope: 'class', group: 'Tools', help: 'Consumable installation kit used to deploy a magnetic keycard reader onto a door or frame.' },

    // --- Broadcast ---
    broadcast_receiver: { label: 'Broadcast Receiver', shape: 'flag', scope: 'class', group: 'Broadcast',
      targets: ['item', 'furniture'],
      help: 'Item or furniture can be tuned to a broadcast channel.' },
    broadcast_transmitter: { label: 'Broadcast Transmitter', shape: 'flag', scope: 'class', group: 'Broadcast',
      targets: ['item', 'furniture'],
      help: 'Item or furniture is a camera or microphone (broadcast source).' },
    broadcast_device_type: { label: 'Device Type', shape: 'enum', scope: 'class', group: 'Broadcast',
      targets: ['item', 'furniture'],
      options: ['tv', 'radio', 'security_monitor', 'portable_monitor', 'camera'],
      help: 'Controls how broadcast content is formatted for this device.' },
    media_deck: { label: 'Media Deck', shape: 'flag', scope: 'furniture', group: 'Broadcast',
      help: 'This furniture is a media cassette deck. Players can load/eject cassette items. Broadcasts in deck_cassettes play in the zone instead of scheduled programming.' },
    media_cassette: { label: 'Media Cassette', shape: 'flag', scope: 'class', group: 'Broadcast',
      help: 'This item is a cassette tape. It should also have flags.broadcast_id pointing to a media_broadcasts row.' },

    // --- Furniture capabilities (presence-only, on a furniture row) ---
    water_source: { label: 'Water Source', shape: 'flag', scope: 'furniture', group: 'Capabilities',
      help: 'Players can drink from and wash at this furniture. Enables the water-plugin verbs (drink/wash). The verb is blind to what the furniture is — sink, fountain, well, leaking pipe — it only asks for this capability.' },
    bulletin: { label: 'Bulletin Board', shape: 'flag', scope: 'furniture', group: 'Capabilities',
      help: 'Players can READ this furniture to see the server leaderboard — the top 5 survivors ranked by total XP (ties broken by older account first).' },
    toilet: { label: 'Toilet', shape: 'flag', scope: 'furniture', group: 'Capabilities',
      help: 'Players can sit and relieve themselves here (pee / poop / flush) with privacy. The verbs are blind to what the furniture is — stall, latrine, bucket — they only ask for this capability.' },
    cosmetic_machine: { label: 'Cosmetic Machine', shape: 'flag', scope: 'furniture', group: 'Capabilities',
      help: 'Players can change their appearance here (the morphex/biosculpt verbs). The verb only asks for this capability, not a specific object_type.' },

    // --- Instance flags (presence-only, on a carried item) ---
    broken: { label: 'Broken', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set on a carried instance.' },
    cursed: { label: 'Cursed', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set on a carried instance.' },
  };

  global.TAG_CATALOG = TAG_CATALOG;
})(typeof window !== 'undefined' ? window : globalThis);

// NOTE: applicability helpers (tagTargets / tagAppliesTo) live in the sibling
// tagHelpers.js, NOT here — this file is regenerated verbatim from JSON whenever
// the Tags screen saves the catalog (see apiPutTagCatalog), which would wipe any
// functions defined here.
