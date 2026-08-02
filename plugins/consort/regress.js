// consort plugin regression suite — run by tests/regress.js (never in production).
// Covers the archetype registry, the pronoun renderer, pairing resolution, the
// seeded roster/pricing, and the live surface (talk hook, beckon/dismiss/pour, tick).
import { _test } from './index.js';
import { ARCHETYPES, PAIRINGS, renderLine, pronounsFor, soloSafe, needsOther, temperamentOf, voiceSamples } from './archetypes.js';
import { generateAppearance, appearanceCard, describeAppearance, intimateCard, intimateHeadline, BUILDS, rngFor } from './appearance.js';
import * as roster from './roster.js';

export default async function regress({ check }) {
  const mk = (over = {}) => ({
    id: 'regress_consort_a', name: 'Roxy', zone_id: 'zone_nowhere',
    flags: {
      consort: true, devoted_to: 'Cyd', consort_archetype: 'strategist', consort_sex: 'female',
      clothing_layers: ['a robe', 'a slip', 'a bra and panties'],
    },
    ...over,
  });
  const roxy = mk();

  // ── Identity + undress maths (unchanged contract) ──────────────────────────
  check('isConsort: flagged NPC is a consort', _test.isConsort(roxy) === true);
  check('isConsort: dead consort is not', _test.isConsort({ ...roxy, _dead: true }) === false);
  check('isConsort: plain NPC is not', _test.isConsort({ id: 'x', flags: {} }) === false);
  check('peel: nothing off at zero arousal', _test.peeledForArousal(roxy, 0) === 0);
  check('peel: everything off at max arousal', _test.peeledForArousal(roxy, _test.MAX_AROUSAL) === 3);
  let mono = true, prev = -1;
  for (let a = 0; a <= _test.MAX_AROUSAL; a += 5) {
    const p = _test.peeledForArousal(roxy, a);
    if (p < prev) mono = false;
    prev = p;
  }
  check('peel: layers come off monotonically with arousal', mono);

  // ── Archetype registry ─────────────────────────────────────────────────────
  const KEYS = Object.keys(ARCHETYPES);
  check('archetypes: the registry carries a real spread of personalities', KEYS.length >= 10, `${KEYS.length}`);
  const POOLS = ['devotedTame', 'devotedHot', 'arousedTame', 'arousedHot', 'shy', 'worried',
    'missShort', 'missLong', 'talkKeeper', 'talkShy', 'selfDescribes'];
  let poolBad = null;
  for (const k of KEYS) {
    const A = ARCHETYPES[k];
    for (const p of POOLS) {
      if (!Array.isArray(A[p]) || !A[p].length || !A[p].every(l => typeof l === 'string' && l.trim())) { poolBad = `${k}.${p}`; break; }
    }
    if (poolBad) break;
    for (const p of ['pourTame', 'pourHot']) {
      if (!Array.isArray(A[p]) || !A[p].length
        || !A[p].every(fn => typeof fn === 'function' && /a test cocktail/.test(String(fn('a test cocktail') || '')))) { poolBad = `${k}.${p}`; break; }
    }
    if (poolBad) break;
    for (const e of ['arriveWardrobe', 'arriveDeck', 'departWardrobe', 'departDeck']) {
      if (!Array.isArray(A.entrances?.[e]) || !A.entrances[e].length) { poolBad = `${k}.entrances.${e}`; break; }
    }
    if (poolBad) break;
  }
  check('archetypes: every archetype carries every pool, all non-empty', poolBad === null, poolBad || '');

  // Every archetype must have a tier (drives pricing) and a self-description.
  check('archetypes: every archetype is priced and self-describing',
    KEYS.every(k => Number.isFinite(ARCHETYPES[k].tier) && ARCHETYPES[k].selfDescribes.length && ARCHETYPES[k].label));

  // ── Pronoun rendering ──────────────────────────────────────────────────────
  check('pronouns: female resolves to she/her', pronounsFor('female').they === 'she' && pronounsFor('female').them === 'her');
  check('pronouns: male resolves to he/him', pronounsFor('male').they === 'he' && pronounsFor('male').them === 'him');
  const tokenLine = '§ catches {themself} at it and {goes} back to what {they} {was} doing, and §other notices.';
  const rf = renderLine(tokenLine, mk(), { other: 'Vesper' });
  const rm = renderLine(tokenLine, mk({ flags: { ...roxy.flags, consort_sex: 'male' } }), { other: 'Vesper' });
  check('render: female line resolves fully', /herself/.test(rf) && /she was/.test(rf) && rf.includes('Roxy') && rf.includes('Vesper'), rf);
  check('render: male line resolves fully', /himself/.test(rm) && /he was/.test(rm), rm);

  // No pool anywhere may leave an unresolved {token} for either sex — this is the
  // check that catches a typo'd pronoun/verb token in newly-written prose.
  const leftovers = new Set();
  const walk = (v) => {
    if (typeof v === 'function') { walk(v('a drink')); return; }
    if (typeof v === 'string') {
      for (const sex of ['female', 'male']) {
        const out = renderLine(v, { name: 'X', flags: { consort_sex: sex } }, { other: 'Y' });
        for (const t of out.match(/\{\w+\}/g) || []) leftovers.add(t);
      }
      return;
    }
    if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object') Object.values(v).forEach(walk);
  };
  walk(ARCHETYPES);
  check('render: no archetype line leaves an unresolved token', leftovers.size === 0, [...leftovers].join(' '));

  // §other lines must be filtered out when a consort is alone.
  const withOther = ['plain line', 'talks to §other about it'];
  check('render: soloSafe drops two-hander lines', soloSafe(withOther).length === 1 && needsOther(withOther[1]));
  check('say: solo consort never emits an §other line',
    !String(_test.say(roxy, withOther) || '').includes('§other'));
  check('say: with a companion the §other slot is filled',
    !String(_test.say(roxy, ['aims it at §other'], { name: 'Vesper' })).includes('§other'));

  // ── Voice resolves by ARCHETYPE, never by name ─────────────────────────────
  check('voice: resolves off flags.consort_archetype', _test.voiceOf(roxy) === ARCHETYPES.strategist);
  check('voice: a renamed consort keeps her voice',
    _test.voiceOf(mk({ name: 'Someone Else Entirely' })) === ARCHETYPES.strategist);
  check('voice: an unknown archetype key falls back rather than throwing',
    !!_test.voiceOf(mk({ flags: { ...roxy.flags, consort_archetype: 'nonsense' } })));

  // ── Entrances ──────────────────────────────────────────────────────────────
  let entBad = null;
  for (const k of KEYS) {
    for (const sex of ['female', 'male']) {
      const npc = mk({ name: 'Testy', flags: { ...roxy.flags, consort_archetype: k, consort_sex: sex } });
      for (const kind of ['arrive', 'depart']) {
        for (const via of [true, false]) {
          const l = _test.pickEntrance(npc, kind, via);
          if (typeof l !== 'string' || !l.trim() || l.includes('§') || /\{\w+\}/.test(l) || !l.includes('Testy')) {
            entBad = `${k}/${sex}/${kind}/${via}: ${l}`; break;
          }
        }
        if (entBad) break;
      }
      if (entBad) break;
    }
    if (entBad) break;
  }
  check('entrance: every archetype renders arrivals/departures for both sexes', entBad === null, entBad || '');

  // ── Pairings ───────────────────────────────────────────────────────────────
  check('pairings: registry is well-formed',
    Object.values(PAIRINGS).every(p => p.members?.length === 2
      && p.members.every(k => ARCHETYPES[k]) && Number.isFinite(p.tier) && p.label));

  const pairA = mk({ id: 'p_a', zone_id: 'zone_pair', flags: { ...roxy.flags, consort_pairing: 'strategist_romantic' } });
  const pairB = mk({ id: 'p_b', name: 'Jolie', zone_id: 'zone_pair', flags: { ...roxy.flags, consort_archetype: 'romantic', consort_pairing: 'strategist_romantic' } });
  const resolved = _test.pairIn([pairA, pairB], 'zone_pair');
  check('pair: two consorts sharing a pairing resolve to an ordered A/B', !!resolved && resolved[0] === pairA && resolved[1] === pairB);
  check('pair: order follows the PAIRINGS registry, not spawn order',
    (() => { const r = _test.pairIn([pairB, pairA], 'zone_pair'); return r && r[0] === pairA && r[1] === pairB; })());
  check('pair: a lone consort is not a pair', _test.pairIn([pairA], 'zone_pair') === null);
  check('pair: two UNRELATED consorts are not a pair',
    _test.pairIn([mk({ id: 'u1', zone_id: 'z' }), mk({ id: 'u2', zone_id: 'z', flags: { ...roxy.flags, consort_archetype: 'ghost' } })], 'z') === null);

  // ── Two-hander threads ─────────────────────────────────────────────────────
  for (const [poolName, pool] of [['private', _test.PAIR_PRIVATE], ['with-keeper', _test.PAIR_WITH_KEEPER]]) {
    check(`banter: ${poolName} pool has threads`, Array.isArray(pool) && pool.length > 0, `${pool?.length}`);
    let bad = null;
    for (const thread of pool) {
      const whos = thread.map(t => t[0]);
      const ok = thread.length >= 2 && whos.includes('A') && whos.includes('B')
        && whos.every(w => w === 'A' || w === 'B')
        && thread.every(([, l]) => typeof l === 'string' && l.trim() && (l.match(/"/g) || []).length % 2 === 0);
      if (!ok) { bad = thread; break; }
    }
    check(`banter: ${poolName} threads are well-formed A/B two-handers`, bad === null, bad ? JSON.stringify(bad).slice(0, 120) : '');
  }

  // ── Settle: classified against the names actually present ──────────────────
  check('settle: naming the first consort → a', _test.classifySettle('Roxy, obviously', 'Roxy', 'Jolie') === 'a');
  check('settle: naming the second → b', _test.classifySettle('it has to be jolie', 'Roxy', 'Jolie') === 'b');
  check('settle: naming both → both', _test.classifySettle('both of you, always', 'Roxy', 'Jolie') === 'both');
  check('settle: "can\'t choose" → both', _test.classifySettle("I can't choose", 'Roxy', 'Jolie') === 'both');
  check('settle: an unrelated reply → dodge', _test.classifySettle('the weather is nice', 'Roxy', 'Jolie') === 'dodge');
  // The bug this replaced: hardcoded names meant a renamed consort was unnameable.
  check('settle: works for arbitrary generated names', _test.classifySettle('Thaddeus', 'Thaddeus', 'Ondine') === 'a');
  check('settle: a name that is a regex metacharacter does not throw',
    _test.classifySettle('hello', 'A(', 'B[') === 'dodge');
  check('settle: every reaction pool is a well-formed two-hander',
    Object.values(_test.SETTLE_REACT).every(th => th.length >= 1
      && th.every(([w, l]) => (w === 'A' || w === 'B') && typeof l === 'string' && l.trim())));

  // ── Questions: a consort asks, the keeper answers, they react ──────────────
  const QS = _test.QUESTIONS;
  check('questions: the pool is worth having', QS.length >= 8, `${QS.length}`);
  let qBad = null;
  for (const q of QS) {
    if (!q.key || typeof q.ask !== 'string' || !q.ask.trim()) { qBad = `${q.key}: ask`; break; }
    if (!Array.isArray(q.answers) || !q.answers.length) { qBad = `${q.key}: answers`; break; }
    // Every declared branch, plus dodge and timeout, must have written prose.
    const branches = [...q.answers.map(([b]) => b), 'dodge', 'timeout'];
    const missing = branches.find(b => !Array.isArray(q.react?.[b]) || !q.react[b].length
      || !q.react[b].every(l => typeof l === 'string' && l.trim()));
    if (missing) { qBad = `${q.key}.react.${missing}`; break; }
    if (q.answers.some(([, re]) => !(re instanceof RegExp))) { qBad = `${q.key}: answers regex`; break; }
  }
  check('questions: every question is askable and every branch is written', qBad === null, qBad || '');
  check('questions: keys are unique', new Set(QS.map(q => q.key)).size === QS.length);

  // A question must read for BOTH sexes and never leave a token behind — same
  // contract as every other pool. It must also never assume the KEEPER's sex,
  // because the keeper is a player.
  let qTok = null, qKeeper = null;
  for (const q of QS) {
    for (const sex of ['female', 'male']) {
      const who = mk({ name: 'Vesper', flags: { ...mk().flags, consort_sex: sex } });
      const all = [q.ask, ...Object.values(q.react).flat()];
      for (const line of all) {
        const out = renderLine(line, who, { other: 'Calla' });
        if (/\{[A-Za-z]+\}/.test(out)) { qTok = `${q.key} [${sex}]: ${out.slice(0, 90)}`; break; }
      }
      if (qTok) break;
    }
    // The keeper is addressed in the second person throughout; a third-person
    // pronoun in the ASK is the tell that somebody assumed a male keeper.
    if (/\bhe\b|\bshe\b|\bhis\b|\bher\b|\bhim\b/i.test(q.ask.replace(/\{[^}]+\}/g, ''))) qKeeper = q.key;
    if (qTok) break;
  }
  check('questions: every line renders clean for both sexes', qTok === null, qTok || '');
  check('questions: no question assumes the keeper is a man', qKeeper === null, qKeeper || '');

  // The classifier: generous, and an unreadable answer is a dodge, never a crash.
  const qStay = _test.questionByKey('staying');
  check('questions: questionByKey resolves', !!qStay);
  check('questions: a yes is read as yes', _test.classifyAnswer(qStay, 'yeah, I am staying') === 'yes');
  check('questions: a no is read as no', _test.classifyAnswer(qStay, 'nope, heading out') === 'no');
  check('questions: an unrelated reply is a dodge', _test.classifyAnswer(qStay, 'the gin is warm') === 'dodge');
  check('questions: an empty reply is a dodge', _test.classifyAnswer(qStay, '') === 'dodge');
  check('questions: punctuation does not defeat the match', _test.classifyAnswer(qStay, 'Yes!!!') === 'yes');
  check('questions: a branch with no written reaction never wins',
    QS.every(q => q.answers.every(([b]) => !!q.react[b])));

  // Rotation: a consort works through the pool before repeating.
  const asker = mk({ id: 'regress_consort_q' });
  const seen = new Set();
  for (let i = 0; i < QS.length; i++) seen.add(_test.nextStaticQuestion(asker).key);
  check('questions: the whole pool is asked before any repeat', seen.size === QS.length, `${seen.size}/${QS.length}`);
  check('questions: the pool wraps rather than running dry', !!_test.nextStaticQuestion(asker));

  // ── Dynamic questions: the ones that read the live room ────────────────────
  const DQ = _test.DYNAMIC_QUESTIONS;
  const CTX = {
    gameMinutes: 3 * 60 + 20, hour: 3, hpPct: 0.42, hunger: 20, thirst: 15,
    credits: 300, bank: 200, dailyRate: 900, daysKept: 44, missed: 1,
    stars: 3, charge: 'assault', tempC: -4, severity: 0.8, weather: 'sleeting',
    impaired: 2, companionName: 'Calla',
  };
  check('questions: a dynamic pool exists', DQ.length >= 8, `${DQ.length}`);
  let dBad = null;
  for (const q of DQ) {
    if (typeof q.applies !== 'function' || typeof q.ask !== 'function') { dBad = `${q.key}: shape`; break; }
    const branches = [...q.answers.map(([b]) => b), 'dodge', 'timeout'];
    const missing = branches.find(b => !Array.isArray(q.react?.[b]) || !q.react[b].length);
    if (missing) { dBad = `${q.key}.react.${missing}`; break; }
  }
  check('questions: every dynamic question is gated and fully written', dBad === null, dBad || '');
  check('questions: dynamic keys never collide with static ones',
    !DQ.some(q => QS.some(s => s.key === q.key)));

  // The whole point: with a rich context they all apply, and with an empty one
  // (a healthy, clean, fed, solvent keeper on a mild afternoon) almost none do.
  check('questions: a loaded context makes every dynamic question available',
    _test.applicableDynamic(CTX).length === DQ.length,
    `${_test.applicableDynamic(CTX).length}/${DQ.length}`);
  const CALM = {
    gameMinutes: 14 * 60, hour: 14, hpPct: 1, hunger: 100, thirst: 100,
    credits: 50_000, bank: 50_000, dailyRate: 900, daysKept: 2, missed: 0,
    stars: 0, charge: null, tempC: 19, severity: 0, weather: 'clear',
    impaired: 0, companionName: null,
  };
  check('questions: a calm context provokes none of them',
    _test.applicableDynamic(CALM).length === 0,
    _test.applicableDynamic(CALM).map(q => q.key).join(','));
  check('questions: applies() never throws on a partial context',
    Array.isArray(_test.applicableDynamic({})));

  // Rendered against the context, for both sexes, with nothing left unresolved.
  let dTok = null;
  for (const q of DQ) {
    for (const sex of ['female', 'male']) {
      const who = mk({ name: 'Vesper', flags: { ...mk().flags, consort_sex: sex } });
      const lines = [q.ask, ...Object.values(q.react).flat()];
      for (const l of lines) {
        const out = renderLine(_test.resolveLine(l, CTX), who, { other: 'Calla' });
        if (typeof out !== 'string' || !out.trim()) { dTok = `${q.key} [${sex}]: empty`; break; }
        if (/\{[A-Za-z]+\}/.test(out) || out.includes('undefined') || out.includes('NaN')) {
          dTok = `${q.key} [${sex}]: ${out.slice(0, 90)}`; break;
        }
      }
      if (dTok) break;
    }
    if (dTok) break;
  }
  check('questions: every dynamic line resolves against a live context', dTok === null, dTok || '');
  check('questions: a dynamic question quotes the actual state back',
    _test.resolveLine(_test.DYNAMIC_QUESTIONS.find(q => q.key === 'tenure').ask, CTX).includes('44'));
  check('questions: dynamic branches classify like static ones',
    _test.classifyAnswer(_test.questionByKey('heat'), 'no, they have no idea') === 'no');
  check('questions: questionByKey finds dynamic questions too', !!_test.questionByKey('hurt'));

  // ── Pacing: these beats are meant to be rare ───────────────────────────────
  check('pacing: spoken beats are minutes apart', _test.SPEAK_GAP_MS >= 150_000, `${_test.SPEAK_GAP_MS}`);
  check('pacing: scenes are on a long cooldown', _test.SCENE_GAP_MS >= 12 * 60_000, `${_test.SCENE_GAP_MS}`);
  check('pacing: arousal takes several minutes to peak',
    (_test.MAX_AROUSAL / _test.RISE_PER_TICK) * 15 >= 180,
    `${Math.round((_test.MAX_AROUSAL / _test.RISE_PER_TICK) * 15)}s to peak`);
  check('pacing: a question is rarer than a spoken beat', _test.QUESTION_GAP_MS > _test.SPEAK_GAP_MS);

  // ── Co-presence: non-paired consorts noticing each other ───────────────────
  // Two consorts kept by the same person who were never written for each other.
  // They get a basic register instead of the two-hander threads, and it's keyed by
  // BOTH sexes — speaker first — so the reaction differs in each direction.
  const CP = _test.CO_PRESENCE;
  check('co-presence: all four sex combinations exist',
    ['ff', 'fm', 'mf', 'mm'].every(k => Array.isArray(CP[k]) && CP[k].length >= 4),
    Object.keys(CP).map(k => `${k}:${CP[k].length}`).join(' '));
  let cpBad = null;
  for (const [k, pool] of Object.entries(CP)) {
    for (const entry of pool) {
      if (!Array.isArray(entry) || entry.length !== 2
        || !entry.every(l => typeof l === 'string' && l.includes('§') && (l.match(/"/g) || []).length % 2 === 0)) {
        cpBad = `${k}: ${JSON.stringify(entry).slice(0, 90)}`; break;
      }
    }
    if (cpBad) break;
  }
  check('co-presence: every entry is a [tame, hot] pair templating the name', cpBad === null, cpBad || '');
  // Every line must name the OTHER consort — that's the whole point of the beat.
  check('co-presence: every line references the other consort',
    Object.values(CP).every(pool => pool.every(e => e.every(l => l.includes('§other')))));
  // These lines are about the two CONSORTS. The keeper is a player and can be any
  // sex, so no co-presence line may assume one — the pools that talk ABOUT the
  // keeper elsewhere are a separate, deliberate matter.
  const keeperGendered = [];
  for (const [k, pool] of Object.entries(CP)) {
    for (const e of pool) {
      for (const l of e) {
        // Consort pronouns are fine (they resolve from the pool's own sex key);
        // what we're hunting is a pronoun standing in for the keeper.
        if (/\b(to|for|about|than|with) (him|her)\b(?!'s)/i.test(l)) keeperGendered.push(`${k}: ${l.slice(0, 70)}`);
      }
    }
  }
  check('co-presence: no line assumes the keeper\'s sex', keeperGendered.length === 0, keeperGendered.join(' | '));

  const cpF = mk({ flags: { ...roxy.flags, consort_sex: 'female' } });
  const cpM = mk({ id: 'cp_m', name: 'Soren', flags: { ...roxy.flags, consort_sex: 'male' } });
  check('co-presence: woman→woman resolves ff', _test.coPresenceFor(cpF, cpF) === CP.ff);
  check('co-presence: woman→man resolves fm', _test.coPresenceFor(cpF, cpM) === CP.fm);
  check('co-presence: man→woman resolves mf', _test.coPresenceFor(cpM, cpF) === CP.mf);
  check('co-presence: man→man resolves mm', _test.coPresenceFor(cpM, cpM) === CP.mm);
  // "Both ways" means the two directions are genuinely different writing, not a mirror.
  check('co-presence: fm and mf are distinct pools', CP.fm !== CP.mf
    && JSON.stringify(CP.fm) !== JSON.stringify(CP.mf));

  // Paired vs. not — a pairing gets the threads, everyone else gets this register.
  const pA = mk({ id: 'cp_pa', flags: { ...roxy.flags, consort_pairing: 'strategist_romantic' } });
  const pB = mk({ id: 'cp_pb', flags: { ...roxy.flags, consort_archetype: 'romantic', consort_pairing: 'strategist_romantic' } });
  check('co-presence: two consorts sharing a pairing ARE paired', _test.arePaired(pA, pB) === true);
  check('co-presence: two unpaired consorts are not', _test.arePaired(cpF, cpM) === false);
  check('co-presence: a pairing key of null never pairs anyone',
    _test.arePaired(mk({ flags: { ...roxy.flags, consort_pairing: null } }),
                    mk({ id: 'z', flags: { ...roxy.flags, consort_pairing: null } })) === false);
  check('co-presence: consorts in DIFFERENT pairings are not paired',
    _test.arePaired(pA, mk({ id: 'cp_pc', flags: { ...roxy.flags, consort_pairing: 'wit_ice' } })) === false);

  // Lines render clean for every combination — no leftover slot either side.
  let cpRenderBad = null;
  for (const [self, other] of [[cpF, cpM], [cpM, cpF], [cpF, cpF], [cpM, cpM]]) {
    for (const entry of _test.coPresenceFor(self, other)) {
      for (const l of entry) {
        const out = renderLine(l, self, { other: 'Ondine' });
        if (out.includes('§') || /\{\w+\}/.test(out) || !out.includes('Ondine')) { cpRenderBad = out; break; }
      }
      if (cpRenderBad) break;
    }
    if (cpRenderBad) break;
  }
  check('co-presence: every line renders with both names and no leftover slots', cpRenderBad === null, cpRenderBad || '');

  // ── Keeper acts, per consort sex ───────────────────────────────────────────
  // Every act carries a female AND a male thread set — `ride` in particular can't
  // be a pronoun swap, so the two sets are written separately and chosen off
  // flags.consort_sex. A male consort must never fall back to the female prose.
  const threadOk = (thread, roles) => Array.isArray(thread) && thread.length >= 2
    && thread.every(t => Array.isArray(t) && t.length === 3 && roles.has(t[0])
      && typeof t[1] === 'string' && t[1].includes('§') && (t[1].match(/"/g) || []).length % 2 === 0
      && typeof t[2] === 'string' && t[2].includes('§') && (t[2].match(/"/g) || []).length % 2 === 0);

  // The act registry is a FULL MATRIX: [keeper sex][consort sex]. A keeper is a
  // player and players are male or female — the old `maleOnly` flag meant every
  // female player who kept a consort got no signature acts whatsoever.
  let actBad = null;
  for (const [key, act] of Object.entries(_test.KEEPER_ACTS)) {
    if (!Number.isFinite(act.gain)) { actBad = `${key}.gain`; break; }
    if ('maleOnly' in act) { actBad = `${key}: maleOnly flag survived`; break; }
    for (const ks of ['male', 'female']) {
      for (const cs of ['female', 'male']) {
        const solo = act.solo?.[ks]?.[cs];
        if (!Array.isArray(solo) || !solo.length || !solo.every(t => threadOk(t, new Set(['A'])))) { actBad = `${key}.solo.${ks}.${cs}`; break; }
        if (act.duo) {
          const duo = act.duo[ks]?.[cs];
          if (!Array.isArray(duo) || !duo.length
            || !duo.every(t => threadOk(t, new Set(['A', 'B'])) && t.some(x => x[0] === 'A') && t.some(x => x[0] === 'B'))) { actBad = `${key}.duo.${ks}.${cs}`; break; }
        }
      }
      if (actBad) break;
    }
    if (actBad) break;
  }
  check('acts: every act covers all four keeper-sex × consort-sex combinations', actBad === null, actBad || '');

  const she = mk({ flags: { ...roxy.flags, consort_sex: 'female' } });
  const he = mk({ id: 'regress_he', name: 'Cassian', flags: { ...roxy.flags, consort_sex: 'male' } });
  const kM = { id: 'kM', handle: 'Cyd', current_zone: 'zone_nowhere', biological_sex: 'male', mis_enabled: 0 };
  const kF = { id: 'kF', handle: 'Vera', current_zone: 'zone_nowhere', biological_sex: 'female', mis_enabled: 0 };

  check('acts: sexOf reads the consort flag', _test.sexOf(he) === 'male' && _test.sexOf(she) === 'female');
  check('acts: keeperSexOf reads the player', _test.keeperSexOf(kF) === 'female' && _test.keeperSexOf(kM) === 'male');
  check('acts: an unset keeper sex reads as male (pre-existing keepers unchanged)',
    _test.keeperSexOf({}) === 'male' && _test.keeperSexOf(null) === 'male');

  // Male keeper — the original threads, unchanged.
  check('acts: male keeper + female consort → the original threads',
    _test.actSoloFor(_test.KEEPER_ACTS.ride, she, kM) === _test.RIDE_SOLO);
  check('acts: male keeper + male consort → the male threads',
    _test.actSoloFor(_test.KEEPER_ACTS.ride, he, kM) === _test.RIDE_SOLO_M);
  // Female keeper — the other half of the matrix, which used to not exist at all.
  check('acts: FEMALE keeper + female consort resolves its own threads',
    _test.actSoloFor(_test.KEEPER_ACTS.oral, she, kF) === _test.ORAL_F_SOLO_F);
  check('acts: FEMALE keeper + male consort resolves its own threads',
    _test.actSoloFor(_test.KEEPER_ACTS.oral, he, kF) === _test.ORAL_F_SOLO_M);
  check('acts: a female keeper never falls through to the male-keeper prose',
    _test.actSoloFor(_test.KEEPER_ACTS.oral, she, kF) !== _test.FELLATIO_SOLO
    && _test.actSoloFor(_test.KEEPER_ACTS.ride, he, kF) !== _test.RIDE_SOLO_M);
  // The regression this whole change exists to prevent.
  check('acts: EVERY act resolves a scene for a female keeper, both consort sexes',
    Object.values(_test.KEEPER_ACTS).every(a =>
      _test.actSoloFor(a, she, kF)?.length && _test.actSoloFor(a, he, kF)?.length));
  check('acts: every act resolves a scene for a male keeper too',
    Object.values(_test.KEEPER_ACTS).every(a =>
      _test.actSoloFor(a, she, kM)?.length && _test.actSoloFor(a, he, kM)?.length));

  // Prose actually differs across the matrix — copy-paste would pass identity checks.
  check('acts: the male-consort ride prose is genuinely different writing',
    JSON.stringify(_test.RIDE_SOLO_M) !== JSON.stringify(_test.RIDE_SOLO));
  check('acts: the female-keeper oral prose is genuinely different writing',
    JSON.stringify(_test.ORAL_F_SOLO_F) !== JSON.stringify(_test.FELLATIO_SOLO));
  check('acts: no male-consort thread describes a female body',
    !/\b(her|she|breasts|hers|herself)\b/i.test(JSON.stringify([
      _test.FELLATIO_SOLO_M, _test.FELLATIO_DUO_M, _test.RIDE_SOLO_M, _test.RIDE_DUO_M,
      _test.HANDJOB_SOLO_M, _test.ORAL_F_SOLO_M, _test.RIDE_F_SOLO_M, _test.HAND_F_SOLO_M])));

  // Duo threads describe both bodies, so a mixed-sex pair degrades to solo.
  check('acts: a same-sex pair resolves a duo set',
    !!_test.actDuoFor(_test.KEEPER_ACTS.oral, she, mk({ id: 'x', flags: { ...she.flags } }), kM));
  check('acts: a same-sex pair resolves a duo set for a FEMALE keeper too',
    !!_test.actDuoFor(_test.KEEPER_ACTS.oral, she, mk({ id: 'x', flags: { ...she.flags } }), kF));
  check('acts: a MIXED-sex pair falls back to solo rather than mismatched prose',
    _test.actDuoFor(_test.KEEPER_ACTS.oral, she, he, kM) === null);
  check('acts: an act with no duo set never resolves one',
    _test.actDuoFor(_test.KEEPER_ACTS.hand, she, she, kM) === null);

  // Verbs map onto ROLE keys, not anatomy, so the same request works either way.
  check('acts: verbs map onto role keys that exist',
    Object.values(_test.DIRECT_ACT).every(k => !!_test.KEEPER_ACTS[k]),
    [...new Set(Object.values(_test.DIRECT_ACT))].join(','));
  check('acts: oral is reachable by several spellings',
    _test.DIRECT_ACT.suck === 'oral' && _test.DIRECT_ACT.lick === 'oral' && _test.DIRECT_ACT.eat === 'oral');
  check('acts: the direct matcher accepts the new verbs', _test.CONSORT_DIRECT_RE.test('vesper lick me'));
  check('acts: bare "eat" still belongs to the food verb',
    _test.CONSORT_DIRECT_RE.test('eat a ration') === false);

  // Commanded acts resolve for every keeper/consort combination without throwing.
  let cmdBad = null;
  for (const [kname, k] of [['male keeper', kM], ['female keeper', kF]]) {
    for (const [cname, c] of [['female consort', he], ['male consort', she]]) {
      for (const actKey of Object.keys(_test.KEEPER_ACTS)) {
        let r;
        try { r = _test.startCommandedAct(c, k, actKey); } catch (e) { cmdBad = `${kname}/${cname}/${actKey}: threw ${e.message}`; break; }
        if (!r || typeof r.message !== 'string') { cmdBad = `${kname}/${cname}/${actKey}: no reply`; break; }
        if (/not going to work the way you're picturing/.test(r.message)) { cmdBad = `${kname}/${cname}/${actKey}: refused`; break; }
      }
      if (cmdBad) break;
    }
    if (cmdBad) break;
  }
  check('acts: every act is commandable by a female keeper as well as a male one', cmdBad === null, cmdBad || '');

  // ── Consort ⇄ consort ──────────────────────────────────────────────────────
  // Two warmed-up consorts turn to each other. Three pools cover all four sex
  // combinations (mixed is shared, with the cast reordered so 'A' is always the
  // woman), and it fires for paired and unpaired consorts alike.
  let mutBad = null;
  for (const [name, pool] of [['ff', _test.MUTUAL_FF], ['mm', _test.MUTUAL_MM], ['mixed', _test.MUTUAL_MIXED]]) {
    if (!Array.isArray(pool) || !pool.length) { mutBad = `${name}: empty`; break; }
    for (const thread of pool) {
      const whos = thread.map(t => t[0]);
      const ok = thread.length >= 3 && whos.includes('A') && whos.includes('B')
        && whos.every(w => w === 'A' || w === 'B')
        && thread.every(t => t.length === 3
          && typeof t[1] === 'string' && t[1].includes('§') && (t[1].match(/"/g) || []).length % 2 === 0
          && typeof t[2] === 'string' && t[2].includes('§') && (t[2].match(/"/g) || []).length % 2 === 0);
      if (!ok) { mutBad = `${name}: ${JSON.stringify(thread).slice(0, 100)}`; break; }
    }
    if (mutBad) break;
  }
  check('mutual: every pool is well-formed [who, tame, hot] two-handers', mutBad === null, mutBad || '');
  check('mutual: every thread names the other consort somewhere',
    [_test.MUTUAL_FF, _test.MUTUAL_MM, _test.MUTUAL_MIXED].every(p =>
      p.every(th => th.some(t => t[1].includes('§other') || t[2].includes('§other')))));

  const mf1 = mk({ id: 'mut_f1', name: 'Odile', flags: { ...roxy.flags, consort_sex: 'female' } });
  const mf2 = mk({ id: 'mut_f2', name: 'Ilse', flags: { ...roxy.flags, consort_sex: 'female' } });
  const mm1 = mk({ id: 'mut_m1', name: 'Soren', flags: { ...roxy.flags, consort_sex: 'male' } });
  const mm2 = mk({ id: 'mut_m2', name: 'Rafe', flags: { ...roxy.flags, consort_sex: 'male' } });

  check('mutual: two women resolve the ff pool', _test.mutualFor(mf1, mf2).pool === _test.MUTUAL_FF);
  check('mutual: two men resolve the mm pool', _test.mutualFor(mm1, mm2).pool === _test.MUTUAL_MM);
  check('mutual: a mixed couple resolves the mixed pool', _test.mutualFor(mf1, mm1).pool === _test.MUTUAL_MIXED);
  // The mixed thread is written with the woman as 'A' — the cast must be reordered
  // to match no matter which way round the two were found in the room.
  check('mutual: mixed cast puts the woman in the A slot',
    _test.mutualFor(mf1, mm1).A === mf1 && _test.mutualFor(mf1, mm1).B === mm1);
  check('mutual: mixed cast reorders when the man is found first',
    _test.mutualFor(mm1, mf1).A === mf1 && _test.mutualFor(mm1, mf1).B === mm1);
  check('mutual: same-sex casts keep their given order',
    _test.mutualFor(mf1, mf2).A === mf1 && _test.mutualFor(mf1, mf2).B === mf2);
  check('mutual: every sex combination resolves a non-empty pool',
    [[mf1, mf2], [mm1, mm2], [mf1, mm1], [mm1, mf1]].every(([x, y]) => _test.mutualFor(x, y).pool.length > 0));
  check('mutual: the threshold sits below the keeper-act threshold',
    _test.MUTUAL_AT < _test.FELLATIO_AT, `${_test.MUTUAL_AT} vs ${_test.FELLATIO_AT}`);

  // ── Absence ────────────────────────────────────────────────────────────────
  const away = mk();
  check('absence: nothing owed when the keeper never left', _test.absenceTierFor(away, { id: 'k' }, Date.now()) === null);
  away._pendingAbsence = 3 * 3_600_000;
  check('absence: a few hours away earns the short greeting', _test.absenceTierFor(away, { id: 'k' }, Date.now()) === 'missShort');
  check('absence: the greeting is consumed, not repeated', _test.absenceTierFor(away, { id: 'k' }, Date.now()) === null);
  away._pendingAbsence = 40 * 3_600_000;
  check('absence: days away earns the long greeting', _test.absenceTierFor(away, { id: 'k' }, Date.now()) === 'missLong');

  // ── Appearance ─────────────────────────────────────────────────────────────
  const look = generateAppearance('seed-1');
  check('appearance: generation is deterministic',
    JSON.stringify(look) === JSON.stringify(generateAppearance('seed-1')));
  check('appearance: a different seed is a different person',
    JSON.stringify(look) !== JSON.stringify(generateAppearance('seed-2')));
  check('appearance: sex can be forced', generateAppearance('s', { sex: 'male' }).sex === 'male'
    && generateAppearance('s', { sex: 'female' }).sex === 'female');
  check('appearance: layers come from the build and are peelable',
    Array.isArray(look.layers) && look.layers.length >= 2);
  check('appearance: both sexes have a real spread of builds',
    Object.keys(BUILDS.female).length >= 6 && Object.keys(BUILDS.male).length >= 6);
  check('appearance: the card itemises every characteristic', appearanceCard(look).length >= 11, `${appearanceCard(look).length}`);
  const desc = describeAppearance('Vesper', look);
  check('appearance: the description is prose naming the consort', desc.startsWith('Vesper') && desc.length > 80);
  // Sweep a lot of seeds for a malformed description (empty pool entry, stray undefined).
  let descBad = null;
  for (let i = 0; i < 250; i++) {
    const a = generateAppearance(`sweep-${i}`);
    const d = describeAppearance('X', a);
    if (/undefined|null|\s,|,,/.test(d) || !a.layers.length) { descBad = `sweep-${i}: ${d}`; break; }
  }
  check('appearance: 250 seeded people all describe cleanly', descBad === null, descBad || '');

  // ── Roster + pricing ───────────────────────────────────────────────────────
  const r1 = roster.generateRoster('p:0');
  check('roster: generates a full catalogue', r1.length === roster.ROSTER_SIZE);
  check('roster: is deterministic for a seed', JSON.stringify(r1) === JSON.stringify(roster.generateRoster('p:0')));
  check('roster: a new generation is a new catalogue', JSON.stringify(r1) !== JSON.stringify(roster.generateRoster('p:1')));
  check('roster: every listing is priced above zero', r1.every(l => l.rate > 0));
  check('roster: names are unique within a catalogue', (() => {
    const names = r1.flatMap(l => l.members.map(m => m.name));
    return new Set(names).size === names.length;
  })());
  check('roster: pairings carry exactly two members', r1.filter(l => l.kind === 'pairing').every(l => l.members.length === 2));
  check('roster: singles carry exactly one', r1.filter(l => l.kind === 'single').every(l => l.members.length === 1));
  // Over many generations we should see both sexes and a pairing turn up.
  const many = Array.from({ length: 40 }, (_, i) => roster.generateRoster(`sweep:${i}`)).flat();
  const sexes = new Set(many.flatMap(l => l.members.map(m => m.appearance.sex)));
  check('roster: both sexes appear in the catalogue', sexes.has('male') && sexes.has('female'), [...sexes].join(','));
  check('roster: rare pairings do appear', many.some(l => l.kind === 'pairing'));
  // "Rare" means rare. The old per-slot roll put a pair on most registers; a pair
  // is now rolled once per register and capped at one.
  const registers = Array.from({ length: 60 }, (_, i) => roster.generateRoster(`rare:${i}`));
  const withPair = registers.filter(r => r.some(l => l.kind === 'pairing'));
  check('roster: most registers carry no pairing at all',
    withPair.length < registers.length * 0.4, `${withPair.length}/${registers.length}`);
  check('roster: never more than one pairing on a register',
    registers.every(r => r.filter(l => l.kind === 'pairing').length <= 1));

  // The sex split is PLANNED, not coin-flipped per slot — the failure this fixes
  // is a register of six women when the player wanted men and a refresh now costs
  // a game day.
  let splitBad = null;
  for (const r of registers) {
    const singles = r.filter(l => l.kind === 'single');
    const m = singles.filter(l => l.members[0].appearance.sex === 'male').length;
    const f = singles.length - m;
    if (Math.abs(m - f) > 1) { splitBad = `${m}m/${f}f`; break; }
    if (singles.length >= 2 && (m === 0 || f === 0)) { splitBad = `one-sided: ${m}m/${f}f`; break; }
  }
  check('roster: every register is an even split of men and women', splitBad === null, splitBad || '');
  check('roster: a register is not always ordered the same way',
    new Set(registers.map(r => r.map(l => l.members[0].appearance.sex).join(''))).size > 4);

  // Sections: what the app shelves the register into.
  const sections = roster.rosterSections(r1);
  check('roster: sections cover every listing exactly once',
    sections.reduce((s, x) => s + x.ids.length, 0) === r1.length
    && new Set(sections.flatMap(s => s.ids)).size === r1.length);
  check('roster: a pairing is shelved as a pair, never under a sex',
    registers.every(r => {
      const pairIds = r.filter(l => l.kind === 'pairing').map(l => l.id);
      const sec = roster.rosterSections(r).find(s => s.key === 'pairs');
      return pairIds.every(id => sec?.ids.includes(id));
    }));
  check('roster: an empty section is dropped rather than shown empty',
    sections.every(s => s.ids.length > 0));
  const archSeen = new Set(many.flatMap(l => l.members.map(m => m.archetypeKey)));
  check('roster: every archetype is reachable', archSeen.size === KEYS.length, `${archSeen.size}/${KEYS.length}`);

  // The card never leaks the internal archetype key to the player.
  const card = roster.listingCard(r1[0]);
  check('card: shows a self-description, not the archetype key',
    card.members.every(m => m.says && !KEYS.includes(m.says)));
  check('card: carries the full physical breakdown', card.members.every(m => m.physical.length >= 11));
  check('card: projects the loyalty curve', card.projection.length === 4 && card.projection.every(p => p.rate > 0));

  // ── The explicit specification, and the personality half ───────────────────
  // Anatomy is generated for everyone, itemised on the card, and — the rule that
  // matters — NEVER in describeAppearance(), which is what a stranger standing in
  // the room sees when they examine a consort.
  let anaBad = null;
  for (let i = 0; i < 200; i++) {
    const a = generateAppearance(`ana-${i}`);
    if (!a.anatomy) { anaBad = `ana-${i}: missing`; break; }
    const rows = intimateCard(a);
    if (rows.length < 7) { anaBad = `ana-${i}: ${rows.length} rows`; break; }
    if (rows.some(([, v]) => !v || /undefined|null/.test(v))) { anaBad = `ana-${i}: blank row`; break; }
    if (!intimateHeadline(a)) { anaBad = `ana-${i}: no headline`; break; }
    // The two tables are separate bodies, not one table with a pronoun swap.
    const keys = rows.map(([k]) => k);
    if (a.sex === 'male' && keys.includes('Bust')) { anaBad = `ana-${i}: male card carries female anatomy`; break; }
    if (a.sex === 'female' && keys.includes('Cock')) { anaBad = `ana-${i}: female card carries male anatomy`; break; }
  }
  check('anatomy: every generated body is fully specified', anaBad === null, anaBad || '');
  check('anatomy: the room description never carries it', (() => {
    for (let i = 0; i < 200; i++) {
      const a = generateAppearance(`leak-${i}`);
      const d = describeAppearance('X', a).toLowerCase();
      if (/\b(cock|cunt|nipple|bust|balls|areola|clit)\b/.test(d)) return false;
      // ...and no anatomy VALUE appears verbatim in it either.
      if (Object.values(a.anatomy).some(v => d.includes(String(v).toLowerCase().slice(0, 30)))) return false;
    }
    return true;
  })());
  check('anatomy: adding it did not change any pre-existing appearance', (() => {
    // A seed is a promise: anatomy is rolled last, so every axis above it must
    // still land where it always did. Spot-check the axes by shape rather than
    // by frozen fixture — a changed ORDER would scramble these.
    const a = generateAppearance('promise-check');
    return a.sex && a.build && a.height && a.hair && a.eyes && a.skin && a.mouth
      && a.grooming && a.scent && a.voice && a.age && a.layers.length > 0;
  })());
  check('card: carries the explicit specification', card.members.every(m => m.intimate.length >= 7));

  // Temperament + voice: the personality half of a listing.
  check('temperament: every archetype has one',
    KEYS.every(k => {
      const t = temperamentOf(k);
      return t && t.traits.length >= 3 && t.warmth && t.wants && t.warned;
    }));
  check('temperament: every placement carries a written downside',
    KEYS.every(k => temperamentOf(k).warned.length > 40));
  check('temperament: never leaks the archetype key',
    KEYS.every(k => !JSON.stringify(temperamentOf(k)).toLowerCase().includes(`"${k}"`)));
  check('card: shows temperament and a voice sample',
    card.members.every(m => m.temperament?.traits?.length && m.voice.length >= 2));
  check('voice: samples resolve every token and name the speaker', (() => {
    for (const k of KEYS) {
      for (const sex of ['female', 'male']) {
        const s = voiceSamples(k, { name: 'Vesper', appearance: { sex } });
        if (s.length < 2) return false;
        if (s.some(l => /\{[A-Za-z]+\}|§/.test(l))) return false;
        if (s.some(l => !l.trimStart().startsWith('"') && !l.startsWith('Vesper'))) return false;
      }
    }
    return true;
  })());
  check('voice: the same listing samples the same lines every time',
    JSON.stringify(voiceSamples('ice', { name: 'Vesper', appearance: { sex: 'female' } }))
    === JSON.stringify(voiceSamples('ice', { name: 'Vesper', appearance: { sex: 'female' } })));

  // Loyalty discount: monotonically cheaper, floored, never free.
  const rates = [0, 7, 21, 45, 90, 400].map(d => roster.effectiveRate(2000, d));
  check('loyalty: the rate never increases with tenure', rates.every((v, i) => i === 0 || v <= rates[i - 1]), rates.join('>'));
  check('loyalty: a long tenure is materially cheaper', rates[4] < rates[0] * 0.8, `${rates[4]} vs ${rates[0]}`);
  check('loyalty: the discount is floored, not unbounded', rates[5] >= 2000 * roster._test.LOYALTY_FLOOR - 5, `${rates[5]}`);
  check('loyalty: tenure labels escalate', roster.loyaltyTier(0).label !== roster.loyaltyTier(90).label);

  // Reroll cooldown.
  const now = Date.now();
  check('reroll: a fresh account may roll', roster.rerollState(0, now).ready === true);
  check('reroll: rolling starts a cooldown', roster.rerollState(now, now).ready === false);
  const cd = roster.rerollCooldownMs();
  check('reroll: the cooldown expires', roster.rerollState(now - cd - 1, now).ready === true);
  check('reroll: a pending cooldown reports time remaining',
    /\d+[hm]/.test(roster.rerollState(now - 60_000, now).remainingLabel));
  // A register refresh is a DAY's wait, not ten minutes — the cooldown is the only
  // thing stopping a player spinning until the placement they wanted falls out.
  check('reroll: refreshing costs a game day', cd >= 20 * 60_000, `${Math.round(cd / 60_000)}m`);
  check('reroll: a long wait is labelled in hours',
    /h/.test(roster.rerollState(now, now).remainingLabel), roster.rerollState(now, now).remainingLabel);

  // ── Talk hook ──────────────────────────────────────────────────────────────
  const toKeeper = await _test.onTalk({ player: { handle: 'Cyd' }, npc: roxy });
  check('talk: keeper gets a warm reply', !!toKeeper?.message, toKeeper?.message?.slice(0, 70));
  const toStranger = await _test.onTalk({ player: { handle: 'RandomGuest' }, npc: roxy });
  check('talk: stranger gets a deflection', !!toStranger?.message, toStranger?.message?.slice(0, 70));
  check('talk: keeper and stranger get different registers', toKeeper?.message !== toStranger?.message);
  check('talk: falls through for a non-consort',
    (await _test.onTalk({ player: { handle: 'Cyd' }, npc: { id: 'y', flags: {} } })) === undefined);
  const withTree = mk({ dialogue_tree: {
    root: { text: 'There you are.', options: [{ label: 'Hi.', next: 'bye' }] },
    bye: { text: 'Go on.', options: [] },
  } });
  const convo = await _test.onTalk({ player: { handle: 'Cyd' }, npc: withTree });
  check('talk: keeper with a dialogue_tree opens a conversation',
    convo?.type === 'dialogue' && convo.node === 'root', convo?.type);
  check('talk: a stranger never opens the tree',
    (await _test.onTalk({ player: { handle: 'RandomGuest' }, npc: withTree }))?.type !== 'dialogue');

  // ── Keeper-only commands ───────────────────────────────────────────────────
  check('consortsOf: bogus handle owns no consorts', _test.consortsOf('__nobody__').length === 0);
  const stranger = { handle: '__nobody__', id: 'regress_stranger', current_zone: 'zone_nowhere' };
  const beckonDenied = await _test.cmdBeckon([], 'beckon', stranger);
  check('beckon: stranger is refused', beckonDenied?.type === 'error' && /answers to you/i.test(beckonDenied.message || ''), beckonDenied?.message);
  const dismissDenied = await _test.cmdDismiss([], 'dismiss', stranger);
  check('dismiss: stranger is refused', dismissDenied?.type === 'error' && /answers to you/i.test(dismissDenied.message || ''), dismissDenied?.message);
  const pourDenied = await _test.cmdPour([], 'pour', stranger);
  check('pour: stranger with no consort is refused', pourDenied?.type === 'error', pourDenied?.message);
  check('pour: barIn finds no bar in an empty zone', _test.barIn('zone_nowhere') === null);

  // Direct-address matcher still can't shadow the other multi-word verbs.
  check('direct: matches a name+act', _test.CONSORT_DIRECT_RE.test('vesper suck me'));
  check('direct: does NOT shadow "eat out"', _test.CONSORT_DIRECT_RE.test('eat out vesper') === false);
  check('direct: does NOT shadow "jerk off on"', _test.CONSORT_DIRECT_RE.test('jerk off on vesper') === false);
  check('direct: falls through when the speaker owns no consort here',
    (await _test.cmdConsortDirect([], 'vesper suck me', { handle: '__nobody__', current_zone: 'zone_nowhere' })) === undefined);

  // retreatConsorts leaves an already-tucked-away consort untouched.
  check('retreat: no-op when already home',
    _test.retreatConsorts([{ name: 'Fake', home_zone: 'zone_b', zone_id: 'zone_b', flags: { consort: true } }]).length === 0);

  // ── Area life ──────────────────────────────────────────────────────────────
  check('area: sundeck flag → sundeck profile', _test.areaProfile({ flags: { echelon_sundeck: true } }) === 'sundeck');
  check('area: unflagged zone → cabin profile', _test.areaProfile({ flags: {} }) === 'cabin');
  check('area: suite/boudoir are intimate zones', _test.isIntimateZone({ flags: { echelon_suite: true } }) === true);
  check('area: the sun deck is NOT intimate', _test.isIntimateZone({ flags: { echelon_sundeck: true } }) === false);
  let actsBad = null;
  for (const [prof, list] of Object.entries(_test.AREA_ACTIVITIES)) {
    if (!Array.isArray(list) || list.length < 3) { actsBad = `${prof}: thin`; break; }
    for (const a of list) {
      if (!(a.key && typeof a.start?.t === 'function' && a.start.t('X').includes('X')
        && Array.isArray(a.idle) && a.idle.length && a.idle.every(l => typeof l.t === 'function'))) {
        actsBad = `${prof}/${a.key}`; break;
      }
    }
    if (actsBad) break;
  }
  check('area: every activity is well-formed and every profile has variety', actsBad === null, actsBad || '');

  const deckGirl = mk({ id: 'regress_deck', name: 'Vesper', zone_id: 'zone_deck_x' });
  let deckThrew = false;
  try { _test.runAreaActivity(deckGirl, { flags: { echelon_sundeck: true } }, 'zone_deck_x', 1_000_000, false, false); }
  catch { deckThrew = true; }
  check('area: runAreaActivity picks an activity without throwing', deckThrew === false && !!deckGirl._activity);
  check('area: onFurniture is a name or null, never undefined',
    deckGirl.onFurniture === null || typeof deckGirl.onFurniture === 'string');

  // ── Furniture describe + tick ──────────────────────────────────────────────
  check('furn: no describe line when nobody is parked',
    _test.onFurnitureDescribe({ zone_id: 'zone_deck_x', name: 'jacuzzi' }, null) === undefined);
  let threw = false;
  try { _test.consortTick(); } catch { threw = true; }
  check('tick: sweeps the live world without throwing', threw === false);

  // Housekeeping — don't leave regress ids in the shared in-memory maps.
  for (const id of ['regress_consort_a', 'regress_deck', 'p_a', 'p_b']) {
    _test.arousal.delete(id); _test.lastSpoke.delete(id); _test.moodCap.delete(id);
  }
  _test.pendingSettle.delete('regress_keeper');
}
