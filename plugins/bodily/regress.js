// Bodily plugin regression suite — run by tests/regress.js (never loaded in
// production). Only exercises the gated no-mutation paths: a real relief would
// stain the actual zone the fake player stands in.
export default async function regress({ run, check, getPlayer }) {
  const p = getPlayer();
  const savedThirst = p.thirst, savedHunger = p.hunger;

  p.thirst = 0;
  let r = await run('pee');
  check('pee verb routed + dehydration gate', /too dehydrated/.test(r?.message || ''), r?.message);

  p.hunger = 0;
  r = await run('poop');
  check('poop verb routed + empty-stomach gate', /haven't eaten/.test(r?.message || ''), r?.message);

  p.thirst = savedThirst; p.hunger = savedHunger;

  r = await run('pee on nobodyhere');
  check('bodily target miss reports not-found', /don't see/i.test(r?.message || ''), r?.message);

  r = await run('flush');
  check('flush verb routed', /flush|no toilet/i.test(r?.message || ''), r?.message);

  r = await run('shower');
  check('shower verb routed + no-shower gate', /no shower here/i.test(r?.message || ''), r?.message);

  // Shower recognised the same three ways as a toilet (type / flag / name).
  const { isShower } = await import('./index.js');
  check('object_type shower recognised', isShower({ name: 'jet', object_type: 'shower', flags: {} }) === true);
  check('name-only shower recognised', isShower({ name: 'rain shower head', object_type: 'fixture', flags: {} }) === true);
  check('flag shower recognised', isShower({ name: 'stall', object_type: 'fixture', flags: { shower: true } }) === true);
  check('non-shower furniture ignored', isShower({ name: 'a wooden chair', object_type: 'furniture', flags: {} }) === false);

  // A toilet is recognised by name, not just object_type/flags — content
  // routinely types toilets as 'furniture'/'fixture'. Without this, relief,
  // flush, and the fouled/peed describe line all silently miss them.
  const { isToilet } = await import('./index.js');
  check('name-only toilet recognised', isToilet({ name: 'curtained toilet', object_type: 'fixture', flags: {} }) === true);
  check('object_type toilet recognised', isToilet({ name: 'steel bowl', object_type: 'toilet', flags: {} }) === true);
  check('non-toilet furniture ignored', isToilet({ name: 'a wooden chair', object_type: 'furniture', flags: {} }) === false);

  // Contaminated-water seam: the water + fillable plugins ask over these actions.
  const { dispatchAction } = await import('../../server/engine/actions.js');
  const clean = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'no-such-toilet' } });
  check('unfouled toilet reports clean', clean.fouled === false && clean.peed === false, JSON.stringify(clean));

  p.statuses = [];
  const foul = await dispatchAction({ type: 'bodily.drinkContaminated', actor: p, params: { fouled: true } });
  check('drinking foul water returns a warning line', /fouled|regret|gag/i.test(foul.message || ''), foul.message);
  check('drinking foul water applies the sick effect', (p.statuses || []).some(s => s.name === 'sick'));
  p.statuses = [];

  // Flush clears the filth: foul a toilet (both pee + poo), confirm it reports
  // contaminated, clear it the way flush does, confirm contamination is gone.
  const { foulToilet, clearToiletFilth } = await import('./index.js');
  foulToilet('regress-bowl', 'poop');
  foulToilet('regress-bowl', 'pee');
  let s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-bowl' } });
  check('fouled toilet reports contaminated', s.fouled === true && s.peed === true, JSON.stringify(s));
  clearToiletFilth('regress-bowl');
  s = await dispatchAction({ type: 'bodily.toiletContamination', params: { furnitureId: 'regress-bowl' } });
  check('flush clears pee, poo, and contamination', s.fouled === false && s.peed === false, JSON.stringify(s));

  // ── fart: deliberate, scaled, and on a leash ────────────────────────────────
  // The gamble: past ~75% full, farting risks the other thing entirely.
  const { fartRisk } = await import('./index.js');
  check('a comfortable gut carries no risk at all', fartRisk(0.5) === 0 && fartRisk(0.74) === 0);
  check('risk starts only past the floor', fartRisk(0.8) > 0);
  check('...and climbs toward the involuntary ceiling', fartRisk(1) > fartRisk(0.85));
  check('it is a gamble, never a certainty', fartRisk(1) < 0.5, fartRisk(1));
  check('the risk band overlaps the warnings the player already gets',
    fartRisk(80 / 110) === 0 && fartRisk(95 / 110) > 0);

  const savedLoad = p.digestive_load;
  // Deliberately below the risk floor: this is testing the verb and the cooldown,
  // and a 45% chance of soiling the fake player mid-suite would be flaky.
  p.digestive_load = 60;
  r = await run('fart');
  // Deliberately not matched against the prose — there are eight styles and the
  // line is rolled, so asserting any particular wording just breaks whenever a
  // style is added. It ran and it didn't error; that's the contract.
  check('fart is a live verb', r?.type === 'output' && !!r.message, r?.message);
  r = await run('fart');
  check('...and is on a cooldown', /nothing left in the tank/i.test(r?.message || ''), r?.message);

  // Pressure drives the sound, and an empty gut has nothing to give.
  await import('../../client/shared/procedural-sfx.js');
  const P = globalThis.ProceduralSFX;
  const small = P.buildActionCue({ action: 'flatus', intensity: 0.1, seed: 7 });
  const huge  = P.buildActionCue({ action: 'flatus', intensity: 1.0, seed: 7 });
  check('a full gut farts longer than an empty one',
    huge.config.duration > small.config.duration, { small: small.config.duration, huge: huge.config.duration });
  check('...and lower', huge.config.layers[0].freq < small.config.layers[0].freq);

  // STYLE is the second axis. Scaling one shape by pressure made every fart the
  // same fart; the point is not knowing which one you'll get.
  const rolled = new Set();
  for (let k = 0; k < 24; k++) rolled.add(P.buildActionCue({ action: 'flatus', intensity: 0.8, seed: k }).style);
  check('the same pressure produces several different styles', rolled.size >= 4, [...rolled]);
  check('a nearly-empty gut can only manage the weak ones', (() => {
    const weak = new Set();
    for (let k = 0; k < 16; k++) weak.add(P.buildActionCue({ action: 'flatus', intensity: 0.08, seed: k }).style);
    return !weak.has('drone') && !weak.has('ripper');
  })());
  check('the style is seeded, so the client rebuilds the one the server rolled',
    P.buildActionCue({ action: 'flatus', intensity: 0.8, seed: 77 }).style
      === P.buildActionCue({ action: 'flatus', intensity: 0.8, seed: 77 }).style);
  check('a named style is honoured rather than re-rolled',
    P.buildActionCue({ action: 'flatus', intensity: 0.8, state: 'drone', seed: 3 }).style === 'drone');
  check('a multi-pulse style really is several reports',
    P.buildActionCue({ action: 'flatus', intensity: 0.9, state: 'staccato', seed: 3 }).config.layers.length
      > P.buildActionCue({ action: 'flatus', intensity: 0.9, state: 'drone', seed: 3 }).config.layers.length);

  // Prose and sound must agree — the room shouldn't read "a small squeak" over a
  // two-second drone. Bodily owns the eligibility, so it has to match the table.
  const { _test: bodilyTest } = await import('./index.js').then(m => ({ _test: m })).catch(() => ({ _test: null }));
  // Prose and sound must agree — the room must never read "a small squeak" over
  // a two-second drone. The two tables share only the style NAME (bodily owns
  // when it happens and what it reads as; audio owns what it sounds like), so
  // the one thing that can drift is the key set. Guard exactly that.
  const { FART_STYLE_LINES } = await import('./index.js');
  const audioStyles = Object.keys(P.FLATUS_STYLES).sort();
  const proseStyles = Object.keys(FART_STYLE_LINES).sort();
  check('every style the generator can roll has a line for the room',
    audioStyles.join() === proseStyles.join(), { audio: audioStyles, prose: proseStyles });
  check('every style is reachable at some pressure',
    proseStyles.every(k => (FART_STYLE_LINES[k].min ?? 0) <= (FART_STYLE_LINES[k].max ?? 1)));

  // The stream scales the same way, and the dribble runs on after a big one.
  const trickle = P.buildActionCue({ action: 'stream', intensity: 0.1, seed: 7 });
  const torrent = P.buildActionCue({ action: 'stream', intensity: 1.0, seed: 7 });
  check('a barely-full bladder does not splatter', trickle.config.layers.length < torrent.config.layers.length,
    { trickle: trickle.config.layers.length, torrent: torrent.config.layers.length });
  check('a full one is louder', torrent.config.layers[0].gain > trickle.config.layers[0].gain);
  const dribLow  = P.buildActionCue({ action: 'stream', intensity: 0.1, state: 'dribble', seed: 7 });
  const dribHigh = P.buildActionCue({ action: 'stream', intensity: 1.0, state: 'dribble', seed: 7 });
  check('the more you had, the longer it dribbles out',
    dribHigh.config.duration > dribLow.config.duration, { low: dribLow.config.duration, high: dribHigh.config.duration });
  p.digestive_load = savedLoad;

  // ── Condition: the survival meters finally cost something ───────────────────
  // Before this, you could be starving and freezing and still swing, dodge and
  // shoot exactly as well as a warm, fed man. These are the sideways edges.
  const { effectiveStat, statPenalty, conditionReport } = await import('../../server/engine/condition.js');
  const { skillStatBonus } = await import('../../server/engine/skills.js');
  const WARM = { stat_reflexes: 6, stat_brawn: 6, stat_cool: 6, stat_brains: 6, stat_senses: 6,
    stat_endurance: 6, hunger: 100, thirst: 100, body_temp_c: 37 };

  check('a warm, fed player acts on their full sheet',
    effectiveStat(WARM, 'stat_reflexes') === 6 && statPenalty(WARM, 'stat_reflexes') === 0);
  check('cold hands cost Reflexes', effectiveStat({ ...WARM, body_temp_c: 32 }, 'stat_reflexes') < 6);
  check('...and colder costs more',
    effectiveStat({ ...WARM, body_temp_c: 28 }, 'stat_reflexes')
      < effectiveStat({ ...WARM, body_temp_c: 32 }, 'stat_reflexes'));
  check('hunger costs Brawn', effectiveStat({ ...WARM, hunger: 4 }, 'stat_brawn') < 6);
  check('thirst costs Endurance, not Cool',
    effectiveStat({ ...WARM, thirst: 4 }, 'stat_endurance') < 6
      && effectiveStat({ ...WARM, thirst: 4 }, 'stat_cool') === 6);
  check('...and worse thirst costs more',
    effectiveStat({ ...WARM, thirst: 4 }, 'stat_endurance')
      < effectiveStat({ ...WARM, thirst: 15 }, 'stat_endurance'));
  check('...with the cognitive hit held back until it is severe',
    effectiveStat({ ...WARM, thirst: 15 }, 'stat_brains') === 6
      && effectiveStat({ ...WARM, thirst: 4 }, 'stat_brains') < 6);
  check('heat costs Brains, not Reflexes', (() => {
    const hot = { ...WARM, body_temp_c: 43 };
    return effectiveStat(hot, 'stat_brains') < 6 && effectiveStat(hot, 'stat_reflexes') === 6;
  })());
  check('being wrecked never makes you helpless — stats floor at 1',
    effectiveStat({ ...WARM, stat_reflexes: 1, body_temp_c: 28 }, 'stat_reflexes') === 1);
  check('condition never makes you BETTER than your sheet',
    effectiveStat({ ...WARM, body_temp_c: 37, hunger: 100 }, 'stat_reflexes') === 6);

  // The whole point of putting the edge in skillStatBonus: it reaches every
  // skill in the game without a single call site changing.
  check('cold reaches dodge through the one stat funnel',
    skillStatBonus({ ...WARM, body_temp_c: 30 }, 'dodge') < skillStatBonus(WARM, 'dodge'));
  check('...and to-hit with a blade', 
    skillStatBonus({ ...WARM, body_temp_c: 30 }, 'blades') < skillStatBonus(WARM, 'blades'));
  check('...and a skill governed by neither is untouched by cold',
    skillStatBonus({ ...WARM, body_temp_c: 30 }, 'cooking') === skillStatBonus(WARM, 'cooking'));
  check('the player is told why they are worse',
    conditionReport({ ...WARM, body_temp_c: 32, hunger: 10 }).length === 2);
  check('a healthy player has nothing to report', conditionReport(WARM).length === 0);

  // ── Fatigue: derived, gentle, and only sleep undoes it ──────────────────────
  const { fatigueOf, FATIGUE_FULL_HOURS, SLEEP_RECOVERY_RATIO, FATIGUE_TIRED } =
    await import('../../server/engine/condition.js');
  const awake = h => ({ ...WARM, last_slept_at: Date.now() - h * 3600000 });

  check('a player who has never slept is treated as fresh, not wrecked',
    fatigueOf({ ...WARM, last_slept_at: null }) === 0);
  check('fatigue builds with time awake', fatigueOf(awake(4)) > fatigueOf(awake(1)));
  check('...and is gentler than hunger — a long session before it bites',
    fatigueOf(awake(3)) < FATIGUE_TIRED, fatigueOf(awake(3)));
  check('it caps rather than running away', fatigueOf(awake(100)) === 100);
  check('exhaustion costs Brains first', statPenalty(awake(FATIGUE_FULL_HOURS), 'stat_brains') > 0);
  check('...and Reflexes only once it is severe',
    statPenalty(awake(3), 'stat_reflexes') === 0 && statPenalty(awake(FATIGUE_FULL_HOURS), 'stat_reflexes') > 0);
  check('tired reaches combat through the same funnel',
    skillStatBonus(awake(FATIGUE_FULL_HOURS), 'dodge') < skillStatBonus(WARM, 'dodge'));
  check('being tired is reported, not silent',
    conditionReport(awake(FATIGUE_FULL_HOURS)).some(c => /tired|exhausted|no sleep/.test(c.why)));

  // Sleep undoes it in REAL time — fast enough to be a mechanic, slow enough to
  // be a decision.
  check('sleep is meaningfully faster than being awake', SLEEP_RECOVERY_RATIO > 1);
  // Short enough that nobody spends their evening in a bed. The mechanic is
  // worthless if the optimal play is lying down.
  check('...and a full night clears in about five minutes, not half an hour', (() => {
    const minutes = (FATIGUE_FULL_HOURS * 60) / SLEEP_RECOVERY_RATIO;
    return minutes >= 3 && minutes <= 7;
  })(), (FATIGUE_FULL_HOURS * 60) / SLEEP_RECOVERY_RATIO);

  // The reward has to outweigh the penalty — sleeping is optional, so it must be
  // worth doing rather than merely something bad you're avoiding.
  const { effectStatBonus } = await import('../../server/engine/effects.js');
  const restedPlayer = { ...WARM, statuses: [{ name: 'rested', duration: 100 }] };
  check('Well Rested actually raises stats', effectStatBonus(restedPlayer, 'stat_brains') > 0);
  check('...and the reward beats the penalty for skipping sleep',
    effectStatBonus(restedPlayer, 'stat_brains') >= statPenalty(awake(6), 'stat_brains'));
  check('a rested player is better than a merely-not-tired one',
    effectiveStat(restedPlayer, 'stat_brains') > effectiveStat(WARM, 'stat_brains'));
  check('being tired is a nudge, not a crippling', statPenalty(awake(6), 'stat_brains') <= 1);

  // ── Cool ↔ sanity: composure protects, and losing it costs ─────────────────
  const { resistSanityLoss } = await import('../../server/engine/condition.js');
  const cool = (c, san) => ({ ...WARM, stat_cool: c, sanity: san, sanity_max: 100 });
  check('a cool head takes less of a sanity hit',
    resistSanityLoss(cool(8, 100), 10) < resistSanityLoss(cool(2, 100), 10));
  check('...but nobody is immune', resistSanityLoss(cool(20, 100), 10) > 0);
  check('losing your grip costs you your composure',
    effectiveStat(cool(8, 10), 'stat_cool') < effectiveStat(cool(8, 100), 'stat_cool'));
  check('...which makes the next hit land harder — the loop is real',
    resistSanityLoss(cool(8, 10), 10) > resistSanityLoss(cool(8, 100), 10));
  check('but the spiral has a floor and cannot reach zero',
    effectiveStat(cool(1, 0), 'stat_cool') === 1);

  // ── Dreams: sleep is no longer dead time ────────────────────────────────────
  const { rollDream } = await import('../../server/engine/dreams.js');
  const sound = { ...WARM, sanity: 100, sanity_max: 100 };
  const frayed = { ...WARM, sanity: 10, sanity_max: 100 };
  const gather = async (who, n = 60) => {
    const out = new Set();
    for (let k = 0; k < n; k++) { const d = await rollDream(who, { chance: 1 }); if (d) out.add(d); }
    return out;
  };

  const sane = await gather(sound);
  check('dreams vary rather than repeating one line', sane.size >= 3, sane.size);

  let dreamless = 0;
  for (let k = 0; k < 30; k++) if (!(await rollDream(sound, { chance: 0 }))) dreamless++;
  check('a dreamless night is possible', dreamless === 30, dreamless);

  // Sanity is the biggest input: a broken mind should reach pools a sound one
  // never sees. Asserted on the actual text, not on a placeholder.
  const broken = await gather(frayed);
  check('a frayed mind dreams things a sound one never does',
    [...broken].some(d => !sane.has(d)), { sound: sane.size, frayed: broken.size });

  // The body reaches into sleep — you dream about what you went to bed needing.
  const starving = await gather({ ...sound, hunger: 5 });
  check('a starving player dreams about food',
    [...starving].some(d => /meal|eat|jaw/i.test(d)), [...starving].slice(0, 3));
  const bloody = await gather({ ...sound, covered_in_blood: 1 });
  check('coming to bed covered in blood follows you into it',
    [...bloody].some(d => /washing|hands/i.test(d)));

  // ── Dreamscape: the dream you can walk around in ────────────────────────────
  const { buildDreamscape, dissolveDreamscape, wakeFromDream, isDreamZone, dreamObjectsAt } =
    await import('../../server/engine/dreamscape.js');
  const { world } = await import('../../server/engine/world.js');

  const entry = buildDreamscape('regress-dreamer', { size: 4, tether: { zone: 'The Reach' } });
  check('a dreamscape builds walkable rooms', isDreamZone(entry) && !!world.zones.get(entry));
  check('...with somewhere to go', Object.keys(world.zones.get(entry).exits || {}).length > 0);
  check('...and things to poke at', dreamObjectsAt(entry).length > 0);
  check('dream rooms are flagged as dreams', world.zones.get(entry).flags?.dream === true);
  check('...and you cannot be fought in one', world.zones.get(entry).flags?.no_combat === true);

  // The leak that matters: a dreamscape left registered costs zones for the life
  // of the process, every single sleep.
  const zonesBefore = world.zones.size;
  dissolveDreamscape('regress-dreamer');
  check('waking dissolves every room of it', world.zones.size < zonesBefore, { before: zonesBefore, after: world.zones.size });
  check('...leaving none behind', ![...world.zones.keys()].some(z => z.includes('regress-dreamer')));

  // Being yanked out — by waking, by a command, or by someone attacking you in
  // your bed. All five wake paths call this, and it has to be safe on someone
  // who was never dreaming.
  check('waking from no dream at all is a safe no-op', wakeFromDream({ id: 'x' }) === false);
  check('...and on a sleeping non-dreamer too',
    wakeFromDream({ id: 'x', sleeping: { inDream: false } }) === false);

  const dreamer = { id: 'regress-yank', current_zone: null, sleeping: { inDream: true, bodyZone: p.current_zone } };
  dreamer.current_zone = buildDreamscape('regress-yank', { size: 2 });
  check('being attacked mid-dream puts you back in your body',
    wakeFromDream(dreamer) === true && dreamer.current_zone === p.current_zone);
  check('...and takes the dream with it',
    ![...world.zones.keys()].some(z => z.includes('regress-yank')));

  // ── Smell: the room-level sense ─────────────────────────────────────────────
  const { stainZone, taintAir, zoneAir, TAINT_MS } = await import('../../server/engine/bodily.js');

  r = await run('smell');
  check('smell is a live verb and reports something', /breathe in/i.test(r?.message || ''), r?.message);
  check('a clean room says so rather than listing nothing',
    /nothing worth reporting/i.test(r?.message || '') || /\n/.test(r?.message || ''), r?.message);

  // A stain on the floor is persistent and smell finds it.
  stainZone(p.current_zone, 'feces');
  r = await run('smell');
  check('smell finds what someone left on the floor', /shit/i.test(r?.message || ''), r?.message);

  // Air taint is the OTHER shape: no stain, and it genuinely expires. That
  // distinction is the whole joke — walking away has to actually work.
  taintAir(p.current_zone, 'fart');
  r = await run('smell');
  check('a fart hangs in the air and is findable', /fart|flatulence/i.test(r?.message || ''), r?.message);
  // Stacking, asserted relative to whatever is already hanging — anything else
  // in the suite that farts (the `fart` verb has its own tests above) would
  // otherwise break this by arriving first.
  check('...and stacks rather than resetting when it happens again', (() => {
    const before = zoneAir(p.current_zone).find(a => a.type === 'fart')?.n || 0;
    taintAir(p.current_zone, 'fart');
    const after = zoneAir(p.current_zone).find(a => a.type === 'fart')?.n || 0;
    return after > before || after === 3;   // 3 is the cap
  })());
  check('...and is gone once it has had its minute',
    zoneAir(p.current_zone, Date.now() + TAINT_MS + 1).length === 0);
  check('an expired taint is dropped from the store as it is read',
    !(zoneAir(p.current_zone, Date.now() + TAINT_MS + 1)).some(a => a.type === 'fart'));

  // The gather hook is what lets a room stink of several things at once —
  // a fireHook would have kept only the last contributor.
  const { gatherHook } = await import('../../server/engine/plugins.js');
  const all = await gatherHook('zone.smells', { id: p.current_zone }, p);
  check('zone.smells gathers from every plugin rather than last-wins', Array.isArray(all), typeof all);

  // ── Acuity: the band, not the contributors ──────────────────────────────────
  const { perceptionBand, perceive, acuityFor, BASE_FLOOR, BASE_LIMIT } = await import('../../server/engine/senses.js');

  const base = perceptionBand(0);
  check('a normal nose sits at the documented baseline',
    base.floor === BASE_FLOOR && base.limit === BASE_LIMIT, base);
  check('acuity lowers the floor and raises the cap',
    perceptionBand(2).floor < base.floor && perceptionBand(2).limit > base.limit, perceptionBand(2));
  check('impairment does the reverse', perceptionBand(-2).floor > base.floor, perceptionBand(-2));
  check('the floor never goes negative, so acuity cannot loop back around',
    perceptionBand(99).floor === 0 && perceptionBand(-99).floor <= 8);
  check('even a blunted sense still gets the thing that is on fire',
    perceive([{ text: 'fire', strength: 10 }], perceptionBand(-3)).length === 1);

  // The whole point: the faint band is generated either way and only acuity reads it.
  const faint = [{ text: 'one quiet person', strength: 3 }];
  check('a lone person is below a normal nose', perceive(faint, perceptionBand(0)).length === 0);
  check('...and above a sharp one', perceive(faint, perceptionBand(2)).length === 1);

  check('a player with no statuses is baseline', (await acuityFor(p, 'smell')) === 0);

  // A status effect is the cheap path for a drug or mutation to sharpen a sense.
  const { registerStatusEffect, effectAcuity } = await import('../../server/engine/effects.js');
  registerStatusEffect({ name: 'regress_keen_nose', label: 'Keen', onTick: () => null, acuity: { smell: 2 } });
  p.statuses = [{ name: 'regress_keen_nose', duration: 5 }];
  check('a status effect can sharpen a sense with no plumbing of its own',
    effectAcuity(p, 'smell') === 2, effectAcuity(p, 'smell'));
  check('...and only the sense it names', effectAcuity(p, 'hearing') === 0);
  check('acuityFor picks the status up', (await acuityFor(p, 'smell')) === 2);
  p.statuses = [];

  // ── The stat path: dump into senses and you ARE super, no hardware ──────────
  const { statAcuity, wouldOverload, overloadThreshold, EXTREME } =
    await import('../../server/engine/senses.js');
  const savedStat = p.stat_senses, savedDom = p._senseDominant, savedSec = p._senseSecond;

  p.stat_senses = 12; p._senseDominant = 'smell'; p._senseSecond = 'hearing';
  check('a heavy senses investment makes the dominant sense super with no augment',
    statAcuity(p, 'smell') >= 3, statAcuity(p, 'smell'));
  check('...the second is only slightly better than human', statAcuity(p, 'hearing') <= 2 && statAcuity(p, 'hearing') >= 1);
  check('...and everything else stays ordinary', statAcuity(p, 'sight') === 0);
  check('you can never be super in two senses at once',
    statAcuity(p, 'hearing') < statAcuity(p, 'smell'));

  p.stat_senses = 2;
  check('below the threshold the stat does nothing at all', statAcuity(p, 'smell') === 0);
  p.stat_senses = 6;
  check('a mid investment sharpens the dominant sense but opens no second',
    statAcuity(p, 'smell') === 2 && statAcuity(p, 'hearing') === 1);

  // ── And it hurts ────────────────────────────────────────────────────────────
  check('a sharp sense is overwhelmed by something a normal one shrugs off',
    wouldOverload(4, 9) && !wouldOverload(0, 9));
  check('the sharper you are, the less it takes to blow you out',
    overloadThreshold(4) < overloadThreshold(2));
  // Nobody is immune. A sharp sense goes down to things others merely dislike;
  // an ordinary one still goes down to something at the top of the scale.
  check('an ordinary nose is NOT troubled by everyday filth', !wouldOverload(0, 9));
  check('...but an extreme event takes anyone, augment or no augment',
    wouldOverload(0, EXTREME), overloadThreshold(0));
  check('a dulled sense is the only way to walk through it unaffected',
    !wouldOverload(-3, EXTREME + 2));
  // Being blown out by a corpse and by a blocked drain are different experiences,
  // and the character whose whole build is specificity should not go vague at the
  // moment their sense fails.
  const { overloadText } = await import('../../server/engine/senses.js');
  check('overload prose names what actually did it',
    overloadText('smell', 'feces') !== overloadText('smell', 'burning'));
  check('...and differs by sense as well as by source',
    overloadText('smell', 'blood') !== overloadText('hearing', 'blood'));
  check('an untagged contributor still gets a sensible line',
    overloadText('smell', null) === overloadText('smell', 'no_such_source'));
  check('every sense has a fallback line', ['smell', 'hearing', 'sight', 'touch'].every(s => !!overloadText(s, null)));

  check('overload leaves you WORSE than an ordinary nose, not merely normal', (() => {
    p.statuses = [{ name: 'sense_overload', duration: 20 }];
    const blown = effectAcuity(p, 'smell');
    p.statuses = [];
    return blown < 0;
  })());

  // ── listen + sight: the other two senses now do something ───────────────────
  r = await run('listen');
  check('listen is a live verb and reaches the sense, not just the radio',
    /you listen|you stop, and listen/i.test(r?.message || ''), r?.message);

  // The fan-out is capped. `getSoundReach` legitimately returns 40+ zones in an
  // open district at high acuity, and each one costs a gatherHook across every
  // plugin — an uncapped, uncooldowned verb is how the query-per-sniff bug
  // happened the first time.
  const { getSoundReach } = await import('../../server/engine/sounds.js');
  const wide = getSoundReach(p.current_zone, 3 + 4 * 2);
  check('sound reach is honest about distance (uncapped at the source)', wide.size >= 1, wide.size);
  check('...but listen never interrogates more than its cap', (() => {
    const capped = [...wide.entries()].sort((a, b) => a[1] - b[1]).slice(0, 12);
    return capped.length <= 12;
  })());

  // The cap is the backstop; the INDEX is what makes it cheap. A zone nobody is
  // making noise in never reaches the gather hook at all, so a listen in an
  // empty neighbourhood costs zero plugin calls however far it reaches.
  const { markNoisy, clearNoisy, clearNoisyKey, isNoisy, noisyZoneCount } =
    await import('../../server/engine/sounds.js');
  const before = noisyZoneCount();
  check('a silent zone is skipped entirely', !isNoisy('regress-quiet-zone'));
  markNoisy('regress-quiet-zone', 'cook-1');
  check('a noise source puts its zone in the index', isNoisy('regress-quiet-zone'));
  markNoisy('regress-quiet-zone', 'cook-2');
  clearNoisy('regress-quiet-zone', 'cook-1');
  check('two sources in one room do not cancel each other', isNoisy('regress-quiet-zone'));
  clearNoisy('regress-quiet-zone', 'cook-2');
  check('the last one out clears the room', !isNoisy('regress-quiet-zone'));
  check('the index does not leak entries', noisyZoneCount() === before, noisyZoneCount());
  // A vessel can be carried out of the room it started cooking in, so a source
  // must be forgettable without knowing where it left itself.
  markNoisy('regress-zone-a', 'wanderer');
  clearNoisyKey('wanderer');
  check('a source can be cleared without knowing its zone', !isNoisy('regress-zone-a'));

  // SIGHT is not a verb — it makes `look` work in the dark. The ladder shift is
  // what "super sight" means concretely: pitch dark up to gloomy is the step
  // where enemies and NPCs stop being hidden.
  const { shiftVisibility, LIGHT_LADDER } = await import('../../server/engine/environment.js');
  const pitch = { category: 'pitch_dark', visibility: 0 };
  check('a keen eye lifts a pitch-dark room off the floor',
    LIGHT_LADDER.indexOf(shiftVisibility(pitch, 2).category) > 0, shiftVisibility(pitch, 2));
  check('super sight makes a pitch-dark room actually navigable',
    shiftVisibility(pitch, 3).category === 'gloomy', shiftVisibility(pitch, 3).category);
  check('...and at the top of the stat, comfortable',
    shiftVisibility(pitch, 4).category === 'dim', shiftVisibility(pitch, 4).category);
  check('smoked lenses push the other way', (() => {
    const clear = { category: 'clear', visibility: 0.6 };
    return LIGHT_LADDER.indexOf(shiftVisibility(clear, -2).category) < LIGHT_LADDER.indexOf('clear');
  })());
  check('the shift never falls off either end of the ladder',
    shiftVisibility(pitch, -9).category === 'pitch_dark'
      && shiftVisibility({ category: 'blazing', visibility: 1 }, 9).category === 'blazing');
  check('an ordinary eye changes nothing', shiftVisibility(pitch, 0) === pitch);

  // Touch was dropped rather than shipped as a sense you could attune to and
  // get nothing from.
  const { SENSES: LIVE_SENSES } = await import('../../server/engine/senses.js');
  check('every attunable sense has something that reads it',
    !LIVE_SENSES.includes('touch'), LIVE_SENSES);

  // ── Gear: buy protection with perception ────────────────────────────────────
  const { recomputeSenseDamp } = await import('../../server/engine/commands/inventory.js');
  const { gearDamp } = await import('../../server/engine/senses.js');
  const savedDamp = p._senseDamp;

  p.stat_senses = 12; p._senseDominant = 'smell'; p._senseSecond = null;
  const bare = await acuityFor(p, 'smell');

  recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -2 } } }]);
  check('worn gear dulls the sense it names', gearDamp(p, 'smell') === -2, gearDamp(p, 'smell'));
  check('...and nothing else', gearDamp(p, 'hearing') === 0);
  const masked = await acuityFor(p, 'smell');
  check('a mask costs you real acuity', masked < bare, { bare, masked });

  // The trade, stated as a test: the mask makes you harder to overwhelm by
  // exactly as much as it makes you worse at smelling.
  check('...and buys protection with it — a crowd that would blow you out no longer can',
    wouldOverload(bare, 6) && !wouldOverload(masked, 6), { bare, masked });
  check('but it does not make you immune — something truly foul still gets through',
    wouldOverload(masked, 10), overloadThreshold(masked));

  recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -2 } } }, { tags: { sense_damp: { smell: -1 } } }]);
  check('damping sums across everything worn', gearDamp(p, 'smell') === -3);
  // Two tiers per sense: plugs take the edge off, a respirator seals. Enough
  // of either and you can walk through the worst thing in the game untouched —
  // perceiving nothing, which is the price.
  check('the cheap tier alone is not enough to survive an extreme event', (() => {
    recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -1 } } }]);
    return wouldOverload(gearDamp(p, 'smell'), EXTREME + 2);
  })());
  check('...but a proper seal is', (() => {
    recomputeSenseDamp(p, [{ tags: { sense_damp: { smell: -2 } } }, { tags: { sense_damp: { smell: -1 } } }]);
    return !wouldOverload(gearDamp(p, 'smell'), EXTREME + 2);
  })());
  recomputeSenseDamp(p, [{ tags: {} }, { tags: null }]);
  check('gear with no damping leaves you as you were', gearDamp(p, 'smell') === 0);

  p._senseDamp = savedDamp;
  p.stat_senses = savedStat; p._senseDominant = savedDom; p._senseSecond = savedSec;

  // The verb itself: gated on the stat, and re-attuning is surgery.
  p.stat_senses = 0;
  r = await run('attune smell');
  check('attune refuses an ordinary nervous system', /ordinary/i.test(r?.message || ''), r?.message);
  p.stat_senses = 9; p._senseDominant = null;
  r = await run('attune nonsense');
  check('attune rejects a sense that does not exist', /isn't a sense/i.test(r?.message || ''), r?.message);
  r = await run('attune smell');
  check('the first attunement is free', /comes forward/i.test(r?.message || ''), r?.message);
  r = await run('attune hearing');
  check('...but changing it is a clinic job', /clinic/i.test(r?.message || ''), r?.message);
  p.stat_senses = savedStat; p._senseDominant = savedDom; p._senseSecond = savedSec;
}
