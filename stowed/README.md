# Stowed content

Content taken out of the world but kept so it can come back. Nothing under `stowed/` is imported.

To bring something back, move its file back to the same folder under `content/` and put it back on whatever sold, dropped or crafted it. To get rid of it for good, delete the file.

## Weapons, stowed 2026-11-22

The weapon list was cut to one per combat skill so it can be built up again:

| Skill | Kept |
|---|---|
| blades | `item_combat_knife`, combat knife |
| clubs | `item_bat`, aluminum bat |
| firearms | `item_ferris_model9`, renamed "service pistol" |
| science | `item_taser`, renamed "taser" |

The other 26 weapons are in `items/`. The Wildblood recipes for the spurblade and the thorn flail are in `recipes/`. They were taken off these vendors: Clinkerman, the fence, Brace, Kade, Vega, Watts, Vessa, the Soak barber, Ferrous, Rindle, Tom Budge and `npc_1784515608920`. Each vendor entry was a plain `{ item_id, price, stock?, min_trust? }` row; the prices are in git history.

Tools that also train a weapon skill (pipe wrench, carapace scraper, fireman's axe, resonant stylus, leaf-spring blade) weren't touched.
