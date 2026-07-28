# mis

Mature Interaction System — the opt-in sexual layer. The engine keeps only the
**consent substrate** ([server/engine/mis.js](../../server/engine/mis.js):
`isMisActive` / `isAttractedTo` / the server setting). Everything MIS *does* —
horniness, ongoing events, climax, the verbs, the appearance notes — lives here.

Full system doc: [docs/systems-mis.md](../../docs/systems-mis.md).

## Files

| File | Holds |
|---|---|
| `index.js` | verbs, event loops, NPC handling, the `player.appearanceMisNotes` hook, the decay tick |
| `mis-system.js` | state + prose: the event registry, `addHorniness`/`triggerClimax`, every message pool, the tutorial |
| `mis-body.js` | what happens to a body: refractory timing, exertion cost, fluid ageing, infection + protection |

## The consent gate

Every verb opens with `misGate(player, raw)`, which returns **`Unknown command`**
— not "you can't do that" — when MIS is off. That's deliberate: a player who
hasn't opted in should never learn these verbs exist. `isMisActive` is an AND of
the server setting `mis_enabled` and the player's own `mis_enabled` (flipped by
the hidden Maturity Slider in client settings, which emits `mis.toggled`).

Consent between *players* is the same flag on both sides. `strip <player>` is the
sharp edge here: it skips every strip-club gate (tip, heat, willing, zone) and
strips the target outright — but only if they have MIS on too. **Their opt-in is
the consent**, so nothing in this plugin may ever act on a player who hasn't
opted in. The regress suite pins that.

`wash` is the one verb that works with MIS off (it also clears blood and acid
residue), which is why it's the plugin's only ungated command.

## Ongoing events

An ongoing act (`masturbate`, `fuck`, the service verbs) registers an 8s interval
in `MIS_EVENTS` keyed by player id — one per player, so starting a second act
stops the first, and re-typing the same verb is the toggle-off.

Every tick re-validates from scratch, and **any of these ends it**:

- the actor logged out, or MIS went off underneath them
- the target left the room, went offline, or turned MIS off
- an NPC target died, walked home, or stopped being willing
- the actor crossed 100 horniness → climax, then stop

The room check is not optional. Without it a partner who walks away keeps taking
arousal ticks and climaxing from across the map — which is exactly what the
player-target loops used to do while the NPC loops got it right.

The unified `stop` command halts a MIS event like any other repeating action
(via the `player.stop` event), and it reports what it stopped.

## Arousal

`addHorniness` is the single entry point: clamps to 120, stamps
`horniness_last_increased`, persists, and returns the private messages to send.
Tiers fire at **50 / 65 / 80 / 92**, one per jump (the highest newly-crossed, so
a +20 event beat doesn't spam four lines), then a last-chance `HNNNG` beat at 97.
Males flip `erect` at 40.

At **100** it's climax: `triggerClimax` zeroes horniness, **grants +10 sanity**,
and writes `appearance_data.ejaculate_state` — which the appearance hook then
renders on anyone looking, until it's washed off. Passive accumulation climaxes
inside `addHorniness`; an ongoing event handles its own so it can broadcast the
act-specific line instead of the generic one.

Decay runs on the plugin's own `1m` tick: −1/min, but only after **5 minutes**
with no increase, decayed in memory for every live player and flushed as one
`UPDATE … FROM (VALUES …)` — never a round trip per player.

## NPCs

NPC arousal (`_misHorny`) is **transient and in-memory only** — it never touches
the DB, and it cools off on the same 5-minute-idle rule. Willingness comes from
the personality table ([npc-personality.js](../../server/engine/npc-personality.js)):

| Flag | On | Effect |
|---|---|---|
| `flags.mis_willing` | NPC | explicit yes/no, overrides personality |
| `flags.mis_lines_ok` / `mis_lines_no` | NPC | bespoke consent/refusal lines |
| `flags.mis_requires_zone_flag` | NPC | only here — a VIP dancer refuses on the street |
| `personality.mis_never` | personality | hard no, unoverridable |

An unwilling NPC refuses in character, and may flee home or (≈20%, attack-leaning
personalities only) turn on you.

## Discoverability

`wash` registers a **declaration-only** specialized action
(`{ verb: 'wash', requiredTag: 'water_source', handler: null }`) so a sink
advertises it on examine. The verb itself stays an ordinary command because it
accepts more than furniture — falling rain, a carried water item — and none of
that is examinable. Nothing dispatches through the registry row; it exists purely
so the verb is findable.

Every other MIS verb is deliberately *not* discoverable in-world: they're taught
once by `MIS_TUTORIAL`, printed on opt-in.

## Known gaps

- The `MIS_CURE_STI` Action exists but is on **no NPC's dialogue tree yet** — the
  cure is unreachable until a medic or chemist node calls it.
- `item_condom` exists but **no vendor stocks it**. Both of these are content, not code.
- Acid rain refuses to wash you, and swimming rinses nothing — you can't clean up
  in the sea.
- Infection is transmitted by penetrative acts only, which is the honest scope but
  means oral is a free pass.

### The open door (`consent all`)

A player can accept advances from anyone with `consent all`. It grants nothing
outward (others may act on you; you may not act on them), a named `revoke` still
wins **and shuts the door**, and named grants stay in their own ledger. Stored as
a self-row in `mis_consents` so `hasConsent` stays sync and query-free. See
[docs/systems-mis.md](../../docs/systems-mis.md).
