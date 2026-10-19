// THE POSE LAB: Deadball's clips keyed by hand, on the real rig and the real player.
//
// A page of the Modelshop (npm run modelshop, then /pose-lab.html). It loads the clip library
// from content/animation_clips/ (GET /api/clips) and plays the clip under edit on a skinned player
// in the 3-D park (gl/ballpark.js), standing where his role stands, with the rest of the cast round
// him as stills. Everything about the clip is editable: its own fields, its keys and their
// tension, every field of each key's pose (the rig's pose language, diamond/rig.js), its events
// and its plants. A reference frame, a photo of the motion, can sit over the picture to pose
// against. The player can be a left-hander, or done at either end of the traits' ranges, which is
// where anim-smoke plays every clip too. A clip that travels (its `root`) carries him across the
// park as it plays, and the camera goes with him.
//
// Every edit is checked against the schema the bake uses (diamond/clip-schema.js validateClip),
// and the selected key against what a body can do. Save sends the clip to PUT /api/clips, which
// bakes the whole library with it before writing anything (scripts/shapes/bake-clips.mjs
// planSave), so this page can't write a clip the push gate refuses. The motion between the keys
// is anim-smoke's to judge.
//
// Nothing here is a second opinion: the player, the park, the clip player and the checks are the
// client's own modules.

import { createBallparkRenderer, castOf } from '/client/game/js/panels/gl/ballpark.js';
import { sampleClip, completePose, limitBreaks, TRAIT_RANGE } from '/client/game/js/panels/diamond/anim.js';
import { solvePose, POSES } from '/client/game/js/panels/diamond/rig.js';
import { validateClip, clipFileName, CLIP_ROLES, CLIP_EVENTS, POSE_FIELDS } from '/client/game/js/panels/diamond/clip-schema.js';
import { groundHeight, DEG } from '/client/game/js/panels/diamond/geo.js';
import { SHOTS } from '/client/game/js/panels/diamond/camera.js';
import { carried } from '/client/game/js/panels/diamond/world.js';

const $ = (id) => document.getElementById(id);
const copy = (v) => JSON.parse(JSON.stringify(v));
const r4 = (v) => Math.round(v * 1e4) / 1e4 || 0;
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;');

// ── the clip under edit ────────────────────────────────────────────────────────
let library = [];            // [{ file, doc }] as the server read them
let doc = null;              // the clip being edited
let saved = '';              // the clip as last loaded or saved, to tell an edit from none
let baked = null;            // `doc` ready to play: every key's pose completed (as the bake does)
let sel = 0;                 // the selected key
let t = 0, playing = false, speed = 1;
let laps = 0;                // how many laps a travelling loop has run since it started
const undo = [], redo = [];
let before = null;           // the clip as it was when a number started moving under the wheel

// The clip as the player plays it, or null while a key isn't a pose yet. A root that isn't one yet
// is left off, so the clip plays where it stands until it is.
const rootOk = (R) => Array.isArray(R) && R.length >= 2 && R.every((k) => k && Number.isFinite(k.t) && Array.isArray(k.at) && k.at.length === 2 && k.at.every(Number.isFinite) && Number.isFinite(k.yaw || 0));
function bake(d) {
  try {
    return {
      id: d.id, role: d.role, duration: d.duration, loop: !!d.loop, ...(d.moving ? { moving: d.moving } : {}),
      events: (d.events || []).map((e) => ({ ...e })).sort((a, b) => a.t - b.t),
      plants: (d.plants || []).map((p) => ({ ...p })).sort((a, b) => a.from - b.from),
      ...(rootOk(d.root) ? { root: d.root.map((k) => ({ t: k.t, at: k.at.slice(), ...(k.yaw ? { yaw: k.yaw } : {}) })) } : {}),
      keys: d.keys.map((k) => ({ t: k.t, ...(k.tension ? { tension: k.tension } : {}), pose: completePose(k.pose) })),
    };
  } catch { return null; }
}
// An edit: remember the clip as it was, then redraw everything that shows it. One that changes
// nothing (a field's change firing again as it loses focus) leaves the undo history alone, or
// undo would seem to do nothing.
function edit(fn) {
  const was = before || JSON.stringify(doc);
  before = null;
  fn(doc);
  if (JSON.stringify(doc) !== was) {
    undo.push(was);
    if (undo.length > 200) undo.shift();
    redo.length = 0;
  }
  changed();
}
function changed() {
  baked = bake(doc);
  sel = Math.max(0, Math.min(sel, doc.keys.length - 1));
  t = Math.max(0, Math.min(t, doc.duration));
  fillClip(); fillKeys(); fillPose();
  check();
  drawTimeline();
  draw();
}
function step(from, to) {
  if (!from.length) return;
  to.push(JSON.stringify(doc));
  const role = doc.role, travels = !!doc.root;
  doc = JSON.parse(from.pop());
  if (doc.role !== role || !!doc.root !== travels) place();
  changed();
}

