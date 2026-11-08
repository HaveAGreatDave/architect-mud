// THOMAS · SEQUENCES. A 3-D scene for a broadcast, as data: a set, who's on it, and a list of beats
// (docs/proposals/broadcast-3d.md). Nothing here knows a sport. A show says which sequence plays
// when and hands it a data object; `{home}` in a line or a graphic is that object's `home`.
//
// Three documents, each a media_graphics row (`type` is the kind, `content` the JSON):
//   set       a room: its size, pieces, marks people stand on and the cameras that shoot it
//   sequence  a set, its roles, and its beats. A beat is one shot: a camera, a framing, who speaks,
//             what they say and what's on screen. A spoken beat lasts as long as its line, so a
//             sequence is a shot list, never a timeline in seconds
//   show      a broadcast's entry: its cast, and which sequence plays at which of its slots
//
// A beat, a graphic and a show's slot can each carry `if`: conditions on the data, so one show plays
// differently on a blowout, a tied game or a night somebody fought. A table can run over a list in the
// data, and a profile can point at a person in it, so what's on screen comes off the feed
// (plugins/broadcast/sports/facts.js) and nobody types a score.
//
// The tables below are what the Broadcast Studio builds its forms from, so a new framing, move or
// graphic is a row here and a drawing function in sequence-gfx.js, with nothing to add to the editor.
//
// Pure: no DOM, no GL. The client, the server (plugins/broadcast/sequences.js), the Studio and the
// gate (scripts/shapes/sequence.mjs) all run it.

export const SEQ_FORMAT = 1;

// A framing is how much of a subject fits top to bottom, in metres. `null` covers the whole set.
export const FRAMES = Object.freeze({
  full: { label: 'Whole set', cover: null },
  wide: { label: 'Wide', cover: 3.0 },
  two: { label: 'Two-shot', cover: 1.5 },
  medium: { label: 'Medium', cover: 0.95 },
  close: { label: 'Close-up', cover: 0.54 },
  tight: { label: 'Tight', cover: 0.34 },
});

// A move runs across the beat, eased. `amt` scales it.
export const MOVES = Object.freeze({
  none: { label: 'Locked off' },
  drift: { label: 'Slow drift' },
  push: { label: 'Push in' },
  pull: { label: 'Pull out' },
  pan: { label: 'Pan' },
  truck: { label: 'Truck' },
  crane: { label: 'Crane down' },
  orbit: { label: 'Orbit' },
  handheld: { label: 'Handheld' },
});

export const CUTS = Object.freeze({
  cut: { label: 'Cut', ms: 0 },
  dissolve: { label: 'Dissolve', ms: 500 },
  dip: { label: 'Dip to black', ms: 700 },
  wipe: { label: 'Wipe', ms: 420 },
});

// What a person does in a beat. `auto` is talking when it's their line and listening when it isn't.
export const ACTS = Object.freeze({
  auto: 'Automatic', sitRest: 'Sit, hands resting', sitClasp: 'Sit, hands clasped', sitLean: 'Sit, leaning in',
  sitBack: 'Sit back', idle: 'Stand', talk: 'Stand and talk', listen: 'Stand and listen', wave: 'Wave', cheer: 'Cheer',
});

// Where a person looks: 'camera', a role, or nothing for their own idle glance.
export const LOOKS = Object.freeze({ auto: 'Automatic', camera: 'To camera', screen: 'At the screen' });

// A field is { k: key, label, type: text | lines | number | select | source | rows, opts }. `at` is
// seconds into the beat, `for` how long it stays up (0 is to the end of the beat).
const TIMED = [{ k: 'at', label: 'In at (s)', type: 'number' }, { k: 'for', label: 'Stays (s, 0 = the beat)', type: 'number' }];
const SIDE = { k: 'side', label: 'Side', type: 'select', opts: ['left', 'right'] };
const CORNER = { k: 'corner', label: 'Corner', type: 'select', opts: ['top-left', 'top-right', 'bottom-left', 'bottom-right'] };

