// THE CLOSE-UP FIGURE (client/game/js/panels/figure.js): every cut, hair style and level builds,
// and builds sound.
//
//   node scripts/shapes/figure.mjs            # gate
//   node scripts/shapes/figure.mjs --report   # the numbers behind it
//
// What can go wrong without a picture showing it: a mesh past UNSIGNED_SHORT or its budget, a
// non-finite point, weights that don't sum to one or name a bone that isn't there, a part wound
// inward (its normals point in, and the ink and the light go inside out), skin left under a coat
// (it pokes through at the first bent elbow), a hair card under the hairline or across the face,
// and the crowd's body drifting from the close-up one it's sampled from, which is the promise that
// a person seen from the cab has the silhouette they have across a room.
import { readdirSync, readFileSync } from 'node:fs';
import { buildFigure, figureSole, FIGURE_CUT_NAMES, FIGURE_BONES, FIG_SLOT, SCULPT_BUILDS, FIGURE_FACIAL } from '../../client/game/js/panels/figure.js';
import { hairlineAt, headMesh, skullPoint, HAIR_STYLES } from '../../client/game/js/panels/actor-head.js';
import { ACTOR_IDLES, ACTOR_CLIPS, ACTOR_ROOM_CLIPS, ACTOR_BODIES, ACTOR_ACTS, actorSkinAt, actorSkinMix, actorOutfit } from '../../client/game/js/panels/actor3d.js';
import { actOfLine, speakerOf, NPC_ACTS } from '../../client/shared/npc-acts.js';
import { MOUTHS, mouthTrack, textTrack, mouthAt } from '../../client/shared/lip-sync.js';
import { figurePeople, FIGURE_LOD, actClip } from '../../client/game/js/panels/gl/room-people.js';

const REPORT = process.argv.includes('--report');
const problems = [];
const report = (...a) => { if (REPORT) console.log(...a); };
const BUDGET = { hd: 32000, lite: 11000, crowd: 2200, far: 400 };

function volumeOf(F, p) {
  const { P, I } = F;
  let cx = 0, cy = 0, cz = 0;
  for (let v = p.v0; v < p.v0 + p.nv; v++) { cx += P[v * 3]; cy += P[v * 3 + 1]; cz += P[v * 3 + 2]; }
  cx /= p.nv; cy /= p.nv; cz /= p.nv;
  let vol = 0;
  for (let t = p.start; t < p.start + p.count; t += 3) {
    const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
    const ax = P[a] - cx, ay = P[a + 1] - cy, az = P[a + 2] - cz, bx = P[b] - cx, by = P[b + 1] - cy, bz = P[b + 2] - cz, qx = P[c] - cx, qy = P[c + 1] - cy, qz = P[c + 2] - cz;
    vol += ax * (by * qz - bz * qy) - ay * (bx * qz - bz * qx) + az * (bx * qy - by * qx);
  }
  return vol / 6;
}