// ── the checks ─────────────────────────────────────────────────────────────────
// The schema's verdict on the whole clip, and the selected key's joints.
function check() {
  const v = validateClip(doc, clipFileName(doc.id || 'clip'));
  const dirty = JSON.stringify(doc) !== saved;
  $('verdict').className = v.errors.length ? 'bad' : v.warnings.length ? 'warn' : 'good';
  $('verdict').textContent = v.errors.length ? `${v.errors.length} to fix before it can be saved` : v.warnings.length ? `saveable, ${v.warnings.length} to look at` : 'saveable';
  $('save').disabled = !!v.errors.length || !dirty;
  $('problems').innerHTML = [...v.errors.map((m) => `<li class="bad">${esc(m)}</li>`), ...v.warnings.map((m) => `<li class="warn">${esc(m)}</li>`)].join('');
  const k = doc.keys[sel];
  let breaks = [];
  try { const P = completePose(k.pose); breaks = limitBreaks(P, solvePose({ ...P, at: [0, 0, 0], yaw: 0 })); } catch (e) { breaks = ['not a pose yet: ' + e.message]; }
  $('joints').innerHTML = breaks.length ? breaks.map((m) => `<li class="bad">${esc(m)}</li>`).join('') : '<li class="good">inside every joint\'s limits</li>';
}

// ── the clip's own fields ──────────────────────────────────────────────────────
function fillClip() {
  $('id').value = doc.id;
  $('role').value = doc.role;
  $('duration').value = doc.duration;
  $('loop').checked = !!doc.loop;
  $('moving').value = doc.moving || '';
  $('note').value = doc.note || '';
  $('events').value = JSON.stringify(doc.events || [], null, 1).replace(/\n\s*/g, ' ').replace(/\}, \{/g, '},\n{');
  $('plants').value = JSON.stringify(doc.plants || [], null, 1).replace(/\n\s*/g, ' ').replace(/\}, \{/g, '},\n{');
  $('root').value = doc.root ? JSON.stringify(doc.root, null, 1).replace(/\n\s*/g, ' ').replace(/\}, \{/g, '},\n{') : '';
  $('events').classList.remove('bad'); $('plants').classList.remove('bad'); $('root').classList.remove('bad');
  // how far it goes and how fast, to match against the ground the keys have the feet cover
  const end = rootOk(doc.root) ? doc.root[doc.root.length - 1] : null, far = end ? Math.hypot(end.at[0], end.at[1]) : 0;
  $('roothint').textContent = end ? `it travels ${far.toFixed(2)} ft${doc.loop ? ' a lap' : ''}, ${(far / doc.duration).toFixed(1)} ft/s on average, and turns ${end.yaw || 0}°` : 'empty: the clip stays where it starts';
}
$('id').onchange = (e) => edit((d) => { d.id = e.target.value.trim(); });
$('role').onchange = (e) => edit((d) => { d.role = e.target.value; place(); });
$('duration').onchange = (e) => {
  const D = Number(e.target.value);
  if (!(D > 0)) return fillClip();
  // the keys keep their places in the motion: the clip stretches or squeezes to the new length
  edit((d) => {
    const k = D / d.duration;
    for (const x of d.keys) x.t = r4(x.t * k);
    for (const x of d.events || []) x.t = r4(x.t * k);
    for (const x of d.plants || []) { x.from = r4(x.from * k); x.to = Math.min(D, r4(x.to * k)); }
    if (d.keys.length > 1) d.keys[d.keys.length - 1].t = D;
    // the frame covers the same ground in the new time
    if (Array.isArray(d.root)) { for (const x of d.root) if (x && Number.isFinite(x.t)) x.t = r4(x.t * k); if (d.root.length > 1) d.root[d.root.length - 1].t = D; }
    d.duration = D;
  });
};
$('loop').onchange = (e) => edit((d) => { if (e.target.checked) d.loop = true; else delete d.loop; });
$('moving').onchange = (e) => edit((d) => { if (e.target.value) d.moving = e.target.value; else delete d.moving; });
$('note').onchange = (e) => edit((d) => { if (e.target.value.trim()) d.note = e.target.value.trim(); else delete d.note; });
for (const id of ['events', 'plants', 'root']) {
  $(id).onchange = (e) => {
    const travels = !!doc.root;
    // an empty root is a clip that doesn't travel
    if (id === 'root' && !e.target.value.trim()) edit((d) => { delete d.root; });
    else {
      let v;
      try { v = JSON.parse(e.target.value); } catch { e.target.classList.add('bad'); return; }
      if (!Array.isArray(v)) { e.target.classList.add('bad'); return; }
      edit((d) => { d[id] = v; });
    }
    if (!!doc.root !== travels) place();
  };
}
$('role').innerHTML = CLIP_ROLES.map((r) => `<option>${r}</option>`).join('');
$('eventkinds').textContent = Object.entries(CLIP_EVENTS).map(([k, x]) => (x.length ? `${k} (${x.join(', ')})` : k)).join(' · ');