export const GFX = Object.freeze({
  lower: { label: 'Lower third', icon: '▁', fields: [{ k: 'text', label: 'Name', type: 'text' }, { k: 'sub', label: 'Title', type: 'text' }, ...TIMED], make: { text: '{speaker.name}', sub: '', at: 0.4, for: 5 } },
  box: { label: 'Over-the-shoulder box', icon: '▣', fields: [{ k: 'source', label: 'Shows', type: 'source' }, { k: 'title', label: 'Caption', type: 'text' }, SIDE, ...TIMED], make: { source: 'feed', title: '', side: 'right', at: 0, for: 0 } },
  pip: { label: 'Picture in picture', icon: '◰', fields: [{ k: 'source', label: 'Shows', type: 'source' }, { k: 'title', label: 'Caption', type: 'text' }, CORNER, ...TIMED], make: { source: 'cam:cam1', title: '', corner: 'top-right', at: 0, for: 0 } },
  profile: { label: 'Player profile', icon: '☺', fields: [{ k: 'who', label: 'Who, from the data', type: 'person' }, { k: 'name', label: 'Or a name', type: 'text' }, { k: 'num', label: 'Number', type: 'text' }, { k: 'role', label: 'Position or role', type: 'text' }, { k: 'club', label: 'Club', type: 'text' }, { k: 'colour', label: 'Colour', type: 'text' }, { k: 'stats', label: 'Stats (label: value)', type: 'rows' }, SIDE, ...TIMED], make: { who: 'star', side: 'left', at: 0.3, for: 0 } },
  score: { label: 'Score panel', icon: '#', fields: [{ k: 'title', label: 'Above', type: 'text' }, { k: 'left', label: 'Left name', type: 'text' }, { k: 'leftScore', label: 'Left score', type: 'text' }, { k: 'right', label: 'Right name', type: 'text' }, { k: 'rightScore', label: 'Right score', type: 'text' }, { k: 'sub', label: 'Below', type: 'text' }, ...TIMED], make: { title: '{status}', left: '{away}', leftScore: '{awayScore}', right: '{home}', rightScore: '{homeScore}', sub: '{venue}', at: 0, for: 0 } },
  table: { label: 'Table', icon: '☰', fields: [{ k: 'title', label: 'Heading', type: 'text' }, { k: 'list', label: 'One row for each', type: 'list' }, { k: 'row', label: 'Each row (left: right)', type: 'text' }, { k: 'limit', label: 'At most', type: 'number' }, { k: 'rows', label: 'Or fixed rows (left: right)', type: 'rows' }, SIDE, ...TIMED], make: { title: 'Tonight', rows: ['{away}: {awayRecord}', '{home}: {homeRecord}'], side: 'right', at: 0.3, for: 0 } },
  full: { label: 'Full-screen card', icon: '■', fields: [{ k: 'title', label: 'Title', type: 'text' }, { k: 'sub', label: 'Under it', type: 'text' }, ...TIMED], make: { title: '{show}', sub: '', at: 0, for: 0 } },
  ticker: { label: 'Ticker', icon: '»', fields: [{ k: 'text', label: 'Text', type: 'text' }, ...TIMED], make: { text: '', at: 0, for: 0 } },
});

// What a box or a picture-in-picture can show: `feed` is the live programme (the game), `cam:<id>`
// another of the set's cameras, `wall` what's on the set's screen, `photo:<name>` a person.
export const sourceKind = (s) => String(s || '').split(':')[0];

// ── Reading a document ─────────────────────────────────────────────────────────────────────────
export function parseDoc(text) {
  if (text && typeof text === 'object') return text;
  try { const d = JSON.parse(String(text)); return d && typeof d === 'object' ? d : null; } catch { return null; }
}

const hash = (s) => { let h = 2166136261; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 16777619); return h >>> 0; };

// `{a.b}` is the data's a.b; `{speaker.name}` needs `speaker` in the data, which timeline() sets per beat.
const TOKEN = /\{([\w.]+)\}/g;
export const dig = (data, path) => { let v = data; for (const k of String(path).split('.')) { if (v == null) return undefined; v = v[k]; } return v; };
export function fill(text, data = {}) {
  return String(text ?? '').replace(TOKEN, (m, p) => { const v = dig(data, p); return v == null || typeof v === 'object' ? '' : String(v); });
}
export const tokensIn = (text) => [...String(text ?? '').matchAll(TOKEN)].map((m) => m[1]);
// A line with a token the data can't fill would air with a hole in it, so it's never picked.
export const fillable = (text, data = {}) => tokensIn(text).every((p) => { const v = dig(data, p); return v != null && v !== '' && typeof v !== 'object'; });

