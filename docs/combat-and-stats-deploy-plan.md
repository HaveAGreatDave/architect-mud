# Combat & Stats Rework — Phased Deploy Plan

## Context

`docs/combat-and-stats-plan.md` defines the agreed *scope* for reworked stats, skills,
and combat: HellMOO stat names, continuous skills, an IP economy that funds stat growth,
2d10-to-hit vs dodge, and per-body-part typed armor soak. It supersedes the light Stats/Skills
tables in `design.md`. Implementation was deliberately deferred — this plan sequences it.

The rework touches nearly every combat-adjacent system, so it is split into six phases that
each leave the game runnable. The current systems are minimal (good — less to unwind):

- Combat (`server/engine/combat.js`) uses `d20+stat_agi` vs `d15+stat_agi`, flat global armor,
  static crit, no body parts, no damage types.
- Stats are 6 INTEGER columns on `players` (`stat_str/agi/int/wil/end/cha`, default 5), inert —
  no creation choice, no way to raise them.
- Skills (`server/engine/skills.js`) are 22 hardcoded entries, INTEGER rank 0–10 from XP thresholds,
  flat XP gain, `stat/2` bonus on checks.
- Items are already JSONB-`tags` based (`client/shared/tagCatalog.js`) — so damage types and
  per-part armor need **new tags, not schema changes**.
- Enemies have 3 stats + `damage_min/max` + flat `armor` (structured columns).

### Decisions locked with the user

- **Characters reset.** No data migration; we zero/re-roll stats & skills under the new system.
- **Enemies stay lean.** Engine *derives* their dodge, to-hit skill, and per-type soak from a few
  fields rather than giving them full player parity.
- **Tuning is dev-panel editable.** All deferred constants live in a `combat_config` table edited
  from the dev panel, read through one tunables module — no redeploy to retune.

### Cross-cutting groundwork (used by every phase)

- **`server/engine/tunables.js`** — new module: loads `combat_config` rows into a cached object,
  exposes `getTunable(key, default)` and a `reloadTunables()` hot-reload hook (mirror `world.reloadZone`).
  All magic numbers (2d10 target offsets, IP-per-0.01, stat cost curve coefficients, hit weights,
  per-type soak defaults, crit threshold/mult, head mult) read from here.
- **`combat_config` table** (in `migrate.js`): `key TEXT PRIMARY KEY, value JSONB, label TEXT, category TEXT`.
  Seed sensible defaults in `seed.js`. Dev-panel "Tuning" tab edits these via existing REST pattern.

---

## Phase 0 — Schema & data foundation

Goal: land all schema/column changes and the tunables layer in one idempotent migration pass, reset
characters. Game still runs on old logic after this phase (columns added, not yet wired).

- `migrate.js`:
  - `players`: add `stat_brawn/reflexes/endurance/brains/senses/cool INTEGER DEFAULT 0`, add `ip REAL DEFAULT 0`.
    Leave old `stat_*` columns in place for now (dropped at end of rollout to keep migration reversible).
  - `player_skills`: add `trained REAL DEFAULT 0` (the continuous 0–10 trained value). Keep `rank/xp`
    columns until Phase 2 cuts over.
  - `enemies`: add `defense INTEGER DEFAULT 0` (feeds derived dodge) and `soak JSONB DEFAULT '{}'`
    (per-damage-type soak map, e.g. `{"kinetic":4,"energy":1}`). Keep flat `armor` until Phase 5.
  - Create `combat_config` table.
- `seed.js`: seed `combat_config` defaults; seed damage types on existing weapons (default `kinetic`).
- `client/shared/tagCatalog.js`: add `damage_type` (enum: kinetic/edged/energy/fire/radiation) and
  `armor_soak` (statmap: type→value) tags. Keep legacy `armor` int tag working.
- One-time **character reset** script (`npm run db:reset-chars` or a guarded migrate step): zero new
  stat columns, clear `player_skills`, zero `ip`, set `hp=hp_max`.

Verify: `npm run db:migrate && npm run db:seed`, confirm columns/`combat_config` exist, game boots.

---

## Phase 1 — Stats rename + character creation point-buy

Goal: new stat names are the source of truth; players pick stats at creation.

- Engine-wide rename of stat reads from `stat_str/agi/int/wil/end/cha` → new names. Mapping for any
  *display/derived* carryover: str→brawn, agi→reflexes, end→endurance, int→brains, wil→cool;
  **senses is brand new** (no old equivalent), **charisma is dropped**. Grep for `stat_` across
  `server/engine/**` and `server/api/routes.js`.
- `server/api/routes.js` `apiRegister()`: accept a stat allocation payload (~6 points across the six
  stats, start 0, no negatives) instead of seeding all to 5. Validate server-side (sum ≤ budget from
  `tunables`).
- `client/game/index.html` character-creation UI: add a point-buy allocator (preserve UTF-8 glyphs).
- Dev panel (`client/devpanel/index.html`): rename player/enemy stat fields; enemies keep only the
  stats they use plus the new `defense`/`soak` fields.

Verify: register a new character via the client, confirm chosen stats persist; existing combat still
resolves (reads new names).

---

## Phase 2 — Continuous skills + stat-averaged effective skill + learn-by-use

Goal: skills become the 0.00–10.00 continuous scale with the §2 effective-skill formula and the
"barely win" learning curve.

