# butchering

**Purpose** — carving up a corpse for parts. A timed, posture-based action on a butcherable body: it needs a butchering tool, the **Butchering** skill gates each individual cut, and a botch ruins that part and leaves the butcher covered in blood.

## Commands
- `butcher` — carve a butcherable corpse.

## Discovery
`butcher` targets an enemy corpse carrying a `corpse.butcher_table`. **Corpse examine cannot surface it** — the engine hardcodes only loot/attack/pinch for corpses. Instead the **loot router** is the discovery path: `loot <corpse>` dispatches BUTCHER when the corpse is empty but still butcherable. This is a known and accepted gap, recorded in the manifest.

## Skill
**Butchering** — gates each cut, so a bad butcher wastes a good carcass.