// ── the keys ───────────────────────────────────────────────────────────────────
function fillKeys() {
  $('keys').innerHTML = doc.keys.map((k, i) => `<li class="${i === sel ? 'sel' : ''}" data-i="${i}">` +
    `<span>${i}</span><input type="number" step="0.01" value="${k.t}" data-f="t"${i === 0 ? ' disabled' : ''}>` +
    `<label>tension <input type="number" step="0.1" min="-1" max="1" value="${k.tension ?? 0}" data-f="tension"></label></li>`).join('');
}
$('keys').onclick = (e) => {
  const li = e.target.closest('li');
  if (!li || e.target.tagName === 'INPUT') return;
  sel = +li.dataset.i; seek(doc.keys[sel].t);
  fillKeys(); fillPose(); check(); drawTimeline(); draw();
};
$('keys').onchange = (e) => {
  const li = e.target.closest('li'), i = +li.dataset.i, v = Number(e.target.value);
  if (!Number.isFinite(v)) return fillKeys();
  edit((d) => {
    if (e.target.dataset.f === 't') {
      d.keys[i].t = v;
      // keep them in order, and the selection on the key that moved
      const k = d.keys[i];
      d.keys.sort((a, b) => a.t - b.t);
      sel = d.keys.indexOf(k);
    } else if (v) d.keys[i].tension = Math.max(-1, Math.min(1, v));
    else delete d.keys[i].tension;
  });
};
// The pose a clip holds at `at`, written back in the pose language: what a new key starts from.
function poseAt(at) {
  const P = sampleClip(baked, at, {});
  const out = {};
  for (const f of POSE_FIELDS) if (f in P) out[f] = copy(P[f]);
  for (const S of ['L', 'R']) delete out['plant' + S];
  return roundPose(out);
}
function roundPose(P) {
  const r = (v) => (Array.isArray(v) ? v.map(r) : typeof v === 'number' ? r4(v) : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, r(x)])) : v);
  return r(P);
}
$('addkey').onclick = () => {
  if (!baked) return;
  const at = r4(t);
  if (doc.keys.some((k) => Math.abs(k.t - at) < 1e-6)) return;
  edit((d) => { const k = { t: at, pose: poseAt(at) }; d.keys.push(k); d.keys.sort((a, b) => a.t - b.t); sel = d.keys.indexOf(k); });
};
$('dupkey').onclick = () => {
  const k = doc.keys[sel], next = doc.keys[sel + 1];
  const at = r4(next ? (k.t + next.t) / 2 : k.t);
  if (!next) return;
  edit((d) => { d.keys.splice(sel + 1, 0, { t: at, pose: copy(k.pose) }); sel++; });
};
$('delkey').onclick = () => {
  if (doc.keys.length < 2 || sel === 0) return;
  edit((d) => { d.keys.splice(sel, 1); sel = Math.max(0, sel - 1); });
};
$('grabkey').onclick = () => {
  if (!baked) return;
  edit((d) => { d.keys[sel].pose = poseAt(t); });
};