// A condition is { fact, op, value }. A list of them has to all pass, and none always does. A fact
// the data hasn't got fails everything but `missing`, so a beat waits for its fact.
export const OPS = Object.freeze({ '=': 'is', '!=': 'is not', '>': 'over', '>=': 'at least', '<': 'under', '<=': 'at most', has: 'exists', missing: "doesn't exist" });
const asValue = (v) => (v === 'true' ? true : v === 'false' ? false : v !== '' && v != null && Number.isFinite(+v) ? +v : v);
const present = (v) => !(v == null || v === '' || v === false || v === 0 || (Array.isArray(v) && !v.length));
export function passes(conds, data = {}) {
  for (const c of conds || []) {
    if (!c?.fact) continue;
    const got = dig(data, c.fact), v = asValue(c.value), n = Array.isArray(got) ? got.length : got;
    const ok = c.op === 'has' ? present(got) : c.op === 'missing' ? !present(got)
      : got === undefined ? false
        : c.op === '!=' ? n !== v : c.op === '>' ? n > v : c.op === '>=' ? n >= v : c.op === '<' ? n < v : c.op === '<=' ? n <= v : n === v;
    if (!ok) return false;
  }
  return true;
}

// Every dotted path the data can answer, for the editor's token list. A list shows its length and
// its first row, since `{goals.0.player}` is a fine thing to say.
export function tokenPaths(data, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(data || {})) {
    if (Array.isArray(v)) { out.push(`${prefix}${k}.length`); if (v[0] && typeof v[0] === 'object') out.push(...tokenPaths(v[0], `${prefix}${k}.0.`)); } else if (v && typeof v === 'object') out.push(...tokenPaths(v, prefix + k + '.'));
    else out.push(prefix + k);
  }
  return out;
}
// The data's lists, and the people in it (anything with a name), for the editor's pickers.
export const listPaths = (data) => Object.entries(data || {}).filter(([, v]) => Array.isArray(v)).map(([k]) => k);
export const peoplePaths = (data) => Object.entries(data || {}).filter(([, v]) => v && typeof v === 'object' && !Array.isArray(v) && v.name).map(([k]) => k);

// A table's rows: its list, one row each with the row's own fields as tokens, or its fixed rows.
export function tableRows(g, data = {}) {
  if (g.list) {
    const list = dig(data, g.list);
    if (!Array.isArray(list)) return [];
    return list.slice(0, g.limit || 8).map((r) => fill(g.row || '{name}', { ...data, ...r }));
  }
  return (g.rows || []).map((r) => fill(r, data));
}
// Who a profile shows: the person it points at, or what it spells out.
export function profileOf(g, data = {}) {
  const p = g.who ? dig(data, g.who) : null;
  if (p?.name) return { name: p.name, num: p.num ?? '', role: p.pos ?? '', club: p.team ?? '', colour: p.colour ?? '', stats: p.stats || [], tonight: p.tonight || '', person: p };
  return { name: fill(g.name, data), num: fill(g.num, data), role: fill(g.role, data), club: fill(g.club, data), colour: fill(g.colour, data), stats: (g.stats || []).map((s) => fill(s, data)), tonight: '', person: null };
}

// ── The beats, in order ────────────────────────────────────────────────────────────────────────
// How long a spoken line holds: the CPhL pacer's short floor, then 95 ms a character (hockey-pacing.js).
export const lineSeconds = (text) => Math.max(1.8, 0.5 + String(text).length * 0.095);

// One of a beat's lines, the same one for the same seed on every screen.
export function pickLine(beat, data, seed = '') {
  const lines = (beat.say?.lines || []).filter((l) => String(l).trim() && fillable(l, data));
  if (!lines.length) return null;
  return lines[hash(`${seed}|${beat.id}`) % lines.length];
}

