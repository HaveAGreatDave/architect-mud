# Mature Interaction System (MIS) — as built

The opt-in sexual layer: consent, arousal, ongoing acts, climax, and the body
descriptions that only exist once you've asked for them. Tone authority is
[story.md](story.md) — MIS prose is blunt and adult but never leering at the
player, and it is funny for the same reason the rest of the game is.

**Split:** the engine owns the consent flag and nothing else
([server/engine/mis.js](../server/engine/mis.js)); every mechanic lives in the
`mis` plugin ([plugins/mis/README.md](../plugins/mis/README.md)).

## Opting in

Two switches, ANDed by `isMisActive(player)`:

| Switch | Where | Who flips it |
|---|---|---|
| `server_settings.mis_enabled` | DB, cached at boot by `loadMisSettings()` | an admin, once, per server |
| `players.mis_enabled` | player row | the player, via the hidden Maturity Slider in client settings |

Flipping the player switch emits **`mis.toggled`**; the plugin answers it by
printing `MIS_TUTORIAL` (the only place the verbs are ever taught) on enable, and
by killing any running event on disable.

With MIS off, every MIS verb answers **`Unknown command`**. That is the whole
point: a player who hasn't opted in never learns the surface exists. It also
means the verbs are invisible to `help` and to examine — with one exception,
`wash`, which works either way (it clears blood and acid residue too) and is
advertised on any `water_source` furniture.

`isMisActive` is read well outside the plugin — the **bodily** plugin's targeting,
appearance rendering, and the **MORPHEX** cosmetic machine all gate on it. That's
why it's a substrate and not plugin state.

## Attraction

`isAttractedTo(viewer, target)` compares `viewer.sexuality` against
`target.biological_sex`. The canon set is `SEXUALITIES` in
[mis.js](../server/engine/mis.js):

`Male` · `Female` · `Male and Female` · `None`

**`None` is a real answer, not an absence** — it opts a character out of every
attraction-driven beat (passive arousal on examine, being a willing threesome
joiner, the receiver's share of a partner's arousal) while leaving every verb
they choose to type working. An **unset** sexuality answers `false` rather than
defaulting to `Male`; nothing should decide a character is attracted to men
because nobody asked them. Players change it at a MORPHEX machine (10₵).

Attraction never gates consent — it gates *involuntary* arousal. What you do is
always your own choice.

## Arousal → climax

`players.horniness` (0–120) is the meter. `addHorniness()` is the only way it
moves up:

| Threshold | What happens |
|---|---|
| 40 | males flip `erect` — visible through ≤3 thin layers on examine |
| 50 / 65 / 80 / 92 | escalating private heat lines; only the highest newly-crossed tier fires |
| 97 | the `HNNNG` beat — the last chance to aim |
| 100 | climax |

Climax zeroes the meter, **grants +10 sanity** (MIS is a genuine sanity valve —
see [systems-survival.md](systems-survival.md)), and writes
`appearance_data.ejaculate_state`, a list of body sites that stays on you, visible
to anyone who looks, until washed. Fluid on a site covered by clothing is hidden,
not erased.