// ── the selected key's pose, field by field ────────────────────────────────────
// Positions are feet in the pose's frame (x his left, y up, z his front); angles are degrees;
// directions are any length (the bake makes them unit). Optional fields left out take the
// solver's defaults, which is what most keys want for knees, elbows, hands and toes.
const KIND = {
  pelvis: ['pos', 3, true], pitch: ['ang', 1], twist: ['ang', 1], roll: ['ang', 1],
  spine: ['ang', 3], chest: ['ang', 3], neck: ['ang', 3], head: ['ang', 3],
  ankL: ['ankle'], ankR: ['ankle'], plantL: ['flag'], plantR: ['flag'],
  toeL: ['dir', 3], toeR: ['dir', 3], kneeL: ['dir', 3], kneeR: ['dir', 3],
  wrL: ['wrist', 3], wrR: ['wrist', 3], elbL: ['dir', 3], elbR: ['dir', 3],
  handL: ['dir', 3], handR: ['dir', 3], palmL: ['dir', 3], palmR: ['dir', 3], bat: ['bat'],
};
const numbers = (f, vals, step, sub = '') => vals.map((v, i) => `<input type="number" step="${step}" value="${r4(v)}" data-f="${f}" data-i="${i}"${sub ? ` data-sub="${sub}"` : ''}>`).join('');
function fillPose() {
  const P = doc.keys[sel]?.pose;
  if (!P) { $('pose').innerHTML = ''; return; }
  $('keyname').textContent = `key ${sel} at ${doc.keys[sel].t} s`;
  const rows = [];
  for (const f of POSE_FIELDS) {
    const [kind, n, need] = KIND[f];
    // a field can be left out unless the pose needs it; one it needs but hasn't got can be put in
    const has = f in P, optional = !need && kind !== 'ankle' && (kind !== 'wrist' || !!P.bat || !has);
    const tick = optional ? `<input type="checkbox" data-have="${f}"${has ? ' checked' : ''} title="leave it out for the solver's own">` : '<span class="need"></span>';
    let body = '';
    if (kind === 'flag') body = has ? `<select data-f="${f}"><option value="true"${P[f] ? ' selected' : ''}>planted</option><option value="false"${P[f] ? '' : ' selected'}>free</option></select>` : '';
    else if (kind === 'ankle') {
      const a = P[f], down = a.length === 2;
      body = `<label class="mini"><input type="checkbox" data-ground="${f}"${down ? ' checked' : ''}> on the ground</label>` + (down ? numbers(f, [a[0], a[1]], 0.01) : numbers(f, a, 0.01));
    } else if (kind === 'bat') {
      body = has ? `knob ${numbers(f, P.bat.knob, 0.01, 'knob')} dir ${numbers(f, P.bat.dir, 0.01, 'dir')} <select data-f="bat" data-sub="bottom"><option${P.bat.bottom !== 'R' ? ' selected' : ''}>L</option><option${P.bat.bottom === 'R' ? ' selected' : ''}>R</option></select> low hand` : '';
    } else if (has) body = numbers(f, kind === 'ang' && n === 1 ? [P[f]] : P[f], kind === 'ang' ? 1 : 0.01);
    rows.push(`<div class="row${has ? '' : ' off'}">${tick}<b>${f}</b><span>${body}</span></div>`);
  }
  $('pose').innerHTML = rows.join('');
}
const DEFAULTS = {
  pitch: 0, twist: 0, roll: 0, spine: [0, 0, 0], chest: [0, 0, 0], neck: [0, 0, 0], head: [0, 0, 0],
  plantL: true, plantR: true, toeL: [0, 0, 1], toeR: [0, 0, 1], kneeL: [0, 0, 1], kneeR: [0, 0, 1],
  elbL: [0.4, -0.2, -1], elbR: [-0.4, -0.2, -1], handL: [0, -1, 0], handR: [0, -1, 0], palmL: [-1, 0, 0], palmR: [1, 0, 0],
  wrL: [0.84, 2.95, 0.12], wrR: [-0.84, 2.95, 0.12], bat: { knob: [-0.62, 4.5, 1.02], dir: [0.1, 0.9, -0.4], bottom: 'L' },
};
$('pose').onchange = (e) => {
  const el = e.target, P = doc.keys[sel].pose;
  if (el.dataset.have) {
    const f = el.dataset.have;
    // a field put in starts where the solver had it, so nothing jumps
    let from = DEFAULTS[f];
    try { const C = completePose(P); if (f in C) from = C[f]; } catch { /* the default */ }
    return edit((d) => { const Q = d.keys[sel].pose; if (el.checked) Q[f] = roundPose(copy(from)); else delete Q[f]; });
  }
  if (el.dataset.ground) {
    const f = el.dataset.ground;
    return edit((d) => { const a = d.keys[sel].pose[f]; d.keys[sel].pose[f] = el.checked ? [a[0], a[2]] : [a[0], 0.28, a[1]]; });
  }
  const f = el.dataset.f;
  if (!f) return;
  edit((d) => {
    const Q = d.keys[sel].pose;
    if (KIND[f][0] === 'flag') { Q[f] = el.value === 'true'; return; }
    if (el.dataset.sub === 'bottom') { Q.bat.bottom = el.value; return; }
    const v = Number(el.value);
    if (!Number.isFinite(v)) return;
    if (el.dataset.sub) Q.bat[el.dataset.sub][+el.dataset.i] = v;
    else if (KIND[f][0] === 'ang' && KIND[f][1] === 1) Q[f] = v;
    else Q[f][+el.dataset.i] = v;
  });
};
// a number dragged with the wheel moves the player as it goes
$('pose').addEventListener('input', (e) => {
  if (e.target.type !== 'number' || !e.target.dataset.f) return;
  const v = Number(e.target.value), f = e.target.dataset.f, Q = doc.keys[sel].pose;
  if (!Number.isFinite(v)) return;
  before ??= JSON.stringify(doc);
  if (e.target.dataset.sub) Q.bat[e.target.dataset.sub][+e.target.dataset.i] = v;
  else if (KIND[f][0] === 'ang' && KIND[f][1] === 1) Q[f] = v;
  else if (Array.isArray(Q[f])) Q[f][+e.target.dataset.i] = v;
  baked = bake(doc);
  seek(doc.keys[sel].t);
  draw();
});

