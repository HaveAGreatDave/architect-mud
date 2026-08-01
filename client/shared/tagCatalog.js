/**
 * Field Catalog — single source of truth for what a thing can be given.
 *
 * Every behavioral property an item, furniture piece or zone can have is a tag,
 * and every editable zone COLUMN is catalogued here too. This file documents what
 * each field does, what shape its value takes, and how an editor should render a
 * widget for it. The engine reads behavior from tags; this file is the reference
 * so functionality isn't forgotten as the list grows, and it is what the map
 * Studio will generate its entire field editor from — one catalog entry and a new
 * system's flag becomes editable, grouped, labelled, with help text.
 *
 * (Still named tagCatalog.js. The honest rename is deferred — see
 * docs/proposals/map-pipeline-spec.md §3.)
 *
 * Dual-mode by design: the dev panel loads this as a classic <script> (so it
 * can't use a bare `export`), while the Node engine imports it for its side
 * effect and reads the global. Both land on `globalThis.TAG_CATALOG`.
 *
 * shape — drives the editor widget, serialization, and validateTags():
 *   text    free text (textarea)
 *   flag    valueless marker (stored as `true`)
 *   tristate unset / true / false, where FALSE IS LOAD-BEARING. For a property a
 *           terrain presets and a tile overrides: absent = inherit the preset,
 *           false = explicitly not this. `flag` cannot express the last one —
 *           there absence and false are the same signal. Editors render a
 *           three-way select, not a checkbox. See
 *           docs/proposals/terrain-property-presets.md
 *   number  any number (integers included — `int` was collapsed into this)
 *   enum    one of `options`
 *   ref     an id in another table; `refTable` names it. Buys a picker in the
 *           editor and a resolution check in content:lint, which is the only
 *           thing standing between a typo and a silently inert reference — none
 *           of these live in a column, so Postgres has no foreign key to break.
 *   list    JSON array
 *   object  JSON object with its own internal shape (checkpoint_cfg, greeter…)
 *   range   { min, max }
 *   hot     heal-over-time { amount, duration_seconds }
 *   statmap JSON object of key -> number (small JSON textarea)
 *
 * scope — storage semantics for the engine: 'class' tags live on the item
 * template (items.tags); 'instance' tags are presence-only flags on a carried
 * item (player_inventory.custom_data); 'furniture' tags live on a furniture row
 * (furniture.flags); 'zone' tags live in zones.flags. They all surface via
 * tagsOf() the same way.
 *
 * 'zone_column' is the exception: those entries describe a real COLUMN of the
 * zones table, not a key in a flags bag, and they are keyed `zone:<column>` so a
 * column can never collide with a flag of the same name (`description` is both).
 * validateZoneColumns() checks them; tagsOf()/validateTags() never see them.
 *
 * order — OPTIONAL number for sorting within a `group`. Absent sorts last.
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
    no_repair: { label: 'Cannot Be Repaired', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Opt-OUT of repair. Anything that wears (weapon / armour / body-slot apparel / tool) is repairable by default and needs no tag — use this only for the rare thing that genuinely cannot be fixed at a bench (sealed chrome, burned firmware). See docs/systems-durability.md.' },
    wear_rate: { label: 'Wear Rate', shape: 'number', scope: 'class', group: 'Core',
      help: 'Rarely needed override. Durability is derived from the item\'s value; set this only when that formula is wrong for a specific item. Higher = wears faster.' },
    repair_kit: { label: 'Repair Kit', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Lets the carrier field-repair worn gear (capped at Battered — proper restoration needs a repairman).' },
    syringe: { label: 'Syringe', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Delivered by INJECT, never by eat/use/drink. Pairs with a drug row whose flags carry `injectable` and (optionally) `requires_site` — a drug that names a site does nothing at all if you put it anywhere else.' },
    bodily_filth: { label: 'Bodily Filth', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Produced by relieving yourself (or finishing) into a carried vessel. Cooks like any other ingredient and taints the whole dish — anything made with it carries the filth through to the plate. MIS/bodily only.' },
    disease_risk: { label: 'Disease Risk', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Eating this can transmit an infection from whoever produced it, on top of its ordinary food-poisoning chance.' },
    soap: { label: 'Soap', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Carried soap. Makes a wash at a sink or in open water count as a FULL clean (resets the hygiene clock rather than just rinsing what is on you).' },
    cleaning_tool: { label: 'Cleaning Tool', shape: 'flag', scope: 'class', group: 'Core',
      help: 'A mop, brush, rag or utility sink. CLEAN/MOP with one of these clears every stain on the floor in a single action instead of one patch at a time, and costs less sweat. Works as an item you carry OR as furniture standing in the room.' },
    consumable_cleaner: { label: 'Consumable Cleaner', shape: 'flag', scope: 'class', group: 'Core',
      help: 'A bottle of something that cleans and is USED UP doing it (acetone, bleach). Cleans a floor like a Cleaning Tool, but spends a unit per use — so the resolver reaches for a mop or brush FIRST and only falls back to this when there is no reusable tool to hand. Pair with cleaning_tool on the same item.' },
    spray_paint: { label: 'Spray Paint', shape: 'flag', scope: 'class', group: 'Core',
      help: 'A can of aerosol paint. TAG a building on an adjacent exit with one; the can is spent doing it (one tag, one can). Nothing else gates the verb — no skill, no stat. Removing the result needs a Cleaning Tool: bare hands do floor filth, not brickwork.' },
    condom: { label: 'Protection', shape: 'flag', scope: 'class', group: 'Core',
      help: 'Consumed at the start of a penetrative MIS act, dropping infection risk to near zero (never zero). MIS only.' },

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
    armor_soak: { label: 'Armor Soak', shape: 'statmap', scope: 'class', group: 'Equipment',
      help: 'Per-damage-type soak, e.g. { "kinetic": 4, "energy": 1 }. Used when this piece covers the struck body part.' },
    insulation: { label: 'Insulation', shape: 'number', scope: 'class', group: 'Equipment',
      help: 'Thermal insulation in °C. Added to ambient temperature to determine effective temperature for body heat calculations. Stacks across all equipped clothing.' },
    bulkiness: { label: 'Bulkiness', shape: 'number', scope: 'class', group: 'Equipment',
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
    waterproof: { label: 'Waterproof (Acid Shield)', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'Sheds falling liquid. Shields the slots this garment actually occupies (its own slot plus anything in `covers`) from the acid-rain burn, and exempts the piece itself from acid corrosion. Unlike `sealed`, protection is COVERAGE-based — head, torso, legs and feet must all be covered for full immunity; partial cover only scales the burn down.' },
    hydrophobic: { label: 'Insulates Wet', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'This garment keeps its `insulation` when soaked. Wool, neoprene, sealed shells and wicking synthetics do; cotton, denim and padding do not, and lose most of their value wet — which is why "cotton kills". Without this tag a soaked garment contributes almost nothing against the cold, so a rained-on hoodie is genuinely dangerous and a wet wool sweater is not. Also makes the piece less stifling in the heat, since the same water is not being trapped against you.' },
    windproof: { label: 'Windproof (Shell)', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'A sealed outer face the wind cannot get through. Gives back the WIND CHILL share of the feels-like temperature for the slots this garment covers — torso is worth about two thirds of it, legs the rest — so a shell is what makes a gale survivable rather than merely a warmer coat. Does nothing about the actual air temperature: windproof is not insulation, and a windproof shell over nothing still leaves you in the cold.' },
    electronic: { label: 'Electronic', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'Carries live circuitry. An EMP / ion storm pulse fries an unshielded carried item with this tag (sets the `fried` instance flag), leaving it dead until repaired at a bench.' },
    shielded: { label: 'EMP Shielded', shape: 'flag', scope: 'class', group: 'Equipment',
      help: 'Faraday shielding. The item itself is immune to an EMP pulse, and — if it is also a container — so is everything inside it.' },
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
    min_skill: { label: 'Minimum Skill', shape: 'object', scope: 'class', group: 'Combat',
      help: 'Skill required to handle this weapon, e.g. { "blades": 6 }. TWO different gates: a vendor will REFUSE TO SELL it to anyone under the bar (hard), while actually using one you are short on merely makes you terrible with it — to-hit drops by the shortfall and damage falls up to 75% (soft). That split is deliberate: you can never buy your way past the ladder, but a weapon looted off a corpse is still yours to struggle with. Skill ids are the ones in skills.js (blades, clubs, firearms, science, fists).' },
    waterproof: { label: 'Works In Water', shape: 'flag', scope: 'class', group: 'Combat',
      help: 'Exempts this weapon from the water combat penalty. By default a FIREARM will not fire at all while you are in water (wet powder), and every melee weapon swings slower and lands at a fraction of its damage until high skill claws it back. Tag anything actually designed for it — a speargun, a diving knife — and it fights normally.' },
    water_shock: { label: 'Discharges In Water', shape: 'flag', scope: 'class', group: 'Combat',
      help: 'Using this weapon while in water dumps its charge into the water instead of the target: everyone in the zone takes the hit, INCLUDING the person holding it. For electrical weapons (the ComplyMate taser). Overrides the ordinary water penalty — it works fine, it just works on everybody.' },
    spread: { label: 'Spread (pellet groups)', shape: 'number', scope: 'class', group: 'Combat',
      help: 'Buckshot. The blast lands as this many SEPARATE impacts (2-4), each rolling its own body part and soaked separately by the armour covering it, then summed for HP. Absent or 1 = one impact, the way every weapon has always worked. Use it to make a heavy shotgun frightening without letting it saturate the injury curve: one 18-34 slug cleared the Maimed bar on nearly every hit at every armour tier, while the same damage split three ways lands several ordinary wounds and lets armour matter again (soak is subtracted once per group, so plate is far better against shot than against a slug).' },
    demolition_damage: { label: 'Demolition Damage', shape: 'range', scope: 'class', group: 'Combat',
      help: 'Damage roll { "min": N, "max": N } used ONLY against destructible infrastructure, in place of `damage`. Exists because industrial soak is brutal (the Coldwater generator absorbs 25 per hit) while people are not: a sledgehammer needs to roll 40-70 to scratch a generator casing, and that same roll one-shot a 40 HP player and maimed on every landed blow. Split the two and each stays sane. Falls back to `damage` when absent, so only demolition tools need it.' },

    // --- Cooking ---
    needs_cooking: { label: 'Needs Cooking', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Consumable is dangerous raw — eating it before the instance is cooked (see the `cooked` instance flag) applies food poisoning instead of its normal restores. Gates the `cook` verb (plugins/cooking).' },
    heater_target_c: { label: 'Heater Target (C)', shape: 'number', scope: 'furniture', group: 'Cooking',
      help: 'This piece HOLDS its room at this temperature. A target, not an offset, so it makes a freezing room habitable and does nothing to a warm one - leaving it on in summer is wasteful, never lethal. Two heaters in a room are not twice as warm; the higher target wins. Needs power: on mains whenever the grid is up, otherwise on its own battery (see heater_battery_min). Read by plugins/warmth via the engine heat-source seam, so the body-temp drift, frostbite and the HUD thermometer all see the same number.' },
    heater_battery_min: { label: 'Heater Battery (game-min)', shape: 'number', scope: 'furniture', group: 'Cooking',
      help: 'How many GAME-minutes the heater runs with no grid behind it (default 720 = 12 in-game hours). Mains recharges it at half the discharge rate, so a full top-up is a day and a heater that carried you through last night is not automatically ready for tonight. This is the whole point of the object: HVAC dies in a blackout and an unheated room bleeds toward outdoor temperature, so the battery is what stands between a cold snap and a body.' },
    microwave: { label: 'Microwave', shape: 'flag', scope: 'furniture', group: 'Cooking',
      help: 'This furniture is a microwave — its own appliance, NOT a stove tier. Fastest cook in the game and far and away the best defroster, but it browns nothing: a hard quality ceiling no skill, prep or vessel can lift, no fond, and no handling at all (the door is shut and it is going round). The right tool for leftovers and thawing, the wrong one for anything you wanted to be proud of. Constants live in plugins/cooking/config.js as MICROWAVE_*.' },
    stove_tier: { label: 'Stove Tier', shape: 'enum', scope: 'furniture', group: 'Cooking',
      options: ['low', 'mid', 'high'],
      help: 'Marks this furniture as a stove and sets its cook-speed multiplier (low 1.0x, mid 1.5x, high 2.5x). See plugins/cooking.' },
    portable_oven: { label: 'Portable Oven', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Marks this item as a carried cooking appliance — the `cook` verb uses it when no room stove is available. Carry it uncontained (the fishing_rod/mining_tool tool-gate pattern). Pair with oven_capacity_g.' },
    oven_capacity_g: { label: 'Oven Capacity (g)', shape: 'number', scope: 'class', group: 'Cooking',
      help: 'Max food weight (grams) a portable_oven can cook at once — heavier food is refused outright ("small amounts only").' },
    food_profile: { label: 'Food Profile', shape: 'enum', scope: 'class', group: 'Cooking',
      options: ['dense_meat', 'starchy_vegetable', 'dry_starch', 'soft_vegetable', 'fruit', 'liquid', 'batter', 'egg', 'preserved', 'fat_or_oil', 'aromatic', 'dairy', 'bread'],
      help: 'Opts this food into deep cooking: a peak window it can be plated in, a burn point past it, handling that matters (flip/stir), and a quality band stamped by `plate` that scales its restores. Also the ingredient CLASS the dish matcher combines on (plugins/cooking/dishes.js) — a recipe asks for "one liquid, one dense meat", never for a specific item, so a new food with an existing profile joins every dish that profile fits. The profile catalog lives in plugins/cooking/profiles.js. Food without this tag keeps the plain raw→cooked behaviour.' },
    // NOT `material` — that name is long since taken by the crafting-material
    // flag at the top of this file, and a duplicate key here silently overwrites
    // it rather than erroring.
    sound_material: { label: 'Acoustic Material', shape: 'enum', scope: 'class', group: 'Cooking',
      options: ['hard_food', 'soft_food', 'wet_meat', 'bone', 'dough', 'fat', 'liquid', 'thick_sauce', 'bread', 'dairy'],
      help: 'OVERRIDE for how this sounds under a knife or in a pan. Almost never needed — the food_profile already picks a sensible acoustic class, and a carrot and a potato are indistinguishable at any resolution a game client reproduces. Set it only for genuine outliers whose class is wrong: a bone in a haunch, a husk, a shell. Absent, the class is used.' },
    sense_damp: { label: 'Sense Damping', shape: 'statmap', scope: 'class', group: 'Equipment',
      help: 'Worn gear that deliberately DULLS a sense: { "smell": -2 }. Negative numbers only — this is protection, not enhancement. It cuts what you perceive AND raises the strength something needs to overwhelm you, which is the whole trade: a respirator keeps a keen nose from being blown out in a charnel house, at the cost of not being a keen nose while you wear it. Sums across every equipped item. Senses: smell, hearing, sight, touch.' },
    food_also: { label: 'Also Counts As', shape: 'enum', scope: 'class', group: 'Cooking',
      options: ['dense_meat', 'starchy_vegetable', 'dry_starch', 'soft_vegetable', 'fruit', 'liquid', 'batter', 'egg', 'preserved', 'fat_or_oil', 'aromatic', 'dairy', 'bread'],
      help: 'A SECOND ingredient class this satisfies in recipes, without being it. Milk is the case: food_profile "liquid" (it cooks like one — one timeline, one set of stage prose) plus food_also "dairy" (a recipe asking for dairy accepts it). A secondary can only ever HELP a match: it satisfies a `needs` entry but never counts toward the allowed-profile check, so adding one can never stop an item matching something it already matched. Contributes the same unit count as the primary, never recounted against its own unitWeight.' },
    food_noun: { label: 'Food Noun', shape: 'text', scope: 'class', group: 'Cooking',
      help: 'The word this ingredient lends to a derived dish name ("fish" → "fish and potato stew"). Optional: without it the item name is used, minus state words (raw/fresh/frozen/dried). Set it when the item name reads badly in a dish ("fresh catch" → "catch and potato stew").' },
    vessel: { label: 'Cooking Vessel', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Marks this container as a pan/pot: `heat <vessel>` puts it and everything in it on the stove. Requires the Container tag for its capacity. Pair with heat_distribution and heat_retention; cooking without a vessel works but cooks worse.' },
    vessel_kind: { label: 'Vessel Kind', shape: 'enum', scope: 'class', group: 'Cooking',
      options: ['pan', 'pot', 'tray', 'bowl', 'bread'],
      help: 'Which dishes this vessel can produce — a stew needs a pot, a sear needs a pan, a roast needs a tray, a dip needs a bowl, a sandwich needs bread (plugins/cooking/dishes.js). A bowl and bread are worked, not heated. Only meaningful alongside `vessel`; a vessel without it still cooks its contents but can never resolve them into a dish.' },
    // ── Drinks (plugins/drinks) ────────────────────────────────────────────
    // Drinks are DOSED, not weighed — there is no gram anywhere in this group.
    // `pour_units` is the unit and a pour is 25ml (plugins/drinks/config.js).
    drink_profile: { label: 'Drink Class', shape: 'enum', scope: 'class', group: 'Drinks',
      options: ['base_spirit', 'liqueur', 'fortified', 'wine', 'beer_base', 'mixer', 'juice', 'syrup', 'bitters',
                'dairy_cream', 'coffee_base', 'tea_base', 'cocoa_base', 'ice', 'garnish', 'hot_water'],
      help: 'What this counts as in a drink recipe. Recipes match on the multiset of CLASSES in the vessel, never on item ids — tag a new bottle with an existing class and every recipe that class fits accepts it immediately, with no code change. syrup/bitters/garnish are MODIFIERS: they season a drink rather than composing it, and are measured in dashes rather than measures.' },
    drink_noun: { label: 'Drink Noun', shape: 'text', scope: 'class', group: 'Drinks',
      help: 'The word this lends to a derived drink name ("gin" → "gin and tonic highball"). Optional: without it the item name is used, minus state words (bottle of / can of / chilled / iced).' },
    pour_units: { label: 'Pours', shape: 'number', scope: 'class', group: 'Drinks',
      help: 'How many 25ml measures one of these rows is. A 700ml bottle is 14; a can of tonic is 2 or 3. This is the unit every drink recipe counts in, and it is also what the recipe card converts back into millilitres. Absent reads as 1, so nothing silently vanishes from a build.' },
    abv: { label: 'ABV %', shape: 'number', scope: 'class', group: 'Drinks',
      help: 'Percent alcohol of THIS ingredient. The only alcohol figure anyone ever authors: a mixed drink derives its whole strength from the ABV and pour count of what went into it (plugins/drinks/alcohol.js) and then lands on the ordinary drug_alcohol path, so intoxication behaves identically to a bottled cocktail. Absent means non-alcoholic, and a drink deriving zero applies no drug at all.' },
    drinkware: { label: 'Drinkware', shape: 'flag', scope: 'class', group: 'Drinks',
      help: 'A REUSABLE drinking vessel — a mug, a glass, a shaker. You mix or brew into it, carry it, drink it down and rinse it out; it is never consumed. Requires the Fillable tag, whose capacity doubles as how many SERVINGS it holds. Not the same thing as a cooking `vessel`.' },
    drinkware_kind: { label: 'Drinkware Kind', shape: 'enum', scope: 'class', group: 'Drinks',
      options: ['cup', 'mug', 'glass', 'tumbler', 'coupe', 'tankard', 'shaker', 'thermos', 'carafe', 'teapot'],
      help: 'Which drinks this vessel can produce — a negroni wants a tumbler or a glass, a shaken drink wants a shaker (and only rewards the shaken bonus in one). Unlike cooking vessels, a recipe may list SEVERAL acceptable kinds, because drinkware is genuinely interchangeable in a way cookware is not. Only meaningful alongside `drinkware`.' },
    insulated: { label: 'Insulated', shape: 'flag', scope: 'class', group: 'Drinks',
      help: 'A thermos. Stretches how long a brewed drink stays hot — hot drinks lose restore value as they cool, derived from when they were brewed rather than ticked, so this is the whole reason to carry the heavier vessel.' },
    fragile: { label: 'Fragile', shape: 'flag', scope: 'class', group: 'Drinks',
      help: 'Glass. AUTHORED BUT NOT YET READ: there is no drop/break seam to hang it off (player_inventory.condition exists but nothing decrements it for a dropped cup), so this is a marker for a future pass rather than live behaviour. Tag glassware with it now so nothing needs backfilling later.' },
    dishware: { label: 'Dishware', shape: 'flag', scope: 'class', group: 'Drinks',
      help: 'A plate, platter or strainer — kitchen kit that is neither a cooking vessel nor drinkware. It has no mechanics of its own; it exists to be owned, stored in a dish cabinet and set on a table. Deliberately NOT tagged `vessel`, so nobody can put a dinner plate on the stove and call it cooking.' },
    dishware_kind: { label: 'Dishware Kind', shape: 'enum', scope: 'class', group: 'Drinks',
      options: ['plate', 'strainer'],
      help: 'Which sort of dishware. Flavour and sorting only — nothing branches on it yet.' },

    edible_vessel: { label: 'Edible Vessel', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'This vessel is EATEN as part of what it makes, instead of surviving the meal like a pan does. Bread is the only one: a sandwich is not fillings served in a bread container, it IS the bread. The vessel is scored as an ingredient, lends its noun to the dish name, and is consumed by `plate`. Only meaningful alongside `vessel`.' },
    spreadable: { label: 'Spreadable', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Can be spread on food with `butter <food>`. Takes a quarter of the item per spread; buttered food counts as the dish\'s fat and carries a small quality bonus. Butter and anything pretending to be it.' },
    recipe_card: { label: 'Recipe Card', shape: 'text', scope: 'class', group: 'Cooking',
      help: 'Makes this item a readable recipe card teaching one dish. The value is the dish key from plugins/cooking/dishes.js (e.g. "stew", "chowder"). READ it to add the recipe to your Cookbook. Knowing a recipe never gates cooking it — it grants a small quality bonus and records it in the tablet app.' },
    heat_distribution: { label: 'Heat Distribution', shape: 'number', scope: 'class', group: 'Cooking',
      help: 'How evenly a vessel spreads heat, 0..1 (a cheap pan ~0.6, a good one ~0.9). Widens the forgiving band between the peak window and burning. Only meaningful alongside `vessel`.' },
    heat_retention: { label: 'Heat Retention', shape: 'number', scope: 'class', group: 'Cooking',
      help: 'How well a vessel holds heat, 0..1 (thin steel ~0.4, heavy cast ~0.8). Widens the peak window itself, so there is more time to plate it right. Only meaningful alongside `vessel`.' },
    utensil: { label: 'Utensil', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'A hand tool for kitchen work — spoon, spatula, tongs, whisk, ladle. Purely a CATEGORY: nothing branches on it, the actual gates are can_stir/can_turn/can_chop. It exists so bulk commands can sweep by category ("drop all utensils", "put all utensils in the drawer") without naming every one. Tag the kitchen tool, not the weapon — a combat knife is not a utensil even though it chops.' },
    can_turn: { label: 'Can Turn Food', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Marks this item as a spatula/tongs. Carrying one uncontained is the tool gate for FLIP on cooking food (the fishing_rod/mining_tool pattern).' },
    can_chop: { label: 'Can Chop Food', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Marks a blade usable for kitchen prep. Combining whole ingredients (meat, roots, vegetables, fruit) in a vessel requires one carried uncontained — cooking a single item on its own does not. Any item tagged  also counts, so every knife in the game already works.' },
    can_stir: { label: 'Can Stir Food', shape: 'flag', scope: 'class', group: 'Cooking',
      help: 'Marks this item as a spoon/ladle. Carrying one uncontained is the tool gate for STIR on cooking liquids.' },

    // --- Consumable effects ---
    use_message: { label: 'Use Message', shape: 'text', scope: 'class', group: 'Consumable',
      help: 'Flavour line shown when the item is consumed via use / eat / drink; falls back to a plain default.' },
    restore_hp: { label: 'Restore HP', shape: 'number', scope: 'class', group: 'Consumable',
      help: 'Instant HP change (can be negative).' },
    restore_hunger: { label: 'Restore Hunger', shape: 'number', scope: 'class', group: 'Consumable',
      help: 'Restores the hunger meter (capped at 100).' },
    restore_thirst: { label: 'Restore Thirst', shape: 'number', scope: 'class', group: 'Consumable',
      targets: ['item', 'furniture'],
      help: 'Restores the thirst meter (capped at 100). On a water-source furniture, sets how much a drink restores.' },
    restore_radiation: { label: 'Restore Radiation', shape: 'number', scope: 'class', group: 'Consumable',
      help: 'Adds/removes radiation (RadAway uses -20).' },
    restore_sanity: { label: 'Restore Sanity', shape: 'number', scope: 'class', group: 'Consumable',
      help: 'Adjusts Sanity (drinks restore it; some items drop it).' },
    grants_credits: { label: 'Grants Credits', shape: 'number', scope: 'class', group: 'Consumable',
      help: 'Currency granted on use (credit chips).' },
    heal_over_time: { label: 'Heal Over Time', shape: 'hot', scope: 'class', group: 'Consumable',
      help: 'Gradual heal { amount, duration_seconds }, ticks once/min, stacks if re-used.' },
    well_fed: { label: 'Well-Fed', shape: 'flag', scope: 'class', group: 'Consumable',
      help: 'Grants the Well-Fed buff (faster HP regen) for 10 minutes.' },
    treat_injury: { label: 'Treat Injury', shape: 'object', scope: 'class', group: 'Consumable',
      help: 'Field medicine for wounds (plugins/injury). { steps, floor, types?, all?, chance? } — steps = severity rungs shed; floor 1 = cannot clear a wound outright (only a clinic can); types narrows it to one damage type (a splint sets fractures, does nothing for burns); all treats every eligible wound at once; chance <1 makes improvised gear fail sometimes.' },
    treat_frostbite: { label: 'Treat Frostbite', shape: 'object', scope: 'class', group: 'Consumable',
      help: 'Field medicine for cold injury (plugins/frostbite). { steps, floor } — steps = stages walked back; floor 1 = cannot clear outright, so the best a kit can do is leave you at frostnip. Only DEEP frostbite actually needs treating (the milder stages thaw on their own), and a deep case is the one injury in the game that never thaws — a kit buys back the use of your hands, a clinic buys back the hands.' },
    warming: { label: 'Warming', shape: 'object', scope: 'class', group: 'Consumable',
      help: 'Takes the edge off the cold for a while. { degrees, minutes } — degrees of effective warmth (the same currency as insulation), tapering linearly to nothing over that many GAME-minutes. Cold side only: a mug of cocoa is thermally negligible against 70kg of body, so this honestly models a defence against cold rather than calories added, and it does nothing in a heatwave. A stronger source refreshes rather than stacks. Hot DRINKS do not use this tag - the drinks plugin scales their warmth by how hot the cup still is.' },
    hydrating: { label: 'Hydrating', shape: 'flag', scope: 'class', group: 'Consumable',
      help: 'Grants the Hydrated buff (faster radiation decay) for 10 minutes.' },
    laced_drug: { label: 'Laced Drug', shape: 'text', scope: 'class', group: 'Consumable',
      help: 'Drug id (e.g. drug_alcohol) this consumable applies as a carrier — the drug\'s onset/effects run, but its own instant restores are skipped in favor of this item\'s restore_* tags.' },
    laced_potency: { label: 'Laced Potency', shape: 'number', scope: 'class', group: 'Consumable',
      help: 'Multiplier applied to the laced drug\'s potency (e.g. 1.6 for a strong pour). Pairs with laced_drug.' },

    // --- Container ---
    container: { label: 'Container Capacity', shape: 'number', scope: 'class', group: 'Container',
      help: 'Marks this item as a container. Value is the max total weight it can hold. Contents count at 75% of their weight while carried.' },
    wardrobe: { label: 'Wardrobe', shape: 'flag', scope: 'furniture', group: 'Container',
      help: 'Marks a container furniture as a wardrobe: it stores clothing like any container, but opens the wardrobe panel instead — saved outfits on the left, a drag-and-drop paper doll in the middle. Requires the furniture to also carry a `container` capacity.' },
    fillable: { label: 'Fillable Capacity', shape: 'number', scope: 'class', group: 'Container',
      help: 'Marks this item as a fillable fluid container. Value is the capacity in fluid units (a neutral volume). Fill at a water source; drink to consume the fluid. How much a fluid restores is a property of the fluid, not the container.' },

    // --- Preservation ---
    perishable: { label: 'Perishable', shape: 'flag', scope: 'class', group: 'Preservation',
      help: 'Marks a consumable as subject to freshness decay. Presence gates the whole freshness system — an item without this tag never gets a freshness checkpoint.' },
    spoil_rate: { label: 'Spoil Rate', shape: 'enum', scope: 'class', group: 'Preservation',
      options: ['fast', 'normal', 'slow'],
      help: 'Selects how quickly a perishable item decays at a given preservation tier (fresh produce vs. packaged/cured goods). Only meaningful alongside perishable.' },
    preservative: { label: 'Preservative', shape: 'flag', scope: 'class', group: 'Preservation',
      help: 'A carried antioxidant/curing chemical the `preserve` verb spends to slow ONE perishable item\'s decay wherever it sits (a vial of BHT). Stacks with refrigeration rather than replacing it, and is refused on food that is already spoiling — it slows rot, it never reverses it.' },
    preserves: { label: 'Preserves', shape: 'enum', scope: 'furniture', group: 'Preservation',
      options: ['refrigerated', 'frozen'],
      help: 'Marks this furniture (or portable container) as an active preservation environment at the given tier. A stronger tier satisfies a weaker requirement. Requires the furniture to also be plugged in and, if it draws power, on a live zone grid — see plugged_in.' },
    plugged_in: { label: 'Plugged In', shape: 'flag', scope: 'furniture', group: 'Preservation',
      help: 'Whether a powered appliance (vending machine, fridge/freezer) is connected to power right now. Absent/unset is treated as plugged in, for backward compatibility with furniture predating this tag. Toggled by the plug/unplug verbs.' },
    aliases: { label: 'Aliases', shape: 'list', scope: 'furniture', group: 'Preservation',
      help: 'Extra names this container furniture also answers to for open/stow/pull, e.g. ["fridge"] on a two-compartment refrigerator so either box opens by the generic name, not just its full product name.' },
    paired_container: { label: 'Paired Container', shape: 'text', scope: 'furniture', group: 'Preservation',
      help: 'Furniture id of a second container that opens alongside this one in the SAME container panel (e.g. a fridge and its separate freezer box) — set on both sides, pointing at each other.' },
    appliance_grade: { label: 'Appliance Grade', shape: 'enum', scope: 'furniture', group: 'Preservation',
      options: ['consumer', 'commercial'],
      help: 'Cosmetic tier for a preserves-tagged container — picks the client container-panel theme (consumer: frosted-glass/condensation; commercial: industrial stainless steel). Only meaningful alongside `preserves`.' },

    // --- Gear ---
    flashlight: { label: 'Flashlight', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a battery-powered handheld flashlight. LIGHT / UNLIGHT toggle it; RELOAD swaps in a battery. A lit, charged flashlight makes dark rooms readable for the holder. Pair with the Unique tag so each unit keeps its own on/charge state.' },
    battery: { label: 'Battery', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a power cell. Consumed by RELOAD to recharge a flashlight (or other battery-powered device).' },
    hack_device: { label: 'Hacking Device', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as an intrusion deck. Carrying one (in hand, not in a container) is the tool gate for HACK on hololocked doors and for jacking ATM terminals; it is also classed as contraband when jailed. Pair with the Unique tag so each deck keeps its own condition — failed breaches damage it.' },
    hack_penalty: { label: 'Hack Penalty', shape: 'number', scope: 'class', group: 'Gear',
      help: 'On a Hacking Device: how much this deck ADDS to every target\'s Hack Difficulty. 0 (or unset) is a clean professional deck. 2 is junk — every hololock, ATM and safe reads two points harder while this is the best deck you are carrying. Only the best deck in your inventory is consulted.' },
    hack_fail_damage: { label: 'Hack Fail Damage', shape: 'number', scope: 'class', group: 'Gear',
      help: 'On a Hacking Device: the fraction of condition (0–1) burned by each FAILED breach. Unset means 0.2 — five failures and the deck is slag. 0.45 means roughly three. This bypasses the usual value-derived durability pool, so a cheap grinder deck is fragile because you said so, not because it was cheap.' },
    fishing_rod: { label: 'Fishing Rod', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a fishing rod. Carrying one (in hand, not in a container) is the tool gate for FISH at a water-adjacent zone. Pair with the Unique tag so each rod keeps its own condition — a botched reel can snap it.' },
    bait: { label: 'Bait', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as fishing bait. Optional while FISHing: one is consumed per catch, shifting the odds toward better catches and unlocking bait-gated fish. A more specific sub-tag (e.g. bait_bloodworm) can gate particular catches.' },
    mining_tool: { label: 'Mining Tool', shape: 'flag', scope: 'class', group: 'Gear',
      help: 'Marks this item as a mining tool (pick, drill, breaker bar). Carrying one (in hand, not in a container) is the tool gate for MINE at a zone with an ore deposit. Pair with the Unique tag so each tool keeps its own condition.' },

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
    emergency_deck: { label: 'Emergency Deck', shape: 'flag', scope: 'furniture', group: 'Broadcast',
      help: "The Echelon's special MediaDeck. AIREMERGENCY (admin) seizes EVERY tuned television in Architect with this deck's loaded bulletin (deck_active); ENDEMERGENCY releases them. The single global counterpart to the per-deck pirate override." },
    teleporter: { label: 'Teleporter', shape: 'flag', scope: 'furniture', group: 'Broadcast',
      help: "A concealed teleporter (yacht plugin). USE it to jump to flags.teleport_target — but only for an approved player; to anyone else it behaves as an ordinary closet. Pairs with teleport_target." },
    teleport_target: { label: 'Teleport Target', shape: 'text', scope: 'furniture', group: 'Broadcast',
      help: 'Destination zone id a teleporter furniture jumps an approved user to.' },
    concealed: { label: 'Concealed', shape: 'flag', scope: 'furniture', group: 'Broadcast',
      help: 'Cosmetic marker: this furniture is a hidden fixture whose true function is not advertised.' },
    beta_cassette: { label: 'Small-Format Cassette', shape: 'flag', scope: 'class', group: 'Broadcast',
      help: 'Marks a cassette as the SMALL format — the fat paperback-sized shell the top-loading tape players take. Carries `media_cassette` too, so a full-size media deck reads it perfectly well; the tag exists so the little players can refuse the big deck cassettes, which physically will not fit. Purely a compatibility marker, no playback behaviour of its own.' },
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
    fried: { label: 'Fried (EMP)', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'This particular `electronic` item was cooked by an EMP / ion storm pulse. It does nothing at all until repaired at a bench. Never dev-panel-editable — written by the weather EMP path, cleared by the repair action.' },
    freshness: { label: 'Freshness', shape: 'statmap', scope: 'instance', group: 'Instance',
      help: 'Runtime-managed freshness checkpoint { value, checkpointAt, envBucket, powerLostAt, additive } for a perishable item instance. `additive` is present only once the item has been dosed by `preserve`, and multiplies the decay rate from then on. Never dev-panel-editable — written and read only by the preservation plugin.' },
    cooked: { label: 'Cooked', shape: 'flag', scope: 'instance', group: 'Instance',
      help: 'Per-item state flag set once a needs_cooking instance finishes cooking. Never dev-panel-editable — written only by the cooking plugin.' },
    cook_quality: { label: 'Cook Quality', shape: 'enum', scope: 'instance', group: 'Instance',
      options: ['poor', 'acceptable', 'good', 'excellent', 'masterful'],
      help: 'Per-item quality band stamped when a food_profile meal is plated. Scales its restores on the eat path (poor 0.5x → masterful 1.6x). Never dev-panel-editable — written only by the cooking plugin.' },
    cooking: { label: 'Cooking', shape: 'statmap', scope: 'instance', group: 'Instance',
      help: 'Runtime-managed cook session { applianceId, startedAt, thawMs, cookMs, plainDoneAt } for an instance mid-cook. Never dev-panel-editable — written and read only by the cooking plugin.' },

    // --- System tags (backfilled from live data by the tag-key sweep; each is
    // read by the named system. bait_* sub-tags are a parameterized family —
    // see the fishing plugin — and are exempted from catalog validation.) ---
    amp_cassette: { label: 'Amp Cassette', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Amp-plugin music cassette. Playable in an amp.' },
    automates: { label: 'Automates Step', shape: 'enum', scope: 'class', group: 'Systems',
      options: ['charge', 'mix', 'pour', 'stir', 'heat', 'rhythm'],
      help: 'Synthesis lab equipment: which splice stage this apparatus automates (SPLICE_STAGES).' },
    interactions: { label: 'Interactions', shape: 'list', scope: 'class', group: 'Systems',
      help: 'Interactable verbs this object offers, e.g. ["switch","sit"]. Each entry surfaces as a present tag via tagsOf() for the specialized-action registry.' },
    battery_max: { label: 'Battery Capacity', shape: 'number', scope: 'class', group: 'Systems',
      help: 'Portable generator battery capacity in kW-minutes (generator plugin / power sim).' },
    boat: { label: 'Boat', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Carrying this rides the player across water dry — no swim stamina cost, no wetness/cold (swimming plugin).' },
    rebreather: { label: 'Rebreather', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Carrying/wearing this supplies air underwater — no breath timer, so you never drown from lack of air (swimming plugin). Stamina still applies.' },
    broadcast_id: { label: 'Broadcast ID', shape: 'text', scope: 'class', group: 'Systems',
      help: 'media_broadcasts row this cassette plays (pairs with media_cassette).' },
    component: { label: 'Component', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Salvaged tech component — crafting/repair input.' },
    concealment_base: { label: 'Concealment Base', shape: 'number', scope: 'class', group: 'Systems',
      help: 'Surveillance device: base difficulty to spot it once planted.' },
    contraband: { label: 'Contraband', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Illegal to carry through government checkpoints; confiscated to the evidence locker on arrest (govgate/jail).' },
    cook_kit: { label: 'Cook Kit', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Portable drug-synthesis kit (synthesis plugin).' },
    device_kind: { label: 'Device Kind', shape: 'text', scope: 'class', group: 'Systems',
      help: 'Surveillance device type: audio_sensor, motion_sensor, drone, jammer, camera…' },
    device_tier: { label: 'Device Tier', shape: 'number', scope: 'class', group: 'Systems',
      help: 'Surveillance device quality tier (1–3).' },
    document: { label: 'Document', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Readable document marker (NPC reactions / flavor).' },
    hack_difficulty: { label: 'Hack Difficulty', shape: 'number', scope: 'class', group: 'Systems',
      help: 'Difficulty of hacking this device (ATM / hackable gear).' },
    lab_upgrade: { label: 'Lab Upgrade', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Synthesis lab upgrade marker. Not currently read by engine code.' },
    crop: { label: 'Legal Crop', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Baled legal agricultural produce — the bottom rung of the Reach dead-drop ladder. Orderable like a raw but tagged NEITHER raw_drug NOR contraband, so it is not a manufacturing felony and customs never scans it. Cures into its finished product via a fabrication recipe, not a chemistry cook.' },
    metal: { label: 'Metal', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Metal material marker (infrastructure repair / crafting).' },
    mule_crate: { label: 'Mule Crate', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Smuggling cargo crate (smuggle plugin).' },
    prologue_holocaster: { label: 'Prologue Holocaster', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'The prologue quest holocaster (prologue plugin).' },
    radioactive: { label: 'Radioactive', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Radioactive cargo/material hazard marker (flight biomes).' },
    raw_drug: { label: 'Raw Drug', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Uncut drug brick — smuggling/flight contract cargo, checkpoint contraband.' },
    reagent: { label: 'Reagent', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Drug-synthesis chemical input (synthesis plugin).' },
    security_gear: { label: 'Security Gear', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Plantable surveillance gear (surveillance plugin).' },
    song_id: { label: 'Song ID', shape: 'text', scope: 'class', group: 'Systems',
      help: 'audio_samples row this music item plays (audio plugin).' },
    specter_program: { label: 'SPECTER Program', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'The SPECTER surveillance tablet-app item (surveillance plugin).' },
    piracy_firmware: { label: 'Pirate Firmware', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Firmware drive `use`d to flash signal-piracy onto the tablet; then `pirate` a media deck (broadcast plugin).' },
    spy_deck: { label: 'Spy Deck', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Surveillance hub deck — reviews planted-device feeds.' },
    stackable: { label: 'Stackable (legacy)', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Legacy no-op: items stack by default (unique opts out). Kept so existing content validates.' },
    trophy: { label: 'Trophy', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Sports-league trophy item.' },
    valuable: { label: 'Valuable', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'High-value flavor marker. Not currently read by engine code.' },
    wired: { label: 'Wired', shape: 'flag', scope: 'class', group: 'Systems',
      help: 'Wired/connected device state marker (infrastructure/graph systems).' },

    // --- Zone tags (scope 'zone': the zones.flags bag, validated on zone save) ---
    sanctuary: { label: 'Sanctuary', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Civilization carve-out — attach DELIBERATELY. Grants combat protection via the protection substrate, safe sleep, AI safe-flee targeting, and suppresses hostile spawns. (Not auto-derived from the legacy is_safe_zone column, which was stamped on most of the map.)' },
    allow_sleep: { label: 'Allow Sleep', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Permit `sleep` in this zone WITHOUT the full sanctuary bundle — grants safe-zone-rate rest but no combat protection / forcefield / spawn suppression. For places like the holding cell where you can doze but stay exposed.' },
    residents_only: { label: 'Residents Only', shape: 'text', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Set to a building name (e.g. "Solenne Residences"): only a player holding a unit in that building may enter — walked in OR ridden to by elevator (residency plugin). For private amenity floors: the Solenne sky pad, a residents\' spa.' },
    residents_only_deny: { label: 'Residents Only: Refusal', shape: 'text', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Optional refusal line shown when `residents_only` turns someone away, in the building\'s own voice. Defaults to a generic "Residents only."' },
    cell_block: { label: 'Cell Block', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Part of the Precinct 9 cell block: a prisoner doing time may walk here WITHOUT it counting as a jailbreak (jail plugin). Only for rooms behind the same locked cell door — a room that reaches the street must never carry this.' },
    radiation: { label: 'Radiation', shape: 'number', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Ambient radiation 0-100. Players gain floor(value × 0.1) rads on entering the zone. Absent = clean. Replaces the radiation_level column.' },
    danger: { label: 'Danger Override', shape: 'enum', scope: 'zone', group: 'Zone: Law & Hazard',
      options: ['safe', 'low', 'medium', 'high', 'lethal'],
      help: 'Manual danger override. Danger is normally inferred from the zone\'s enemy spawns — set this only for hazard-flavor zones with no spawn rows (rad fields, scripted horrors).' },
    lawless: { label: 'Lawless', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Crimes here raise no heat/wanted (surveillance).' },
    unsurveilled: { label: 'Unsurveilled', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Off the Architect\'s grid — the surveillance witness roll (cameras/cops/bystanders) short-circuits to unseen here, so no crime is ever witnessed and no heat is earned. The Long Watch bunker uses this to stay hidden from the machine.' },
    safehouse: { label: 'Safehouse', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Actively launders wanted heat: unseen time bleeds a wanted star three times as fast as lying low on the street. Pair with unsurveilled/sanctuary for a true refuge.' },
    no_spawn: { label: 'No Spawns', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Suppress enemy spawns in this zone.' },
    claimable: { label: 'Claimable Territory', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Corps territory override: force this zone claimable. Absent = derived (claimable when inferred danger isn\'t safe, never apartments).' },
    claimable_asset: { label: 'Claimable Business', shape: 'text', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Corporate Assets: a corp can take this storefront over with "corp asset claim". Value is the asset type key (restaurant, casino, fence, gun_shop, clinic, chem_supply). Needs a vendor NPC in the zone for the sales cut.' },
    aa_site: { label: 'AA Emplacement', shape: 'flag', scope: 'zone', group: 'Zone: Law & Hazard',
      help: 'Exposed anti-aircraft emplacement (aa-sites plugin): the standable tile that fires on overflying aircraft and can be assaulted on foot. Pairs with an aa_sites row.' },

    is_interior: { label: 'Interior', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Indoors — weather/temperature/lighting use the interior model.' },
    is_dreamzone: { label: 'Dreamzone', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'RETIRED — do not use. Marked the old SHARED authored dreamzones, where two people on the same drug met each other inside the hallucination. Every dream and trip is instanced now (private, RAM-only rooms). Kept only so the login rescue still recognises a legacy row.' },
    is_apartment: { label: 'Apartment', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Rentable apartment zone (RENT / LOCK / SLEEP). Pairs with an apartments row.' },
    is_dwelling: { label: 'Dwelling (Lived In)', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Somewhere a person LIVES but nobody rents — a cabin, a penthouse, a bunkroom, a lair. Together with is_apartment this is what isDwellingZone() answers, and an NPC only performs home-life activities in a zone that passes it. Do NOT put it on a workplace: a shop floor or studio stage is where an NPC WORKS, and flagging it makes them tidy the apartment in front of customers.' },
    is_building: { label: 'Building', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Building facade/root — groups interior zones into one building (junction-box power scope, entrance discovery).' },
    facade: { label: 'Facade (Non-Standable)', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'OPT-IN pass-through building tile: stepping onto it auto-forwards into the building\'s interior entry zone (needs an interior map parented on this zone); OUT from inside lands on world_exit_zone. Without this tag a building tile is a normal standable zone — do NOT put it on street tiles that host a building.' },
    building_name: { label: 'Building Name', shape: 'text', scope: 'zone', group: 'Zone: Structure',
      help: 'Display name of the enclosing building.' },
    rent_cost: { label: 'Rent Cost (₵/cycle)', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'AUTHORED weekly rent for this apartment unit (needs is_apartment). Read by authoredRentCost (apartments.js) when a player rents; omit for the 100c default. Ownership/tenancy itself is player data in the apartments table, never content.' },
    is_storefront: { label: 'Storefront (For Sale)', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'A vacant retail unit a PLAYER can buy and trade out of (plugins/storefront: DEED / BUYSHOP / STOCK / WARES / TILL). The terms below are authored here; who holds the deed is player data in the storefronts table, never content. Pair with a `shop_vault` furniture piece for the till.' },
    shop_price: { label: 'Shop: Asking Price (₵)', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'AUTHORED total purchase price for an `is_storefront` unit. The per-cycle instalment is price ÷ shop_term. Omit for the 6000c default.' },
    shop_term: { label: 'Shop: Mortgage Term (cycles)', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'How many 7-game-day instalments clear the mortgage on an `is_storefront` unit. Omit for the 8-cycle default. Clearing the term buys it outright; only shop_upkeep is charged after that.' },
    shop_upkeep: { label: 'Shop: Upkeep (₵/cycle)', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'Rates and power charged every cycle on an `is_storefront` unit AFTER the mortgage clears — so an abandoned shop still eventually lapses instead of squatting the tile forever. Omit for the 40c default.' },
    building_type: { label: 'Building Type', shape: 'text', scope: 'zone', group: 'Zone: Structure',
      help: 'Building category (bar, hotel, store, grocery, …) — controls entrance-discovery flavor text.' },
    floors: { label: 'Floors (Storeys)', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'Explicit storey count for the flight-sim skyline — overrides the per-building-type default so a landmark tower stands taller (or shorter). Read by the windshield building-height formula.' },
    world_exit_zone: { label: 'World Exit Zone', shape: 'ref', refTable: 'zones', scope: 'zone', group: 'Zone: Structure',
      help: 'Exterior seam zone for this building — where OUT ultimately lands. TWO MEANINGS, by where it sits: on a FACADE it is the STREET tile out front (authored, geometry\'s business); on an INTERIOR tile it is the facade again, i.e. the map anchor — which the map owns and pushes, so change that one on the map, not the tile.' },
    entrance: { label: 'Entrance Direction', shape: 'text', scope: 'zone', group: 'Zone: Structure',
      help: 'Authored door side (north/south/east/west) for the map entrance arrow — read by buildingEntranceDir. Baked once from the road graph, NOT inferred at runtime, so terrain painting can never relocate a door. The interior out-exit must mirror this.' },
    utility_room: { label: 'Utility Room', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Building utility room (the junction box lives here).' },
    elevator: { label: 'Elevator', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Elevator car zone.' },
    elevator_floors: { label: 'Elevator Floors', shape: 'list', scope: 'zone', group: 'Zone: Structure',
      help: 'Floor list for the elevator, e.g. [{ "n": 50, "zone": "zone_x", "label": "Concourse" }].' },
    hide_exits: { label: 'Hide Exits', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Suppress the exit/room/building list in the room description; graph (movement, pathfinding, minimap) is untouched. Elevator cars use it so the floor panel is the sole exit UI.' },
    open_sky: { label: 'Open Sky', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Outdoor zone aircraft can overfly/land; on interiors, an open roof.' },
    water_temp_c: { label: 'Water Temperature (°C)', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'Override the temperature a submerged swimmer here drifts toward (default: 12°C surface / 7°C underwater). Lower = hypothermia faster; e.g. 26 for a warm lagoon.' },
    vessel: { label: 'Vessel (boardable from water)', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'This water tile is a boat you can embark/disembark from the water (needs an `in` exit to the vessel interior). The Echelon uses it; future boats too.' },
    always_lit: { label: 'Always Lit', shape: 'flag', scope: 'zone', group: 'Zone: Structure',
      help: 'Never dark regardless of power/time.' },
    rest_multiplier: { label: 'Rest Multiplier', shape: 'number', scope: 'zone', group: 'Zone: Structure',
      help: 'Scales both stamina regen and HP knit-back for anyone resting in this zone (restRegenTick in gameLoop.js). Default 1. Comfort zones raise it — Solenne units 1.5, penthouse 2.0.' },
    terrain: { label: 'Terrain', shape: 'enum', options: ['water', 'underwater', 'road', 'dirt_road', 'asphalt', 'concrete', 'grass', 'park', 'dirt', 'sand', 'gravel', 'dock', 'scrub', 'redrock', 'ash', 'marsh'], scope: 'zone', group: 'Zone: Structure',
      help: 'Ground surface for the map/minimap and the flight-sim ground tint — the authoritative source for zoneTerrain (overrides the inferred surface). Painted in the dev panel: Maps → Terrain mode. Road AND dirt_road tiles auto-tile their connector piece from adjacent road/dirt_road tiles; dirt_road renders as a graded packed-dirt track (brown, wheel ruts, no paint) rather than paved asphalt. NOT render-only for one value: "water" is the SOLE marker for open water — it makes the tile swimmable (stamina, wetness, drowning), impassable to GPS/pathfinding, and a ditching crash to land on. There is no flags.water; test it with zoneTerrain(zone) === \'water\'.' },
    park_feature: { label: 'Park Feature', shape: 'enum', options: ['grove', 'pond', 'benches', 'flowerbeds', 'path'], scope: 'zone', group: 'Zone: Structure',
      help: 'On a "park" terrain tile, forces which flight-sim park dressing it draws (grove/pond/benches/flowerbeds/path) so a park can be laid out symmetrically. Unset → chosen from the tile position hash.' },

    ascendant_campus: { label: 'Ascendant Campus', shape: 'flag', scope: 'zone', group: 'Zone: Ascendant',
      help: 'Marks a world tile as part of the Ascendant stronghold campus (western frontier) — used for ambience and faction framing.' },
    ascension_gate: { label: 'Ascension Gate', shape: 'flag', scope: 'zone', group: 'Zone: Ascendant',
      help: 'The gated entrance tile into the Ascendant campus.' },
    ascendant_vats: { label: 'Ascendant Vats', shape: 'flag', scope: 'zone', group: 'Zone: Ascendant',
      help: 'The cloning/regrowth hall within The Vats.' },
    ascendant_registry: { label: 'Ascendant Registry', shape: 'flag', scope: 'zone', group: 'Zone: Ascendant',
      help: 'The Vats registry desk — intake/enrolment room.' },
    augment_clinic: { label: 'Augment Clinic', shape: 'flag', scope: 'zone', group: 'Zone: Ascendant',
      help: 'A room where cybernetic augments can be installed (Chrome Clinic). Read by the augments plugin.' },
    assurance_policy: { label: 'Cortical Assurance Desk', shape: 'flag', scope: 'zone', group: 'Zone: Ascendant',
      help: 'A desk that sells prepaid cortical-backup restores (the secret Halcyon front). Enables the `policy` verb. Read by the augments plugin.' },

    yacht: { label: 'Yacht (Access-Gated)', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'Marks a zone as part of an invite-only vessel (the yacht plugin). Boarding on foot is blocked for the uninvited; an uninvited player who ends up here anyway (teleport/glitch) is smitten on entry.' },
    echelon: { label: 'The Echelon', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'Identity flag for The Echelon admin superyacht — distinguishes its zones from any future yacht.' },
    echelon_bridge: { label: 'Echelon Bridge', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'The helm room: the SAIL/HELM verb only works while standing here.' },
    echelon_view: { label: 'Echelon Overlook', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'A deck from which you can LOOK out across the Basin (stern lounge, stair landing).' },
    echelon_suite: { label: "Echelon Owner's Suite", shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: "Cyd's private quarters — owner-gated behind the suite hatch; hosts the MIS-gated dancers." },
    echelon_helipad: { label: 'Echelon Helipad', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'The stern landing pad — a Dragonfly (VTOL) can set down here to embark/disembark.' },
    echelon_sundeck: { label: 'Echelon Sun Deck', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'The open-air top-deck lounge with the jacuzzi; beckoned consorts suntan / soak / lounge here (consort plugin area-life).' },
    pier: { label: 'Pier / Jetty', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'A shoreline docking point. When a yacht (the Echelon) comes to rest on the water tile alongside, a gangway exit is auto-wired between them so invited players can board or step ashore.' },
    naval_ambience: { label: 'Naval Ambience', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'Open-deck soundscape: gulls, surf and rigging play here (client yacht-ambience). Set on open-air deck zones so the naval bed is heard on deck but not in the suites/engineering.' },
    engine_ambience: { label: 'Engine Ambience', shape: 'flag', scope: 'zone', group: 'Zone: Echelon',
      help: 'Engine-room rumble plays here (client yacht-ambience), swelling while she makes way (yacht_underway). Set on the engine spaces.' },
    heading: { label: 'Heading (deg)', shape: 'number', scope: 'zone', group: 'Zone: Echelon',
      help: 'RUNTIME-only: the vessel\'s last steered course in degrees (0=N, bow-north), injected onto the live Echelon exterior zone by the yacht plugin from the persisted world flag. Not authored in content — catalogued so the persisted state validates on the zone-flags sweep.' },

    aircraft_cabin: { label: 'Aircraft Cabin', shape: 'text', scope: 'zone', group: 'Zone: Aircraft',
      help: 'Marks a zone as an interior cabin room of a walkable aircraft (the craft-type id, e.g. "leviathan"). The flight plugin binds these coordinate-free rooms to the live aircraft and lets occupants walk between them; the move gate keeps world exits sealed while airborne.' },
    cabin_window: { label: 'Cabin Window', shape: 'flag', scope: 'zone', group: 'Zone: Aircraft',
      help: 'A cabin room with windows: the WINDOW verb opens the through-hull moving-world view from here (reuses the passenger windshield fed by the live map window).' },
    home_slots: { label: 'Home Slots', shape: 'list', scope: 'zone', group: 'Zone: Aircraft',
      help: 'Authored decor anchors a walkable-base room offers, each { id, kind, label } — the owner fills them from the decor catalog (custom_data.home.slots). The shell defines the anchors; per-owner choices are runtime overlays, never zone edits. NOT YET READ BY ANY CODE — the anchors are authored ahead of the decor feature (docs/proposals/leviathan-flying-base.md). Kept deliberately; do not "clean up".' },
    flightdeck: { label: 'Flight Deck', shape: 'flag', scope: 'zone', group: 'Zone: Aircraft',
      help: 'The cockpit room of a walkable aircraft: where the NPC (or player) pilot flies. Home of the TAKE CONTROLS / HAND OFF verbs and the NAV course console (later phases).' },

    district: { label: 'District Override', shape: 'text', scope: 'zone', group: 'Zone: Identity',
      help: 'Override the derived district key (normally from the zone-id prefix; see server/engine/districts.js).' },
    artery: { label: 'Artery (Street Names)', shape: 'list', scope: 'zone', group: 'Zone: Identity',
      help: 'Major street name(s) this zone lies on, e.g. ["The Haul Road"]. Drives traffic ambience and map street labels.' },
    street_life: { label: 'Street Life', shape: 'flag', scope: 'zone', group: 'Zone: Identity',
      help: 'Opts the zone into lived-in ambient NPC street-life routines.' },
    intro_lore: { label: 'Intro Lore', shape: 'text', scope: 'zone', group: 'Zone: Identity',
      help: 'One-time lore text shown on a player\'s first visit.' },
    gps_suggest: { label: 'GPS Suggestion', shape: 'text', scope: 'zone', group: 'Zone: Identity',
      help: 'Destination zone id. The first time a player enters this tile, a one-off GPS route is plotted there (a pre-quest nudge toward a starter NPC/place). Handled by the lore plugin.' },
    gps_suggest_label: { label: 'GPS Suggestion Label', shape: 'text', scope: 'zone', group: 'Zone: Identity',
      help: 'Optional hint text shown with the gps_suggest route line (e.g. why to go there).' },
    region_id: { label: 'Region (spatial)', shape: 'ref', refTable: 'regions', scope: 'zone', group: 'Zone: Identity',
      help: 'Spatial region membership: the regions.id this tile belongs to (dev-panel World Editor). Distinct from "District Override" above (land-use). Selecting/moving a region acts on every zone sharing this id.' },
    // `ref` rather than `text` so the Studio renders a picker of the assets that
    // actually exist and marks a name that doesn't. `zone_icons` is NOT a content
    // table — it is a directory of SVGs, and the Studio's refOptions special-cases it.
    // Everything downstream copes: shapeError only checks 'ref' is a non-empty string,
    // content:lint skips a refTable with no content files ("nothing to check against"),
    // and the dev panel renders any ref as a plain text input.
    icon: { label: 'Map Icon', shape: 'ref', refTable: 'zone_icons', scope: 'zone', group: 'Zone: Identity',
      help: 'OVERRIDE for this tile\'s map art. Names an SVG in client/game/assets/zone-icons/ (without .svg). This is the top rung of deriveFeature — it outranks the building rooftop and road auto-tiling, so a pinned tile keeps this art even when the map around it changes. Leave empty to let the tile derive its own.' },
    prologue: { label: 'Prologue', shape: 'flag', scope: 'zone', group: 'Zone: Identity',
      help: 'Part of the prologue instance.' },

    // ── Zone PROPERTIES: terrain presets them, a tile overrides them ───────────
    // docs/proposals/terrain-property-presets.md. These are the only `tristate`
    // entries in the catalog, and they are tristate for one reason: the override
    // has to be able to say NO. A frozen bay is terrain:'water' with
    // swimmable:false + routable:true — still blue on the map, walked across,
    // and no new terrain type invented. `flag` cannot express that, because there
    // absence and false are the same signal.
    //
    // `presetFrom` is editor copy only: it tells the Studio what to name in the
    // "— inherit (from …)" option so the row reads as an override of something.
    liquid: { label: 'Liquid', shape: 'tristate', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. You are IN this tile rather than ON it — fishing casts into it, and the overland void rim does not exist here. Preset by terrain (water ⇒ liquid). Omit to inherit; set No to force a water tile solid.' },
    swimmable: { label: 'Swimmable', shape: 'tristate', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. Entering costs stamina and applies wetness, drowning and hypothermia. Preset by terrain (water ⇒ swimmable). Set No for a frozen bay; set Yes for a flooded basement on concrete.' },
    routable: { label: 'Routable', shape: 'tristate', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. GPS and pathfinding may cross this tile. Preset by terrain (water ⇒ NOT routable; everything else routable). This is the flag that keeps routes off the basin.' },
    buildable: { label: 'Buildable', shape: 'tristate', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. The dev-panel building tool may place or move a building here. Preset by terrain (water ⇒ NOT buildable). Authoring-only — no player-facing effect.' },
    underwater: { label: 'Underwater', shape: 'tristate', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. A submerged tile below a surface water tile (link up/down): always submerged (a boat does not help), colder, and dark, and it starts a breath timer that drowns you. Preset by the "underwater" terrain, which paints identically to water — the difference is what it does to you, not what it looks like.' },
    frontage: { label: 'Frontage (front-door street)', shape: 'tristate', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. A street a building\'s front door may face onto — the map builder prefers a neighbouring tile with this when choosing which side the entrance goes. Preset by terrain (road). Authoring-only.' },
    // NUMERIC property: shape 'number', not 'tristate'. A number already tells absent
    // from a value, so it needs no third state — the tri-state problem is only a
    // boolean problem. Typed by its default in PROP_DEFAULTS (derive.mjs).
    speed_mult: { label: 'Speed Multiplier', shape: 'number', scope: 'zone', group: 'Zone: Properties', preset: true, presetFrom: 'terrain',
      help: 'OVERRIDE. Movement pacing on this tile — 2 means you cross it in half the time. Preset by terrain (road and dirt_road are 2, everything else 1). Set it to make one stretch slow (rubble, a rutted lane) without inventing a terrain for it.' },

    scavenging_table_id: { label: 'Scavenging Table', shape: 'ref', refTable: 'scavenging_tables', scope: 'zone', group: 'Zone: Systems',
      help: 'Loot table id for SCAVENGE here.' },
    fishing_table_id: { label: 'Fishing Table', shape: 'ref', refTable: 'scavenging_tables', scope: 'zone', group: 'Zone: Systems',
      help: 'Scavenging-table id used for FISH here.' },
    mining_table_id: { label: 'Mining Table', shape: 'ref', refTable: 'scavenging_tables', scope: 'zone', group: 'Zone: Systems',
      help: 'Scavenging-table id used for MINE here.' },
    checkpoint_cfg: { label: 'Checkpoint Config', shape: 'object', scope: 'zone', group: 'Zone: Systems',
      help: 'Security-checkpoint config object driving the checkpoint plugin: { guards, checks:[wanted|contraband], wantedMode:hard|bluff, and one entry predicate insideFlag|fromFlag|fromDistrict }.' },
    gov_enclave: { label: 'Gov Enclave', shape: 'flag', scope: 'zone', group: 'Zone: Systems',
      help: 'Inside the government enclave.' },
    citadel_public: { label: 'Citadel Public Floor', shape: 'flag', scope: 'zone', group: 'Zone: Systems',
      help: 'The public side of Citadel Financial (the Marble Hall). The security vestibule\'s checkpoint_cfg uses this as its fromFlag, so the scan only runs on the way IN off the public floor — not on the way back out of the vault.' },
    greeter: { label: 'Greeter Config', shape: 'object', scope: 'zone', group: 'Zone: Systems',
      help: 'Greeter NPC gate config for this zone (jobboard plugin).' },
    work_venue: { label: 'Work Venue (Steady Work)', shape: 'object', scope: 'zone', group: 'Zone: Systems',
      help: 'Marks this zone as a Steady Work shift venue: { role, wage, employer?, name? }. Players past the XP gate can `clock in` here (work plugin).' },
    mis_ok: { label: 'MIS OK', shape: 'flag', scope: 'zone', group: 'Zone: Systems',
      help: 'Zone-gated NPC consent (see npcs.flags.mis_requires_zone_flag).' },

    curtain: { label: 'The Curtain (perimeter wall)', shape: 'flag', scope: 'zone', group: 'Zone: Perimeter',
      help: 'This tile borders the Architect\'s energy wall along the city\'s land edge. Renders a shimmer-edge on the minimap and a curtain line in the room description; the tile stays sealed (no exit crosses it) except at a perimeter_gate. Owner: perimeter (wildlands).' },
    perimeter_gate: { label: 'Perimeter Gate', shape: 'flag', scope: 'zone', group: 'Zone: Perimeter',
      help: 'The one break in the Curtain — the guarded road out to the wilds. Draws a gate glyph on the minimap and carries the exit through the wall. Owner: perimeter (wildlands).' },
    glacis: { label: 'Glacis (kill-zone)', shape: 'flag', scope: 'zone', group: 'Zone: Perimeter',
      help: 'Outward-facing turret killing-ground just beyond a perimeter_gate — the cleared no-man\'s-land the wall guns sweep. Owner: perimeter (wildlands).' },
    gate_warning: { label: 'Gate Warning', shape: 'text', scope: 'zone', group: 'Zone: Perimeter',
      help: 'One-time spoken briefing the gate guards deliver the first time a player steps onto this perimeter tile — what leaving the city costs and which regions lie past the Curtain. The prose lives here; the gatewarn plugin owns only the once-gating + delivery. Owner: gatewarn.' },
    light_beacon: { label: 'Light Beacon', shape: 'flag', scope: 'zone', group: 'Zone: Perimeter',
      help: 'This tile glows bright enough to flood itself and every same-level tile one grid-step away (the 8 surrounding cells) to full brightness, overriding night, power, and weather. Set on the source tile only; the environment sim expands the spill. Owner: environment (getZoneVisibility).' },

    airfield_id: { label: 'Airfield ID', shape: 'text', scope: 'zone', group: 'Zone: Flight',
      help: 'Which airfield this zone belongs to.' },
    airfield_name: { label: 'Airfield Name', shape: 'text', scope: 'zone', group: 'Zone: Flight',
      help: 'Display name of the airfield.' },
    airfield_charter: { label: 'Airfield: Charter', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'An NPC charter pilot flies you somewhere. Needs a charter_pilot NPC assigned to this field. Independent of the rental desk.' },
    airfield_rental: { label: 'Airfield: Rental', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Self-fly rental desk — `rent` an airframe you pilot yourself. Independent of Charter: a field can offer an NPC ride without renting anything out (Buzzard Field), or vice versa.' },
    charter_vtol_only: { label: 'Charter: VTOL-only', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Charter pad flies the VTOL Dragonfly off-airfield only — no Mule, no self-fly rental desk (e.g. the Echelon helipad).' },
    airfield_vtol_only: { label: 'Airfield: VTOL-only (helipad)', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'A helipad — no runway, so only VTOL/rotorcraft can be bought, rented, or chartered here (fixed-wings are hidden from every roster).' },
    airfield_residents_only: { label: 'Airfield: Residents Only', shape: 'text', scope: 'zone', group: 'Zone: Flight',
      help: 'A PRIVATE field — a building\'s own pad. Set it to the building name (e.g. "Solenne Residences") and only players holding a unit in that building get a field here at all: no bay, no hangar rent/store, no fuel, no services. Pair with `residents_only` on the pad room itself.' },
    airfield_dealer: { label: 'Airfield: Dealer', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Aircraft dealer here.' },
    airfield_fuel: { label: 'Airfield: Fuel', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Fuel vendor here.' },
    airfield_fuels: { label: 'Airfield: Fuel Types', shape: 'list', scope: 'zone', group: 'Zone: Flight',
      help: 'Fuel types sold, e.g. ["avgas","biofuel"].' },
    airfield_lawless: { label: 'Airfield: Lawless', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Airfield outside city law.' },
    airfield_theme: { label: 'Airfield: Theme', shape: 'text', scope: 'zone', group: 'Zone: Flight',
      help: 'Overrides the airport backdrop painted out the canopy (city, docks, yards, slag, wastes, default). Inferred from the zone id when unset.' },
    airfield_surface: { label: 'Airfield: Surface', shape: 'text', scope: 'zone', group: 'Zone: Flight',
      help: 'Runway surface flavour for a rough strip, e.g. "dust" for a packed-dirt frontier field.' },
    fence_cache: { label: 'Fence Cache (dead drop)', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'A raw-drug dead drop the fence air run spawns pallets in. Descriptive only — the authoritative list is FENCE_CACHES in plugins/flight/contracts.js.' },
    airspace_restricted: { label: 'Airspace Restricted', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'AA-gated airspace over this zone.' },
    hangar_interior: { label: 'Hangar Interior', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Inside a hangar.' },
    hangar_interior_zone: { label: 'Hangar Interior Zone', shape: 'ref', refTable: 'zones', scope: 'zone', group: 'Zone: Flight',
      help: 'Link from ramp to hangar interior zone id.' },
    hangar_ramp: { label: 'Hangar Ramp', shape: 'text', scope: 'zone', group: 'Zone: Flight',
      help: 'Hangar ramp (aircraft parking) — holds the paired dock zone id.' },
    insurance_desk: { label: 'Insurance Desk', shape: 'flag', scope: 'zone', group: 'Zone: Flight',
      help: 'Aircraft insurance vendor here.' },
    runway: { label: 'Runway', shape: 'enum', options: ['ns', 'ew', 'pad'], scope: 'zone', group: 'Zone: Flight',
      help: 'Marks a runway tile: "ns"/"ew" is the centreline orientation the flight sim aligns its drawn runway to; "pad" is the surrounding asphalt. Stamped by the zone planner on runway tiles.' },

    // --- Zone COLUMNS (scope 'zone_column') ------------------------------------
    // Not flags — real columns of the zones table. Keyed `zone:<column>` so a
    // column can never collide with a flag of the same name (`description` is
    // both, and a flat catalog can only hold one of them). Without these entries
    // an editor generated from the catalog has no audio field, no prose field and
    // no colours at all — silently, because nothing tells it they exist.
    //
    // Deliberately absent, and regress holds the line on the list: `id` (the
    // frozen pk, spec §4), `flags` (the bag every other entry describes),
    // `exits` (leaving content, spec §5) and `stains` (runtime). The two
    // provenance columns that used to sit on this list — `created_by` and
    // `updated_at` — are no columns at all now: both were write-only, and both
    // were dropped 2026-08-01 with the zone planner. Git is the record.
    'zone:name': { label: 'Name', shape: 'text', scope: 'zone_column', group: 'Zone: Identity', order: 1,
      help: 'The room title shown at the top of every look.' },
    'zone:description': { label: 'Description', shape: 'text', scope: 'zone_column', group: 'Zone: Identity', order: 2,
      help: 'The prose body of a look. Tone authority is docs/story.md.' },
    'zone:ambient_theme': { label: 'Ambient Theme', shape: 'enum', scope: 'zone_column', group: 'Zone: Identity', order: 3,
      options: ['indoors', 'outdoors', 'city', 'urban', 'residential', 'commercial', 'industrial',
                'underground', 'forest', 'waterfront', 'coast', 'ruins', 'wasteland'],
      help: 'Which global ambience pool this tile draws from when it has no ambient_events of its own (world.js). A theme with no pool means no ambience ever fires — content:lint warns about that rather than letting it stay invisible.' },
    'zone:audio_theme_id': { label: 'Audio Theme', shape: 'ref', refTable: 'audio_songs', scope: 'zone_column', group: 'Zone: Identity', order: 4,
      help: 'Procedural music while a player is here. An OVERRIDE: leave it empty and the tile inherits its region default (regions.defaults, see scripts/content/derive.mjs).' },
    'zone:ambient_events': { label: 'Ambient Events', shape: 'list', scope: 'zone_column', group: 'Zone: Identity', order: 5,
      help: 'Per-tile ambience lines, e.g. ["A pipe knocks somewhere in the walls."]. Any entry here wins over the global pool the Ambient Theme selects.' },

    // All three BEAT the terrain palette, on every terrain, with no exception list —
    // and until 2026-08-01 two of them did not, which is why these strings now say
    // what blank gives you rather than only what the field is. Leave one empty and
    // the tile derives it; type one and the map obeys.
    'zone:marker': { label: 'Map Marker', shape: 'text', scope: 'zone_column', group: 'Zone: Presentation', order: 1,
      help: 'Up to 2 characters drawn on the map for this tile. Beats the code the build derives (a building\'s acronym, an apartment\'s floor, a sewer run\'s corridor art). Leave it empty and the tile derives its own; painted ground no longer suppresses it.' },
    'zone:color': { label: 'Marker Colour', shape: 'text', scope: 'zone_column', group: 'Zone: Presentation', order: 2,
      help: 'CSS colour for the marker glyph. Beats the terrain palette. Leave it empty and the tile takes the terrain\'s glyph colour, or a readable contrast against its fill.' },
    'zone:bg_color': { label: 'Tile Colour', shape: 'text', scope: 'zone_column', group: 'Zone: Presentation', order: 3,
      help: 'CSS fill for the tile. Beats the terrain palette. Leave it empty and the tile takes the terrain\'s fill — which is what almost every tile should do; an override is for the one that has earned looking different.' },

    'zone:map_id': { label: 'Map', shape: 'ref', refTable: 'maps', scope: 'zone_column', group: 'Zone: Geometry', order: 1,
      help: 'Which map this tile sits on (map_world for the overworld, an interior map for a room).' },
    'zone:parent_zone': { label: 'Parent Zone', shape: 'ref', refTable: 'zones', scope: 'zone_column', group: 'Zone: Geometry', order: 2,
      help: 'The world tile this tile\'s MAP hangs off. Owned by maps.parent_zone_id and pushed down — content:lint errors if a tile on a map disagrees, so edit it on the map (the Studio\'s map properties), not here. Only a tile on NO map still owns this, where it means the dev panel\'s room grouping.' },
    'zone:grid_x': { label: 'Grid X', shape: 'number', scope: 'zone_column', group: 'Zone: Geometry', order: 3,
      help: 'Column on the map grid. Geometry is authored, never derived.' },
    'zone:grid_y': { label: 'Grid Y', shape: 'number', scope: 'zone_column', group: 'Zone: Geometry', order: 4,
      help: 'Row on the map grid.' },
    'zone:grid_z': { label: 'Grid Z (floor)', shape: 'number', scope: 'zone_column', group: 'Zone: Geometry', order: 5,
      help: 'Floor level. 0 is ground; the knock and stairs checks compare this.' },

    // ── Districts (scope 'district_column') ──────────────────────────────────
    // The land-use neighbourhood a tile reads as. Catalogued for the same reason
    // zone columns are: these were a hardcoded object in engine code, validated by
    // nothing, mirrored by hand in the client — and the mirror had gone four
    // districts stale. Keys are `district:<column>`, so they cannot collide with a
    // flag or a zone column.
    'district:name': { label: 'Name', shape: 'text', scope: 'district_column', group: 'District: Identity', order: 1,
      help: 'Player-facing neighbourhood name, shown with the room and when crossing in. Written the way it reads in a sentence — "the Redline", not "Redline".' },
    'district:color': { label: 'Colour', shape: 'text', scope: 'district_column', group: 'District: Identity', order: 2,
      help: 'CSS colour. Tints the tile on the tablet\'s regional map, fills the legend swatch, and blends the street lines at that zoom. Not the tile fill at normal zoom — terrain owns that.' },
    'district:sort': { label: 'Sort Order', shape: 'number', scope: 'district_column', group: 'District: Identity', order: 3,
      help: 'Display order in authoring tools. Not player-facing.' },
    'district:blurb': { label: 'Mood (first entry)', shape: 'text', scope: 'district_column', group: 'District: Prose', order: 1,
      help: 'One line, shown once — the first time a player ever sets foot in this district.' },
    'district:signature': { label: 'Sensory Lines', shape: 'list', scope: 'district_column', group: 'District: Prose', order: 2,
      help: 'The smell/sound/air pool the district-ambience plugin draws from, OUTDOORS only. An empty list means this district has no sensory layer at all.' },
    'district:landmark': { label: 'Landmark Zone', shape: 'ref', refTable: 'zones', scope: 'district_column', group: 'District: Prose', order: 3,
      help: 'The orienting feature seen from across the district. Pairs with Skyline: both must be set, and the zone must exist, or no skyline line is shown at all.' },
    'district:skyline': { label: 'Skyline Phrase', shape: 'text', scope: 'district_column', group: 'District: Prose', order: 4,
      help: 'How the landmark reads from afar, completing "To the north, ___." — e.g. "the Dread Furnace glows red beyond the fence".' },
    'district:prefixes': { label: 'Legacy Id Prefixes', shape: 'list', scope: 'district_column', group: 'District: Legacy', order: 1,
      help: 'Zone-id prefixes that resolve to this district (zone_<prefix>_…), for the 154 old zones that still classify themselves that way. Every tile on the modern grid is zone_district_<x>_<y> and matches nothing here — those are assigned by painting.' },
  };

  global.TAG_CATALOG = TAG_CATALOG;
})(typeof window !== 'undefined' ? window : globalThis);

// NOTE: applicability helpers (tagTargets / tagAppliesTo) live in the sibling
// tagHelpers.js, NOT here — this file is regenerated verbatim from JSON whenever
// the Tags screen saves the catalog (see apiPutTagCatalog), which would wipe any
// functions defined here.
