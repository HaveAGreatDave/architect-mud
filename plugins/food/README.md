# food

**Purpose** — the food domain. One specialized action, one tag.

## Specialized actions
- `eat` — gated on the `consumable` tag.

## How a consumable is taken

`consumable` says an item runs through the consume path. It does **not** say the
item is food: a bandage, a hand warmer and a credit chip all carry it, because
that is the tag the restore/payout code keys on. Reading it as "edible" is what
once put an Eat button on a roll of gauze.

So the verb an item is actually taken by is derived, in
[itemActions.js](../../server/engine/itemActions.js) — `consumeVerb()` returns one
of `eat`, `drink` or `use`, and every test it makes reads a tag some other system
already needed. Nothing is authored twice, and no existing item was re-tagged.

- applied to a body or spent (`treat_injury`, `treat_frostbite`, `warming`,
  `currency`) → **use**. Checked first: a drawing poultice pulls radiation out of
  you and is still a rag you press against a burn.
- poured (`drink_profile`, `pour_units`, `hydrating`, `mutagen`, or a lone
  `restore_thirst`) → **drink**. Checked before food, because the cooking system
  profiles drinkable things as ingredients too — a bottle of water is a
  `food_profile` and is still a drink.
- fed (`food_profile`, `food_noun`, `restore_hunger`) → **eat**.
- anything else → **use**. A stim, a pill and an amp are consumed but not at a
  table, and there is no fourth verb worth inventing for them.

Two consequences worth knowing. The registry can only gate on a bare tag, so this
plugin still advertises `eat` on everything `consumable`; `itemVerbs()` narrows it
afterwards, which is why the item menu is the display list and never the authority.
And the **refusal lives in `cmdUse`**, not here — `eat` reaches it down two paths
(this plugin's action and the engine builtin behind it), so a gate in either one
would leave the other open. `use` is the generic route and is never refused.

## Commands
None.