// ── the park, the player and the camera ────────────────────────────────────────
const canvas = $('view');
let R = null, raf = 0, lastNow = 0, frameOf = null, castNow = null;
const lab = { lefty: false, traits: 'none' };
// Where the clip's player stands and which body he is: the cast's own man for a role that has one
// on the field, and for a role with nobody there (a runner with the bases empty, anyone) the
// batter's body: out on the grass in front of the plate, facing it, or for a clip that travels a
// step out of the box, facing first, with the base path to run down.
function place() {
  if (!R) return;
  const p = { half: 'top', inning: 1, batter: 'Pose Lab', pitcher: 'Pose Lab Arm', bats: lab.lefty ? 'L' : 'R', throws: lab.lefty ? 'L' : 'R', battingTeam: 'Rats', fieldingTeam: 'Kings', basesBefore: [false, false, false] };
  castNow = castOf(p);
  R.setCast(castNow, { home: 'Kings', away: 'Rats' });
  const role = doc?.role || 'any';
  const by = (r) => castNow.find((c) => c.look.role === r);
  const own = role === 'ump' ? castNow.find((c) => c.id === 'ump:plate') : by(role);
  const c = own || by('batter');
  frameOf = own ? { slot: c.look.slot, at: c.at, yaw: c.yaw, scale: c.scale, mirror: c.mirror }
    : doc?.root ? { slot: c.look.slot, at: [-2, 0, 2], yaw: -45, scale: 1, mirror: lab.lefty }
      : { slot: c.look.slot, at: [0, 0, 22], yaw: 180, scale: 1, mirror: lab.lefty };
  aim();
  draw();
}
const groundFor = (f) => (x, z) => {
  const c = Math.cos(f.yaw * DEG), s = Math.sin(f.yaw * DEG);
  return groundHeight(f.at[0] + c * x + s * z, f.at[2] - s * x + c * z) - f.at[1];
};
function traitsNow() {
  if (lab.traits === 'none') return null;
  const end = lab.traits === 'low' ? 0 : 1;
  return Object.fromEntries(Object.entries(TRAIT_RANGE).map(([k, v]) => [k, v[end]]));
}
// Where the clip has carried him by the playhead (world.js carried): his place, for a clip that
// doesn't travel. A travelling loop runs lap after lap while it plays, and starts again from his
// place once the next lap would take it more than a base path from there; moving the playhead by
// hand starts it again too.
const RUN_ROOM = 90;
function seek(s) { t = s; laps = 0; syncTime(); }
const carriedNow = () => (frameOf && baked ? { ...frameOf, ...carried(frameOf, baked, 0, 1, laps * baked.duration + t, frameOf.mirror) } : frameOf);
// The camera: an orbit round the player, going with him as he travels, or one of the broadcast's
// shots by name.
const cam = { az: 0, el: 10, dist: 13, shot: null, focus: [0, 3, 0] };
function aim() { const f = carriedNow(); if (f) cam.focus = [f.at[0], f.at[1] + 3, f.at[2]]; }
function shotNow() {
  if (cam.shot) return cam.shot;
  const a = cam.az * DEG, e = cam.el * DEG, f = cam.focus;
  const eye = [f[0] + Math.sin(a) * Math.cos(e) * cam.dist, f[1] + Math.sin(e) * cam.dist, f[2] + Math.cos(a) * Math.cos(e) * cam.dist];
  return { eye, at: f, fov: 34, near: 0.5, shadow: [f, 9] };
}
function view(name) {
  if (SHOTS[name]) { cam.shot = name; return draw(); }
  cam.shot = null;
  const yaw = carriedNow()?.yaw ?? 0;
  ({ front: () => { cam.az = yaw; cam.el = 8; }, left: () => { cam.az = yaw + 90; cam.el = 8; }, back: () => { cam.az = yaw + 180; cam.el = 8; },
    right: () => { cam.az = yaw - 90; cam.el = 8; }, top: () => { cam.el = 82; } })[name]?.();
  draw();
}
let drag = null;
canvas.addEventListener('pointerdown', (e) => { drag = { x: e.clientX, y: e.clientY, az: cam.az, el: cam.el }; canvas.setPointerCapture(e.pointerId); });
canvas.addEventListener('pointermove', (e) => {
  if (!drag) return;
  cam.shot = null;
  cam.az = drag.az - (e.clientX - drag.x) * 0.4;
  cam.el = Math.max(-10, Math.min(85, drag.el + (e.clientY - drag.y) * 0.3));
  draw();
});
canvas.addEventListener('pointerup', () => { drag = null; });
canvas.addEventListener('wheel', (e) => { e.preventDefault(); cam.shot = null; cam.dist = Math.max(3, Math.min(80, cam.dist * Math.exp(e.deltaY * 0.001))); draw(); }, { passive: false });