// The people a sequence's roles name, with `speaker` set per beat. `cast` is role → { id, name, ... }.
const speakerData = (data, cast, role) => ({ ...data, ...Object.fromEntries(Object.entries(cast || {}).map(([k, v]) => [k, v])), speaker: cast?.[role] || {} });

// [{ i, beat, role, text, spoken, t0, dur, data }]: a beat with lines that can't be filled and no
// hold of its own is left out, so a missing fact loses the beat and never airs a hole.
export function timeline(seq, data = {}, { cast = {}, seed = '' } = {}) {
  const out = [];
  let t = 0;
  (seq?.beats || []).forEach((beat, i) => {
    const role = beat.say?.role || '';
    const d = speakerData(data, cast, role);
    if (!passes(beat.if, d)) return;
    const raw = beat.say?.lines?.length ? pickLine(beat, d, seed) : null;
    if (beat.say?.lines?.length && !raw && !beat.hold) return;
    const text = raw ? fill(raw, d).trim() : '';
    const dur = text ? lineSeconds(text) + (beat.pad || 0) : Math.max(0.4, beat.hold || 3);
    out.push({ i, beat, role, text, spoken: !!text, t0: t, dur, data: d });
    t += dur;
  });
  return out;
}
export const timelineLength = (tl) => (tl.length ? tl[tl.length - 1].t0 + tl[tl.length - 1].dur : 0);
export const beatAt = (tl, t) => { let n = 0; for (let i = 0; i < tl.length; i++) if (t >= tl[i].t0) n = i; return n; };

// What's up at `t`: each graphic of every beat, with a stable key, its text filled in that beat's data.
export function gfxAt(tl, t) {
  const out = [];
  for (const it of tl) {
    (it.beat.gfx || []).forEach((g, n) => {
      if (!passes(g.if, it.data)) return;
      const from = it.t0 + (g.at || 0), to = g.for ? from + g.for : it.t0 + it.dur;
      if (t >= from && t < to) out.push({ key: `${it.beat.id}:${n}`, g, data: it.data, left: to - t });
    });
  }
  return out;
}

// ── The set's geometry ─────────────────────────────────────────────────────────────────────────
// A set is in metres: u across, v back from the camera side, y up, as room-layout.js's frame.
export const eyeHeight = (pose) => (pose === 'sit' ? 1.2 : 1.6);

export function roleMark(set, seq, role) {
  const name = seq?.roles?.[role]?.mark || role;
  return set?.marks?.[name] || null;
}
// A place a shot can aim at: a role, or a mark by name.
function subjectPoint(set, seq, on) {
  const m = roleMark(set, seq, on) || set?.marks?.[on];
  return m ? [m.at[0], eyeHeight(m.pose), m.at[1]] : null;
}

const ease = (k) => k * k * (3 - 2 * k);
const lerp = (a, b, k) => a + (b - a) * k;
const FOV_MIN = 4, FOV_MAX = 62;

