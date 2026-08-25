# Plain writing — the house rule against AI prose

**Applies to:** everything we write. Docs, comments, commit messages, READMEs,
player guides, dev-panel copy, chat replies. Player-facing *in-world* prose is
covered too, with the carve-outs in the last section.

This is the `claudish-to-english` spec
([programasweights/claudish](https://github.com/programasweights/claudish),
`specs/claudish-to-english.md`), adopted as a writing standard rather than run as
a service. The rules are theirs; the carve-outs at the bottom are ours.

Adopted 2026-08-24.

## The one-line version

Say the thing once, at the lowest level of abstraction that stays accurate, and
stop.

## What "Claudish" is

The prose style of Claude and Claude Code: polished, contrast-heavy,
metaphorical about structure, process-oriented, and prone to expressing one
simple idea through several abstractions, contrasts and restatements. It reads
well sentence by sentence and says a third of what its length implies.

## Compress

Claudish states the same idea several times in different frames. If clauses or
sentences restate a point, emphasise it without adding information, hang a
metaphor on it, dramatise it, contrast it with an invented alternative, or
summarise a conclusion already given — collapse them into one statement.

A five-sentence passage becoming one sentence is a success, not a loss. Do not
write one output sentence per input sentence. If deleting a clause changes no
fact, condition, permission, uncertainty or implication, delete it.

## Drop the abstraction level

Ordinary verbs and direct relationships beat rhetorical framing, nominalisations
and system metaphors.

| Write | Not |
|---|---|
| Only owners can merge. | Merge authority is restricted to the owner role. |
| Don't launch until the tests pass. | Passing tests is a mandatory launch requirement. |
| The timestamp shows the cache is stale. | The timestamp provides verified evidence of cache staleness. |
| Release requires approval. | Approval-gated release path. |
| The rewrite must preserve every fact. | The rewrite is a fact-preservation pass. |

## Delete the scaffolding

These get removed, not paraphrased, when they add no meaning. Don't swap them
for simpler filler — cut them.

- **Contrast frames** — "not X but Y", "X, not Y", "less X than Y", or a rejected
  framing followed by the preferred one.
- **Staged emphasis** — "the key distinction", "the deeper point", "the honest
  take", "the cleanest way to see this", "the load-bearing constraint", "the
  verdict here", "the smoking gun".
- **Redundant orientation** — "in one sentence", "put differently", "in other
  words", repeated summaries.
- **Aphoristic endings** — "that distinction matters", "that is the boundary",
  "that is the actual constraint", and any punchy closing fragment that restates
  the paragraph it sits under.
- **Validation and candour framing** — "you're absolutely right", "fair hit",
  "one honest caveat", "the honest answer" — unless the interpersonal meaning is
  the point.
- **Rhetorical restatement** — the same claim again in different vocabulary.

## Decode the metaphors

Replace the metaphor with the relationship it describes. Contextually, not
mechanically — this is not a find-and-replace table.

`X-gated` → X is required · `owner-gated` → only owners may · `hard gate` →
a strict requirement · `load-bearing` → essential · `surface` → the actual thing
· `path` → the action or option · `layer` → the component · `handoff` → transfer
· `spine` → main structure · `landed` → merged, shipped, finished · `surfaced` →
appeared, was found, was reported · `stale` → out of date · `canonical` →
authoritative · `blocker` → what's stopping it · `drift` → change over time

Same for noun stacks: `X-backed`, `X-side`, `X-level`, `X-first`, `X-safe`,
`X-matched`, `X-layer`, `X-surface`, `X-path`, `X-boundary`. Recover the actual
relationship and prefer a verb.

## Simplify over-formal research language

frontier, horizon, floor, surface, exchange rate, regime, trajectory, slice,
cell, matched, frozen, headline, confirmatory, protocol, claim gate, lower
bound, clears, survives, implicates — plain English when they are rhetoric.
Leave them alone when they are the precise technical term.

## Keep the real terminology

None of the above words are banned. `provenance`, `calibration`, `routing`,
`gate`, `verified`, `canonical`, `drift` and the rest stay when they are the
clearest description of the thing. Cut them only when they are ornament.

## Never widen the claim

The most damaging failure of a rewrite is a scope change that reads fine.

- "Do X if Y" does **not** mean Y is the only time X may happen.
- "X requires Y" does **not** mean X is defined by Y.
- "Only owners may publish" says nothing about what non-owners may do.
- A prerequisite is not a cause. A trigger is not an exclusivity rule.
- "Has not started" is not "in progress". "Not tested" is not "incorrect".
  "Required" is not "sufficient".

When a metaphor is ambiguous, take the narrowest reading the surrounding text
supports.

Names, quotations, commands, code, verb names and fixed technical terms keep
their exact wording.

## Architect carve-outs

The spec was written for technical prose. Four things here are voice, not
Claudish, and survive a rewrite:

1. **In-world prose is not in scope.** NPC dialogue, room descriptions, item
   text, broadcast copy and death messages answer to
   [docs/story.md](../story.md). A bartender is allowed to be rhetorical.
2. **Em dashes stay an Ascendant tell.** The existing rule stands — em dashes
   mark Ascendant and Architect voices and appear in no other dialogue. Don't
   remove them from those voices for reading plainer, and don't add them
   elsewhere for rhythm.
3. **Flavour lines that are jokes, not summaries.** The guides end on lines like
   "take a coat". That is a closing joke, not an aphoristic restatement of the
   paragraph above it. Aphorisms that restate go; jokes that add stay.
4. **This repo's docs deliberately front-load rules with their reasons.** The
   "⚠ this exists because X broke" pattern in [CLAUDE.md](../../CLAUDE.md) and
   the `systems-*.md` docs carries real history. Compress the wording, keep the
   reason.