function draw() { if (R && !raf) raf = requestAnimationFrame(frame); }
function frame(now) {
  raf = 0;
  if (!R || R.lost) return;
  if (R.pending() && R.pump(14)) { lastNow = now; draw(); return; }
  const dt = Math.min(0.1, Math.max(0, (now - (lastNow || now)) / 1000));
  lastNow = now;
  if (playing && baked) {
    t += dt * speed;
    if (t > baked.duration) {
      if (baked.loop) {
        laps += Math.floor(t / baked.duration);
        t %= baked.duration;
        const end = baked.root?.[baked.root.length - 1].at, lap = end ? Math.hypot(end[0], end[1]) : 0;
        if (!lap || (laps + 1) * lap > RUN_ROOM) laps = 0;
      } else t = 0;
    }
    syncTime();
  }
  paint();
  if (playing) draw();
}
// The player in his pose at the playhead, and the picture.
function paint() {
  if (baked && frameOf) {
    const f = carriedNow();
    if (baked.root && !cam.shot) cam.focus = [f.at[0], f.at[1] + 3, f.at[2]];
    try {
      const P = sampleClip(baked, t, { ground: groundFor(f), scale: f.scale, traits: traitsNow(), mirror: f.mirror });
      R.setPose(f.slot, { ...P, at: f.at, yaw: f.yaw, scale: f.scale });
    } catch (err) { $('verdict').textContent = 'won\'t play: ' + err.message; $('verdict').className = 'bad'; }
  }
  const w = canvas.clientWidth, h = canvas.clientHeight, k = Math.min(devicePixelRatio || 1, 2);
  if (canvas.width !== Math.round(w * k) || canvas.height !== Math.round(h * k)) { canvas.width = Math.round(w * k); canvas.height = Math.round(h * k); }
  R.render(shotNow());
}
// The frame at the playhead drawn now and saved as `name`.png in the OS temp dir (the Modelshop's
// /api/shot), every body built first. The canvas is read in the same task as the draw: the park's
// context doesn't keep its drawing buffer, so a read after the frame is shown gets nothing.
async function shoot(name, from = null) {
  if (!R || R.lost) return null;
  if (!from) { while (R.pending() && R.pump(200)); paint(); }
  const blob = await new Promise((r) => (from || canvas).toBlob(r, 'image/png'));
  const res = await fetch('/api/shot?name=' + encodeURIComponent(name), { method: 'POST', headers: { 'content-type': 'image/png' }, body: blob });
  return res.json();
}
// The frame at clip time `at` drawn now and copied onto a canvas of its own, for a script to lay
// several out side by side and `shoot(name, sheet)` them as one.
function still(at) {
  if (!R || R.lost) return null;
  seek(at);
  while (R.pending() && R.pump(200));
  paint();
  const c = document.createElement('canvas');
  c.width = canvas.width; c.height = canvas.height;
  c.getContext('2d').drawImage(canvas, 0, 0);
  return c;
}

