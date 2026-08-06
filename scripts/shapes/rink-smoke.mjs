// Rink smoke — runs the CPhL sub-screen headlessly and fails if it throws.
//
// The rink view is the only part of the hockey pipeline with no server to test it: the
// one thing that ever exercised it was a player having a hockey broadcast on screen at
// the moment a beat landed. This drives `apply()` through every beat type the sim can
// emit, spins the rAF loop for a few hundred frames, and asserts that ten men, a puck
// and two goalies actually ended up somewhere on the sheet.
//
// It proves the view RUNS and that its motion converges — not that it looks right.
// There is no pixel comparison here and there is not meant to be one.
//
// Run:  node scripts/shapes/rink-smoke.mjs

import { __install } from './rink-dom-stub.mjs';

// The DOM has to exist before the module under test is even parsed, so the import is
// deliberately dynamic and deliberately after `__install()`.
const stub = __install();
const { createRinkView, __test } = await import('../../client/game/js/panels/gameday-rink.js');
const { GEO, DOTS, SAVE } = __test;

let failures = 0;
const check = (label, ok, detail) => {
  if (ok) { console.log(`  ok   ${label}`); return; }
  failures++;
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`);
};

// ── a beat, shaped exactly like plugins/broadcast/sports/hockey-narrator.js builds one
function beat(kind, over) {
  const shot = kind === 'goal' || SAVE[kind];
  return {
    sport: 'hockey', type: kind === 'goal' ? 'goal' : 'chance', kind,
    shooter: 'Asbestos McQuaid', goalie: 'Renna Voss', assist: 'Ibarra',
    attackingTeam: 'Slaglands Slashers', defendingTeam: 'Wastes Drifters',
    attackingAbbr: 'SS', defendingAbbr: 'WD',
    awayTeam: 'Slaglands Slashers', homeTeam: 'Wastes Drifters', awayAbbr: 'SS', homeAbbr: 'WD',
    awayColours: ['#c8a13a', '#2a1d05'], homeColours: ['#7fb2dd', '#10283f'],
    attackingColours: ['#c8a13a', '#2a1d05'], defendingColours: ['#7fb2dd', '#10283f'],
    section: '2nd', clock: '12:41', clockSecs: 761, strength: 'even',
    awayScore: 3, homeScore: 3, desc: 'a chance', hornSeed: 7, rivalry: false,
    possession: shot ? [
      { t: 0, p: [0.30, 0.50], ev: 'carry', carrier: 3 },
      { t: 1, p: [0.52, 0.24], ev: 'pass', carrier: 1 },
      { t: 2, p: [0.74, 0.38], ev: 'entry', carrier: 1 },
      { t: 3, p: [0.955, 0.46], ev: 'shot', carrier: 0 },
    ] : null,
    ...over,
  };
}

const host = stub.makeHost();
const view = createRinkView(host);

// ── every beat type the sim emits ───────────────────────────────────────────────
const KINDS = [...Object.keys(SAVE)];
for (const kind of KINDS) {
  try {
    view.apply(beat(kind));
    stub.runFrames(240);          // ~4s of play at 60fps
    stub.runTimers(6000);
  } catch (e) {
    check(`beat "${kind}" plays without throwing`, false, e && e.stack ? e.stack.split('\n')[0] : String(e));
    continue;
  }
  check(`beat "${kind}" plays without throwing`, true);
}

// ── the non-shot beats ──────────────────────────────────────────────────────────
for (const dot of Object.keys(DOTS)) {
  try {
    view.apply(beat('save', { type: 'faceoff', kind: 'faceoff', possession: null, dot, winnerSide: 'att', winner: 'Duguay', loser: 'Ibarra' }));
    stub.runFrames(120); stub.runTimers(4000);
    check(`faceoff at "${dot}" plays`, true);
  } catch (e) { check(`faceoff at "${dot}" plays`, false, String(e && e.message)); }
}
try {
  view.apply(beat('save', { type: 'fight', kind: 'fight', possession: null, winnerSide: 'att', winner: 'Duguay', loser: 'Ibarra',
    exchange: [{ thrower: 'Duguay', landed: true }, { thrower: 'Ibarra', landed: false }, { thrower: 'Duguay', landed: true }] }));
  stub.runFrames(180); stub.runTimers(5000);
  check('a fight plays', true);
} catch (e) { check('a fight plays', false, String(e && e.message)); }

// ── the violence ────────────────────────────────────────────────────────────────
// These four used to reach the rink as nothing at all: the announcer described a man
// going through the glass and the ice held its last frame. Each has to actually put a
// body somewhere now, so each is checked for its own visible consequence and not just
// for failing to throw.
const VIOLENT = [
  // The payloads carry the SIM'S OWN FIELD NAMES, deliberately. The view used to read a
  // `victimSide` tag that hockey.js has never emitted, so every violent beat in the
  // league fell through to the same fallback sweaters; a fixture that invents the
  // missing field is a fixture that could never have caught that.
  { type: 'boards', over: { hitter: 'Duguay', victim: 'McQuaid', hitterTeam: 'Slaglands Slashers', victimTeam: 'Wastes Drifters' }, cls: 'down', at: 700 },
  { type: 'injury', over: { player: 'McQuaid', teamName: 'Wastes Drifters', slotsOut: 3 }, cls: 'leaving', at: 2000 },
  { type: 'death',  over: { player: 'McQuaid', teamName: 'Wastes Drifters', winnerTeam: 'Slaglands Slashers' }, cls: 'dead', at: 900 },
  { type: 'scrum',  over: {}, cls: 'shoving', at: 700 },
];
for (const v of VIOLENT) {
  try {
    view.apply(beat('save', { type: v.type, kind: v.type, possession: null, ...v.over }));
    stub.runFrames(Math.round(v.at / 16.7));
    const hit = host.findAll('.gdr-skater').filter(s => s.classList.contains(v.cls));
    check(`a ${v.type} puts a body on the ice`, hit.length > 0, `no .${v.cls} skater`);
    // …and puts it where the CAMERA is. A beat with no possession chain never went
    // through the possession cut, so its men used to stay at their seed positions
    // while the camera sat on the puck elsewhere — a man killed off-screen.
    // The Y translate, not the `3` in `translate3d` — which a looser pattern grabs, and
    // which reads as a camera parked at the top of the sheet no matter where it is.
    const camOff = Math.abs(parseFloat((host.find('.gdr-cam').style.transform.match(/translate3d\([^,]*,\s*(-?[\d.]+)px/) || [0, 0])[1]));
    const camH = host.find('.gdr-cam').offsetHeight, vh = host.find('.gdr-rink').clientHeight;
    const inFrame = host.findAll('.gdr-skater').filter(s => {
      const y = (parseFloat(s.style.top) / 100) * camH;
      return y >= camOff - vh * 0.2 && y <= camOff + vh * 1.2;
    });
    check(`…and a ${v.type} happens on camera`, inFrame.length >= 6, `${inFrame.length}/10 men in frame`);
    stub.runFrames(240); stub.runTimers(9000);
  } catch (e) {
    check(`a ${v.type} puts a body on the ice`, false, e && e.stack ? e.stack.split('\n')[0] : String(e));
  }
}
// A death stops the rink, and the stopping is the point — if the sheet isn't marked
// as mourning, the picture kept playing hockey over a corpse.
view.apply(beat('save', { type: 'death', kind: 'death', possession: null, player: 'McQuaid', teamName: 'Wastes Drifters', winnerTeam: 'Slaglands Slashers' }));
stub.runFrames(90);
check('a death stops the rink', host.find('.gdr-rink').classList.contains('mourning'));
// Two pools: where he fell, and where the part that came off him landed.
check('…and leaves a mark on the ice', host.findAll('.gdr-blood').length === 2, `${host.findAll('.gdr-blood').length} pools`);
// A death takes a piece of him. Both halves have to happen — the part hidden ON the man
// and the same part thrown as its own token — because one without the other is either
// an invisible limb or a man who somehow kept it.
{
  const dead = host.findAll('.gdr-skater').find(s => s.classList.contains('dead'));
  const sev = dead && String(dead.attrs.get('class') || '').match(/sev-(\w+)/);
  check('a death takes a limb off him', !!sev, 'nothing severed');
  const gore = host.findAll('.gdr-gore');
  check('…and the limb is on the ice', gore.length === 1, `${gore.length} parts`);
  check('…and it was drawn, not left empty', gore.length === 1 && !!gore[0].innerHTML);
  // IT IS A BODY, NOT AN ANIMATION. The part goes into the same integrator the puck is
  // in, so it must travel and it must spin — and both have to be written by the loop
  // rather than by a keyframe, which is exactly what stepping frames and re-reading the
  // style proves. A CSS throw would look identical on screen and fail right here.
  const p0 = `${gore[0].style.left}|${gore[0].style.top}`;
  const r0 = gore[0].style.rotate;
  stub.runFrames(30);
  check('the limb slides on the ice', `${gore[0].style.left}|${gore[0].style.top}` !== p0, p0);
  check('…and it spins as it goes', gore[0].style.rotate !== r0 && !!gore[0].style.rotate);
  // And it stops. Ice takes it off a limb far faster than off a puck; if it were still
  // travelling four seconds later it would slide the length of the rink and out.
  stub.runFrames(240);
  const p1 = `${gore[0].style.left}|${gore[0].style.top}`;
  stub.runFrames(30);
  check('…and comes to rest', `${gore[0].style.left}|${gore[0].style.top}` === p1, p1);
}
// The man who died must not be wandering. Two frames apart, he has not moved.
{
  const dead = host.findAll('.gdr-skater').find(s => s.classList.contains('dead'));
  const p0 = dead && `${dead.style.left}|${dead.style.top}`;
  stub.runFrames(200);
  const p1 = dead && `${dead.style.left}|${dead.style.top}`;
  check('the dead man stays where he fell', !!dead && p0 === p1, `${p0} → ${p1}`);
}

try {
  view.apply({ sport: 'hockey', type: 'intermission', section: '1st', awayAbbr: 'SS', homeAbbr: 'WD', awayScore: 3, homeScore: 3,
    goals: [{ clockStr: '9:38', shooter: 'Duguay', assist: 'Ibarra', teamName: 'Slaglands Slashers', strength: 'even' }],
    shotsAway: 14, shotsHome: 9, penalties: 1, fights: 0, hits: 3, nextOrd: '2nd',
    standings: [{ team: 'Slaglands Slashers', points: 8 }, { team: 'Wastes Drifters', points: 6 }] });
  stub.runTimers(3000);
  check('the intermission board renders', true);
} catch (e) { check('the intermission board renders', false, String(e && e.message)); }

// ── the building goes off ───────────────────────────────────────────────────────
// A goal is the loudest thing the sim produces and used to be one of the quietest
// things in the picture. Three things have to fire, and the flashes have to be in the
// STANDS — a camera flash on the ice reads as lightning, not as a crowd.
view.apply(beat('goal'));
// Long enough for the whole chain — carry, pass, wind-up, shot, across the line, into
// the mesh — and short enough to still be INSIDE the celebration, which lasts 1.5s.
// Frames, not a timer jump: the punch is fired by the puck arriving at the back of the
// net, so the puck has to actually get there.
stub.runFrames(140);
{
  check('a goal punches the camera', host.find('.gdr-rink').classList.contains('scored'));
  const flashes = host.findAll('.gdr-flash');
  check('…and the building takes photographs', flashes.length > 0, `${flashes.length} flashes`);
  const onIce = flashes.filter(f => { const l = parseFloat(f.style.left); return l > 16 && l < 84; });
  check('…none of them on the ice', onIce.length === 0, `${onIce.length} over the sheet`);
}

// ── the ice is populated and everybody is ON it ─────────────────────────────────
view.apply(beat('goal'));
stub.runFrames(300);
const sheet = host.find('.gdr-sheet');
check('the sheet exists', !!sheet);
const skaters = host.findAll('.gdr-skater');
check('ten skaters take the ice', skaters.length === 10, `${skaters.length} men`);
check('both goalies dress', host.findAll('.gdr-goalie').length === 2);
check('there is exactly one puck', host.findAll('.gdr-puck').length === 1);
// THE TWO FACES OF A SWEATER. A crest on the chest and a number on the back — never a
// number on both, which was two sizes of the same marking and told a viewer nothing about
// which way a man was pointed. Every skater carries one of each and a full cage on the
// front of his helmet, and the `away` class is the only thing that decides which you see.
// TWENTY of each, and the number is the assertion. The markings are printed on the
// sweater, so they live INSIDE `.gdr-sk-body` and are duplicated by the reflection along
// with everything else the body carries — which is exactly what proves they are attached
// to it. Ten would mean they had drifted back outside the body, where they inherit none
// of its lean, ride or mirror and visibly slide around on the shirt.
check('every skater wears a club crest and a back number',
  host.findAll('.gdr-sk-crest').length === 20 && host.findAll('.gdr-sk-num').length === 20,
  `${host.findAll('.gdr-sk-crest').length} crests, ${host.findAll('.gdr-sk-num').length} numbers`);
// And the mirror they inherit is cancelled locally, so the numerals read the right way
// round: the counter-flip has to be there, once per copy.
check('…and the numerals are un-mirrored where they are printed',
  host.findAll('.gdr-sk-marks-flip').length === 20, `${host.findAll('.gdr-sk-marks-flip').length} counter-flips`);
// Forty: the cage is two bar paths, on a head that IS inside the body, so ×2 for the
// reflection. Counting it proves the cage survived into both copies of the figure.
check('…and a full cage to face the camera with',
  host.findAll('.gdr-sk-cage-bar').length === 40, `${host.findAll('.gdr-sk-cage-bar').length} bars`);
// The crest is derived from the club NAME the same way the sim derives its colours, so
// two clubs get different marks and one club gets the same mark every night.
{
  const mark = (side) => host.findAll(`.gdr-skater[data-side="${side}"] .gdr-sk-crest-mark`)[0].attrs.get('d');
  check('…and the two clubs do not wear the same crest', mark('a') !== mark('h'));
}
check('every skater wears a number and a position',
  host.findAll('.gdr-sk-tag').length === 10 && host.findAll('.gdr-sk-tag').every(t => /^\d+ (C|LW|RW|LD|RD)$/.test(t.textContent)),
  host.findAll('.gdr-sk-tag').map(t => t.textContent).join(','));

const frac = (v) => parseFloat(String(v));
const onIce = (el) => {
  const l = frac(el.style.left), t = frac(el.style.top);
  return Number.isFinite(l) && Number.isFinite(t) && l >= -1 && l <= 101 && t >= -1 && t <= 101;
};
check('every skater is inside the boards', skaters.every(onIce),
  skaters.map(s => `${s.style.left}/${s.style.top}`).join(' '));
check('the puck is on the sheet', onIce(host.find('.gdr-puck')), `${host.find('.gdr-puck').style.left}/${host.find('.gdr-puck').style.top}`);
check('the camera moved to follow it', /translate3d/.test(host.find('.gdr-cam').style.transform || ''), host.find('.gdr-cam').style.transform);

// Two men in the same place for three hundred frames means the formation collapsed.
const spread = new Set(skaters.map(s => `${frac(s.style.left).toFixed(0)}:${frac(s.style.top).toFixed(0)}`));
check('the men hold a formation rather than stacking up', spread.size >= 7, `${spread.size} distinct positions`);

// ── the ice keeps moving between beats ──────────────────────────────────────────
// The whole point of the rAF loop: with no new payload at all, the puck must still be
// somewhere else a few seconds later. A frozen puck here is the old bug returning.
const before = `${host.find('.gdr-puck').style.left}|${host.find('.gdr-puck').style.top}`;
stub.runFrames(600);
const after = `${host.find('.gdr-puck').style.left}|${host.find('.gdr-puck').style.top}`;
check('the puck keeps circulating with no new beat', before !== after, `${before} → ${after}`);

// ── the ice gets used up ────────────────────────────────────────────────────────
// Blade cuts accumulate as the men skate, and they are BOUNDED — an unbounded scatter
// is a memory leak that looks like weather. The cap is what makes the feature safe to
// leave running for a whole game, so it is the half worth asserting.
{
  const cutsAfter = host.findAll('.gdr-cut').length;
  check('the men cut the ice as they skate', cutsAfter > 0, `${cutsAfter} cuts`);
  stub.runFrames(4000);
  const capped = host.findAll('.gdr-cut').length;
  check('…and the cuts are capped, not unbounded', capped <= 200, `${capped} cuts`);
}

// ── nobody shakes ───────────────────────────────────────────────────────────────
// THE JITTER TEST. Three things used to flip on a bare threshold and each of them made
// men shake violently in place: which way a man faces (his lateral velocity crosses zero
// constantly, so any fixed cutoff gets crossed with it), whether you see his front or his
// back, and — loudest of all — the stride DURATION, because rewriting it restarts the
// animation, so a man sitting on a band boundary re-triggered his own stride every frame.
// All three are hysteretic now. This counts the flips over a long ordinary beat; the
// numbers are per-man over ~8 seconds, so single digits are real changes of direction and
// anything in the dozens is the shaking coming back.
{
  view.apply(beat('save'));
  stub.runFrames(60);
  const men = host.findAll('.gdr-skater');
  const read = () => men.map(m => ({
    face: m.style.getPropertyValue('--gdr-face') === '-1' ? 1 : 0,
    back: m.classList.contains('away') ? 1 : 0,
    dur: m.style.getPropertyValue('--gdr-stride'),
  }));
  // Measured as a WORST ONE-SECOND WINDOW PER MAN, not as a total. A total says nothing:
  // over eight seconds of circulation the puck legitimately reverses several times and
  // men turn with it, so a handful of flips each is correct play. Shaking is a different
  // shape entirely — ONE man flipping repeatedly inside a second — and that is what this
  // catches. Sampled every 2 frames (~33ms), so a one-second window is 30 samples.
  let prev = read();
  const hist = prev.map(() => ({ face: [], back: [] }));
  let durWrites = 0;
  for (let i = 0; i < 240; i++) {
    stub.runFrames(2);
    const now = read();
    now.forEach((c, k) => {
      if (c.face !== prev[k].face) hist[k].face.push(i);
      if (c.back !== prev[k].back) hist[k].back.push(i);
      if (c.dur !== prev[k].dur) durWrites++;
    });
    prev = now;
  }
  const worst = (key) => Math.max(0, ...hist.map(h =>
    Math.max(0, ...h[key].map(t => h[key].filter(u => u >= t && u < t + 30).length))));
  check('no man flips left/right more than twice a second', worst('face') <= 2, `worst ${worst('face')} in one second`);
  check('…nor spins front-to-back more than twice a second', worst('back') <= 2, `worst ${worst('back')} in one second`);
  check('…nor restarts his own stride every frame', durWrites <= 60, `${durWrites} duration rewrites`);
}

// ── draw order is anatomy ───────────────────────────────────────────────────────
// SVG has no z-index, so a limb's place in the figure IS its position in the markup, and
// two orderings here were wrong in opposite directions. The near arm sat in front of the
// HEAD, so raising his hands (a check, the top of a slapshot) put his own glove over the
// mask — the single most important thing on the figure for reading which way he faces.
// The far arm sat behind EVERYTHING, so when he turned to the camera and the stance swung
// it forward it stayed buried under the sweater: a man facing you with one arm.
{
  const body = host.findAll('.gdr-sk-body')[0];
  const order = body.children.map(c => c.attrs.get('data-part') || c.attrs.get('class') || '');
  const at = (name) => order.findIndex(o => o.includes(name));
  const torso = at('gdr-sk-torso'), far = at('armL'), marks = at('gdr-sk-marks');
  const near = at('armR'), head = at('head');
  check('the far arm is over the sweater, not buried under it', far > torso, `torso ${torso}, far arm ${far}`);
  check('…the markings stay readable over it', marks > far, `far arm ${far}, marks ${marks}`);
  check('…the near arm and its stick pass in front', near > marks, `marks ${marks}, near arm ${near}`);
  check('…and NOTHING he carries covers his own mask', head > near, `near arm ${near}, head ${head}`);
}

// ── toward the camera looks different from away from it ─────────────────────────
// The body only mirrors left/right, so a man skating AT the camera and one skating away
// were the identical drawing with a different badge — a whole team travelling up the ice
// read as skating backwards. The STICK carries the difference: swung low and in front
// coming at you, tucked high and behind going away. Checked as a sign flip, which is the
// thing that was missing entirely rather than a matter of degree.
{
  const yawOf = (s) => parseFloat(s.style.getPropertyValue('--gdr-stickyaw'));
  view.apply(beat('save'));
  stub.runFrames(200);
  const yaws = host.findAll('.gdr-skater').map(yawOf).filter(Number.isFinite);
  check('a skater\'s stick yaws with his heading', yaws.length === 10, `${yaws.length} set`);
  // Sampled ACROSS the beat, not at one instant. At any single moment the whole ice can
  // legitimately be drifting the same way — that is what a rush is — so a snapshot proves
  // nothing. What must be true is that over a passage of play the cue reaches both ends
  // of its range: sticks swing forward when men come at the camera and back when they go
  // away. A cue stuck on one sign is a cue not tracking heading at all.
  let lo = 0, hi = 0;
  for (let i = 0; i < 80; i++) {
    stub.runFrames(6);
    for (const v of host.findAll('.gdr-skater').map(yawOf)) {
      if (Number.isFinite(v)) { if (v > hi) hi = v; if (v < lo) lo = v; }
    }
  }
  check('…and toward-camera is not the same pose as away', hi > 15 && lo < -15, `range ${lo}…${hi}`);
}

// ── nobody moves in lockstep ────────────────────────────────────────────────────
// Every off-puck man used to target the identical puck-relative offset with an identical
// time constant, so the five-man unit TRANSLATED AS ONE RIGID BODY — the puck moved a
// foot and ten men moved a foot, in perfect sympathy. Measured as the correlation of
// their per-frame movement: if the unit is rigid, every man's displacement is the same
// vector every frame, and the spread of those displacements collapses to nothing.
{
  view.apply(beat('save'));
  stub.runFrames(90);
  const men3 = host.findAll('.gdr-skater');
  const read = () => men3.map(s => [parseFloat(s.style.left), parseFloat(s.style.top)]);
  let prev = read();
  let sameness = 0, samples = 0;
  for (let i = 0; i < 60; i++) {
    stub.runFrames(3);
    const now = read();
    const d = now.map((p, k) => [p[0] - prev[k][0], p[1] - prev[k][1]]);
    prev = now;
    const mag = d.map(v => Math.hypot(v[0], v[1]));
    const moving = mag.filter(v => v > 0.004);
    if (moving.length < 4) continue;
    // How alike the ten displacements are: the mean magnitude over the spread of them.
    // A rigid formation has near-zero spread and this runs away; individuals keep it low.
    const mean = moving.reduce((a, b) => a + b, 0) / moving.length;
    const spread = Math.sqrt(moving.reduce((a, b) => a + (b - mean) ** 2, 0) / moving.length);
    sameness += mean / Math.max(1e-6, spread); samples++;
  }
  const rigidity = samples ? sameness / samples : 0;
  check('the men do not move as one rigid formation', rigidity < 6, `rigidity ${rigidity.toFixed(1)}`);
}

// ── painter's order ─────────────────────────────────────────────────────────────
// THE PICTURE IS 3/4, SO DRAWING ORDER IS A POSITION. Goalies used to carry a fixed
// z-index above every skater, so a forward at the top of the crease — unambiguously
// nearer the camera than the keeper behind him — was painted out by him. The far end of
// the sheet is the TOP of the picture, so anything lower on screen is nearer and must be
// painted later. Checked as a monotonicity: sort every man and both keepers by `top`, and
// z-index must never go backwards.
{
  view.apply(beat('save'));
  stub.runFrames(120);
  const tokens = [...host.findAll('.gdr-skater'), ...host.findAll('.gdr-goalie')]
    .map(e => ({ top: parseFloat(e.style.top), z: parseInt(e.style.zIndex, 10) }))
    .filter(t => Number.isFinite(t.top) && Number.isFinite(t.z))
    .sort((a, b) => a.top - b.top);
  const inversions = tokens.filter((t, i) => i > 0 && t.z < tokens[i - 1].z).length;
  check('men and goalies are painted in depth order', inversions === 0 && tokens.length === 12,
    `${inversions} inversions over ${tokens.length} tokens`);
}

// ── the puck is on his STICK ────────────────────────────────────────────────────
// A standing figure is anchored at his SKATES, so putting the carrier's own position on
// the puck drew every man in the league dribbling it with his boots. He is offset by his
// stick reach instead. The assertion is that the man and the puck are separated ACROSS
// the sheet by roughly a stick — not zero (feet) and not a body-width (nowhere near it).
{
  // Sampled as the WIDEST separation reached while he is actually carrying, because he
  // spends the opening of a carry catching up to his own puck and a single instant can
  // land anywhere in that. What must be true is that the blade gets out to where the
  // artwork draws it — `BLADE_REACH` is 0.038 of the sheet's width and `left` is a
  // percentage of it, so a settled blade sits ~3.8% away. Zero would be his boots.
  view.apply(beat('save'));
  let gap = 0;
  for (let i = 0; i < 12; i++) {
    stub.runFrames(6);
    const carrier = host.findAll('.gdr-skater').find(s => s.classList.contains('carrier'));
    const pk = host.find('.gdr-puck');
    if (carrier) gap = Math.max(gap, Math.abs(parseFloat(carrier.style.left) - parseFloat(pk.style.left)));
  }
  check('the carrier has the puck on his blade, not his boots', gap > 2.2 && gap < 7, `${gap.toFixed(1)}% across the sheet`);
}

// ── crossovers, and pulling it across his body ──────────────────────────────────
// Changing direction is a MOVE. Two things have to be true and they used to fight each
// other: a turning skater steps one skate over the other, and a carrier who switches
// stick side has to take the puck across his body rather than have the blade teleport to
// his other hip — which is what an instantaneous mirror did, dragging the puck straight
// through his skates for a frame every time.
{
  view.apply(beat('save'));
  // Measured on the FACE BLEND itself rather than on the man-to-puck gap. The gap
  // conflates two motions — his switch and the puck's own travel along the sim's
  // keyframes — so a fast carry reads as a jump even when nothing teleported. The blend
  // is the mechanism: it is what the lateral offset is derived from, so if it moves
  // continuously the blade cannot have jumped sides, and if it ever stepped straight
  // from −1 to +1 that is exactly the bug this is here to catch.
  // THE FLIP HAPPENS WHEN HE IS SQUARE OVER THE PUCK, and that is the whole proof. The
  // mirror sign is the observable half of the blend, and the blend crosses zero exactly
  // when the lateral offset is zero — so if the switch is a move, the blade is at his
  // centre at the instant he turns around. Under the old instantaneous mirror the flip
  // landed with the blade a full stick reach out on the OLD side, which is the frame
  // where the puck appeared to pass through his skates.
  let sawCrossover = false;
  const flipGaps = [];
  let prevSign = null;
  for (let i = 0; i < 120; i++) {
    stub.runFrames(2);
    const men2 = host.findAll('.gdr-skater');
    if (men2.some(s => s.classList.contains('crossing'))) sawCrossover = true;
    const c = men2.find(s => s.classList.contains('carrier'));
    if (!c) { prevSign = null; continue; }
    const sign = c.style.getPropertyValue('--gdr-face') === '-1' ? -1 : 1;
    if (prevSign !== null && sign !== prevSign) {
      flipGaps.push(Math.abs(parseFloat(c.style.left) - parseFloat(host.find('.gdr-puck').style.left)));
    }
    prevSign = sign;
  }
  check('somebody crosses over through a turn', sawCrossover);
  check('…and a carrier switching hands is square over the puck as he turns',
    flipGaps.every(g => g < 3),
    flipGaps.length ? `gaps ${flipGaps.map(g => g.toFixed(1)).join(',')}%` : 'no hand-switch in window');
}

// ── they go and GET it ──────────────────────────────────────────────────────────
// A pad save leaves a rebound with nobody carrying it, and the nearest man from each
// side is supposed to race for it. Before the job assignment existed the puck would
// squirt into a corner and ten men would shade two feet sideways and carry on holding
// their lanes — the formation was correct and completely inert. The assertion is simply
// that somebody CLOSES: the nearest man is meaningfully nearer a second later.
{
  const nearest = () => {
    const pk = host.find('.gdr-puck');
    const px = parseFloat(pk.style.left), py = parseFloat(pk.style.top);
    // Weight the along-sheet axis by the tilt, so this measures screen distance the way
    // the view's own ranking does rather than treating the short axis as the long one.
    return Math.min(...host.findAll('.gdr-skater').map(s =>
      Math.hypot(parseFloat(s.style.left) - px, (parseFloat(s.style.top) - py) * 0.62)));
  };
  // Sampled as a MINIMUM over a window, not as a before/after pair. The puck is under
  // physics and idle circulation the whole time, so any two instants can show a man
  // moving away from it and prove nothing; what pursuit actually claims is that somebody
  // REACHES it. With the job assignment removed this floor sits around 3–4% — the
  // formation's standoff distance — and never comes down.
  view.apply(beat('pad'));
  stub.runFrames(150);          // through the rush and the save, into the rebound
  let closest = Infinity;
  for (let i = 0; i < 24; i++) { stub.runFrames(10); closest = Math.min(closest, nearest()); }
  check('somebody chases a loose puck down', closest < 1.5, `closest approach ${closest.toFixed(2)}%`);
}

// ── a loose puck is stopped by things ───────────────────────────────────────────
// A free puck fired straight down the middle of a sheet with ten men on it must not
// arrive at the far boards untouched. This is the one assertion that a puck and a man
// are in the same physics rather than in two layers drawn over each other — with the
// collision removed it passes clean through and the test goes red.
{
  const shot = beat('save', { possession: [{ t: 0, p: [0.5, 0.5], carrier: 0 }, { t: 1, p: [0.52, 0.5], ev: 'shot', carrier: 0 }] });
  view.apply(shot);
  stub.runFrames(400);
  const p = host.find('.gdr-puck');
  const inside = parseFloat(p.style.top) > 1 && parseFloat(p.style.top) < 99;
  check('a loose puck stays on the sheet', inside, `top ${p.style.top}`);
}

// ── geometry ────────────────────────────────────────────────────────────────────
// The sheet is drawn at its real proportions, so a faceoff circle is a circle. If the
// viewBox and the CSS aspect-ratio ever disagree, every circle on the ice becomes an
// egg and nothing else in the suite would notice.
check('the sheet keeps the real 85:200', __test.SHEET_W === 85 && __test.SHEET_L === 200,
  `${__test.SHEET_W}x${__test.SHEET_L}`);
check('the away end projects to the top of the picture', __test.sy(GEO.goalLine[0]) < __test.sy(GEO.goalLine[1]));
check('the projection spans the full sheet width', __test.sx(0) === 85 && __test.sx(1) === 0);
const svg = __test.rinkSvg();
check('the markings carry the sheet viewBox', svg.includes('viewBox="0 0 85 200"'), svg.slice(0, 80));
check('every faceoff dot is drawn', Object.keys(DOTS).every(d => svg.includes(`data-dot="${d}"`)));
check('both cages are drawn', svg.includes('data-side="l"') && svg.includes('data-side="r"'));

view.clear();
check('clear() empties the host', host.innerHTML === '');

console.log(failures ? `\n${failures} failure(s)` : '\nrink smoke: all clear');
process.exit(failures ? 1 : 0);
