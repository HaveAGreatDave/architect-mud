/**
 * The accolades catalog — every entry the Architect can log against you.
 *
 * Entries are DATA, not code paths: adding number twelve is one object literal
 * here and nothing else. They live in the plugin rather than the DB on purpose —
 * each entry is welded to an engine event and a predicate over that event's
 * payload, so there is nothing here a content author could meaningfully edit,
 * and nothing outside this plugin reads them (the leaf test).
 *
 * Shape:
 *   key    — stable id; the PK half in player_achievements. NEVER rename a
 *            shipped key: the row is the durable fact, and a rename re-awards
 *            the entry (and its XP) to everyone who already had it.
 *   title  — what the banner and the app show.
 *   line   — the observation. House voice: clinical, unimpressed, second person
 *            only when it stings. Never congratulate.
 *   on     — engine event name this listens to.
 *   test   — (payload, ctx) => playerId | falsy.  Return the id to log against.
 *            ctx = { bump(playerId, counterKey) -> new count, has(playerId, key) }
 *            `bump` is in-memory + write-behind; calling it is not a DB read.
 *
 * Every entry is worth exactly 1 XP, forever, including the hardest one. The
 * flatness is the joke — the system does not care what you did.
 */

// The prologue's own zone constants. Hardcoded here the same way plugins/prologue
// hardcodes them: the vat sequence is a fixed scripted path, not authored content.
const Z_COLLAPSE = 'zone_the_collapse';
const Z_CLONEVAT = 'zone_start';