// ── the timeline ───────────────────────────────────────────────────────────────
// The keys as ticks (the selected one lit), the events as flags, each foot's plants as a bar,
// and the playhead. Click or drag to scrub; click a tick to select its key.
const tl = $('timeline');
function drawTimeline() {
  const k = devicePixelRatio || 1, w = tl.clientWidth, h = tl.clientHeight;
  if (tl.width !== Math.round(w * k)) { tl.width = Math.round(w * k); tl.height = Math.round(h * k); }
  const g = tl.getContext('2d');
  g.setTransform(k, 0, 0, k, 0, 0);
  g.clearRect(0, 0, w, h);
  if (!doc) return;
  const D = doc.duration, X = (s) => 10 + (w - 20) * (s / D);
  g.fillStyle = '#151827'; g.fillRect(0, 0, w, h);
  g.fillStyle = '#5a6080'; g.font = '10px ui-monospace, monospace';
  for (let s = 0; s <= D + 1e-9; s += D > 4 ? 1 : 0.1) { g.fillRect(X(s), h - 10, 1, 4); if (D <= 4 ? Math.abs(s * 10 - Math.round(s * 10)) < 1e-6 && Math.round(s * 10) % 5 === 0 : true) g.fillText(s.toFixed(D > 4 ? 0 : 1), X(s) + 2, h - 1); }
  for (const p of doc.plants || []) {
    if (!Number.isFinite(p.from) || !Number.isFinite(p.to)) continue;
    g.fillStyle = p.foot === 'L' ? '#2f6a4a' : '#6a4a2f';
    g.fillRect(X(p.from), p.foot === 'L' ? 30 : 38, X(p.to) - X(p.from), 6);
  }
  for (const e of doc.events || []) {
    if (!Number.isFinite(e.t)) continue;
    g.fillStyle = '#e8c070'; g.fillRect(X(e.t), 4, 2, 22); g.fillText(e.kind, X(e.t) + 4, 12);
  }
  doc.keys.forEach((key, i) => { g.fillStyle = i === sel ? '#8fb4ff' : '#c8c4b8'; g.fillRect(X(key.t) - 2, 18, 4, 10); });
  g.fillStyle = '#ff5050'; g.fillRect(X(t) - 1, 0, 2, h);
}
function scrubTo(e) {
  const r = tl.getBoundingClientRect(), s = ((e.clientX - r.left) - 10) / (r.width - 20) * doc.duration;
  t = Math.max(0, Math.min(doc.duration, s)); laps = 0;
  const near = doc.keys.findIndex((k) => Math.abs(((k.t / doc.duration) * (r.width - 20)) - (e.clientX - r.left - 10)) < 5);
  if (near >= 0 && near !== sel) { sel = near; t = doc.keys[near].t; fillKeys(); fillPose(); check(); }
  syncTime(); drawTimeline(); draw();
}
let scrubbing = false;
tl.addEventListener('pointerdown', (e) => { scrubbing = true; tl.setPointerCapture(e.pointerId); scrubTo(e); });
tl.addEventListener('pointermove', (e) => { if (scrubbing) scrubTo(e); });
tl.addEventListener('pointerup', () => { scrubbing = false; });
function syncTime() { $('time').textContent = `${t.toFixed(3)} s`; drawTimeline(); }
$('play').onclick = () => { playing = !playing; $('play').textContent = playing ? '❚❚ pause' : '▶ play'; lastNow = 0; draw(); };
$('speed').onchange = (e) => { speed = Number(e.target.value) || 1; };

// ── the reference frame ────────────────────────────────────────────────────────
// A still of the real motion over the picture, to pose against. It stays in this browser.
const ref = $('ref');
function showRef(file) {
  if (!file || !file.type.startsWith('image/')) return;
  if (ref.src) URL.revokeObjectURL(ref.src);
  ref.src = URL.createObjectURL(file);
  ref.hidden = false;
  refStyle();
}
function refStyle() {
  ref.style.opacity = $('refop').value;
  ref.style.transform = `translate(${$('refx').value}%, ${$('refy').value}%) scale(${$('refscale').value})${$('refflip').checked ? ' scaleX(-1)' : ''}`;
}
$('reffile').onchange = (e) => showRef(e.target.files[0]);
for (const id of ['refop', 'refx', 'refy', 'refscale', 'refflip']) $(id).oninput = refStyle;
$('refoff').onclick = () => { ref.hidden = true; };
$('stage').addEventListener('dragover', (e) => e.preventDefault());
$('stage').addEventListener('drop', (e) => { e.preventDefault(); showRef(e.dataTransfer.files[0]); });