// The sculpted figure (docs/proposals/sculpted-figure.md) has to come in under the figure it revises.
for (const level of ['hd', 'lite']) for (const cut of FIGURE_CUT_NAMES) {
  const K = { cut, style: 4, level }, F = buildFigure({ ...K, sculpt: true }), O = buildFigure(K), name = `sculpt ${level} ${cut}`;
  if (F.nt > O.nt) problems.push(`${name} is ${F.nt} triangles, over the ${O.nt} it replaces`);
  if (F.P.some((v) => !Number.isFinite(v)) || F.NF.some((v) => !Number.isFinite(v))) problems.push(`${name} has a non-finite position or form normal`);
  for (let i = 0; i < F.nv * 4; i++) if (F.B[i] >= FIGURE_BONES.length) { problems.push(`${name} names a bone that isn't there`); break; }
  report(`${name}: ${F.nt} triangles against ${O.nt}`);
}
// Every build on every head and a sleeved and a bare cut: built sound, and one mesh a build, so the
// same vertices aren't shared by accident.
for (const build of Object.keys(SCULPT_BUILDS)) for (const cut of ['coat', 'tee']) for (const head of [0, 3]) for (const weight of [null, 0, 0.3, 0.5, 0.8, 1]) {
  const F = buildFigure({ cut, style: 3, level: 'hd', sculpt: true, head, build, weight }), name = `sculpt ${build} ${cut} head ${head} weight ${weight}`;
  if (F.P.some((v) => !Number.isFinite(v))) problems.push(`${name} has a non-finite position`);
  if (F.nt > 32220) problems.push(`${name} is ${F.nt} triangles, over the current figure's 32,220`);
}
// A settled look (an NPC's flags.figure) names things that exist, or the figure quietly falls back to a coat.
for (const file of readdirSync(new URL('../../content/npcs/', import.meta.url))) {
  const fg = JSON.parse(readFileSync(new URL('../../content/npcs/' + file, import.meta.url), 'utf8')).flags?.figure;
  if (!fg) continue;
  if (fg.cut && !FIGURE_CUT_NAMES.includes(fg.cut)) problems.push(`${file}: flags.figure.cut ${fg.cut} isn't a cut`);
  if (fg.build && !SCULPT_BUILDS[fg.build]) problems.push(`${file}: flags.figure.build ${fg.build} isn't a build`);
  if (fg.head !== undefined && !(fg.head >= 0 && fg.head <= 3)) problems.push(`${file}: flags.figure.head ${fg.head} isn't a head`);
  if (fg.facial && !FIGURE_FACIAL[fg.facial]) problems.push(`${file}: flags.figure.facial ${fg.facial} isn't a facial hair style`);
}
// A beard with a mesh builds sound at both levels and every head, under the figure it revises.
for (const [name, F] of Object.entries(FIGURE_FACIAL)) if (F.mesh) for (const level of ['hd', 'lite']) for (const head of [0, 1, 2]) {
  const G = buildFigure({ cut: 'tee', style: 4, level, sculpt: true, head, weight: 0.5, beard: F.mesh }), O = buildFigure({ cut: 'tee', style: 4, level });
  if (G.P.some((v) => !Number.isFinite(v))) problems.push(`beard ${name} ${level} isn't finite`);
  if (G.nt > O.nt) problems.push(`beard ${name} ${level} is ${G.nt} triangles, over ${O.nt}`);
}
// Real eyes are the close-up's alone: the phone has no budget for them. Each ball stays behind the skin.
{
  const hd = buildFigure({ cut: 'tee', style: 4, level: 'hd', sculpt: true, weight: 0.5 }), lite = buildFigure({ cut: 'tee', style: 4, level: 'lite', sculpt: true, weight: 0.5 });
  const n = (F, name) => F.parts.filter((p) => p.name === name).length;
  if (n(hd, 'eyes') !== 1 || n(hd, 'lids') !== 1) problems.push('the close-up figure has no real eyes');
  if (n(lite, 'eyes') || n(lite, 'lids')) problems.push('the phone figure has real eyes it has no budget for');
  for (const head of [0, 1, 2, 3]) for (const weight of [0, 0.5, 1]) {
    const F = buildFigure({ cut: 'tee', style: 4, level: 'hd', sculpt: true, head, weight, build: head === 3 ? 'woman' : 'average' }), e = F.parts.find((p) => p.name === 'eyes');
    for (let v = e.v0; v < e.v0 + e.nv; v++) if (!Number.isFinite(F.P[v * 3 + 2])) { problems.push(`head ${head} weight ${weight}: an eye isn't finite`); break; }
  }
}
// The levels of detail step down at every weight and beard, each well under the one before it.
for (const weight of [0, 0.5, 1]) for (const beard of ['', 'full', 'long']) {
  const nt = ['hd', 'lite', 'crowd', 'far'].map((level) => buildFigure({ cut: 'coat', style: 4, level, sculpt: true, weight, beard }).nt);
  for (let i = 1; i < nt.length; i++) if (nt[i] > nt[i - 1] * 0.6) problems.push(`weight ${weight} beard ${beard}: level ${i} is ${nt[i]} triangles against ${nt[i - 1]} above it`);
}
// A person drops to the lite figure across a room and comes back up, and doesn't flicker at the line.
{
  const L = { world: (u, v, y) => [u, y, v], r: [1, 0, 0], f: [0, 0, 1] }, eye = [0, 1.6, 0], at = (d) => figurePeople(L, [{ id: 'lod-check', at: [d, 0], pose: 'stand', sculpt: true, sex: 'male' }], 0, { level: 'hd', eye })[0].key.level;
  const steps = [[1, 'hd'], [FIGURE_LOD.far + 0.5, 'lite'], [(FIGURE_LOD.near + FIGURE_LOD.far) / 2, 'lite'], [FIGURE_LOD.near - 0.5, 'hd'], [(FIGURE_LOD.near + FIGURE_LOD.far) / 2, 'hd']];
  for (const [d, want] of steps) if (at(d) !== want) problems.push(`at ${d} m a person should be ${want}`);
  if (figurePeople(L, [{ id: 'lod-phone', at: [1, 0], pose: 'stand', sculpt: true }], 0, { level: 'lite', eye })[0].key.level !== 'lite') problems.push('a phone asked for the close-up figure');
}
// The street's body types are offsets on one bake, which needs one mesh at every weight, and they stay off until
// the sculpted figure goes live, so an outfit has no body until then. They come off the street token alone.
for (const level of ['crowd', 'far']) {
  const nv = buildFigure({ cut: 'coat', level }).nv;
  for (const [weight, build] of [[0, 'average'], [0.5, 'average'], [1, 'average'], [0.5, 'woman']]) if (buildFigure({ cut: 'coat', level, sculpt: true, weight, build }).nv !== nv) problems.push(`the ${level} body at weight ${weight} ${build} isn't the same mesh`);
}
{
  const rand = (k) => ((k * 0.61803) % 1);
  if (ACTOR_BODIES.on) problems.push('the street body types are on before the sculpted figure is');
  if (actorOutfit(rand).body) problems.push('a street outfit has a body while they are off');
  ACTOR_BODIES.on = true;
  const b = actorOutfit(rand).body;
  ACTOR_BODIES.on = false;
  if (!b || Math.abs(b[0] + b[1] + b[2] - 1) > 1e-6) problems.push(`a street body should mix to one, got ${b}`);
}
// Every idle is a clip that plays, and every two of them mix: a name that's wrong falls back to standing.
{
  const names = new Set([...ACTOR_CLIPS, ...ACTOR_ROOM_CLIPS].map((c) => c.name)), all = Object.values(ACTOR_IDLES).flat().map((c) => c[0]);
  for (const n of all) {
    if (!names.has(n)) problems.push(`idle ${n} isn't a clip`);
    if (actorSkinAt(n, 0.37).some((m) => m.some((v) => !Number.isFinite(v)))) problems.push(`idle ${n} isn't finite`);
  }
  if (actorSkinMix('idleHip', 0.2, 'wait', 0.5, 0.5).some((m) => m.some((v) => !Number.isFinite(v)))) problems.push("two idles don't mix");
  // a sleeper turning over blends from the back to the side
  if (actorSkinMix('sleepBack', 0.3, 'sleepSide', 0.6, 0.5).some((m) => m.some((v) => !Number.isFinite(v)))) problems.push("lying on the back and on the side don't mix");
  // every act an emote line can name is a clip for some way of being, and every clip it names is one
  for (const a of NPC_ACTS) {
    const by = ACTOR_ACTS[a];
    if (!by || !Object.keys(by).length) problems.push(`act ${a} has no clip`);
    for (const [pose, c] of Object.entries(by || {})) { if (!names.has(c)) problems.push(`act ${a} ${pose} plays ${c}, which isn't a clip`); else if (actClip(a, pose) !== c) problems.push(`act ${a} ${pose} doesn't reach ${c}`); }
  }
  for (const a of Object.keys(ACTOR_ACTS)) if (!NPC_ACTS.includes(a)) problems.push(`act ${a} has a clip but no line names it`);
}
// Emote lines the game prints, and what the Room Stage acts out for each (client/shared/npc-acts.js). The narrow
// patterns come before the broad: "nods off" is asleep, not a nod; "leans against" is waiting, not the counter.
{
  const LINES = [
    ['smokes a cigarette.', 'smoke'], ['lights a cigarette at the window.', 'smoke'], ['wipes down the bar with a rag.', 'wipe'],
    ['polishes a glass that was already clean.', 'polish'], ['opens the fridge, looks in, and shuts it again.', 'rummage'],
    ['goes through the wardrobe and takes nothing out.', 'rummage'], ['runs the tap and fills a glass.', 'wash'], ['rinses a mug and leaves it on the side.', 'wash'],
    ['sits down and checks a tablet.', 'read'], ['thumbs through their phone, frowning.', 'phone'], ['reads something on their phone twice.', 'phone'],
    ['leans against the wall and stares at nothing.', 'wait'], ['leans on the counter.', 'lean'], ['stands with their arms folded, thinking about something.', 'fold'],
    ['rolls their shoulders and yawns.', 'stretch'], ['stretches until something in their back clicks.', 'stretch'], ['yawns.', 'yawn'],
    ['sits down and lets out a breath.', 'sigh'], ['lies down with an arm over their eyes.', 'sigh'], ['looks down at the street.', 'look'],
    ['nods off in the chair.', 'doze'], ['nods.', 'nod'], ['counts the till.', 'count'], ['scribbles something in a notebook.', 'write'],
    ['laughs at something only they heard.', 'laugh'], ['coughs into a fist.', 'cough'], ['shivers and rubs their hands together.', 'shiver'],
    ['sips a coffee.', 'drink'], ['takes a bite of a sandwich.', 'eat'], ['stirs the pot.', 'stir'], ['shrugs.', 'shrug'], ['backs away from the door.', 'cower'],
    ['hums and sways a little.', 'dance'], ['checks their watch.', 'time'], ['waves.', 'wave'], ['picks up the remote and puts the set on.', null],
  ];
  for (const [line, want] of LINES) { const got = actOfLine(line); if (got !== want) problems.push(`"${line}" acts ${got}, not ${want}`); }
  if (speakerOf('Mary Ann Kerr wipes the bar.', ['Mary', 'Mary Ann Kerr', 'Ann']) !== 'Mary Ann Kerr') problems.push('a line goes to the shorter of two names');
  if (speakerOf('Marysia waves.', ['Mary']) !== null) problems.push('a line goes to a name that is only the start of a word');
}
// Every sound ORACLE can make has a mouth, or a word goes by with the lips shut, and a line ends closed.
{
  const src = readFileSync(new URL('../../client/shared/audio-engine.js', import.meta.url), 'utf8'), a = src.indexOf('const PH = {'), b = src.indexOf('\n    };', a);
  const quiet = new Set(['_', 'END']), codes = [...src.slice(a, b).matchAll(/\b([A-Z]{1,3}):\{/g)].map((m) => m[1]).filter((c) => !quiet.has(c) && !/^_/.test(c));
  for (const c of codes) { const t = mouthTrack([{ p: c, at: 0 }, { p: 'END', at: 0.2 }]); if (MOUTHS[t[0].m] === MOUTHS.rest) problems.push(`ORACLE's ${c} has no mouth shape`); }
  if (codes.length < 30) problems.push(`found only ${codes.length} ORACLE phonemes`);
  const line = textTrack('Good evening, Coldwater.');
  if (!mouthAt(line, 0.3)) problems.push('a line has no mouth while it plays');
  if (mouthAt(line, 60)) problems.push("a line's mouth doesn't stop");
}
// A head that shortens its chin takes the point closing the skull with it, or that point hangs under the chin.
{
  const { P } = headMesh(0, 'sculptSoft'), ring = skullPoint(1.5236, Math.PI / 2, 'sculptSoft')[1];
  for (let i = 0; i < P.length; i += 3) if (P[i] === 0 && Math.abs(P[i + 2] - 0.05) < 1e-6 && ring - P[i + 1] > 0.004) problems.push(`the soft head's chin spikes ${(ring - P[i + 1]).toFixed(4)} under its last ring`);
}
for (const level of ['hd', 'lite', 'crowd', 'far']) {
  const cuts = level === 'hd' || level === 'lite' ? FIGURE_CUT_NAMES : ['coat'];
  const styles = level === 'hd' ? [...Array(HAIR_STYLES).keys()] : [0];
  for (const cut of cuts) for (const style of styles) {
    const name = `${level} ${cut} hair ${style}`, F = buildFigure({ cut, style, level });
    report(`${name}: ${F.nv} vertices, ${F.nt} triangles${F.cards ? `, ${F.cards.n} cards` : ''}`);
    if (F.nv > BUDGET[level]) problems.push(`${name} is ${F.nv} vertices, over its ${BUDGET[level]}`);
    if (!(F.I instanceof Uint16Array) || F.nv > 65535) problems.push(`${name} doesn't index as UNSIGNED_SHORT`);
    if (F.P.some((v) => !Number.isFinite(v)) || F.N.some((v) => !Number.isFinite(v))) problems.push(`${name} has a non-finite position or normal`);
    for (let i = 0; i < F.I.length; i++) if (F.I[i] >= F.nv) { problems.push(`${name}: an index past the last vertex`); break; }
    let badW = 0, badB = 0;
    for (let v = 0; v < F.nv; v++) {
      let s = 0;
      for (let k = 0; k < 4; k++) { s += F.W[v * 4 + k]; if (F.B[v * 4 + k] >= FIGURE_BONES.length) badB++; }
      if (Math.abs(s - 1) > 1e-4) badW++;
    }
    if (badW) problems.push(`${name}: ${badW} vertices' weights don't sum to 1`);
    if (badB) problems.push(`${name}: ${badB} bone indices past the skeleton`);
    // every part this module builds is wound outward; the head's and the cards' come as they are
    for (const p of F.parts) {
      if (p.name === 'head' || p.name === 'hair' || p.name === 'cards' || p.name === 'collar' || !p.count) continue;
      if (!(volumeOf(F, p) > 0)) problems.push(`${name}: the ${p.name} is wound inward`);
    }
    // under a coat there's no skin between the hips and the shoulders
    if (level === 'hd' && cut === 'coat') {
      const torso = F.parts.find((p) => p.name === 'torso');
      let under = 0;
      if (torso) for (let v = torso.v0; v < torso.v0 + torso.nv; v++) { const y = F.P[v * 3 + 1]; if (y > 0.95 && y < 1.4) under++; }
      if (under) problems.push(`${name}: ${under} torso skin vertices left under the coat`);
    }
    // hair cards: above the hairline at the root, and never across the face
    if (F.cards) {
      const c = F.parts.find((p) => p.name === 'cards');
      let low = 0, face = 0;
      for (let v = c.v0; v < c.v0 + c.nv; v++) {
        const x = F.P[v * 3], y = F.P[v * 3 + 1], z = F.P[v * 3 + 2];
        if (F.UV[v * 2 + 1] === 0 && y < hairlineAt(x, z) - 0.002) low++;
        if (z > 0.06 && Math.abs(x) < 0.05 && y > 1.53 && y < 1.69) face++;
      }
      if (low) problems.push(`${name}: ${low} card roots below the hairline`);
      if (face) problems.push(`${name}: ${face} card points across the face`);
    }
    if (level === 'hd' && style > 0 && !F.cards) problems.push(`${name} has no hair cards`);
    // the form normals the comic light decides lit from shadow with (formNormals): there at the
    // close-up levels, unit length, and on the same side as the surface's own, or a form would
    // light from behind
    if (level === 'hd' || level === 'lite') {
      if (!F.NF || F.NF.length !== F.N.length) problems.push(`${name} has no form normals`);
      else {
        let bad = 0, away = 0;
        for (let v = 0; v < F.nv; v++) {
          const x = F.NF[v * 3], y = F.NF[v * 3 + 1], z = F.NF[v * 3 + 2], l = Math.hypot(x, y, z);
          if (!(Math.abs(l - 1) < 1e-3)) bad++;
          if (x * F.N[v * 3] + y * F.N[v * 3 + 1] + z * F.N[v * 3 + 2] < -0.2) away++;
        }
        if (bad) problems.push(`${name}: ${bad} form normals aren't unit length`);
        if (away > F.nv * 0.01) problems.push(`${name}: ${away} form normals face away from their surface`);
      }
    }
    if (F.S.some((s) => s === FIG_SLOT.card) && !F.cards) problems.push(`${name}: card vertices outside the card range`);
  }
}

// A Wildblood with every change on (docs/lore-wildblood.md): the tunic and mantle, all the gear,
// a mighty arm, thorns, horns, claws, teeth and goggles, at both close-up levels. Each change is
// there, finite, inside the budget, and the mighty arm's side is thicker than the other.
for (const level of ['hd', 'lite']) {
  const body = { mighty: 'R', thorn: true, horns: true, claws: true, teeth: true, goggles: true };
  const F = buildFigure({ cut: 'tunic', style: 3, level, gear: { strap: true, pouch: true }, body }), name = `${level} Wildblood`;
  report(`${name}: ${F.nv} vertices, ${F.nt} triangles`);
  if (F.nv > BUDGET[level]) problems.push(`${name} is ${F.nv} vertices, over its ${BUDGET[level]}`);
  if (F.P.some((v) => !Number.isFinite(v)) || F.N.some((v) => !Number.isFinite(v))) problems.push(`${name} has a non-finite position or normal`);
  for (const want of ['mantle', 'thorns', 'horns', 'clawsL', 'clawsR', 'teeth', 'goggles']) if (!F.parts.some((p) => p.name === want && p.count)) problems.push(`${name} has no ${want}`);
  if (F.parts.some((p) => p.name.startsWith('sleeve'))) problems.push(`${name}'s tunic has sleeves; its arms are meant to be bare`);
  const reach = (nm) => { const p = F.parts.find((q) => q.name === nm); let m = 0; if (p) for (let v = p.v0; v < p.v0 + p.nv; v++) if (Math.abs(F.P[v * 3 + 1] - 1.2) < 0.03) m = Math.max(m, Math.abs(F.P[v * 3])); return m; };
  if (!(reach('armR') > reach('armL') + 0.005)) problems.push(`${name}'s mighty right arm is no thicker than the left (${reach('armR').toFixed(3)} against ${reach('armL').toFixed(3)})`);
}

// The crowd's coat against the close-up coat's: at each height, how far out each one reaches to
// the side and to the front. Sampled coarsely, it should still be the same coat.
{
  const reach = (F, slot) => {
    const bins = new Map();
    for (let v = 0; v < F.nv; v++) {
      if (F.S[v] !== slot) continue;
      const y = F.P[v * 3 + 1];
      if (y < 0.66 || y > 1.4) continue;
      const k = Math.round(y / 0.05), b = bins.get(k) || [0, 0];
      b[0] = Math.max(b[0], Math.abs(F.P[v * 3])); b[1] = Math.max(b[1], F.P[v * 3 + 2]);
      bins.set(k, b);
    }
    return bins;
  };
  const hd = reach(buildFigure({ cut: 'coat', level: 'hd' }), FIG_SLOT.top), crowd = reach(buildFigure({ cut: 'coat', level: 'crowd' }), FIG_SLOT.top);
  let worst = 0, at = 0;
  for (const [k, a] of hd) { const b = crowd.get(k); if (!b) continue; const d = Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1])); if (d > worst) { worst = d; at = k * 0.05; } }
  report(`crowd coat against the close-up coat: worst ${(worst * 1000).toFixed(1)} mm, at ${at.toFixed(2)} m`);
  if (worst > 0.02) problems.push(`the crowd's coat strays ${(worst * 1000).toFixed(0)} mm from the close-up coat at ${at.toFixed(2)} m; it should be the same coat sampled coarsely`);
}

// The sole the root solve pivots on: on the ground through the middle, never under it.
{
  const s = figureSole();
  if (s.some(([, y]) => y < 0.004 - 1e-9)) problems.push('the shoe sole dips under the ground line');
  if (!s.some(([z, y]) => Math.abs(y - 0.004) < 1e-6 && z > 0 && z < 0.05)) problems.push('the shoe sole isn\'t flat on the ground under the ball');
}

if (problems.length) {
  console.log(`✗ figure — ${problems.length} problem(s):`);
  for (const p of problems) console.log('  ' + p);
  process.exit(1);
}
console.log('✓ figure: every cut, hair style and level builds sound, and the crowd wears the close-up coat');
