# synthesis

**Purpose** — drug synthesis. Cook reagents into potency-scaled drugs through a **Chemistry** skill check plus a "stabilize the reaction" minigame.

## Commands
- `synthesize` — the unambiguous drug-cooking verb.
- `splice` / `splicepreview` / `splicebegin` / `spliceresolve` — master tier.
- `synthresolve` — the minigame callback.
- `unseal` · `reclaim` — vault access.
- `cooktest` / `splicetest` — dev aids.

## Splicing by typing
Everything the designer panel does has a typed form, so you can splice from a macro, and from the `log` rung, where there's no panel:

- `splice add <drug> [qty]` puts a drug in the next slot (base first, then splice). `splice remove <drug>` takes it out, and `splice qty <drug> <n>` sets how many doses go in.
- `splice name <name>`, `splice clear`, `splice show`.
- `splice preview` gives the difficulty, instability, warnings and effects.
- `splice begin` starts the reaction.

The draft lives in RAM. `splice begin` builds the same payload the panel's SPLICE button sends and hands it to the same `cmdSpliceBegin`, so the odds, the cost and the product don't depend on how you got there. At `log`, bare `splice` writes the bench (what you carry, what's in the cradle, the verbs) and the reaction resolves as a skill check, as every minigame does on that rung. At `visual` and `textgames`, the draft opens in the designer as a `preset`, and `splice begin` presses SPLICE for you, so the stages play from the drugs on screen.

Familiarity carries over in words: below 55% the bench says the effects are unfamiliar, and up to 75% it names the effect types without the numbers, which is what the panel's scrambled label gives away.

`splicepreview` and `splicebegin` read their base64 payload from `raw`. The dispatcher lowercases `args`, and lowercased base64 doesn't decode.

## No portable kit
Raw → processed cooks require a **real chem lab**. Station quality adds a bonus. This is deliberate: the lab is the chokepoint the whole drug economy hangs off.

## The lab is also the vault
A successful lab cook or splice **deposits its product into the chem lab's shared storage vault** — the lab furniture doubles as a container. You do not walk out holding it.

## Hooks
- `furniture.describe` — the chem-lab hub, which is also where `splice` is surfaced as an action-link, **only once your Chemistry is high enough to splice**.

## `cook` vs `synthesize`
`cook` is owned by **plugins/cooking** and routes here via the `synthesis.cook` Action when the room or the argument points at a chem lab. `synthesize` is the escape hatch that always means drugs. The furniture hub surfaces `cook` only.