// The camera for a shot at `k` (0 to 1 through the beat): { eye, yaw, pitch, fov }, as gl/room.js
// takes it. `seconds` is the beat's own clock, which the handheld wobble runs on.
export function shotCamera(set, seq, shot = {}, k = 0, seconds = 0) {
  const c = set?.cameras?.[shot.cam] || Object.values(set?.cameras || {})[0] || { at: [0, 1], h: 1.5 };
  const ons = (Array.isArray(shot.on) ? shot.on : shot.on ? [shot.on] : []).map((o) => subjectPoint(set, seq, o)).filter(Boolean);
  const frame = FRAMES[shot.frame] || FRAMES.medium;
  const focus = set?.focus || [0, 1.1, (set?.room?.d || 8) / 2];
  const whole = frame.cover == null || !ons.length;
  let target = whole ? [focus[0], focus[1], focus[2]] : ons.reduce((s, p) => [s[0] + p[0] / ons.length, s[1] + p[1] / ons.length, s[2] + p[2] / ons.length], [0, 0, 0]);
  let eye = [c.at[0], c.h ?? 1.5, c.at[1]];
  const dist0 = Math.max(0.5, Math.hypot(target[0] - eye[0], target[1] - eye[1], target[2] - eye[2]));
  // two people have to fit across a 16:9 picture
  let spread = 0;
  for (const p of ons) spread = Math.max(spread, Math.hypot(p[0] - target[0], p[2] - target[2]) * 2);
  let cover = whole ? (set?.room?.h || 3.5) * 1.05 : Math.max(frame.cover, (spread + 0.9) / 1.6);
  // a head goes in the top third of the picture
  if (!whole) target = [target[0], target[1] - cover * 0.17, target[2]];

  const e = ease(Math.max(0, Math.min(1, k))), amt = shot.amt ?? 1, move = shot.move || 'none';
  let dyaw = 0;
  if (move === 'push') cover *= lerp(1.14, 1 - 0.08 * amt, e);
  else if (move === 'pull') cover *= lerp(1 - 0.08 * amt, 1.14, e);
  else if (move === 'drift') cover *= lerp(1.03, 0.98, e);
  else if (move === 'pan') dyaw = lerp(-0.09, 0.09, e) * amt;
  else if (move === 'truck' || move === 'orbit') {
    const dx = target[0] - eye[0], dz = target[2] - eye[2], d = Math.hypot(dx, dz) || 1;
    if (move === 'truck') { const s = lerp(-0.5, 0.5, e) * amt; eye = [eye[0] + (dz / d) * s, eye[1], eye[2] - (dx / d) * s]; } else {
      const a = lerp(-0.22, 0.22, e) * amt, ca = Math.cos(a), sa = Math.sin(a);
      eye = [target[0] - (dx * ca - dz * sa), eye[1], target[2] - (dx * sa + dz * ca)];
    }
  } else if (move === 'crane') eye = [eye[0], eye[1] + lerp(0.9, 0, e) * amt, eye[2]];

  const dx = target[0] - eye[0], dy = target[1] - eye[1], dz = target[2] - eye[2], flat = Math.hypot(dx, dz) || 0.001;
  const dist = Math.hypot(flat, dy) || dist0;
  let yaw = Math.atan2(dx, dz) + dyaw, pitch = Math.atan2(dy, flat);
  if (move === 'handheld') { yaw += Math.sin(seconds * 1.7) * 0.004 * amt + Math.sin(seconds * 3.1) * 0.002; pitch += Math.sin(seconds * 2.3) * 0.003 * amt; }
  const fov = Math.max(FOV_MIN, Math.min(FOV_MAX, 2 * Math.atan(cover / 2 / dist) * 180 / Math.PI));
  return { eye, yaw, pitch, fov };
}

// ── Live coverage ────────────────────────────────────────────────────────────────────────────────
// A show nobody made a sequence for is still a run of lines with a speaker each. This is the vision
// mixer for it: the speaker from the camera that faces them best, a two-shot when two people are going
// back and forth, the whole set for the announcer, and never the same camera twice running when
// another one will do. `prev` is the last shot and `said` how many lines this speaker has had.
const facingOf = (yaw) => { const a = (yaw ?? 180) * Math.PI / 180; return [Math.sin(a), Math.cos(a)]; };
export function camerasFacing(set, mark) {
  const f = facingOf(mark.yaw);
  return Object.entries(set?.cameras || {}).map(([id, c]) => {
    const dx = c.at[0] - mark.at[0], dv = c.at[1] - mark.at[1], d = Math.hypot(dx, dv) || 1;
    return { id, score: (dx * f[0] + dv * f[1]) / d - Math.max(0, (c.h ?? 1.5) - 2) * 0.3 };
  }).sort((a, b) => b.score - a.score);
}
export function autoShot(set, seq, role, { prev = null, prevRole = '', said = 0, n = 0 } = {}) {
  const cams = Object.entries(set?.cameras || {});
  if (!cams.length) return { cam: '', frame: 'full', move: 'none', cut: 'cut' };
  const mark = role ? roleMark(set, seq, role) : null;
  if (!mark) {
    // the announcer, or somebody with no seat: the whole set from the highest camera
    const high = cams.slice().sort((a, b) => (b[1].h ?? 1.5) - (a[1].h ?? 1.5))[0][0];
    return { cam: high, frame: 'full', on: [], move: 'drift', cut: prev ? 'dissolve' : 'cut' };
  }
  const best = camerasFacing(set, mark), other = prevRole && prevRole !== role && roleMark(set, seq, prevRole) ? prevRole : '';
  // back and forth: every third exchange is the pair of them
  if (other && n % 3 === 2) {
    const mid = { at: [(mark.at[0] + roleMark(set, seq, other).at[0]) / 2, (mark.at[1] + roleMark(set, seq, other).at[1]) / 2], yaw: mark.yaw };
    return { cam: camerasFacing(set, mid)[0].id, frame: 'two', on: [role, other], move: 'drift', cut: 'cut' };
  }
  let cam = best[0].id;
  if (cam === prev?.cam && best[1] && best[1].score > best[0].score - 0.35) cam = best[1].id;
  return { cam, frame: said === 0 ? 'medium' : said % 2 ? 'close' : 'medium', on: [role], move: said % 3 === 1 ? 'push' : 'drift', cut: 'cut' };
}

