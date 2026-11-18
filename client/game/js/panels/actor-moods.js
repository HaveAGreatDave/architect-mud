// ROOM's panic and its extra idles: clips for somebody frightened, and more for somebody with nothing to do.
//
// They're ROOM clips like actor-gait.js's: actorSkinAt poses them on the CPU, never baked. actor3d.js hands
// in its own helpers (the stance, the arm setter, the seated wrapper) so the bones and conventions are the
// same as every other clip: flexion about X negative forward, the right arm's abduction negative outward
// and the left's positive, a twist about the upper arm's Y turning the forearm across the body.
//
// The arm angles were solved rather than eyeballed: a search over each arm's four angles for where the
// palm has to be (at the ear, under the chin, on the cheeks, out in front at shoulder height) with the
// elbow kept where a person's would be. Hence the odd decimals. A palm that misses its mark by a few
// centimetres still reads; one that goes through the head doesn't, so the targets sit off the face.
//
// The panic set is what a resident or a bystander does from the moment they see you (plugins/ambient-life
// panic.js says the beats, plugins/roomstage npc-life.js plays them): startled, hands up, backing off with
// the palms out, on the phone to the police with the free hand going, looking for a way out, pleading,
// hands to the face, and shaken once it's over.

// [flexion deg, twist deg, abduction rad, elbow deg]
const A = {
  earR: [-104.2, 37.3, 0.239, -132.7],
  chinR: [-62.5, 62.5, 0.275, -126.6], propL: [-27.4, -78.1, -0.233, -73.1],
  cactusR: [-14.8, -73.8, -1.491, -105.5], cactusL: [-18.8, 73.5, 1.489, -98.1],
  guardR: [-49.8, 9.3, -0.437, -111.5], guardL: [-45.8, -19.9, 0.058, -113.4],
  palmR: [-36.1, 0.6, -0.102, -82.8], palmL: [-37.9, -2.4, 0.324, -82.8],
  pleadR: [-23.5, 35.8, 0.178, -102.0], pleadL: [-29.8, -41.8, 0.175, -105.0],
  cheekR: [-92.3, 18.6, -0.220, -129.0], cheekL: [-91.5, 22.9, 0.881, -130.3],
  wringR: [-16.9, 51.6, -0.251, -101.2], wringL: [-11.1, -45.4, 0.094, -94.8],
  chestR: [-17.7, 51.3, -0.187, -133.8],
  nailsR: [-25.5, 21.1, 0.149, -101.1],
  hairR: [-151.9, 65.4, 0.278, -82.1], hairBackR: [-166.7, 55.8, 0.255, -106.1],
  scrollR: [-16.3, 28.0, 0.047, -76.0],
  headTopL: [-147.2, -57.8, -0.232, -91.0],
  hipL: [-4, -20, 0.32, -95], downR: [-2, 0, -0.07, -12], downL: [-2, 0, 0.07, -12],
};

