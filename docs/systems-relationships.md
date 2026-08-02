# Relationships — what an NPC remembers about you (As Built)

The engine already tracked how the *world* feels about you (ideology rep, wanted level, corp standing) and how one *vendor* feels about you (the bespoke `trust_flag` in [vendor.js](../server/engine/vendor.js), the grudge list in [vendor-grudge.js](../server/engine/vendor-grudge.js)). It never tracked how a **person** feels about you — which is why the hundredth conversation with a bartender read exactly like the first.

Primary file: [server/engine/relations.js](../server/engine/relations.js). Table: `player_npc_relations`.

This is a **substrate and nothing more.** It holds two numbers per (player, NPC) and answers one question — `relationTier` — that dialogue, banter, vendors and descriptions can all read without knowing about each other. It contains no fiction: every line a player ever sees because of this file is authored content, gated on a tier.

---

## The two numbers

| Field | Range | Meaning |
|---|---|---|
| `familiarity` | 0…100 | How well they know you. Only ever grows through contact. |
| `warmth` | −100…100 | How they feel about you. **Signed** — an NPC who actively dislikes you is a different thing from one who has never met you, and the ladder has to tell those apart. |

Both are `REAL`: decay is fractional, and rounding to int would let a slow decay never actually land.

## The tier ladder

```
hostile  <  wary  <  stranger  <  known  <  familiar  <  close
```

| Tier | Condition |
|---|---|
| `hostile` | warmth ≤ −60 |
| `wary` | warmth ≤ −20 |
| `close` | familiarity ≥ 20 **and** warmth ≥ 70 |
| `familiar` | familiarity ≥ 8 **and** warmth ≥ 30 |
| `known` | familiarity ≥ 3 |
| `stranger` | everything else (the default for anyone unmet) |

**Order matters — hostility outranks familiarity.** Someone who knows you well and hates you is not `close`; they're an enemy who knows where you live. `relationAtLeast(rel, 'known')` is therefore false for a hostile NPC no matter how many times you've met.

Bands, not curves, for the same reason [condition.js](../server/engine/condition.js) uses them: a player has to be able to feel *"she knows me now"* as a discrete change, not a drift they can't read.

---

## Field contract

| Field | Shape | Written by | Read by |
|---|---|---|---|
| `player._relations` | `Map<npcId, {familiarity, warmth, met_at, last_seen_at}>` | `hydrateRelations` / `adjustRelation` — **relations.js only** | `getRelation` (and, through it, everything else) |
| `player._relationsDirty` | `Set<npcId>` | `adjustRelation` (add) / `flushRelations` (clear) | `flushRelations`, `flushAllRelations` |
| `player_npc_relations` | table | `flushRelations` — **relations.js only** | `hydrateRelations` — **relations.js only** |

**One writer path.** All mutation goes through `adjustRelation` / `touchRelation`. Grep-verified: no other file in `server/` or `plugins/` touches `player_npc_relations` or `player._relations`.

---

## Read tier — the load-bearing design constraint

Rows exist only for NPCs a player has **actually met**, so the set is bounded by who you've talked to (tens), not by the 167-NPC roster. That bound is what makes the whole set safe to hold in memory:

| Moment | Cost |
|---|---|
| **login** | ONE indexed query → hydrated into `player._relations` |
| **runtime read** | a Map lookup. **Zero queries. Ever.** |
| **write** | marked dirty in memory; coalesced into one multi-row upsert on a `1m` cadence, plus a final flush at logout and before a reconnect re-hydrates |

This is what lets a relationship be read on paths a query could never live on — room arrival, banter selection, examine text — without touching movement cost.

> **`getRelation` is synchronous by contract.** It must never learn to `await`, or every caller inherits a round trip on a hot path. Same contract as [protection.js](../server/engine/protection.js)'s getter.