// ── Reading a .bsm into beats ──────────────────────────────────────────────────────────────────
// A linear script is already a shot list: a CAM line, then who speaks. `CAM — 2 — SNAP_TIGHT on Neil`
// is what the compiler keeps on a camera_cut node.
const CAM_WORDS = { WIDE: ['wide', 'none'], CLOSEUP: ['close', 'none'], MEDIUM: ['medium', 'none'], SNAP_TIGHT: ['tight', 'none'], TIGHT: ['tight', 'none'], PAN: ['medium', 'pan'], FOLLOW: ['medium', 'truck'], TRACK: ['medium', 'truck'], TRACKING: ['medium', 'truck'], HANDHELD: ['medium', 'handheld'], PULL_BACK: ['wide', 'pull'], PUSH: ['medium', 'push'], STATIC: ['medium', 'none'] };
export function parseCamLabel(label) {
  const m = /^CAM\s*[—-]\s*(\d+)\s*(?:[—-]\s*(.*))?$/.exec(String(label || '').trim());
  if (!m) return null;
  const words = (m[2] || '').trim().split(/\s+/), [frame, move] = CAM_WORDS[(words[0] || '').toUpperCase()] || ['medium', 'none'];
  const on = /\b(?:on|to)\s+(?:the\s+)?(.+)$/i.exec(m[2] || '');
  return { cam: `cam${m[1]}`, frame, move, on: on ? on[1].trim() : '' };
}

// A compiled .bsm (compileBsm) as a sequence: each spoken line a beat, on the last CAM line's shot.
// Speakers become roles in the order they appear, so a script drops onto any set with marks.
export function sequenceFromBsm(compiled, { id = 'seq_new', set = '' } = {}) {
  const nodes = compiled?.broadcastGraph?.nodes || {}, roles = {}, names = {}, beats = [];
  const roleOf = (npc) => {
    if (!npc) return '';
    if (!names[npc]) { const r = 'abcdefgh'[Object.keys(names).length] || `p${Object.keys(names).length}`; names[npc] = r; roles[r] = { mark: r, label: npc.replace(/^npc_/, '').replace(/_/g, ' '), npc }; }
    return names[npc];
  };
  let shot = { cam: 'cam1', frame: 'wide', move: 'none' }, speaker = '', pending = [], n = 0, cut = 'cut';
  const push = (b) => { beats.push({ id: `b${++n}`, shot: { ...shot, cut }, gfx: pending, ...b }); pending = []; cut = 'cut'; };
  for (let id = compiled?.broadcastGraph?._start, seen = new Set(); id && !seen.has(id); id = nodes[id]?.next) {
    seen.add(id);
    const nd = nodes[id];
    if (!nd) break;
    if (nd.type === 'camera_cut') {
      const c = parseCamLabel(nd.label);
      if (c) { const r = Object.entries(names).find(([npc]) => npc.includes(c.on.toLowerCase().split(' ')[0])); shot = { cam: c.cam, frame: c.frame, move: c.move, on: r ? r[1] : '' }; }
    } else if (nd.type === 'npc_anchor') speaker = roleOf(nd.npc_id);
    else if (nd.type === 'overlay' && nd.overlayType === 'lower_third') pending.push({ kind: 'lower', text: nd.text || '', sub: nd.subtext || '', at: 0.4, for: 5 });
    else if (nd.type === 'title_card') pending.push({ kind: 'full', title: nd.graphic_id || '', sub: '', at: 0, for: 0 });
    else if (nd.type === 'wait') push({ hold: nd.duration || 3 });
    else if (nd.type === 'say' && nd.text && nd.style !== 'ambient') {
      const role = nd.style === 'narration' ? '' : speaker;
      push({ say: { role, lines: [nd.text] }, shot: { ...shot, on: shot.on || role, cut } });
    }
  }
  if (pending.length) push({ hold: 3 });
  return { kind: 'sequence', format: SEQ_FORMAT, id, name: compiled?.meta?.name || id, set, roles, beats };
}