export function moodClips(h) {
  const { stance, arm, setR, held, bump, smooth, TAU, DEG, sitOf, plant, feet, poses } = h;
  const lerp = (a, b, k) => a + (b - a) * k;
  // an arm part way between two of A's, plus a wrist
  const armK = (P, side, a, b, k, wr = -8, wz = 0) => arm(P, side, lerp(a[0], b[0], k), lerp(a[1], b[1], k), lerp(a[2], b[2], k), lerp(a[3], b[3], k), wr, wz);
  const set = (P, side, a, wr = -8, wz = 0) => arm(P, side, a[0], a[1], a[2], a[3], wr, wz);
  // shaking: a fast tremble on the forearms and the head, as much as `k`
  const tremble = (P, p, k) => {
    const t = Math.sin(31 * TAU * p) * k, u = Math.sin(27 * TAU * p + 1.3) * k;
    setR(P, 'farmR', 3 * DEG * t, 0, 0); setR(P, 'farmL', 3 * DEG * u, 0, 0); setR(P, 'head', 1.2 * DEG * u, 1.2 * DEG * t, 0);
  };
  // quick, shallow breathing: the chest and shoulders lifting
  const pant = (P, p, rate = 6, k = 1) => { const b = Math.sin(rate * TAU * p) * k; setR(P, 'chest', -1.6 * DEG * b, 0, 0); P.root[1] += 0.004 * b; };
  // the knees given a little and the weight back and even, as somebody does who expects to have to move: the
  // hips go down and back over feet that stay where they were (actor-plant.js), further back by 'back'
  const ready = (P, k, back = 0) => plant(P, feet, { weight: lerp(0.28, 0.5, Math.min(1, k * 1.5)), sink: 0.03 * k, dz: -0.025 * k - back });

  // Startled: the hands snap up in front of the face, the body jerks back and the knees give, then it all
  // comes down a little and holds there, watching. Played once.
  function startlePose(p) {
    const P = stance(p), jolt = smooth(0, 0.1, p), k = jolt * (1 - 0.35 * smooth(0.35, 0.8, p));
    ready(P, k);
    setR(P, 'spine', -9 * DEG * k, 0, 0); setR(P, 'chest', -6 * DEG * k, 0, 0);
    armK(P, 'R', A.downR, A.guardR, k, -8 + 30 * k); armK(P, 'L', A.downL, A.guardL, k, -8 + 30 * k);
    setR(P, 'neck', -6 * DEG * k, 0, 0); setR(P, 'head', -8 * DEG * k, 0, 0);
    tremble(P, p, 0.6 * smooth(0.2, 0.4, p));
    return P;
  }
  // Hands up: both arms raised either side of the head with the palms out, leaning back, shaking.
  function handsUpPose(p) {
    const P = stance(p), k = held(p, 0.04, 0.98);
    ready(P, 0.5);
    setR(P, 'spine', -5 * DEG, 0, 0);
    set(P, 'R', A.cactusR, 25); set(P, 'L', A.cactusL, 25);
    setR(P, 'head', (-4 + 3 * Math.sin(TAU * p)) * DEG, 14 * DEG * Math.sin(TAU * p) * k, 0);
    tremble(P, p, 1); pant(P, p, 5);
    return P;
  }
  // Backing off: the weight on the back foot, both palms out at chest height to keep you off, the head
  // forward watching you, a little step back and a little step back again.
  function backAwayPose(p) {
    const P = stance(p), s = Math.sin(2 * TAU * p);
    // rocking back onto the heels and forward again, the feet where they are
    ready(P, 0.7, 0.025 * (0.5 + 0.5 * s));
    setR(P, 'spine', -7 * DEG, 0, 0);
    set(P, 'R', A.palmR, 40 + 8 * s); set(P, 'L', A.palmL, 40 - 8 * s);
    setR(P, 'neck', 6 * DEG, 0, 0); setR(P, 'head', 4 * DEG, 0, 0);
    tremble(P, p, 0.5); pant(P, p, 4);
    return P;
  }
  // On the phone to the police: the phone at the right ear, the left hand going (out, to the head, out),
  // the weight going from foot to foot, the head turning to keep you in sight.
  function panicPhonePose(p) {
    const P = stance(p), s = Math.sin(2 * TAU * p);
    setR(P, 'pelvis', 0, 0, 3 * DEG * s);
    plant(P, feet, { weight: 0.5 + 0.32 * s });
    set(P, 'R', A.earR, 10);
    // the free hand: flung out on the beats, up to the head between them
    const beat = bump(p, 0.15, 0.06) + bump(p, 0.48, 0.05), head = held(p, 0.62, 0.86);
    armK(P, 'L', A.palmL, A.headTopL, head, 20 + 20 * beat);
    setR(P, 'uarmL', -14 * DEG * beat, 0, 0.25 * beat);
    setR(P, 'chest', 3 * DEG * beat, -6 * DEG * s, 0);
    setR(P, 'neck', 0, 18 * DEG * Math.sin(TAU * p), 0);
    setR(P, 'head', (4 - 8 * beat) * DEG, 14 * DEG * Math.sin(TAU * p + 0.4), 0);
    pant(P, p, 7);
    return P;
  }
  // Looking for a way out: the hands wringing at the chest, the head snapping one way and the other.
  function panicLookPose(p) {
    const P = stance(p), w = Math.sin(5 * TAU * p);
    ready(P, 0.4);
    set(P, 'R', A.wringR, -8 + 12 * w, 10 * w); set(P, 'L', A.wringL, -8 - 12 * w, -10 * w);
    // a glance held, a snap the other way, held, and back: steps, not a sweep
    const look = smooth(0.18, 0.24, p) - 2 * smooth(0.45, 0.5, p) + smooth(0.78, 0.84, p);
    setR(P, 'neck', 0, 22 * DEG * look, 0); setR(P, 'head', 2 * DEG, 26 * DEG * look, 0);
    setR(P, 'chest', 0, 8 * DEG * look, 0);
    pant(P, p, 8);
    return P;
  }
  // Pleading: the hands pressed together in front of the chest, bowing into it on each "please".
  function pleadPose(p) {
    const P = stance(p), b = bump(p, 0.2, 0.08) + bump(p, 0.55, 0.08) + 0.7 * bump(p, 0.82, 0.06);
    ready(P, 0.5);
    set(P, 'R', A.pleadR, 10); set(P, 'L', A.pleadL, 10);
    setR(P, 'uarmR', -10 * DEG * b, 0, 0); setR(P, 'uarmL', -10 * DEG * b, 0, 0);
    setR(P, 'spine', 8 * DEG * b, 0, 0); setR(P, 'chest', 4 * DEG * b, 0, 0);
    setR(P, 'head', (-6 + 10 * b) * DEG, 0, 0);
    tremble(P, p, 0.4);
    return P;
  }
  // Hands to the face: both palms on the cheeks, the body bent and pulled back, the mouth open.
  function screamPose(p) {
    const P = stance(p), k = held(p, 0.05, 0.9);
    ready(P, 0.6);
    setR(P, 'spine', -6 * DEG * k, 0, 0); setR(P, 'chest', -5 * DEG * k, 0, 0);
    set(P, 'R', A.cheekR, 0); set(P, 'L', A.cheekL, 0);
    setR(P, 'neck', -4 * DEG * k, 0, 0); setR(P, 'head', -10 * DEG * k, 6 * DEG * Math.sin(3 * TAU * p), 0);
    tremble(P, p, 0.8);
    return P;
  }
  // Shaken, after: a hand flat on the chest, the other on the hip, the head down, long breaths out.
  function shakenPose(p) {
    const P = stance(p), breath = Math.sin(TAU * p * 2);
    set(P, 'R', A.chestR, -4); set(P, 'L', A.hipL, -10);
    setR(P, 'spine', 4 * DEG, 0, 0); setR(P, 'chest', (3 - 3 * breath) * DEG, 0, 0);
    P.root[1] += 0.006 * breath;
    setR(P, 'neck', 8 * DEG, 0, 0); setR(P, 'head', (10 + 4 * breath) * DEG, 6 * DEG * Math.sin(TAU * p), 0);
    tremble(P, p, 0.25);
    return P;
  }

  // ── More to idle at ──
  // Scrolling a phone held low: the thumb going, the head down to it, the other hand in a pocket.
  function phoneScrollPose(p) {
    const P = poses.pockets(p), flick = Math.sin(3 * TAU * p);
    set(P, 'R', A.scrollR, -18 + 6 * Math.max(0, flick), 6 * flick);
    setR(P, 'neck', 14 * DEG, 0, 0); setR(P, 'head', (18 + 4 * bump(p, 0.7, 0.05)) * DEG, 4 * DEG * Math.sin(TAU * p), 0);
    return P;
  }
  // Thinking: the chin on the right hand, the left forearm across the body under the elbow, the head tipped.
  function chinPose(p) {
    const P = stance(p), tap = bump(p, 0.4, 0.03) + bump(p, 0.47, 0.03);
    set(P, 'R', A.chinR, -14 + 10 * tap); set(P, 'L', A.propL, -6);
    setR(P, 'head', (6 + 2 * Math.sin(TAU * p)) * DEG, 8 * DEG * Math.sin(TAU * p + 1), 4 * DEG);
    setR(P, 'chest', 2 * DEG, 0, 0);
    return P;
  }
  // Arms folded, the weight on the other leg, the fingers drumming on an arm, a glance at the door.
  function armsPose(p) {
    const P = poses.wait(p), d = Math.sin(9 * TAU * p) * held(p, 0.2, 0.5);
    setR(P, 'handR', 8 * DEG * d, 0, 0);
    setR(P, 'pelvis', 0, -3 * DEG, 4 * DEG);
    plant(P, feet, { weight: 0.74 });
    setR(P, 'head', 0, 24 * DEG * held(p, 0.6, 0.8), -4 * DEG);
    return P;
  }
  // Looking at the nails of the right hand, fingers curled back toward the face, then a rub on the shirt.
  function nailsPose(p) {
    const P = poses.pockets(p), rub = held(p, 0.62, 0.8);
    armK(P, 'R', A.nailsR, A.chestR, rub, 40 - 30 * rub, 8 * Math.sin(10 * TAU * p) * rub);
    setR(P, 'neck', 10 * DEG, 0, 0); setR(P, 'head', (16 - 6 * rub) * DEG, -6 * DEG, 0);
    return P;
  }
  // A hand back through the hair, from the forehead to the crown, once a cycle; the head tips back with it.
  function hairPose(p) {
    const P = stance(p), up = held(p, 0.15, 0.6), back = smooth(0.28, 0.5, p);
    const top = A.hairR.map((x, i) => lerp(x, A.hairBackR[i], back));
    armK(P, 'R', A.downR, top, up, -10); set(P, 'L', A.downL);
    setR(P, 'head', -8 * DEG * up * back, 0, 0);
    return P;
  }
  // Hands in the pockets, looking up and round the room, whistling something.
  function whistlePose(p) {
    const P = poses.pockets(p);
    setR(P, 'neck', -4 * DEG, 14 * DEG * Math.sin(TAU * p), 0);
    setR(P, 'head', (-8 + 3 * Math.sin(2 * TAU * p)) * DEG, 10 * DEG * Math.sin(TAU * p + 0.8), 3 * DEG * Math.sin(2 * TAU * p));
    P.root[1] += 0.006 * Math.max(0, Math.sin(4 * TAU * p));
    return P;
  }
  // The shoulders rolled back, one then the other, and the neck stretched to each side.
  function shouldersPose(p) {
    const P = stance(p);
    const r = held(p, 0.05, 0.35), l = held(p, 0.35, 0.65), n = held(p, 0.65, 0.92);
    set(P, 'R', [-2 - 25 * Math.sin(TAU * smooth(0.05, 0.4, p)) * r, 0, -0.07 - 0.15 * r, -20], -8);
    set(P, 'L', [-2 - 25 * Math.sin(TAU * smooth(0.35, 0.7, p)) * l, 0, 0.07 + 0.15 * l, -20], -8);
    setR(P, 'chest', -4 * DEG * (r + l), 0, 0);
    setR(P, 'neck', 0, 0, 14 * DEG * n * Math.sin(2 * TAU * p)); setR(P, 'head', 0, 0, 10 * DEG * n * Math.sin(2 * TAU * p));
    return P;
  }

  return [
    { name: 'startle', dur: 2.2, fn: startlePose, once: true, face: (p) => ({ open: 0.4 * smooth(0, 0.08, p) * (1 - 0.6 * smooth(0.3, 0.8, p)), round: 0.5 }) },
    { name: 'handsUp', dur: 3, fn: handsUpPose, face: () => ({ open: 0.15, round: 0.4 }) },
    { name: 'backAway', dur: 2.4, fn: backAwayPose, face: (p) => ({ open: 0.12 + 0.1 * bump(p, 0.3, 0.1), round: 0.3 }) },
    { name: 'panicPhone', dur: 4, fn: panicPhonePose, face: (p) => ({ open: 0.15 + 0.25 * Math.abs(Math.sin(5 * TAU * p)) }) },
    { name: 'panicLook', dur: 4, fn: panicLookPose, face: () => ({ open: 0.1, round: 0.3 }) },
    { name: 'plead', dur: 3, fn: pleadPose, face: (p) => ({ open: 0.25 * (bump(p, 0.2, 0.08) + bump(p, 0.55, 0.08)) }) },
    { name: 'scream', dur: 2.6, fn: screamPose, face: (p) => ({ open: 0.65 * held(p, 0.05, 0.85), round: 0.6 }) },
    { name: 'shaken', dur: 7, fn: shakenPose, face: (p) => ({ open: 0.1 * Math.max(0, Math.sin(2 * TAU * p)), round: 0.5 }) },
    // the ones that work in a chair
    { name: 'sitStartle', dur: 2.2, fn: sitOf(startlePose, -6), once: true, face: (p) => ({ open: 0.4 * smooth(0, 0.08, p), round: 0.5 }) },
    { name: 'sitPanicPhone', dur: 4, fn: sitOf(panicPhonePose, 4), face: (p) => ({ open: 0.15 + 0.25 * Math.abs(Math.sin(5 * TAU * p)) }) },
    { name: 'sitScream', dur: 2.6, fn: sitOf(screamPose, -4), face: (p) => ({ open: 0.6 * held(p, 0.05, 0.85), round: 0.6 }) },
    { name: 'sitPlead', dur: 3, fn: sitOf(pleadPose, 10) },
    { name: 'sitShaken', dur: 7, fn: sitOf(shakenPose, 10) },
    // idles
    { name: 'phoneScroll', dur: 8, fn: phoneScrollPose }, { name: 'sitScroll', dur: 8, fn: sitOf(phoneScrollPose, 12) },
    { name: 'idleChin', dur: 10, fn: chinPose }, { name: 'sitChin', dur: 10, fn: sitOf(chinPose, 10) },
    { name: 'idleArms', dur: 10, fn: armsPose },
    { name: 'idleNails', dur: 8, fn: nailsPose }, { name: 'sitNails', dur: 8, fn: sitOf(nailsPose, 8) },
    { name: 'idleHair', dur: 9, fn: hairPose },
    { name: 'idleWhistle', dur: 8, fn: whistlePose, face: () => ({ round: 0.9, open: 0.08 }) },
    { name: 'idleShoulders', dur: 9, fn: shouldersPose },
  ];
}