**Decay:** −1/minute on the plugin's `1m` tick, and only after 5 minutes with no
increase. Decayed in memory for every live player, flushed as a single
`UPDATE … FROM (VALUES …)` — per the hot-path rule in
[architecture.md](architecture.md#persistence-tiers-when-to-write-the-db).

**Refractory:** a climax stamps `_misRefractoryUntil` (runtime only). Inside it,
`addHorniness` damps gains on a smooth ramp from **10%** back up to full — you can
keep going, it just isn't going anywhere yet. Base 150s male / 75s female, minus
8s per point of Endurance, floor 25s. Without it the +10 sanity was a farmable
loop on a 40-second cycle.

**Exertion:** every 8s beat costs stamina (scaled by Endurance), hydration, and
adds sweat to the engine's hygiene meter. Running your stamina to zero **ends the
act** — `exert()` returns `{ collapsed }` and the loop stops itself.

**Cleaning up:** `wash` (a sink, falling rain that isn't acid, or a carried water
item) clears fluid, blood and acid residue. The bodily plugin's `shower` is a
strict superset and also clears contamination. Both now call `markWashed`, which
resets the hygiene clock. Swimming still rinses nothing — a real gap.

**Fluid ages.** `ejaculate_state` carries `at`, so it dries: wet for 10 minutes,
smellable for 30, visible on examine until washed. Anything landing on a **clothed**
slot soaks in (`stainClothing`) rather than sitting on skin — the same rule bodily
applies to piss and vomit. The room smells it through the
[hygiene substrate](systems-hygiene.md), where it's an ordinary contaminant
carrying `misOnly` so a non-opted nose never gets it.

## Ongoing acts

`masturbate`, `fuck`, and the service verbs (`suck`, `handjob`, `finger`, eat out)
register an **8-second event** keyed by player id — one per player, so a second
act replaces the first and re-typing the verb toggles it off. Each beat sends a
private line to the actor, a private line to the target, and a third-person line
to the room (MIS-enabled onlookers only), plus a chance of an NPC witness
reacting in disgust or arousal.

Every beat re-validates and ends on **any** of: actor gone or MIS off, target gone
/ MIS off / **left the room**, NPC target dead / walked home / no longer willing,
or the actor crossing 100 (→ climax, then stop). The unified `stop` command halts
one like any other repeating action, via `player.stop`.

A third party in the room already above 30 arousal may **join** — a willing NPC,
or a player who is MIS-active and attracted to the actor. The threesome pools
always broadcast them by name.

## NPCs

NPC arousal is transient, in-memory (`npc._misHorny`), and never persisted; it
cools on the same 5-minute-idle rule. A willing NPC builds arousal from acts like
a player does, moans as it climbs, and climaxes at 100 (males stain the zone).

Authoring is via NPC flags over the personality table
([npc-personality.js](../server/engine/npc-personality.js)) — see the flag table
in the [plugin README](../plugins/mis/README.md#npcs). An unwilling NPC refuses in
character and may flee home or, for attack-leaning personalities, ≈20% of the time
turn on you.

**NPCs remember.** A willing act adjusts
[the relationship](systems-relationships.md) by `+3` familiarity / `+4` warmth —
sex is the fastest familiarity in the game and a real, smaller warmth move. And it
reads back: an NPC whose willingness comes from their **personality** now refuses a
stranger outright ("doesn't know you well enough — try talking to them first"),
requiring at least the `known` tier. An NPC with an explicit `flags.mis_willing`
is professional company and skips that gate, which is how the consort/stripper
content buys its way past it.

## Consequence

**Where you do it.** A MIS act outside a private zone emits `mis.publicAct`, which
the surveillance plugin runs through the ordinary `raiseCrime` path as
`indecent_exposure`. Witnessing isn't re-derived — cameras, on-scene cops, the
lawless-zone exemption and the debounce all come free. A zone counts as private on
any of `private` · `mis_private` · `apartment` · `apartment_unit` · `housing_unit`
· `rentable` · `vip`. **Privacy is now something you rent rather than something the
parser enforces** — the NPC's own consent gates (willingness,
`mis_requires_zone_flag`) are untouched and still hard blocks.

**Infection.** Penetrative acts only. A `player_flags.mis_sti` entry (not a
column, not a status — a status is measured in seconds and this in days) holding
`{strain, since}`, read sync off the hydrated flag cache. Three strains, a ~20
minute incubation before symptoms speak up, and a `sti_symptoms` status carrying
**−1 Cool** while it's live. Transmission is **14% unprotected / 1% with**
protection — never zero, because "it broke" is a story and a guarantee isn't.
Protection is one carried item tagged `condom` (`item_condom`, 4₵), consumed at
the start of the act. NPC infection status is deterministic per NPC (hashed off
the id, ~18%, overridable with `flags.mis_clean` / `flags.mis_infected`), so
asking around about someone could one day be a real play.

**The cure** is the `MIS_CURE_STI` dialogue Action — MIS owns it rather than
clinic, because clinic has no business knowing the flag key. Params arrive flat
off the VINE node (`cost`, `clean_line`, `broke_line`, `cured_line`), so a
back-alley chemist and a corporate clinic price the same course differently.
Default 60₵. **Not yet wired onto any NPC** — that's content.

## Appearance

The plugin implements the `player.appearanceMisNotes` hook, which
`describePlayerAppearance` fires at its naked and clothed sites. It contributes:
erection visibility through clothing, the female chest / nipple notes, genitals
when the legs slot is bare, and the fluid description. Looking at someone whose
body is visibly aroused, when you're attracted to them and MIS-active, gives you
+5 horniness — the one involuntary beat in the system.

## Verbs

`mis` `touch` `grope` `squeeze` `kiss` `lick` `fondle` `slap` `stroke`
`masturbate`/`jerkoff`/`jackoff`/`rubself`/`fingerself` `finger` `suck`
`fuck`/`sex`/`screw`/`rail`/`bang`/`breed` `blowjob`/`bj` `handjob`/`hj`
`ejaculate`/`cum`/`come` `wash` `strip`, plus the input matchers `jerk off on …`,
`eat out …`, and `examine <target>'s <part>`.

**`strip <target>`** deserves its own note: it bypasses the strippers plugin's
tip / heat / willing / zone gates entirely. An NPC is bared freely (`_forcedNude`
and `_clothingPeeled`, honoured by the strippers redress tick). A **player** is
stripped only if they also have MIS enabled — their opt-in is the consent — and
everything but their weapon goes into their pack.

## Testing

[plugins/mis/regress.js](../plugins/mis/regress.js) covers both sides: that the
verbs are hidden and unreachable when opted out, and — by enabling the server
setting and the player flag inside the suite, then restoring both — that they
actually run when opted in (arousal accrues, an event starts, `stop` halts it).
It also pins the attraction table and the `wash` discoverability row.