export const ENTRIES = [
  {
    key: 'so_we_meat_again',
    title: 'So We Meat Again',
    line: 'Decanted, inventoried, and assigned a number. The algorithm was expecting you.',
    on: 'zone.entered',
    // The FIRST emergence only. Respawn re-enters zone_start via the gameLoop's
    // scheduleVatEmergence, which never comes from The Collapse — so the `from`
    // check is what stops this re-firing on every death. (The unique-unlock PK
    // would catch it anyway; this keeps it honest at the source.)
    test: (p) => (p?.zone === Z_CLONEVAT && p?.from === Z_COLLAPSE ? p.actor?.id : null),
  },
  {
    key: 'ambulatory',
    title: 'Ambulatory',
    line: "You moved. It's a start.",
    on: 'zone.entered',
    test: (p, ctx) => {
      const id = p?.actor?.id;
      if (!id || p.zone === Z_CLONEVAT) return null;
      return ctx.bump(id, 'moves') >= 1 ? id : null;
    },
  },
  {
    key: 'skill_issue',
    title: 'Skill Issue',
    line: 'Killed by a thing with nine hit points.',
    on: 'player.death',
    test: (p) => p?.player?.id || null,
  },
  {
    key: 'load_bearing',
    title: 'Load-Bearing',
    line: 'Found a chair. Committed to it.',
    on: 'posture.changed',
    test: (p) => (p?.to === 'sitting' ? p?.player?.id : null),
  },
  {
    key: 'yo_yo_dieting',
    title: 'Yo-Yo Dieting',
    line: "Picked the same object up six times. We're not going to ask.",
    on: 'item.taken',
    test: (p, ctx) => {
      const id = p?.actor?.id;
      const item = p?.item?.id;
      if (!id || !item) return null;
      // Counter is per-item, so six *different* pickups never trips it — only
      // the same object, over and over, which is the behaviour being mocked.
      return ctx.bump(id, `take_${item}`) >= 6 ? id : null;
    },
  },
  {
    key: 'liquid_assets',
    title: 'Liquid Assets',
    line: 'Zero credits. Precisely zero. Almost impressive.',
    on: 'credits.changed',
    test: (p) => (Number(p?.after) === 0 ? p?.playerId : null),
  },
  {
    key: 'participation',
    title: 'Participation',
    line: "It had a name. It doesn't now.",
    on: 'enemy.killed',
    test: (p) => p?.actor?.id || null,
  },
  {
    key: 'ongoing_concern',
    title: 'Ongoing Concern',
    line: 'Ten deaths. The vat has stopped asking questions.',
    on: 'player.death',
    test: (p, ctx) => {
      const id = p?.player?.id;
      return id && ctx.bump(id, 'deaths') >= 10 ? id : null;
    },
  },
  {
    key: 'gravity_undefeated',
    title: 'Gravity: Undefeated',
    line: 'First flight. First crater. Consistent, at least.',
    on: 'flight.crashed',
    test: (p) => p?.pilotId || p?.ownerId || null,
  },
  {
    key: 'surrounded_by_taps',
    title: 'Surrounded by Taps',
    line: 'Died of thirst. In a bar.',
    on: 'player.death',
    test: (p) => (/thirst|dehydrat/i.test(p?.cause?.label || p?.cause?.type || '') ? p?.player?.id : null),
  },
  {
    key: 'reading_this',
    title: 'Reading This',
    line: 'You opened the file to see what was in the file. We see that too.',
    on: 'accolade.opened',
    test: (p) => p?.playerId || null,
  },
  {
    key: 'so_fresh_and_so_clean',
    title: 'So Fresh and So Clean',
    // The engine fires hygiene.immaculate only when a cleaning path has left you
    // washed AND laundered AND carrying nothing — which on Ironside takes actual
    // effort and about twelve credits.
    line: 'Washed, laundered, and briefly indistinguishable from someone with prospects.',
    on: 'hygiene.immaculate',
    test: (p) => p?.actor?.id || null,
  },
  {
    key: 'unfit_for_indoor_use',
    title: 'Unfit for Indoor Use',
    // The bottom band: filthy AND unlaundered AND wearing something that happened
    // to you. Reaching it takes genuine neglect, which is the joke.
    line: 'Whatever is on you now has been on you long enough to be considered a tenant.',
    on: 'hygiene.filthy',
    test: (p) => p?.actor?.id || null,
  },
  // ── The stray in Dray Lane (plugins/strays) ──────────────────────────────
  // Four entries, and the tonal split across them is deliberate. The petting
  // ones are dry. The killing one is dry too — the Architect does not moralise,
  // it files. The sadness is carried entirely by the room prose at the moment it
  // happens, and putting a joke here would be the system letting the player off.
  {
    key: 'bionic_purr',
    title: 'Bionic Purr',
    line: "Something in this city let you touch it. Enjoy the feeling; it isn't a trend.",
    on: 'npc.petted',
    test: (p) => (p?.npc?.flags?.stray_cat ? p.actor?.id || null : null),
  },
  {
    key: 'regular',
    title: 'Regular',
    line: 'Petted the same stray six times. It knows your gait now. Nobody else does.',
    on: 'npc.petted',
    // The counter is process-local write-behind, which is fine here: the durable
    // pet count is the plugin's own player flag, and the composite PK on
    // player_achievements stops a restart re-awarding this.
    test: (p, ctx) => {
      const id = p?.actor?.id;
      if (!id || !p?.npc?.flags?.stray_cat) return null;
      return ctx.bump(id, 'stray_pets') >= 6 ? id : null;
    },
  },
  {
    key: 'nine_lives_one_paw',
    title: 'Nine Lives, One Paw',
    line: "Killed a cat with a prosthetic. The Architect has logged this and won't be discussing it further.",
    on: 'npc.killed',
    test: (p) => (p?.npc?.flags?.stray_cat ? p.actor?.id || null : null),
  },
  {
    key: 'found_you',
    title: 'Found You',
    line: "Searched the lane and turned up the one thing in Coldwater that didn't want finding.",
    on: 'stray.found',
    test: (p) => p?.actor?.id || null,
  },
  {
    key: 'meta',
    title: 'Meta',
    line: 'Noticed ten times now. Hardly a personality.',
    on: 'accolade.unlocked',
    // Fires off our OWN unlock event, so it counts entries rather than actions —
    // and lands as your eleventh. Threshold sits below the catalog size on
    // purpose: an entry you can only get by already having everything is a
    // completion prize, and this system doesn't have those.
    test: (p) => (p?.total >= 10 ? p?.playerId : null),
  },
];

// key -> entry, for the app and the unlock path.
export const BY_KEY = new Map(ENTRIES.map((e) => [e.key, e]));

// Every distinct event the catalog listens to — index.js subscribes exactly
// these, so an entry using a new event needs no wiring beyond its own object.
export const LISTENED_EVENTS = [...new Set(ENTRIES.map((e) => e.on))];
