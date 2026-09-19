# psionics

**Purpose** — the Exodus discipline, and the one whose whole design problem is that stating it ruins
it. The full as-built account is [docs/systems-psionics.md](../../docs/systems-psionics.md); this
file is the signpost. The substrate is
[server/engine/psionics.js](../../server/engine/psionics.js), the vocabulary is
[psionics-abilities.js](../../server/engine/psionics-abilities.js), and this plugin is the verbs.

## Deniability is the progression

Codex XIV deliberately leaves psionics unconfirmed — "the Basin's favourite joke" — and Terminus
rules that stating a thing kills it. So **below Seer no output line may claim a mechanism**, and at
Seer the prose may be impossible. The player crossing that line IS the arc.

⚠ **The law lives in ONE function** — `voice()` in [prose.js](prose.js) — with a `CAUSAL_WORDS` ban
that stops "you sense" as firmly as it stops "telepathy", and a `violatesLowRank()` regress seam. A
law spread across forty template strings is a wish, not a law.

## The body pays

The mind is doing something the body was not built to support, so strain is a ladder:
nosebleed → blood from the ears and failing sight → **seizure** (`knockOut`, the cosh's own seam, so
you are killable where you lie) → **real damage through `applyStrikeToPlayer`**, which lets the
injury plugin's observers hang an actual wound off it rather than this plugin authoring one.
Nothing here invents a punishment. The backlash ladder IS the deniability ladder, which is why it
broadcasts to the room.

## Major and minor

`psi_rank` is **depth** and `psi_focus` is **breadth**. Top abilities are `focusOnly` and
unreachable off-major at ANY cost, so there is no build that both takes bodies and walks dreams.
Resistance is **derived** (Cool, Brains, mastery, Static Mind, coprocessor) with deliberately no
second skill.

## Traps

⚠ **The verb-collision trap cost three renames.** `attune` and `pull` are engine builtins and `read`
is a specializedAction in six plugins — and **plugin commands silently beat both classes**, so
checking the `plugin.json` command arrays is NOT sufficient. Grep the engine command map and the
specialized-action registries before claiming a verb.

⚠ **Telekinesis always delivers EXISTING verbs.** `reach` fires `fireSpecializedAction` rather than
reimplementing what it is doing at a distance.

⚠ **`isAwakened` / `psiRank` are sync flag reads** — safe from hot paths, and they must stay that
way.

⚠ **`PSI_CAP`** is `VEIL_CAP`'s sibling and bounds the same class of unreachability.

Telepathy, precognition, biokinesis, projection/dreamwalking, compulsion, the Gate Keeper's Purifier
and the armour taboo are **design**.
