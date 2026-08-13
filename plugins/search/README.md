# search

One verb, one roll, and a hook. `search` turns the current room over by hand.

```
search
search <thing>
```

## What it is

A **single-shot** skill check against `scavenging` (difficulty 4). The plugin
knows how to roll and how to fail. It does not know what can be found — that is
contributed from outside, through the `search.provider` gather hook.

Searching is **conspicuous**: the room gets a `zone_event` line about you going
through things.

## Contributing something findable

Declare the hook in your own `plugin.json` and export a handler. **No import, no
`after:` ordering.**

```json
{ "hooks": ["search.provider"] }
```

```js
function searchForMyThing({ player, zoneId, zone, targetStr, margin, effective, success }) {
  if (margin < 6) return null;              // set your own bar off the margin
  if (!somethingIsHere(zoneId)) return null;
  return { found: true, priority: 50, message: 'You find the thing.' };
}

export const hooks = { 'search.provider': searchForMyThing };
```

Return `null` to pass. Return `{ found: true, message, priority }` to offer a
result; the **lowest priority wins and is the only thing reported** (default
100). A search turns up one thing — reporting every hit at once would tell the
player exactly how much was left to find.

Providers are called with **one shared roll**. Don't roll your own: if each
provider rolled separately, a room with more findable things in it would be
easier to search, which is backwards.

## Three rules

**Search never pays out.** The 30-second cooldown is per-zone, so a player on a
district grid can step one tile and search again indefinitely. Any provider that
grants credits or an item makes this verb a faucet limited only by walking pace.
Providers return *knowledge*. If you want loot, extend the `scavenging` tables —
they are stocked per zone and they deplete.

**A failure must be indistinguishable from an empty room.** No "something is
nearby", no near-miss line, no partial reveal. You cannot tell an unlucky search
from a barren one, and that ambiguity is the entire feeling the verb exists for.
`regress.js` asserts every failure line against a leak pattern.

**It is not a posture.** `plugins/scavenging` owns the perpetual, settle-in hunt
(`scavenge` + `registerActivity`). This is one deliberate look. If you are adding
a tick here, you are rebuilding scavenging.

## Current providers

| Plugin | Finds | Priority |
|---|---|---|
| `strays` | Cathode, the stray in Dray Lane | 50 |
| `concealment` | that a disguise piece is a disguise piece — never the code, never what's behind it | 200 |

## Why its own plugin

Several unrelated systems want a piece of this verb. If any one of them owned
it, the others would have to reach into it. See the header comment in `index.js`
for why the seam is a gather hook rather than an exported registry.
