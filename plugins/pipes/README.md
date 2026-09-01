# pipes

Smoking apparatus: personal pipes and shared hookahs.

## Purpose

Every drug in the game until now was a thing you used up in one act — the item
**is** the dose. An apparatus is the opposite shape. You **pack** it, spending
something else, and then you **puff** it, possibly several times, possibly not
all of them yours. So the state that matters is not on the drug and not on the
player, it is on the **bowl**, and the two verbs are the two halves of that.

**The hookah is not just a bigger pipe: its bowl is shared.** One person packs it
and everyone on a hose draws the same charges down. That is the whole reason it
is furniture instead of an item, and it is why the charge count lives on the
furniture rather than on any of the people around it — what the room is sharing
is a number, and there has to be exactly one of it. The per-puff dose is
identical to a pipe's, so a hookah is not a way to get more drug out of one
pellet; it is a way to get the same drug into more people.

## Where each bowl lives, and why they differ

| Apparatus | Declared by | Bowl lives on | Charges |
|---|---|---|---|
| pipe | item tag `smoking_apparatus: pipe` | the item's own `custom_data.bowl` | 3 |
| hookah | furniture flag `hookah: <hose count>` | this plugin's memory | 6 |

A pipe's bowl persists because a pipe is personal property that goes in a pocket
and comes back out tomorrow still loaded. A hookah's is memory-only because
`furniture` has no `custom_data` column to put it in, and because a restart
clearing a shared bowl is the right outcome anyway: nobody is still sitting round
it. Neither is a substrate — nothing outside this plugin reads either one.

## This plugin implements no pharmacology

Puffing calls the engine's `useDrug` with `route: 'smoke'`, an existing route
requiring the existing `smokeable` flag. Tolerance, addiction, the shared
depressant ceiling, overdose, the come-up and the `smoking` plugin's behavioural
layer all behave exactly as they do for a cigarette, and none of them know this
plugin exists. The only thing passed in is the sentence describing the act.

⚠ **The `smoke` route requires `flags.smokeable` on the drug row.** A drug missing
it does not error — `resolveRoute` degrades to neutral, which looks precisely
like the route working. `regress.js` asserts the flag on `drug_opium` by name for
that reason.

## It gates nothing it does not own

The tempting design was "you cannot smoke opium without a pipe", which would mean
this plugin reaching into the drug path to refuse something — the cross-system
coupling the interaction rule forbids. It does not. Raw resin is still chewable
through the ordinary `use` verb at the neutral route, and the apparatus is simply
the better route (×1.15). The pipe is **desirable rather than mandatory**, and no
verb here has an opinion about anybody else's verb.

Likewise, what may be packed is decided by the **drug row**, not a list here: any
drug flagged `smokeable` or `cannabis` burns in a bowl, so a smokeable authored
tomorrow is packable with no edit to this plugin.

## Commands

| Verb | Does |
|---|---|
| `hookah` | Take a free hose off the hookah in the room and settle onto it. `hookah off` lets go. |
| `pack [drug]` | Load the apparatus — the hose in your hand if you have one, otherwise a pipe you are carrying. Refuses a bowl that is still going rather than tipping it out. |
| `puff` | Draw. One pull is one dose. |

`pack` is also registered as a declaration-only specialized action on
`smoking_apparatus`, so examining a pipe advertises it; a verb you can only find
by being told about it is invisible content. `hookah` needs no equivalent — it is
the furniture's own name typed as a verb.

## Letting go

A hose is a thing in your hand. Leaving the room (`zone.entered`), standing up by
any route (`posture.changed`), `stop` and logging out all release it. Posture is
an engine substrate and plenty of things force a stand, so the hose must not
outlive the sitting.

## Content

- `drug_opium` / `item_opium` — poppy tar. Smokeable, opioid, `depressant`.
- `item_opium_pipe` — a long-stemmed pipe, `smoking_apparatus: pipe`.

A hookah is any furniture row carrying `flags.hookah` set to its hose count.