- `server/engine/skills.js`:
  - Replace rank-from-XP with `trained` (REAL, cap 10). Keep the 22-skill definitions + governing
    stat(s); allow **multiple** governing stats per skill (array) for the averaging rule.
  - `effectiveSkill(player, skillId)` = `trained + average(governing stat values)` (single stat → that
    stat). This can exceed 10.
  - `skillCheck()` uses `effectiveSkill` in place of `rank + stat/2`.
  - Replace flat `awardSkillXp` with **learn-by-use**: on a successful use, grant a `trained` increment
    scaled by *margin-near-zero* (biggest gain on a barely-won check), per `tunables`. Returns the
    delta (Phase 3 mints IP from it).
- Migrate the 22 skill defs' governing stats to new names; drop charisma-governed couplings onto
  appropriate stats (e.g. social skills → `cool`/`senses` per design intent).

Verify: fight a weak vs a near-even enemy, confirm `trained` climbs faster on the near-even fight and
caps at 10; effective skill reflects stats.

---

## Phase 3 — IP economy

Goal: skill gains mint IP into a shared pool; IP buys stat points on an escalating curve.

- `server/engine/ip.js` (new): `mintIp(player, skillDelta)` (called from the Phase-2 learn-by-use hook,
  rate from `tunables`); `statCost(currentValue)` (quadratic-ish curve, coefficients from `tunables`);
  `raiseStat(player, statName)` — spends IP, increments stat, persists.
- Command + client UI to spend IP (`raise <stat>`), showing pool and next-point cost. Wire into the
  existing command dispatcher (`server/engine/commands/`) and the game client's stat panel.

Verify: gain skill → IP pool rises; spend to raise a stat → cost escalates, effective skills using that
stat go up.

---

## Phase 4 — Combat resolution rewrite (2d10 vs dodge)

Goal: replace `rollAttack()` with the §4 loop. Dodge ships as a **placeholder formula** (the doc defers
the real one) read from `tunables`.

- `server/engine/combat.js` `rollAttack()`:
  - To-hit: `2d10 + effectiveSkill(attacker, weaponSkill) ≥ dodge(defender)`.
  - **Placeholder dodge**: `base + effectiveSkill(defender, 'dodge') ` (governed by reflexes/senses) —
    plus a TODO hook for situational mods (cover/darkness/ganged-up). Enemies use derived dodge from
    their `defense` field (per the lean-enemy decision).
  - Binary hit; **crit** on high roll / wide margin → damage multiplier (from `tunables`).
  - Damage still rolled from weapon range; armor still flat for this phase (per-part lands in Phase 5).
- Add a `dodge` skill to the skill list (Phase 2 machinery already supports it).

Verify: combat resolves with the new roll; misses/crits occur at plausible rates; tweak `combat_config`
targets live and confirm hit-rate shifts without redeploy.

---

## Phase 5 — Body parts + typed armor soak + damage types

Goal: the §5 layer — pick a struck part, route the weapon's damage type through that part's typed soak.

- `server/engine/combat.js`: after a hit, roll a struck part from a weighted table (weights from
  `tunables`, ~torso-heavy). Head gets a damage multiplier and crit-to-stun; other parts are flat.
- Per-part typed soak:
  - Players: read `armor_soak` tag (type→value) from the piece equipped in the struck part's slot;
    index by the weapon's `damage_type`; mismatch → minimal reduction. Update `recomputeArmor()` in
    `server/engine/commands/inventory.js` to store a per-slot/per-type structure instead of one scalar.
  - Enemies: index the struck type into the enemy's `soak` JSONB (lean-enemy decision); fall back to a
    flat default.
- Retire the flat `armor` paths once soak is in. Radiation damage type ties into the existing rad system
  (note for tuning, not a blocker).
- Dev panel: armor pieces edited via the new `armor_soak` statmap tag (UI already renders statmaps).

Verify: hits land on varied parts at the weighted distribution; wrong-type damage punches through armor,
right-type is soaked; head hits hurt more and can stun.

---

## Post-rollout cleanup

Once Phase 5 is stable: drop legacy `stat_str/agi/int/wil/cha`, `player_skills.rank/xp`, and the flat
`armor` column in a final idempotent migration; remove dead read paths. (Separate, low-risk commit.)

---

## Critical files

- `server/engine/combat.js` — to-hit/damage/crit/body-parts (Phases 4–5)
- `server/engine/skills.js` — continuous scale, effective skill, learn-by-use (Phase 2)
- `server/engine/ip.js` *(new)*, `server/engine/tunables.js` *(new)*
- `server/engine/commands/inventory.js` — `recomputeArmor()` per-part typed soak (Phase 5)
- `server/models/migrate.js`, `server/models/seed.js` — schema + config/defaults (Phase 0)
- `server/api/routes.js` — `apiRegister()` point-buy, enemy/config REST (Phases 1, 4, tuning)
- `client/shared/tagCatalog.js` — `damage_type`, `armor_soak` tags (Phase 0)
- `client/game/index.html` — creation point-buy, IP-spend UI (Phases 1, 3) — **preserve UTF-8**
- `client/devpanel/index.html` — stat fields, enemy `defense`/`soak`, Tuning tab (Phases 0–1, 5)

## Open risks / flags

- **Dodge is the real unknown.** Phase 4 ships a placeholder; the design doc owes a real formula before
  combat feel is final. Plan isolates it behind `tunables` so it's a one-spot change.
- **Tuning is iterative, not one-shot.** Every phase that adds a constant adds a `combat_config` row;
  expect a dedicated balancing pass after Phase 5 once the full loop exists.
- **Skill list is content, not finalized** (doc §2). Phases reuse the existing 22 skills; the final list
  is sized separately and won't change the engine wiring.
- **No build step** — all client work is hand-edited HTML/ES modules; watch the UTF-8/BOM rule on
  `client/game/index.html`.
