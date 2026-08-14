# ally — an NPC that fights on your side

**Status: built.** First user: Tom Budge, pest exterminator, camped in the Dripping Bend
(`zone_under_bend`) one room east of the Ironside ladder into The Under.

Until this shipped, no NPC in the game could attack an enemy. `combat.js` had enemy→player,
enemy→npc, enemy→enemy, npc→player and npc→npc; `npc→enemy` was the empty cell, and it is the
reason allied NPCs did not exist. The engine grew exactly one function to fill it
(`npcAttackEnemy`). Everything in this folder is the policy on top.

## The split

`npcAttackEnemy` is a **law** — a blow lands, soaks through carapace, wounds a part. It would ship
byte-identical in any game built on this engine. It knows nothing about allies: pass
`{ credit: player }` and the kill counts for them, pass nothing and it counts for nobody.

Which enemy to swing at, who the kill belongs to, and when to walk away are **rules about this
game**, and they are here. That is the litmus in `docs/proposals/engine-plugin-boundary.md` read
straight off.

## Four decisions worth knowing before you change anything

**1. An ally withdraws; it does not die on a schedule.** Below `flags.ally_withdraw_pct` (default 30)
it clears its target, clears every enemy holding it *as* a target, walks home and is unavailable for
`flags.ally_cooldown_mins` (default 10). The engine's own answer — `enemyAttackNpc` kills outright and
respawns at home in 60s at full HP — is both too permanent (your bodyguard evaporates mid-escort) and
too cheap (they pop back like nothing happened).

**But it is not a shield.** A burst from 40% to zero kills them through the ordinary path, which
nothing here modifies, and `regress.js` asserts exactly that. Nothing in this plugin protects an NPC.
That is escort's rule too, and it is what keeps the stakes real. The **cooldown is the cost** —
without it an ally is a renewable meat shield you re-enlist at the door every ten seconds. They also
stay hurt: there is deliberately no healing code. If that plays badly, tune it with a slow regen
*here*, never in the engine.

`knockOut()` was the obvious alternative and is deliberately unused: an unconscious body is killable
where it lies (`docs/systems-stealth.md`), so a KO'd ally in a room of roaches is a corpse with a
delay on it.

**2. Kill credit is the player's.** `enemy.killed` is emitted with `actor: <the player>` even when the
ally lands the blow, because the alternative is that your own bounty quest stops counting the moment
you bring help — the single most likely bug in the whole feature. `via: <the npc>` rides along.

Seven other things subscribe to `enemy.killed` (accolades, corps territory destabilisation, gossip,
psionics residue, audio, prologue). None of them were changed, so today an ally kill reads to all of
them as your kill. That is the tradeoff, chosen deliberately; `via` ships now so any of them can
filter later without a second migration. **Weapon-skill XP is not awarded** — `awardSkillUse` fires on
a swing, and you didn't swing.

**3. Content names the targets.** `flags.ally_targets` is an array of enemy *template* ids; absent or
empty means anything hostile. Hard-coding "vermin" in `targeting.js` would mean the second ally
anybody writes — a bodyguard, a faction gun — needs a code change to be allowed to shoot the thing it
was hired to shoot.

**4. A 1s plugin tick, not an AI graph and not the gameLoop.** The graph was the first idea and is a
trap three ways: `npcWanderTick` runs at 15s against a 4s swing interval; the `ATTACK` node reads
`entity.hit` / `enemyWeaponComponents()`, which an NPC does not have (its numbers live in `flags.*`),
so an authored ally would swing at the hardcoded 1–3 default ignoring everything written on it; and
`_escorting` freezes the AI tick outright, so an ally walking with you would never tick at all.

A third branch in the gameLoop NPC retaliation loop is one Map lookup and very tempting — but the
engine would then own kill credit, the corpse and the `enemy.killed` emit, none of which can be
answered without naming a plugin. Revisit if a second npc-vs-enemy user appears.

`npcAttackEnemy` owns its cooldown (the same `_lastAttack` field the gameLoop retaliation loop uses),
so ticking at 1s and swinging at 4s is free, and an ally can never swing at a player and an enemy in
the same beat. The tick returns on an empty registry before it touches the world; regress asserts it.

## Traps

⚠ **No `after` in `plugin.json`, deliberately.** The obvious `"after": ["weapon"]` is wrong twice:
nothing here needs weapon at load time (`getPlayerCombat()` is called per kill, long after boot), and
forcing weapon to load early re-orders every registry it writes to. It shifted `weapon:flee` ahead of
`injury:grab` in the move-gate list — failing `plugins/injury`'s own suite, for a reason nothing about
this plugin would suggest.

⚠ **Two target fields.** NPC combat uses `npc._combatTargetId` (the 1s loop); the AI runtime uses
`entity.targetId`. Nothing reconciles them. Use `_combatTargetId`; never write `targetId` on an NPC.

⚠ **Retaliation is a content flag, not code.** `enemyAttackNpc` is reachable only through
`ai-behaviour.js`'s `enemy.flags.attacks_npcs` branch. `npcAttackEnemy` sets `enemy.targetId` **only**
behind that flag — unguarded, the graph resolves the id as a player, gets null and *clears* the
target, so an ally would protect you by giving every enemy amnesia. The sewer roach carries
`attacks_npcs: true` and has no `ACQUIRE_TARGET` node, so the only route to an NPC target is being
shot first. That is the correct semantics; don't "fix" it.

⚠ **The corpse comes through `registerPlayerCombat`**, not an import — `plugins/weapon` exposes
`spawnEnemyCorpse` on the provider object it already hands the engine. It takes a zone id here rather
than a player, because the body belongs where the kill happened, which is the ally's tile.

## Surface

| | |
|---|---|
| Verb | `ally` · `ally <name>` · `ally stop` |
| Actions | `ALLY_ENLIST`, `ALLY_DISMISS` (no params — `context.npc` is the speaker) |
| Consent | `flags.fights_for_you`, mirroring escort's `flags.escortable` |
| Tuning | `flags.ally_targets`, `ally_withdraw_pct`, `ally_cooldown_mins` |
| Emits | `ally.enlisted`, `ally.engaged`, `ally.kill`, `ally.withdrawn`, `ally.ended`, `enemy.killed` |
| Consumes | `escort.ended`, `npc.killed`, `player.death`, `player.logout` |

Escort and ally are **separate arrangements** coupled only by events. Ending an escort stands the
ally down; dismissing an ally leaves the escort running, because a body walking with you and a body
swinging for you are two different deals.