// What an emote line's act plays (client/shared/npc-acts.js names it), by how they are, for actor3d.js ACTOR_ACTS.
export const MOOD_ACTS = {
  startle: { stand: 'startle', sit: 'sitStartle' }, handsup: { stand: 'handsUp', sit: 'sitStartle' },
  backoff: { stand: 'backAway' }, callcops: { stand: 'panicPhone', sit: 'sitPanicPhone', lie: 'liePhone' },
  scan: { stand: 'panicLook' }, plead: { stand: 'plead', sit: 'sitPlead' }, scream: { stand: 'scream', sit: 'sitScream' },
  shaken: { stand: 'shaken', sit: 'sitShaken' }, think: { stand: 'idleChin', sit: 'sitChin' }, hair: { stand: 'idleHair' },
  whistle: { stand: 'idleWhistle' }, nails: { stand: 'idleNails', sit: 'sitNails' },
};
// The new idles, as [clip, how often], for actor3d.js ACTOR_IDLES.
export const MOOD_IDLES = {
  stand: [['phoneScroll', 1], ['idleChin', 0.6], ['idleArms', 1], ['idleNails', 0.4], ['idleHair', 0.4], ['idleWhistle', 0.4], ['idleShoulders', 0.4]],
  sit: [['sitScroll', 1], ['sitChin', 0.5], ['sitNails', 0.3]],
};