// ── Checking a document ────────────────────────────────────────────────────────────────────────
// What's wrong with a sequence on its set, as sentences. The Studio shows them and the gate fails on them.
export function checkSequence(seq, set) {
  const out = [];
  if (!seq?.id) out.push('the sequence has no id');
  if (!Array.isArray(seq?.beats) || !seq.beats.length) { out.push(`${seq?.id}: no beats`); return out; }
  if (!set) { out.push(`${seq.id}: no set`); return out; }
  const ids = new Set();
  seq.beats.forEach((b, i) => {
    const at = `${seq.id} beat ${i + 1}`;
    if (!b.id || ids.has(b.id)) out.push(`${at}: its id is missing or repeated`);
    ids.add(b.id);
    if (b.shot?.cam && !set.cameras?.[b.shot.cam]) out.push(`${at}: there's no camera ${b.shot.cam} on ${set.id}`);
    if (b.shot?.frame && !FRAMES[b.shot.frame]) out.push(`${at}: no framing called ${b.shot.frame}`);
    if (b.shot?.move && !MOVES[b.shot.move]) out.push(`${at}: no move called ${b.shot.move}`);
    if (b.shot?.cut && !CUTS[b.shot.cut]) out.push(`${at}: no cut called ${b.shot.cut}`);
    for (const on of [].concat(b.shot?.on || [])) if (!roleMark(set, seq, on) && !set.marks?.[on]) out.push(`${at}: the shot is on ${on}, who has no mark`);
    if (b.say?.role && !seq.roles?.[b.say.role]) out.push(`${at}: ${b.say.role} speaks and isn't a role`);
    if (b.say && !(b.say.lines || []).length && !b.hold) out.push(`${at}: a spoken beat with no lines`);
    for (const g of b.gfx || []) if (!GFX[g.kind]) out.push(`${at}: no graphic called ${g.kind}`);
    for (const c of [...(b.if || []), ...(b.gfx || []).flatMap((g) => g.if || [])]) if (!OPS[c.op]) out.push(`${at}: no condition called ${c.op}`);
  });
  for (const [r, v] of Object.entries(seq.roles || {})) if (!set.marks?.[v.mark || r]) out.push(`${seq.id}: role ${r} stands on ${v.mark || r}, which ${set.id} doesn't have`);
  return out;
}