// ── the library: load, new, save ───────────────────────────────────────────────
async function loadLibrary(pick) {
  const res = await fetch('/api/clips');
  library = (await res.json()).clips || [];
  const roles = [...new Set(library.map((c) => c.doc.role))];
  $('clip').innerHTML = roles.map((r) => `<optgroup label="${r}">${library.filter((c) => c.doc.role === r).map((c) => `<option value="${esc(c.doc.id)}">${esc(c.doc.id)}</option>`).join('')}</optgroup>`).join('');
  if (pick) $('clip').value = pick;
}
function open(d) {
  doc = copy(d);
  saved = JSON.stringify(doc);
  undo.length = 0; redo.length = 0;
  sel = 0; t = 0; laps = 0;
  place();
  changed();
  view('front');
}
$('clip').onchange = (e) => {
  if (doc && JSON.stringify(doc) !== saved && !confirm(`Leave ${doc.id} without saving?`)) { e.target.value = doc.id; return; }
  const c = library.find((x) => x.doc.id === e.target.value);
  if (c) open(c.doc);
};
// A new clip starts from its role's still, or a pitcher's from the look-dev's six-frame delivery
// (the blocking the plan says a session starts from), or as a copy of the clip on screen.
const STILL = { pitcher: 'pSet', batter: 'batStance', catcher: 'catcher', ump: 'umpire', fielder: 'infield', runner: 'runner', coach: 'coach', any: 'stand' };
$('new').onclick = () => {
  const id = (prompt('The new clip\'s id (lower case, digits and underscores):', doc ? doc.id + '_2' : 'new_clip') || '').trim();
  if (!id) return;
  if (library.some((c) => c.doc.id === id)) { alert(`${id} is already in the library; pick it from the list to edit it.`); return; }
  const how = (prompt('Start from: "still" (the role\'s stance), "copy" (this clip) or "delivery" (the look-dev\'s pitch, for a pitcher):', 'still') || '').trim();
  const role = how === 'delivery' ? 'pitcher' : doc?.role || 'any';
  let d;
  if (how === 'copy' && doc) d = { ...copy(doc), id };
  else if (how === 'delivery') {
    const at = [0, 0.6, 1.05, 1.3, 1.44, 2.0];
    d = { id, role, duration: 2.0, events: [{ t: 1.44, kind: 'release', hand: 'R', dir: [1, -0.03, 0] }], plants: [], keys: ['pSet', 'pLift', 'pStride', 'pCocked', 'pRelease', 'pFollow'].map((n, i) => ({ t: at[i], pose: roundPose(POSES[n]()) })) };
  } else d = { id, role, duration: 1, events: [], plants: [], keys: [{ t: 0, pose: roundPose(POSES[STILL[role]]()) }, { t: 1, pose: roundPose(POSES[STILL[role]]()) }] };
  open(d);
  saved = '';
  check();
};
$('save').onclick = async () => {
  $('save').disabled = true;
  $('verdict').textContent = 'saving…';
  const res = await fetch('/api/clips', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ doc }) });
  const out = await res.json().catch(() => ({ errors: ['the server sent something that isn\'t JSON'] }));
  if (res.ok) {
    saved = JSON.stringify(doc);
    await loadLibrary(doc.id);
    check();
    $('verdict').textContent = `saved ${out.file} and baked the library${out.warnings?.length ? `, ${out.warnings.length} to look at` : ''}`;
  } else {
    check();
    $('verdict').className = 'bad';
    $('verdict').textContent = 'not saved: the bake refused it';
    $('problems').innerHTML = (out.errors || [out.error]).map((m) => `<li class="bad">${esc(m)}</li>`).join('');
  }
};

// ── the bar ────────────────────────────────────────────────────────────────────
$('lefty').onchange = (e) => { lab.lefty = e.target.checked; place(); };
$('traits').onchange = (e) => { lab.traits = e.target.value; draw(); };
for (const b of document.querySelectorAll('[data-view]')) b.onclick = () => view(b.dataset.view);
document.addEventListener('keydown', (e) => {
  if (e.target.closest('input, textarea, select')) return;
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); step(e.shiftKey ? redo : undo, e.shiftKey ? undo : redo); }
  else if (e.key === ' ') { e.preventDefault(); $('play').click(); }
  else if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
    // to the key before or after
    const i = Math.max(0, Math.min(doc.keys.length - 1, sel + (e.key === 'ArrowLeft' ? -1 : 1)));
    sel = i; seek(doc.keys[i].t); fillKeys(); fillPose(); check(); draw();
  }
});
window.addEventListener('beforeunload', (e) => { if (doc && JSON.stringify(doc) !== saved) e.preventDefault(); });
window.addEventListener('resize', () => { drawTimeline(); draw(); });

// ── start ──────────────────────────────────────────────────────────────────────
R = createBallparkRenderer(canvas, { ads: ['POSE LAB', 'DEADBALL', 'POSE LAB', 'DEADBALL'] });
if (!R) $('verdict').textContent = 'no WebGL2 here: the Pose Lab draws with the 3-D park';
await loadLibrary();
const first = new URLSearchParams(location.search).get('clip');
const pick = library.find((c) => c.doc.id === first) || library[0];
if (pick) { $('clip').value = pick.doc.id; open(pick.doc); }
// for a look from a script: which clip is open, the playhead, the camera (an orbit's az, el and
// dist round its focus, or a broadcast shot by name), the renderer, `still` and `shoot`
window.__lab = { get doc() { return doc; }, get t() { return t; }, set t(v) { seek(v); draw(); }, set laps(v) { laps = v; draw(); }, view, cam, still, shoot, get renderer() { return R; } };