**Cache safety.** The cache is safe because the write funnel is: relations.js is the only writer of the table, by construction. If a future system starts writing it directly, this cache goes silently stale — the same reason `furniture` and `npcs` are deliberately uncached ([architecture.md](architecture.md#read-tiers-where-data-lives-at-runtime)). Route new writes through `adjustRelation`.

**Reconnect ordering.** `finishAuth` flushes any prior live object *before* hydrating the fresh one. Reversed, the hydrate races the stale Map and the last few minutes of knowing someone are lost.

---

## Decay — lazy, no tick

There is deliberately **no decay tick.** Decay is computed from `last_seen_at` when the row is hydrated:

```
value × 0.5 ^ (daysSinceLastSeen / halfLife)
```

| | Half-life |
|---|---|
| warmth | 21 real days |
| familiarity | 90 real days |

Neither ever reaches zero — they asymptote, so a long-lost regular is still a notch above a total stranger, which is right.

An offline player costs nothing, and a returning one finds a cast that has correctly cooled. It also reads better in fiction: you *discover* you've been forgotten at the moment you walk back in, which is when it should sting.

The decayed value is only in memory until something else touches that relationship — decay is a pure function of elapsed time, so recomputing it next login gives the same answer. Writing every row back at every login would be a write storm for no information gained.

---

## Accrual

| Source | Effect | Notes |
|---|---|---|
| Talking (`root` node rendered) | +1.5 familiarity, +0.5 warmth | **Rate-limited to once per 10 min per (player, NPC)** — relationships are built by showing up over time, not by spamming `talk`. In-memory cooldown (resets on restart), like gossip's tell cooldown. |
| `vendor.purchase` event | +1 familiarity, +0.5 warmth per 100₵ (capped at +3) | Money is not friendship, but it is *acquaintance*. Consumes an event that already exists — no new call site. |
| Authored `RELATION_ADJUST` | whatever the node says | The interesting moves. See below. |

The contact touch fires **after** the node's text is chosen, so the conversation that introduces you still reads as a first meeting: you become familiar by having talked, not while talking.

---

## Authoring (VINE)

### Gate an option on a relationship

```json
{ "relation": "known" }
```

`npc` is optional and defaults to whoever is speaking, which is the normal authored case. Ops: `atLeast` (default), `is`, `isNot`, `below`.

Registered into [flags.js](../server/engine/flags.js) through **`registerConditionShape`** rather than built into it — the substrate owns its own shape, and flags.js keeps no import on relations.js (which would be a cycle: relations → actions → flags). Any future substrate adds a gate the same way; `getRegisteredConditionShapes()` lists them.

A registered shape that throws **fails closed** (hides the option) — the same direction an unknown stat fails. An unknown tier name logs and fails closed too, so a typo hides an option rather than showing it to everyone.

**This condition costs zero round trips**, which is the entire reason it's worth having as a condition at all, and why it's safe in places the `item`/`stat` shapes are not.

### Move a relationship

```json
{ "action": "RELATION_ADJUST", "warmth": 8, "familiarity": 2, "reason": "kept her secret" }
```

Flat params, because the VINE dialogue editor authors actions flat. Deliberately returns **no** `dialogue_line`: the player is never told a number moved. They find out from how the NPC talks to them next time.

### Vary what they say — with fallback by construction

A node MAY author `text_by_relation`:

```json
{
  "text": "State your business.",
  "text_by_relation": {
    "known": "You again. Sit.",
    "close": ["Door's always open for you.", "There you are."]
  }
}
```

**Nothing is required.** An unauthored node, an unauthored tier, or a player this NPC has never met all land on the node's ordinary `text`. This is the property that let the substrate ship across 167 existing NPCs without touching a single tree — every one of them behaves exactly as it did until someone writes a warmer line for it. Variants accept an array of interchangeable lines, same as `text`.

When a tier is missing, the renderer does **not** fall straight to default: it walks **toward neutral** (`stranger`) and takes the first authored line on the way.

### The introduction they only get to make once — `first`

One key in that map is **not a tier**. `first` plays on the single render where this player and this NPC have no history at all:

```json
{
  "text": "He clocks you over the top of a crate. \"What do you need.\"",
  "text_by_relation": {
    "first": "\"Name's Grady. Folks call me Two-Cell.\"",
    "known": "\"You again.\" He almost sounds pleased about it."
  }
}
```

**`first` and `stranger` are different questions, and that's the whole point.** `stranger` isn't "we've just met" — it's "hasn't talked to me three times yet", and it repeats for several visits. So the name-and-nickname line goes in `first`, and the node's ordinary `text` becomes the **every-day greeting** an NPC gives someone they don't know yet.

It costs nothing because `touchRelation` is already called **after** the text is chosen ([dialogue.js](../server/engine/dialogue.js), `renderDialogueNode`) — the conversation that introduces you still sees `met_at === 0`. No flag, no bookkeeping, and an NPC with no `first` line behaves exactly as before.

One edge: any relation accrual creates the row, so a player who *buys* from a vendor before ever opening their root node has spent the introduction. In practice a vendor's shop opens through the root node, so talking comes first.

**Author it for every NPC with anything to introduce** — a name, a nickname, a trade, a reason they're standing there. The pattern is worth asking about explicitly whenever a new dialogue tree is designed.

- **`first`** — the one-time introduction.
- **`text`** — what they say every day before they know you.
- **`known` / `familiar` / `close`** — what they say once you're a regular.

- An NPC with only a `close` line still reads as authored at `familiar`.
- An NPC with only a `wary` line still reads as authored at `hostile`.
- **A hostile player never inherits the line written for a friend** — which is why the walk goes toward neutral rather than simply down the ladder.

---

## What knowing you is worth

`relationHelp(player, npcId)` — one scalar, sync, zero queries — is the substrate's single concession to gameplay. Kept here rather than duplicated per system so a regular gets a consistent deal everywhere, and so retuning generosity is one table rather than a hunt.

| Tier | Help |
|---|---|
| `hostile` | −15% (they mark you up) |
| `wary` | −5% |
| `stranger` | 0 |
| `known` | +3% |
| `familiar` | +8% |
| `close` | +15% |

**Negative tiers charge you more.** Being disliked has to cost something, or warmth is a one-way ratchet with no downside to ignoring.

### Who reads it

| System | Effect |
|---|---|
| **vendors** ([vendor.js](../server/engine/vendor.js) `vendorDiscount`) | Folded into the price at all four sites — shelf listing, buy, sell listing, sell. **Additive with the ideology discount**, then clamped to +40% / −35%: being an Ascendant in good standing *and* her regular beats either alone, but the combination can never make goods free or the markup punitive. |
| **clinic** ([plugins/clinic](../plugins/clinic/README.md)) | Scales the treatment bill; at `close` the medic **waves the money away entirely** — a hard cliff at the top of the ladder, because "she waves it off" is a moment and "she charges you 4₵" is a rounding error nobody notices. |
| **gossip** ([plugins/gossip](../plugins/gossip/README.md)) | `familiar`+ **bypasses the 90s tell cooldown** — someone who actually knows you doesn't make you wait your turn for the word. |

A caller that passes no NPC id (or an offline player, who has no hydrated Map) gets exactly the old behaviour. Same fallback contract as the text variants.

## Events

| Event | Payload | Consumers |
|---|---|---|
| `relation.met` | `{ actor, npcId, reason }` | *none yet* — the seam for "first impressions" reactions |
| `relation.tierChanged` | `{ actor, npcId, from, to, reason }` | *none yet* — the seam for an NPC noticing you've become a regular |

Both are emitted and unconsumed today, deliberately: push-driven reactions hang off these rather than polling the number (the `posture.changed` model).

---

## Known gaps

- **`met_at` is persisted but never read.** It's carried for a future "how long have you known them" read; nothing consults it yet.
- **No player-facing surface.** There is no verb or panel that shows you who knows you. That's intentional for now — the number should be felt, not audited — but it also means the system is currently only as visible as the content authored against it.
- **Only two accrual sources are automatic** (talking, buying). Deaths, crimes witnessed by an NPC, quest turn-ins and gifts all *should* move a relationship and currently don't; they'd each be an event subscription in relations.js.
- **No cross-NPC reads.** The Map answers "how does X feel about me"; nothing yet answers "who in this room knows me", which is the query the table shape was chosen to make possible.