// ── Kinds of show ──────────────────────────────────────────────────────────────────────────────
// What a show's `type` means to the Studio: the moments its broadcast calls `deskSegment` at, the
// roles a sequence for it usually has, the tokens its broadcast fills (as sample data), and the
// `Stage for` word a set takes to stand in for it. A moment here is a promise that the broadcast
// calls it: add one only with the call (plugins/broadcast/index.js). A kind with no moments can
// still be staged behind the TV's 3D button; it just can't play a sequence on air yet.
// `n` tells two calls at the same moment apart (the first and second break of a game).
export const SHOW_KINDS = Object.freeze({
  sports: {
    label: 'Sports',
    moments: [{ when: 'open', label: 'Pregame' }, { when: 'break', label: 'First break' }, { when: 'break', label: 'Second break', n: 1 }, { when: 'close', label: 'Final' }],
    roles: { a: 'Play-by-play', b: 'Analyst' }, simulated: true, stage: 'default', sample: {},
  },
  talkshow: {
    label: 'Talk show',
    moments: [{ when: 'open', label: 'At the desk, before the monologue' }, { when: 'close', label: 'The goodnight' }],
    roles: { a: 'Host', b: 'Sidekick' }, stage: 'talkshow',
    sample: { guest: 'Dovie Deeb', guest_first: 'Dovie', title: 'our special guest', host: 'John Akerson', host_first: 'John', sidekick: 'Graham Mercer', sidekick_first: 'Graham' },
  },
  news: {
    label: 'News',
    moments: [{ when: 'open', label: 'The intro, onto the lead story' }, { when: 'close', label: 'The outro' }],
    roles: { a: 'Anchor', b: 'Co-anchor' }, stage: 'news', castTokens: ['anchor', 'anchor2', 'announcer'],
    sample: { anchor: 'Brick Hardline', anchor2: 'Chastity Vale', announcer: 'The Voice of Raptor', headline: 'Power cut on the east shore', byline: 'our newsroom', stories: [{ headline: 'Power cut on the east shore' }, { headline: 'Ferry fares up again' }, { headline: 'Crows drop a third straight' }] },
  },
  morning: {
    label: 'Morning show',
    moments: [{ when: 'open', label: 'The cold open' }, { when: 'close', label: 'The sign-off' }],
    roles: { a: 'Host', b: 'Co-host' }, stage: 'default',
    sample: { host: 'the host', cohost: 'the co-host', time: '7:10', day: 'Tuesday', temp: 3, feels: -2, weather: 'light rain', hi: 6, lo: 1, tomorrow: 'overcast', tomorrowTemp: 5, wind: 18, precip: 70 },
  },
  weather: { label: 'Weather', moments: [], roles: { a: 'Forecaster' }, stage: 'default', sample: { tempC: 4, sky: 'rain' } },
  gameshow: { label: 'Game show', moments: [], roles: { a: 'Host', b: 'Contestant' }, stage: 'default', sample: {} },
  regular: { label: 'Other', moments: [], roles: { a: 'Left', b: 'Right' }, stage: 'default', sample: {} },
});
// A show's cast value that's a token, `{anchor}`: the broadcast names that person and no NPC plays them.
export const castToken = (v) => /^\{[\w.]+\}$/.test(String(v || ''));
export const kindOf = (show) => SHOW_KINDS[show?.type] || SHOW_KINDS.regular;
// A new show of a kind: a slot for each moment its broadcast calls, and its sample data.
export function showSkeleton(type, { id, name } = {}) {
  const k = SHOW_KINDS[type] || SHOW_KINDS.regular;
  const seen = new Set();
  const slots = k.moments.filter((m) => !seen.has(m.when) && seen.add(m.when)).map((m) => ({ id: m.when, label: m.label, when: m.when, sequence: '' }));
  return { kind: 'show', format: SEQ_FORMAT, id, name, type: SHOW_KINDS[type] ? type : 'regular', broadcast: '', live: false, cast: {}, slots, samples: { Example: structuredClone(k.sample) } };
}

// Which of a show's slots plays at a moment: the first with a sequence whose conditions pass, so a
// show lists its special cases above its usual one.
export const slotFor = (show, when, data = {}) => (show?.slots || []).find((s) => s.when === when && s.sequence && passes(s.if, data)) || null;

export function checkShow(show, docs) {
  const out = [];
  if (!show?.id) return ['the show has no id'];
  const k = kindOf(show), moments = new Set(k.moments.map((m) => m.when));
  for (const s of show.slots || []) {
    if (!s.sequence) continue;
    if (!moments.has(s.when)) out.push(moments.size ? `${show.id}: slot ${s.id} plays at "${s.when}", which a ${k.label.toLowerCase()} never calls (it calls ${[...moments].join(', ')})` : `${show.id}: slot ${s.id} plays at "${s.when}", but a ${k.label.toLowerCase()} doesn't call any moments yet`);
    const seq = docs[s.sequence];
    if (!seq) { out.push(`${show.id}: slot ${s.id} plays ${s.sequence}, which doesn't exist`); continue; }
    for (const r of Object.keys(seq.roles || {})) if (!show.cast?.[r]) out.push(`${show.id}: nobody's cast as ${r} for ${seq.id}`);
  }
  return out;
}
