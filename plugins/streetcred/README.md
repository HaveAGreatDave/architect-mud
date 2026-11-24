# streetcred

**Status:** built (phase 2 of [street-dealers.md](../../docs/proposals/street-dealers.md): street cred and the first contact).

**Purpose:** a hidden standing with the black market as a whole. Each contact keeps their own trust in you; street cred is what the rest of them have heard. It's never shown: a player notices it only in how these people treat them.

## Contacts

A contact is any NPC with both `flags.trust_flag` (the trust vendor in `server/engine/vendor.js`) and a `flags.street` block:

| Key | Meaning |
|---|---|
| `wary` | 0 to 1. How little cred counts with this contact. Old Coldwater sits high |
| `cred_per_step` | Cred paid each time your trust with them crosses a step of 25 (default 5) |
| `lines` | `{ stranger, known, trusted }`: what they do when you walk in. `{name}` is their name |
| `vouches_to` | NPC ids you're introduced to when their trust reaches `trust_max` |
| `vouch_line` | Printed once, when the vouch happens |
| `post` | `{ f, a }`: in GLASS, the contact minds a spot while at work. On a pavement with a building behind it they lean on the wall (`a`, -1 to 1, is where along it); on open ground they stand facing `f` (`n`, `s`, `e`, `w`) |

The first is Tibs Klimek (`npc_shingles_tibs_klimek`), at the Ropewalk end of the Gate Road by night. Weed to anyone, more as he trusts you, and at the top he vouches you to Lenny Sorel.

## How it works

- **Cred** is the `street_cred` player flag with `street_cred_at`, 0 to 100, decaying toward 0 with a 60-day half-life, worked out on read (`cred.js`).
- **Gaining it:** on `vendor.purchase` from a contact, after vendor.js has raised their trust, each new step of 25 pays `cred_per_step`. The step reached is kept in `<trust_flag>_credstep`, so it's paid once.
- **New contacts:** the first time you're in a contact's room, their trust starts at your cred times `1 - wary`.
- **Reactions:** on `zone.entered`, each contact present (and awake) says one line from the band for their own trust plus discounted cred, at most once every 10 minutes per player.
- **Vouches:** at `trust_max`, each id in `vouches_to` gets its `<id>_met` flag set (the introduction plugins/dealer checks, so no passphrase) and, if unset, its trust seeded from your full cred.

## In GLASS

- `npc.streetPose` puts a contact with `post` on it while they're in their work zone. glass/street-life.js holds them at the spot all night instead of wandering, and the close-up figure plays `dealerLean` (on a wall) or `dealerStand` (open ground) from actor3d.js. The crowd and far levels play the baked `leanWall` or `idle`.
- The two clips are one 32-second loop of tells: two fast glances along the street (the second a double-take), a pat of the bum bag, a slow scan both ways, a phone check with a look up in the middle, a shrug into the coat, a sniff and a blink, and on the wall the heel of the raised foot tapping. Standing, the weight goes across to the other leg for a while and back.
- `npc.streetRegard` answers per viewer from their hydrated flags: a stranger gets `stare` (eyes on you the whole time you're near), somebody trusted gets `nod` (a chin-up the first time you come within 4 m, not again for 45 s), and anyone in between the ordinary noticing. gl/street-hd.js reads it.

Cred never drops yet, except by decay. Losing it to the police waits on crime reporting.

## Hooks and events

No verbs. Implements `npc.streetPose` and `npc.streetRegard`. Consumes `vendor.purchase`, `zone.entered` and `player.logout`.
